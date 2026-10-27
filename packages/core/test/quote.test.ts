import { describe, expect, it } from 'vitest';
import { formatQuoteNumber, formatThaiDate } from '../src/index.ts';

describe('formatQuoteNumber', () => {
  it('formats Buddhist-era year+month and pads the sequence to 3 digits', () => {
    const d = new Date('2026-10-22T10:00:00+07:00');
    expect(formatQuoteNumber(d, 1)).toBe('QT-256910-001');
    expect(formatQuoteNumber(d, 12)).toBe('QT-256910-012');
    expect(formatQuoteNumber(d, 1000)).toBe('QT-256910-1000');
  });

  it('uses Asia/Bangkok for year and month', () => {
    // 2026-09-30T20:00Z is already 2026-10-01 03:00 in Bangkok
    expect(formatQuoteNumber(new Date('2026-09-30T20:00:00Z'), 5)).toBe('QT-256910-005');
    // 2026-12-31T16:59Z is still 2026-12-31 in Bangkok; 17:00Z rolls to 2027-01
    expect(formatQuoteNumber(new Date('2026-12-31T16:59:00Z'), 5)).toBe('QT-256912-005');
    expect(formatQuoteNumber(new Date('2026-12-31T17:00:00Z'), 5)).toBe('QT-257001-005');
  });

  it('rejects non-positive / non-integer / unsafe sequences', () => {
    const d = new Date('2026-10-22T10:00:00+07:00');
    for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatQuoteNumber(d, bad)).toThrow(RangeError);
    }
  });

  it('rejects an invalid date', () => {
    expect(() => formatQuoteNumber(new Date('nope'), 1)).toThrow(RangeError);
  });
});

describe('formatThaiDate', () => {
  it('formats an ISO date in the Buddhist era without timezone shift', () => {
    expect(formatThaiDate('2026-10-22')).toBe('22 ตุลาคม 2569');
    expect(formatThaiDate('2026-01-01')).toBe('1 มกราคม 2569');
    expect(formatThaiDate('2026-12-31')).toBe('31 ธันวาคม 2569');
  });

  it('rejects malformed dates', () => {
    expect(() => formatThaiDate('22/10/2026')).toThrow(RangeError);
    expect(() => formatThaiDate('2026-02-30')).toThrow(RangeError);
    expect(() => formatThaiDate('')).toThrow(RangeError);
  });
});
