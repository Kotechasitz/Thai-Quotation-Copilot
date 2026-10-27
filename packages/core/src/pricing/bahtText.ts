const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/**
 * Reads 0 < n < 1,000,000. `hasHigher` is true when a higher (million) group precedes it,
 * so a trailing 1 reads "เอ็ด" (the common BAHTTEXT convention: 1,000,001 -> หนึ่งล้านเอ็ด).
 */
function readGroup(n: number, hasHigher: boolean): string {
  const digits = String(n).padStart(6, '0');
  let out = '';
  let seenNonZero = hasHigher;
  for (let i = 0; i < 6; i++) {
    const d = Number(digits[i]);
    const place = 5 - i;
    if (d === 0) continue;
    if (place === 1) {
      out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${DIGITS[d]}สิบ`;
    } else if (place === 0) {
      out += d === 1 && seenNonZero ? 'เอ็ด' : DIGITS[d];
    } else {
      out += `${DIGITS[d]}${PLACES[place]}`;
    }
    seenNonZero = true;
  }
  return out;
}

function readInteger(n: number): string {
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000);
    const low = n - high * 1_000_000;
    return `${readInteger(high)}ล้าน${low > 0 ? readGroup(low, true) : ''}`;
  }
  return readGroup(n, false);
}

/** Thai amount in words from integer satang, e.g. 107050 -> หนึ่งพันเจ็ดสิบบาทห้าสิบสตางค์ */
export function bahtText(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) {
    throw new RangeError(`satang must be a non-negative safe integer, got ${String(satang)}`);
  }
  const baht = Math.floor(satang / 100);
  const sat = satang - baht * 100;
  if (baht === 0 && sat === 0) return 'ศูนย์บาทถ้วน';
  let out = baht > 0 ? `${readInteger(baht)}บาท` : '';
  out += sat === 0 ? 'ถ้วน' : `${readGroup(sat, false)}สตางค์`;
  return out;
}
