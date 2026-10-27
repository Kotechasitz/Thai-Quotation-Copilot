/**
 * Integer money helpers. Money is always integer satang; no float multiplication.
 */

function assertSafeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${String(value)}`);
  }
}

/**
 * Exact round-half-up integer division for non-negative safe integers.
 * Uses floor + remainder so no intermediate float rounding occurs.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  assertSafeInt(numerator, 'numerator');
  assertSafeInt(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator must be > 0');
  if (numerator < 0) throw new RangeError('numerator must be >= 0');
  const q = Math.floor(numerator / denominator);
  // Float division can be off by one near the safe limit; fix up with exact modulo arithmetic.
  let quotient = q;
  let remainder = numerator - quotient * denominator;
  while (remainder < 0) {
    quotient -= 1;
    remainder += denominator;
  }
  while (remainder >= denominator) {
    quotient += 1;
    remainder -= denominator;
  }
  // half-up: remainder >= denominator / 2  <=>  remainder >= denominator - remainder
  return remainder >= denominator - remainder ? quotient + 1 : quotient;
}

/** 125000 -> "1,250.00". Non-negative integer satang only. */
export function formatBaht(satang: number): string {
  assertSafeInt(satang, 'satang');
  if (satang < 0) throw new RangeError('satang must be >= 0');
  const baht = Math.floor(satang / 100);
  const frac = satang - baht * 100;
  const whole = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${String(frac).padStart(2, '0')}`;
}
