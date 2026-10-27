import { normalizeText } from '../normalize/text.ts';

// After normalizeText: Thai digits are ASCII and Latin is lowercase.
const RUNS = /[฀-๿]+|\d+(?:\.\d+)?|[a-z]+/g;
const THAI_RUN = /^[฀-๿]/;

// Unit words that follow a number ("4 หุน", "2 นิ้ว", "25 มม.", "90 องศา", "1/2 in", '3/4"').
// Size and angle are scored by the re-ranker, so as tokens they would only add noise
// (every "... นิ้ว" product would otherwise match every "... นิ้ว" query).
const UNIT_AFTER_NUMBER =
  /(\d)\s*(?:หุน|นิ้ว|มม\.?|ซม\.?|องศา|°|"|″|(?:inches|inch|in|mm|cm|degrees|degree|deg)(?![a-z]))/g;

/**
 * Unique search tokens for Thai/English product text.
 *
 * - Thai has no spaces, so each Thai run becomes overlapping bigrams and trigrams
 *   (a lone Thai character stays as a unigram) plus the whole run as a "#word" token.
 *   "พีวีซี" typed with different spacing or inside a longer word still shares most of
 *   its tokens, while a whole-word hit scores higher than a substring hit.
 * - Latin runs become lowercase words; numbers (incl. decimals) become tokens.
 * - Unit words directly after a number are dropped (see UNIT_AFTER_NUMBER).
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const cleaned = normalizeText(text).replace(UNIT_AFTER_NUMBER, '$1 ');
  for (const run of cleaned.match(RUNS) ?? []) {
    if (!THAI_RUN.test(run)) {
      out.add(run);
      continue;
    }
    if (run.length === 1) {
      out.add(run);
      continue;
    }
    // Marked so "ท่อ" as a word is distinct from the trigram inside "ฝาครอบท่อ".
    out.add(`#${run}`);
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
    for (let i = 0; i + 3 <= run.length; i++) out.add(run.slice(i, i + 3));
  }
  return [...out];
}
