// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, createStore, getDefaultStore, resetDefaultStore, useStoredState } from '@/lib/storage';
import { memoryStorage, quotaStorage } from './memory-storage';

const KEY = STORAGE_KEYS.draft;

function useBackend(backend: Storage) {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: backend });
  resetDefaultStore();
}

/** What a browser does in OTHER tabs when this tab's localStorage changes. */
function storageEvent(key: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key }));
}

beforeEach(() => useBackend(memoryStorage()));
afterEach(() => {
  cleanup();
  resetDefaultStore();
});

describe('cross-tab storage sync (createStore on the browser localStorage)', () => {
  it('re-reads a tracked key after a storage event, and notifies subscribers', () => {
    const store = createStore();
    store.set(KEY, { v: 1 }); // the in-memory copy now holds v1
    const listener = vi.fn();
    store.subscribe(listener);

    window.localStorage.setItem(KEY, JSON.stringify({ v: 2 })); // another tab wrote
    expect(store.get(KEY)).toEqual({ v: 1 }); // stale until the event arrives
    storageEvent(KEY);

    expect(store.get(KEY)).toEqual({ v: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats a removal in another tab as "no value"', () => {
    const store = createStore();
    store.set(KEY, { v: 1 });
    window.localStorage.removeItem(KEY);
    storageEvent(KEY);
    expect(store.get(KEY)).toBeNull();
  });

  it('drops every in-memory copy on key === null (storage cleared)', () => {
    const store = createStore();
    store.set(STORAGE_KEYS.draft, { v: 1 });
    store.set(STORAGE_KEYS.company, { c: 1 });
    window.localStorage.clear();
    storageEvent(null);
    expect(store.get(STORAGE_KEYS.draft)).toBeNull();
    expect(store.get(STORAGE_KEYS.company)).toBeNull();
  });

  it('clears the write-failed flag of the key so the warning does not outlive the stale copy', () => {
    useBackend(quotaStorage([KEY]));
    const store = createStore();
    expect(store.set(KEY, { v: 1 })).toBe(false);
    expect(store.writeFailed(KEY)).toBe(true);
    storageEvent(KEY);
    expect(store.writeFailed(KEY)).toBe(false);
    expect(store.get(KEY)).toBeNull(); // the failed write left nothing in storage
  });

  it('ignores events for keys it does not track', () => {
    const store = createStore();
    store.set(KEY, { v: 1 });
    const listener = vi.fn();
    store.subscribe(listener);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2 }));
    storageEvent('some.other.site.key');
    expect(store.get(KEY)).toEqual({ v: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', () => {
    const store = createStore();
    store.set(KEY, { v: 1 });
    store.dispose();
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2 }));
    storageEvent(KEY);
    expect(store.get(KEY)).toEqual({ v: 1 });
  });

  it('does not listen when given an explicit backend (tests, no-storage mode)', () => {
    const backend = memoryStorage();
    const store = createStore(backend);
    store.set(KEY, { v: 1 });
    backend.setItem(KEY, JSON.stringify({ v: 2 }));
    storageEvent(KEY);
    expect(store.get(KEY)).toEqual({ v: 1 });
  });

  it('refresh() re-reads storage but keeps a value whose write failed', () => {
    useBackend(quotaStorage(['tqc.company.v1']));
    const store = createStore();
    store.set(STORAGE_KEYS.company, { c: 1 }); // fails: memory only
    store.set(KEY, { v: 1 });
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2 }));
    store.refresh();
    expect(store.get(KEY)).toEqual({ v: 2 });
    expect(store.get(STORAGE_KEYS.company)).toEqual({ c: 1 });
  });
});

describe('useStoredState', () => {
  it('shows the new value after another tab changed it', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1 }));
    const { result } = renderHook(() => useStoredState<{ v: number } | null>(KEY, null));
    expect(result.current[0]).toEqual({ v: 1 });
    act(() => void getDefaultStore().set(KEY, { v: 1 })); // this tab touched it: memory copy exists

    act(() => {
      window.localStorage.setItem(KEY, JSON.stringify({ v: 2 }));
      storageEvent(KEY);
    });
    expect(result.current[0]).toEqual({ v: 2 });

    act(() => {
      window.localStorage.removeItem(KEY);
      storageEvent(KEY);
    });
    expect(result.current[0]).toBeNull();
  });
});
