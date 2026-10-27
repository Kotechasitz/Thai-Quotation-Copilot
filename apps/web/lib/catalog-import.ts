import {
  decodeCsvBytes,
  parseCatalogCsv,
  type CatalogItem,
  type CsvEncoding,
  type RowError,
} from '@tqc/core';

export const FILE_READ_ERROR = 'อ่านไฟล์ไม่ได้ กรุณาบันทึกเป็น CSV (UTF-8) แล้วลองใหม่';

export type CatalogAnalysis =
  | { kind: 'error'; message: string }
  | {
      kind: 'parsed';
      encoding: CsvEncoding;
      items: CatalogItem[];
      rowErrors: RowError[];
      /** Non-empty physical data lines in the file (header excluded). */
      dataLineCount: number;
      /** True when dataLineCount != imported rows + rows with errors (see isMergeSuspected). */
      mergeSuspected: boolean;
    };

/**
 * Physical data lines that carry content. Blank lines and lines made only of commas
 * (what Excel leaves at the end of a sheet) are not counted - the parser skips them too.
 */
export function countDataLines(text: string): number {
  return text
    .split(/\r\n|\n|\r/)
    .slice(1)
    .filter((line) => line.replace(/[,\s]/g, '') !== '').length;
}

/**
 * Stray-quote safeguard: the parser can swallow neighbouring lines into one field. When the
 * line count disagrees with what came out (imported rows + distinct rows with errors), warn.
 * A quoted cell that legitimately contains a line break also trips this - the warning only asks
 * the user to check the file.
 */
export function isMergeSuspected(
  dataLineCount: number,
  importedCount: number,
  errorRows: readonly number[],
): boolean {
  return dataLineCount !== importedCount + new Set(errorRows).size;
}

/** Bytes of a CSV file -> everything the catalog page shows. Never throws. */
export function analyzeCatalogBytes(bytes: Uint8Array): CatalogAnalysis {
  let decoded: ReturnType<typeof decodeCsvBytes>;
  try {
    decoded = decodeCsvBytes(bytes);
  } catch {
    return { kind: 'error', message: FILE_READ_ERROR };
  }
  const { items, rowErrors, fileError } = parseCatalogCsv(decoded.text);
  if (fileError !== null) return { kind: 'error', message: fileError.message };

  const dataLineCount = countDataLines(decoded.text);
  return {
    kind: 'parsed',
    encoding: decoded.encoding,
    items,
    rowErrors,
    dataLineCount,
    mergeSuspected: isMergeSuspected(
      dataLineCount,
      items.length,
      rowErrors.map((e) => e.row),
    ),
  };
}
