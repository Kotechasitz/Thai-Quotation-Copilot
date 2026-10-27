import { roundHalfUpDiv } from './money.ts';

export type Discount = { type: 'percent'; value: number } | { type: 'amount'; satang: number };
export type WhtRate = 0 | 1 | 2 | 3 | 5;

export interface PricedLineInput {
  unitPriceSatang: number;
  quantity: number;
  discount: Discount | null;
}

export interface QuoteInput {
  lines: PricedLineInput[];
  billDiscount: Discount | null;
  vatRatePercent: number;
  pricesIncludeVat: boolean;
  whtRatePercent: WhtRate;
}

export interface LineTotals {
  grossSatang: number;
  discountSatang: number;
  netSatang: number;
}

export interface QuoteTotals {
  lines: LineTotals[];
  subtotalSatang: number;
  billDiscountSatang: number;
  afterDiscountSatang: number;
  vatBaseSatang: number;
  vatSatang: number;
  grandTotalSatang: number;
  whtSatang: number;
  netPayableSatang: number;
}

const WHT_RATES: readonly number[] = [0, 1, 2, 3, 5];
const EPSILON = 1e-6;

/** Percent value (<= 2 decimals) -> hundredths of a percent, e.g. 7.5 -> 750. */
function toBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

/** Quantity (<= 3 decimals) -> milli-units. */
function toMilli(quantity: number, lineIndex: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError(`line ${lineIndex}: quantity must be a non-negative finite number`);
  }
  const milli = Math.round(quantity * 1000);
  if (Math.abs(quantity * 1000 - milli) > EPSILON) {
    throw new RangeError(`line ${lineIndex}: quantity has more than 3 decimals`);
  }
  return milli;
}

/** Discount in satang, clamped to [0, base]. */
function discountSatang(discount: Discount | null, base: number, label: string): number {
  if (discount === null) return 0;
  if (discount.type === 'percent') {
    if (!Number.isFinite(discount.value)) {
      throw new RangeError(`${label}: percent discount must be finite`);
    }
    const bp = Math.min(Math.max(toBasisPoints(discount.value), 0), 10000);
    return Math.min(roundHalfUpDiv(base * bp, 10000), base);
  }
  if (!Number.isSafeInteger(discount.satang)) {
    throw new RangeError(`${label}: amount discount must be an integer number of satang`);
  }
  return Math.min(Math.max(discount.satang, 0), base);
}

export function computeQuote(input: QuoteInput): QuoteTotals {
  if (!Number.isFinite(input.vatRatePercent) || input.vatRatePercent < 0 || input.vatRatePercent > 100) {
    throw new RangeError('vatRatePercent must be within [0, 100]');
  }
  if (!WHT_RATES.includes(input.whtRatePercent)) {
    throw new RangeError('whtRatePercent must be one of 0, 1, 2, 3, 5');
  }
  const vatBp = toBasisPoints(input.vatRatePercent);

  const lines: LineTotals[] = input.lines.map((line, i) => {
    if (!Number.isSafeInteger(line.unitPriceSatang) || line.unitPriceSatang < 0) {
      throw new RangeError(`line ${i}: unitPriceSatang must be a non-negative safe integer`);
    }
    const milli = toMilli(line.quantity, i);
    const gross = roundHalfUpDiv(line.unitPriceSatang * milli, 1000);
    const discount = discountSatang(line.discount, gross, `line ${i}`);
    return { grossSatang: gross, discountSatang: discount, netSatang: gross - discount };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.netSatang, 0);
  if (!Number.isSafeInteger(subtotal)) throw new RangeError('subtotal exceeds safe integer range');
  const billDiscount = discountSatang(input.billDiscount, subtotal, 'bill discount');
  const afterDiscount = subtotal - billDiscount;

  let vatBase: number;
  let vat: number;
  let grandTotal: number;
  if (input.pricesIncludeVat) {
    vatBase = roundHalfUpDiv(afterDiscount * 10000, 10000 + vatBp);
    vat = afterDiscount - vatBase;
    grandTotal = afterDiscount;
  } else {
    vatBase = afterDiscount;
    vat = roundHalfUpDiv(afterDiscount * vatBp, 10000);
    grandTotal = afterDiscount + vat;
  }

  const wht = roundHalfUpDiv(vatBase * input.whtRatePercent, 100);

  return {
    lines,
    subtotalSatang: subtotal,
    billDiscountSatang: billDiscount,
    afterDiscountSatang: afterDiscount,
    vatBaseSatang: vatBase,
    vatSatang: vat,
    grandTotalSatang: grandTotal,
    whtSatang: wht,
    netPayableSatang: grandTotal - wht,
  };
}
