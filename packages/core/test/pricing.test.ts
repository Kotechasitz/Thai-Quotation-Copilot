import { describe, expect, it } from 'vitest';
import {
  computeQuote,
  formatBaht,
  roundHalfUpDiv,
  type QuoteInput,
} from '../src/index.ts';

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  lines: [],
  billDiscount: null,
  vatRatePercent: 7,
  pricesIncludeVat: false,
  whtRatePercent: 0,
  ...over,
});

describe('roundHalfUpDiv', () => {
  it('rounds half up exactly', () => {
    expect(roundHalfUpDiv(5, 2)).toBe(3);
    expect(roundHalfUpDiv(4, 2)).toBe(2);
    expect(roundHalfUpDiv(1, 3)).toBe(0);
    expect(roundHalfUpDiv(2, 3)).toBe(1);
    expect(roundHalfUpDiv(0, 7)).toBe(0);
    expect(roundHalfUpDiv(4247875, 1000)).toBe(4248);
  });
  it('is exact near the safe-integer limit', () => {
    expect(roundHalfUpDiv(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(roundHalfUpDiv(Number.MAX_SAFE_INTEGER - 1, 2)).toBe((Number.MAX_SAFE_INTEGER - 1) / 2);
  });
  it('rejects bad inputs', () => {
    expect(() => roundHalfUpDiv(1, 0)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1, -2)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1.5, 2)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1, 1.5)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(Number.NaN, 2)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(Number.MAX_SAFE_INTEGER + 2, 2)).toThrow(RangeError);
  });
});

describe('computeQuote', () => {
  it('VAT exclusive with bill discount and WHT', () => {
    const t = computeQuote(
      base({
        lines: [
          { unitPriceSatang: 100000, quantity: 3, discount: null },
          { unitPriceSatang: 25050, quantity: 2, discount: null },
        ],
        billDiscount: { type: 'percent', value: 10 },
        whtRatePercent: 3,
      }),
    );
    expect(t.subtotalSatang).toBe(350100);
    expect(t.billDiscountSatang).toBe(35010);
    expect(t.afterDiscountSatang).toBe(315090);
    expect(t.vatBaseSatang).toBe(315090);
    expect(t.vatSatang).toBe(22056);
    expect(t.grandTotalSatang).toBe(337146);
    expect(t.whtSatang).toBe(9453);
    expect(t.netPayableSatang).toBe(327693);
    expect(t.lines).toEqual([
      { grossSatang: 300000, discountSatang: 0, netSatang: 300000 },
      { grossSatang: 50100, discountSatang: 0, netSatang: 50100 },
    ]);
  });

  it('VAT inclusive', () => {
    const t = computeQuote(
      base({
        lines: [{ unitPriceSatang: 107000, quantity: 1, discount: null }],
        pricesIncludeVat: true,
        whtRatePercent: 3,
      }),
    );
    expect(t.vatBaseSatang).toBe(100000);
    expect(t.vatSatang).toBe(7000);
    expect(t.grandTotalSatang).toBe(107000);
    expect(t.whtSatang).toBe(3000);
    expect(t.netPayableSatang).toBe(104000);
  });

  it('VAT inclusive with fractional VAT rate scales consistently', () => {
    const t = computeQuote(
      base({
        lines: [{ unitPriceSatang: 107500, quantity: 1, discount: null }],
        pricesIncludeVat: true,
        vatRatePercent: 7.5,
      }),
    );
    expect(t.vatBaseSatang).toBe(100000);
    expect(t.vatSatang).toBe(7500);
    expect(t.grandTotalSatang).toBe(107500);
  });

  it('VAT exclusive with fractional VAT rate', () => {
    const t = computeQuote(
      base({
        lines: [{ unitPriceSatang: 100000, quantity: 1, discount: null }],
        vatRatePercent: 7.5,
      }),
    );
    expect(t.vatSatang).toBe(7500);
    expect(t.grandTotalSatang).toBe(107500);
  });

  it('rounds half up for quantity and percent discount', () => {
    const t = computeQuote(
      base({
        lines: [
          { unitPriceSatang: 333, quantity: 1.5, discount: null },
          { unitPriceSatang: 1005, quantity: 1, discount: { type: 'percent', value: 10 } },
        ],
      }),
    );
    expect(t.lines[0]).toEqual({ grossSatang: 500, discountSatang: 0, netSatang: 500 });
    expect(t.lines[1]).toEqual({ grossSatang: 1005, discountSatang: 101, netSatang: 904 });
  });

  it('supports percent discounts with 2 decimals', () => {
    const t = computeQuote(
      base({ lines: [{ unitPriceSatang: 10000, quantity: 1, discount: { type: 'percent', value: 12.5 } }] }),
    );
    expect(t.lines[0]?.discountSatang).toBe(1250);
  });

  it('amount discount on a line', () => {
    const t = computeQuote(
      base({ lines: [{ unitPriceSatang: 20000, quantity: 1, discount: { type: 'amount', satang: 5000 } }] }),
    );
    expect(t.lines[0]).toEqual({ grossSatang: 20000, discountSatang: 5000, netSatang: 15000 });
  });

  it('3-decimal quantity', () => {
    const t = computeQuote(base({ lines: [{ unitPriceSatang: 1999, quantity: 2.125, discount: null }] }));
    expect(t.lines[0]?.grossSatang).toBe(4248);
  });

  it('quantity 0 gives a zero line', () => {
    const t = computeQuote(base({ lines: [{ unitPriceSatang: 1999, quantity: 0, discount: null }] }));
    expect(t.lines[0]).toEqual({ grossSatang: 0, discountSatang: 0, netSatang: 0 });
    expect(t.grandTotalSatang).toBe(0);
  });

  it('clamps discounts (Review Focus 5)', () => {
    const t = computeQuote(
      base({
        lines: [
          { unitPriceSatang: 10000, quantity: 1, discount: { type: 'amount', satang: 99999 } },
          { unitPriceSatang: 10000, quantity: 1, discount: { type: 'percent', value: 150 } },
          { unitPriceSatang: 10000, quantity: 1, discount: { type: 'percent', value: -5 } },
          { unitPriceSatang: 10000, quantity: 1, discount: { type: 'amount', satang: -100 } },
        ],
      }),
    );
    expect(t.lines[0]).toEqual({ grossSatang: 10000, discountSatang: 10000, netSatang: 0 });
    expect(t.lines[1]).toEqual({ grossSatang: 10000, discountSatang: 10000, netSatang: 0 });
    expect(t.lines[2]).toEqual({ grossSatang: 10000, discountSatang: 0, netSatang: 10000 });
    expect(t.lines[3]).toEqual({ grossSatang: 10000, discountSatang: 0, netSatang: 10000 });
    expect(t.subtotalSatang).toBe(20000);
  });

  it('clamps bill discount to subtotal', () => {
    const lines = [{ unitPriceSatang: 10000, quantity: 1, discount: null }];
    const a = computeQuote(base({ lines, billDiscount: { type: 'amount', satang: 999999 } }));
    expect(a.billDiscountSatang).toBe(10000);
    expect(a.afterDiscountSatang).toBe(0);
    expect(a.grandTotalSatang).toBe(0);
    const b = computeQuote(base({ lines, billDiscount: { type: 'percent', value: 150 } }));
    expect(b.afterDiscountSatang).toBe(0);
    const c = computeQuote(base({ lines, billDiscount: { type: 'amount', satang: -1 } }));
    expect(c.billDiscountSatang).toBe(0);
  });

  it('empty quote is all zeros', () => {
    const t = computeQuote(base({ whtRatePercent: 3 }));
    expect(t).toEqual({
      lines: [],
      subtotalSatang: 0,
      billDiscountSatang: 0,
      afterDiscountSatang: 0,
      vatBaseSatang: 0,
      vatSatang: 0,
      grandTotalSatang: 0,
      whtSatang: 0,
      netPayableSatang: 0,
    });
  });

  it('rejects invalid input with RangeError', () => {
    const line = (over: object) =>
      base({ lines: [{ unitPriceSatang: 100, quantity: 1, discount: null, ...over }] });
    expect(() => computeQuote(line({ unitPriceSatang: -1 }))).toThrow(RangeError);
    expect(() => computeQuote(line({ unitPriceSatang: 1.5 }))).toThrow(RangeError);
    expect(() => computeQuote(line({ unitPriceSatang: Number.NaN }))).toThrow(RangeError);
    expect(() => computeQuote(line({ unitPriceSatang: Number.MAX_SAFE_INTEGER + 2 }))).toThrow(RangeError);
    expect(() => computeQuote(line({ quantity: -1 }))).toThrow(RangeError);
    expect(() => computeQuote(line({ quantity: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
    expect(() => computeQuote(line({ quantity: Number.NaN }))).toThrow(RangeError);
    expect(() => computeQuote(line({ quantity: 1.0001 }))).toThrow(RangeError);
    expect(() => computeQuote(base({ vatRatePercent: -1 }))).toThrow(RangeError);
    expect(() => computeQuote(base({ vatRatePercent: 100.5 }))).toThrow(RangeError);
    expect(() => computeQuote(base({ vatRatePercent: Number.NaN }))).toThrow(RangeError);
    expect(() => computeQuote(base({ whtRatePercent: 4 as never }))).toThrow(RangeError);
    expect(() => computeQuote(base({ whtRatePercent: -1 as never }))).toThrow(RangeError);
  });

  it('accepts floating-point quantities that are exactly 3 decimals', () => {
    const t = computeQuote(base({ lines: [{ unitPriceSatang: 1000, quantity: 1.1, discount: null }] }));
    expect(t.lines[0]?.grossSatang).toBe(1100);
  });

  it('stays exact on large amounts', () => {
    const t = computeQuote(
      base({
        lines: [
          { unitPriceSatang: 99_999_999_999, quantity: 7, discount: { type: 'percent', value: 33.33 } },
        ],
      }),
    );
    const gross = 99999999999n * 7n;
    const disc = (gross * 3333n + 5000n) / 10000n;
    expect(t.lines[0]?.grossSatang).toBe(Number(gross));
    expect(t.lines[0]?.discountSatang).toBe(Number(disc));
  });
});

describe('formatBaht', () => {
  it('formats satang with thousands separators', () => {
    expect(formatBaht(125000)).toBe('1,250.00');
    expect(formatBaht(5)).toBe('0.05');
    expect(formatBaht(0)).toBe('0.00');
    expect(formatBaht(123456789)).toBe('1,234,567.89');
    expect(formatBaht(100000000)).toBe('1,000,000.00');
  });
  it('rejects negative or non-integer input', () => {
    expect(() => formatBaht(-1)).toThrow(RangeError);
    expect(() => formatBaht(1.5)).toThrow(RangeError);
  });
});
