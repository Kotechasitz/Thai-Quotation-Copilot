/** In-memory Storage for tests (Node's own experimental localStorage shadows jsdom's). */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

/** Backend whose setItem throws QuotaExceededError for the listed keys (the probe always works). */
export function quotaStorage(failingKeys: string[], seed: Record<string, string> = {}): Storage {
  const base = memoryStorage();
  for (const [k, v] of Object.entries(seed)) base.setItem(k, v);
  return {
    get length() {
      return base.length;
    },
    clear: () => base.clear(),
    getItem: (k) => base.getItem(k),
    key: (i) => base.key(i),
    removeItem: (k) => base.removeItem(k),
    setItem: (k, v) => {
      if (failingKeys.includes(k)) throw new DOMException('full', 'QuotaExceededError');
      base.setItem(k, v);
    },
  };
}
