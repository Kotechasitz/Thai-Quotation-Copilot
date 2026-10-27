import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Catalog } from '@tqc/core';

export const STORAGE_KEYS = {
  catalog: 'tqc.catalog.v1',
  company: 'tqc.company.v1',
  draft: 'tqc.draft.v1',
  counter: 'tqc.counter.v1',
} as const;

export const MAX_LOGO_BYTES = 200 * 1024;

/** What the catalog page saves under STORAGE_KEYS.catalog. */
export interface StoredCatalog {
  catalog: Catalog;
  /** File name, or the sample's name, the catalog was imported from. */
  sourceName: string;
  rowCount: number;
  /** ISO timestamp. */
  savedAt: string;
}

export interface Store {
  /** Parsed value, or null when missing or unreadable (corrupt JSON). */
  get<T>(key: string): T | null;
  /** Always keeps the value in memory; returns true only when it was also written to storage.
   *  A failed write removes the key from storage so an older value cannot come back on reload. */
  set(key: string, value: unknown): boolean;
  /** False when storage is unavailable altogether (private window, blocked). */
  readonly persistent: boolean;
  /** True when the LAST write of this key did not reach storage (e.g. quota exceeded). */
  writeFailed(key: string): boolean;
  /** Raw JSON snapshot for useSyncExternalStore (stable string identity between changes). */
  getRaw(key: string): string | null;
  subscribe(listener: () => void): () => void;
  /** Re-reads every tracked key from storage (keys whose last write failed keep their memory copy) and notifies. */
  refresh(): void;
  /** Stops listening for other tabs' changes. */
  dispose(): void;
}

const PROBE_KEY = '__tqc_probe__';
const TRACKED_KEYS: ReadonlySet<string> = new Set(Object.values(STORAGE_KEYS));

/**
 * localStorage-backed store that degrades to memory-only. `backend` undefined = the browser's
 * localStorage (when reachable), null = no storage at all.
 */
export function createStore(backend?: Storage | null): Store {
  let storage: Storage | null = null;
  if (backend === undefined) {
    try {
      storage = typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      storage = null; // accessing localStorage can itself throw (blocked cookies / sandboxed frame)
    }
  } else {
    storage = backend;
  }

  let persistent = false;
  if (storage !== null) {
    try {
      storage.setItem(PROBE_KEY, '1');
      storage.removeItem(PROBE_KEY);
      persistent = true;
    } catch {
      persistent = false;
    }
  }

  // The memory copy always holds the newest value, so the app keeps working when writes fail.
  const memory = new Map<string, string>();
  const failedKeys = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const getRaw = (key: string): string | null => {
    const inMemory = memory.get(key);
    if (inMemory !== undefined) return inMemory;
    if (storage === null) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };

  // Another tab changed localStorage: our memory copy is now stale, so drop it and let readers re-read.
  // (The `storage` event is never delivered to the tab that made the change.) Browser localStorage only.
  const onStorageEvent = (event: StorageEvent) => {
    if (event.storageArea !== null && event.storageArea !== storage) return;
    if (event.key === null) {
      memory.clear();
      failedKeys.clear();
    } else if (TRACKED_KEYS.has(event.key)) {
      memory.delete(event.key);
      failedKeys.delete(event.key);
    } else {
      return;
    }
    notify();
  };
  const listensToWindow = backend === undefined && storage !== null && typeof window !== 'undefined';
  if (listensToWindow) window.addEventListener('storage', onStorageEvent);

  return {
    get<T>(key: string): T | null {
      const raw = getRaw(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      // Every write is attempted on its own: one failure (a big catalog over the quota) must not
      // stop later small writes (the company profile) from being saved.
      let written = false;
      if (storage !== null) {
        try {
          storage.setItem(key, raw);
          written = true;
        } catch {
          try {
            storage.removeItem(key); // never leave the previous value to resurface after a reload
          } catch {
            // nothing more we can do
          }
        }
      }
      if (written) failedKeys.delete(key);
      else failedKeys.add(key);
      notify();
      return written;
    },
    get persistent() {
      return persistent;
    },
    writeFailed: (key) => failedKeys.has(key),
    getRaw,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh() {
      for (const key of TRACKED_KEYS) {
        if (!failedKeys.has(key)) memory.delete(key);
      }
      notify();
    },
    dispose() {
      if (listensToWindow) window.removeEventListener('storage', onStorageEvent);
    },
  };
}

let defaultStore: Store | null = null;

/** The shared browser store. Only call on the client (inside effects, handlers or snapshots). */
export function getDefaultStore(): Store {
  defaultStore ??= createStore();
  return defaultStore;
}

/** Test seam: forget the shared store so the next use re-detects localStorage. */
export function resetDefaultStore(): void {
  defaultStore?.dispose();
  defaultStore = null;
}

const NOOP_SUBSCRIBE = () => () => {};

/**
 * Persistent state. The server render and the first client render both use `initial`; after
 * hydration the stored value takes over (useSyncExternalStore reconciles that without a mismatch).
 *
 * `parse` validates the decoded JSON (e.g. a zod safeParse wrapper): returning null means
 * "wrong shape" and the hook falls back to `initial`. Pass module-level constants for `initial`
 * and `parse` so the value keeps a stable identity.
 *
 * The setter returns true only when the value also reached storage.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  parse?: (raw: unknown) => T | null,
): [T, (value: T) => boolean, { persistent: boolean; writeFailed: boolean }] {
  const subscribe = useCallback(
    (listener: () => void) =>
      typeof window === 'undefined' ? NOOP_SUBSCRIBE() : getDefaultStore().subscribe(listener),
    [],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => getDefaultStore().getRaw(key),
    () => null,
  );
  const persistent = useSyncExternalStore(
    subscribe,
    () => getDefaultStore().persistent,
    () => true,
  );
  const writeFailed = useSyncExternalStore(
    subscribe,
    () => getDefaultStore().writeFailed(key),
    () => false,
  );

  const value = useMemo<T>(() => {
    if (raw === null) return initial;
    try {
      const decoded: unknown = JSON.parse(raw);
      if (parse === undefined) return decoded as T;
      return parse(decoded) ?? initial;
    } catch {
      return initial;
    }
  }, [raw, initial, parse]);

  const setValue = useCallback((next: T) => getDefaultStore().set(key, next), [key]);

  return [value, setValue, { persistent, writeFailed }];
}
