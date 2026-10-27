import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS, createStore } from '@/lib/storage';
import { nextQuoteNumber } from '@/lib/quoteNumber';
import { memoryStorage } from './memory-storage';

const OCT_2026 = new Date('2026-10-22T05:00:00.000Z');
const NOV_2026 = new Date('2026-11-03T05:00:00.000Z');

describe('nextQuoteNumber', () => {
  it('counts up within a month: 001, 002, 003', () => {
    const store = createStore(memoryStorage());
    expect(nextQuoteNumber(store, OCT_2026)).toBe('QT-256910-001');
    expect(nextQuoteNumber(store, OCT_2026)).toBe('QT-256910-002');
    expect(nextQuoteNumber(store, new Date('2026-10-30T05:00:00.000Z'))).toBe('QT-256910-003');
  });

  it('starts again at 001 in the next month', () => {
    const store = createStore(memoryStorage());
    nextQuoteNumber(store, OCT_2026);
    nextQuoteNumber(store, OCT_2026);
    expect(nextQuoteNumber(store, NOV_2026)).toBe('QT-256911-001');
    expect(nextQuoteNumber(store, NOV_2026)).toBe('QT-256911-002');
  });

  it('takes the month in Asia/Bangkok, not UTC', () => {
    const store = createStore(memoryStorage());
    // 18:00 UTC on 30 Sep is already 1 Oct in Bangkok.
    expect(nextQuoteNumber(store, new Date('2026-09-30T18:00:00.000Z'))).toBe('QT-256910-001');
    // 16:00 UTC on 31 Oct is still 31 Oct in Bangkok.
    expect(nextQuoteNumber(store, new Date('2026-10-31T16:00:00.000Z'))).toBe('QT-256910-002');
  });

  it('keeps the counter in storage so a reload continues the sequence', () => {
    const backend = memoryStorage();
    nextQuoteNumber(createStore(backend), OCT_2026);
    expect(JSON.parse(backend.getItem(STORAGE_KEYS.counter) ?? 'null')).toEqual({ month: '256910', seq: 1 });
    expect(nextQuoteNumber(createStore(backend), OCT_2026)).toBe('QT-256910-002');
  });

  it('ignores a corrupt or wrong-shape counter and starts at 001', () => {
    const bad = ['not json', '{"month":5,"seq":"x"}', '{"month":"256910","seq":-4}', '{"month":"256910","seq":1.5}', 'null'];
    for (const raw of bad) {
      const backend = memoryStorage();
      backend.setItem(STORAGE_KEYS.counter, raw);
      expect(nextQuoteNumber(createStore(backend), OCT_2026)).toBe('QT-256910-001');
    }
  });

  it('still hands out numbers when storage is unavailable (memory only)', () => {
    const store = createStore(null);
    expect(nextQuoteNumber(store, OCT_2026)).toBe('QT-256910-001');
    expect(nextQuoteNumber(store, OCT_2026)).toBe('QT-256910-002');
  });
});
