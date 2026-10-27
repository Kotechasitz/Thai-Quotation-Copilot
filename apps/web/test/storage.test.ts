import { describe, expect, it } from 'vitest';
import { memoryStorage as memoryBackend, quotaStorage as quotaBackend } from './memory-storage';
import { STORAGE_KEYS, MAX_LOGO_BYTES, createStore } from '@/lib/storage';

describe('storage constants', () => {
  it('uses the versioned keys', () => {
    expect(STORAGE_KEYS).toEqual({
      catalog: 'tqc.catalog.v1',
      company: 'tqc.company.v1',
      draft: 'tqc.draft.v1',
      counter: 'tqc.counter.v1',
    });
    expect(MAX_LOGO_BYTES).toBe(200 * 1024);
  });
});

describe('createStore with a working backend', () => {
  it('round-trips JSON through the backend and reports persistent', () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    expect(store.persistent).toBe(true);
    expect(store.set('k', { a: [1, 2], b: 'ไทย' })).toBe(true);
    expect(store.get('k')).toEqual({ a: [1, 2], b: 'ไทย' });
    expect(JSON.parse(backend.getItem('k') as string)).toEqual({ a: [1, 2], b: 'ไทย' });
  });

  it('reads values another store instance already saved (page refresh)', () => {
    const backend = memoryBackend();
    createStore(backend).set('k', 42);
    expect(createStore(backend).get<number>('k')).toBe(42);
  });

  it('returns null for a missing key', () => {
    expect(createStore(memoryBackend()).get('nope')).toBeNull();
  });

  it('returns null (does not throw) when the stored JSON is corrupt', () => {
    const backend = memoryBackend();
    backend.setItem('k', '{not json');
    expect(createStore(backend).get('k')).toBeNull();
  });
});

describe('createStore without localStorage (private window)', () => {
  it('is not persistent, set returns false, get returns the in-memory value', () => {
    const store = createStore(null);
    expect(store.persistent).toBe(false);
    expect(store.set('k', { n: 1 })).toBe(false);
    expect(store.get('k')).toEqual({ n: 1 });
    expect(store.get('other')).toBeNull();
  });
});

describe('createStore when the quota is exceeded', () => {
  it('does not throw, set returns false, writeFailed is true, value stays readable in memory', () => {
    const store = createStore(quotaBackend(['big']));
    expect(store.persistent).toBe(true);
    expect(() => store.set('big', 'x')).not.toThrow();
    expect(store.set('big', 'x')).toBe(false);
    expect(store.writeFailed('big')).toBe(true);
    expect(store.get('big')).toBe('x');
  });

  it('keeps persisting other keys after one write failed', () => {
    const backend = quotaBackend(['big']);
    const store = createStore(backend);
    expect(store.set('big', 'x')).toBe(false);
    expect(store.set('small', { ok: true })).toBe(true);
    expect(store.writeFailed('small')).toBe(false);
    expect(createStore(backend).get('small')).toEqual({ ok: true });
  });

  it('removes the stale stored value when a write fails so it cannot resurface on reload', () => {
    const base = memoryBackend();
    let full = false;
    const backend: Storage = {
      ...base,
      length: 0,
      setItem: (k, v) => {
        if (full && k === 'catalog') throw new DOMException('full', 'QuotaExceededError');
        base.setItem(k, v);
      },
    };
    const store = createStore(backend);
    expect(store.set('catalog', 'old')).toBe(true);
    expect(base.getItem('catalog')).toBe('"old"');

    full = true;
    expect(store.set('catalog', 'a much bigger value')).toBe(false);

    expect(base.getItem('catalog')).toBeNull();
    expect(createStore(backend).get('catalog')).toBeNull(); // a reload sees nothing, not the old one
    expect(store.get('catalog')).toBe('a much bigger value'); // this tab keeps the new value
  });

  it('clears writeFailed once a later write of the same key succeeds', () => {
    const backend = quotaBackend([]);
    let full = true;
    const flaky: Storage = {
      ...backend,
      length: 0,
      setItem: (k, v) => {
        if (full && k === 'k') throw new DOMException('full', 'QuotaExceededError');
        backend.setItem(k, v);
      },
    };
    const store = createStore(flaky);
    expect(store.set('k', 1)).toBe(false);
    expect(store.writeFailed('k')).toBe(true);
    full = false;
    expect(store.set('k', 2)).toBe(true);
    expect(store.writeFailed('k')).toBe(false);
  });

  it('notifies subscribers on every set, and stops after unsubscribe', () => {
    const store = createStore(quotaBackend(['k']));
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.set('k', 1);
    expect(calls).toBeGreaterThan(0);
    unsubscribe();
    const before = calls;
    store.set('k', 2);
    expect(calls).toBe(before);
  });
});

describe('createStore when the backend is unusable at probe time', () => {
  it('reports not persistent; set returns false and the value stays in memory', () => {
    const broken = {
      ...memoryBackend(),
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as Storage;
    const store = createStore(broken);
    expect(store.persistent).toBe(false);
    expect(store.set('k', 1)).toBe(false);
    expect(store.writeFailed('k')).toBe(true);
    expect(store.get('k')).toBe(1);
  });
});
