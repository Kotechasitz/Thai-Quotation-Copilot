/**
 * Parsers for the review screen's number inputs. They reject anything computeQuote would throw on
 * (too many decimals, negatives, NaN), so invalid text is shown as a Thai message and never dispatched.
 * Blank text parses to `null` ("not set").
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_QUANTITY = 1_000_000;
export const MAX_DISCOUNT_BAHT = 1_000_000_000;

interface Decimal {
  negative: boolean;
  integer: string;
  fraction: string;
}

const DECIMAL = /^(-?)(\d*)(?:\.(\d*))?$/;

function readDecimal(text: string): Decimal | null {
  const match = DECIMAL.exec(text);
  if (match === null) return null;
  const [, sign = '', integer = '', fraction = ''] = match;
  if (integer === '' && fraction === '') return null; // "", "-" or "." alone
  return { negative: sign === '-', integer, fraction };
}

/** Quantity: > 0, at most 3 decimals. */
export function parseQuantity(text: string): ParseResult<number | null> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const decimal = readDecimal(trimmed);
  if (decimal === null) return { ok: false, error: 'กรุณากรอกจำนวนเป็นตัวเลข' };
  if (decimal.fraction.length > 3) return { ok: false, error: 'จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง' };
  const value = Number(trimmed);
  if (decimal.negative || value <= 0) return { ok: false, error: 'จำนวนต้องมากกว่า 0' };
  if (value > MAX_QUANTITY) return { ok: false, error: 'จำนวนมากเกินไป' };
  return { ok: true, value };
}

/** Percentage 0-100 with at most 2 decimals. `label` names the field in messages. */
export function parsePercent(text: string, label = 'ส่วนลด'): ParseResult<number | null> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const decimal = readDecimal(trimmed);
  if (decimal === null) return { ok: false, error: `กรุณากรอก ${label} เป็นตัวเลข` };
  if (decimal.fraction.length > 2) return { ok: false, error: `${label} มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง` };
  const value = Number(trimmed);
  if (decimal.negative || value > 100) return { ok: false, error: `${label} ต้องอยู่ระหว่าง 0 ถึง 100%` };
  return { ok: true, value };
}

/** Baht amount (commas allowed, at most 2 decimals) -> integer satang, computed from the digits (no float math). */
export function parseBahtAsSatang(text: string, label = 'ส่วนลด'): ParseResult<number | null> {
  const trimmed = text.replace(/,/g, '').trim();
  if (trimmed === '') return { ok: true, value: null };
  const decimal = readDecimal(trimmed);
  if (decimal === null) return { ok: false, error: `กรุณากรอก ${label} เป็นตัวเลข` };
  if (decimal.negative) return { ok: false, error: `${label} ต้องไม่ติดลบ` };
  if (decimal.fraction.length > 2) return { ok: false, error: `${label} มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง` };
  const baht = Number(decimal.integer === '' ? '0' : decimal.integer);
  if (baht > MAX_DISCOUNT_BAHT) return { ok: false, error: 'จำนวนเงินมากเกินไป' };
  return { ok: true, value: baht * 100 + Number(decimal.fraction.padEnd(2, '0')) };
}
