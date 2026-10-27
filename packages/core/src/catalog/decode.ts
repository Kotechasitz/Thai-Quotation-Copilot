export type CsvEncoding = 'utf-8' | 'windows-874';

/**
 * Decode CSV bytes: UTF-8 (BOM stripped) when valid, otherwise Windows-874
 * (the legacy Thai code page Excel on Thai Windows still saves "CSV" in).
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasBom) {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)),
      encoding: 'utf-8',
    };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      encoding: 'utf-8',
    };
  } catch {
    return { text: new TextDecoder('windows-874').decode(bytes), encoding: 'windows-874' };
  }
}
