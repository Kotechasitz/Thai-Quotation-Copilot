const BUDDHIST_LATN = 'th-TH-u-ca-buddhist-nu-latn';

const bangkokYearMonth = new Intl.DateTimeFormat(BUDDHIST_LATN, {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'Asia/Bangkok',
});

const thaiDateParts = new Intl.DateTimeFormat(BUDDHIST_LATN, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((p) => p.type === type)?.value;
  if (value === undefined) throw new Error(`Intl did not return a "${type}" part`);
  return value;
}

/** QT-<BE year><MM>-<seq>, e.g. QT-256910-001. Year/month are taken in Asia/Bangkok. */
export function formatQuoteNumber(date: Date, sequence: number): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('date is invalid');
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('sequence must be a positive safe integer');
  }
  const parts = bangkokYearMonth.formatToParts(date);
  const year = part(parts, 'year');
  const month = part(parts, 'month').padStart(2, '0');
  return `QT-${year}${month}-${String(sequence).padStart(3, '0')}`;
}

/** '2026-10-22' -> '22 ตุลาคม 2569'. Date-only strings are calendar dates (no timezone shift). */
export function formatThaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) throw new RangeError(`invalid ISO date: ${iso}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999, and rolls over invalid days (e.g. Feb 30).
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`invalid ISO date: ${iso}`);
  }
  const parts = thaiDateParts.formatToParts(utc);
  return `${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
}
