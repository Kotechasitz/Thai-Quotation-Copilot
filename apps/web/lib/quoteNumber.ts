import { formatQuoteNumber } from '@tqc/core';
import { STORAGE_KEYS, type Store } from '@/lib/storage';

/** What is saved under STORAGE_KEYS.counter: the last sequence handed out in a Buddhist-era month. */
interface QuoteCounter {
  /** BE year + month in Asia/Bangkok, e.g. '256910'. */
  month: string;
  seq: number;
}

function readCounter(store: Store): QuoteCounter | null {
  const raw = store.get<unknown>(STORAGE_KEYS.counter);
  if (typeof raw !== 'object' || raw === null) return null;
  const { month, seq } = raw as Record<string, unknown>;
  if (typeof month !== 'string' || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
  return { month, seq };
}

/**
 * Hands out the next quote number for the month `date` falls in (Asia/Bangkok): QT-256910-001, -002, ...
 * The sequence restarts at 001 in a new month, and a missing or unreadable counter starts at 001 too.
 * Each call uses up one number, so call it only when a number is actually going on a document.
 */
export function nextQuoteNumber(store: Store, date: Date): string {
  const month = /^QT-(\d+)-/.exec(formatQuoteNumber(date, 1))?.[1] ?? '';
  const counter = readCounter(store);
  const seq = (counter !== null && counter.month === month ? counter.seq : 0) + 1;
  store.set(STORAGE_KEYS.counter, { month, seq } satisfies QuoteCounter);
  return formatQuoteNumber(date, seq);
}
