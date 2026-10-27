const THAI_DIGITS = /[๐-๙]/g;

/**
 * Canonical form for matching Thai/English product text:
 * NFKC, recomposed sara am, Thai digits -> ASCII, no zero-width chars,
 * lowercase, single spaces.
 */
export function normalizeText(s: string): string {
  return (
    s
      .normalize('NFKC')
      // NFKC splits U+0E33 (sara am) into U+0E4D U+0E32; put it back.
      .replace(/ํา/g, 'ำ')
      // nikhahit + tone mark + sara aa (typed in the wrong order) -> tone + sara am
      .replace(/ํ([่-๋])า/g, '$1ำ')
      .replace(THAI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0e50))
      .replace(/[​-‍﻿]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}
