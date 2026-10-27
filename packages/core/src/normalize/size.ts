import type { Size } from '../types.ts';
import { normalizeText } from './text.ts';

const VULGAR_FRACTIONS: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4' };

// Expand ½ ¼ ¾ before NFKC, which would glue them to a preceding digit ("1½" -> "11⁄2").
function prepare(s: string): string {
  return normalizeText(s.replace(/[½¼¾]/g, (c) => ` ${VULGAR_FRACTIONS[c]}`)).replace(
    /⁄/g,
    '/',
  );
}

const INCH = String.raw`(?:นิ้ว|inch(?:es)?\b|in\b|"|”|“|″|′′|'')`;
const HUN = /(\d+(?:\.\d+)?)\s*หุน/;
// Mixed number: the whole part is at most 2 digits and must not be the tail of a decimal
// ("8.5 1/2 in" is 8.5 then 1/2 in, not 5 1/2 in).
const FRACTION_INCH = new RegExp(
  String.raw`(?:(?<![\d.])(\d{1,2})\s+)?(\d+)\s*/\s*(\d+)\s*${INCH}`,
);
// Real pipe sizes top out around 12 in; a larger leading number is a separate quantity/spec
// ("20 1/2 นิ้ว" is 20 of something, then 1/2 in).
const MAX_MIXED_WHOLE = 12;
const DECIMAL_INCH = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${INCH}`);
const MM = /(\d+(?:\.\d+)?)\s*(?:มม\.?|mm\b)/;

/** Pipe/fitting size: หุน (1/8"), inches (decimal or fraction), or millimetres. */
export function extractSize(s: string): Size | null {
  const t = prepare(s);

  const hun = HUN.exec(t);
  if (hun) return { value: Number(hun[1]) / 8, unit: 'in' };

  const frac = FRACTION_INCH.exec(t);
  if (frac) {
    const denominator = Number(frac[3]);
    const whole = Number(frac[1] ?? 0);
    if (denominator !== 0) {
      return {
        value: (whole <= MAX_MIXED_WHOLE ? whole : 0) + Number(frac[2]) / denominator,
        unit: 'in',
      };
    }
  }

  const inch = DECIMAL_INCH.exec(t);
  if (inch) return { value: Number(inch[1]), unit: 'in' };

  const mm = MM.exec(t);
  if (mm) return { value: Number(mm[1]), unit: 'mm' };

  return null;
}

const ANGLE = /(\d+(?:\.\d+)?)\s*(?:องศา|°|º|deg(?:rees?)?\b)/;

/** Elbow/bend angle in degrees, e.g. "90 องศา", "45°". */
export function extractAngle(s: string): number | null {
  const m = ANGLE.exec(normalizeText(s));
  return m ? Number(m[1]) : null;
}
