import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeCatalogBytes, countDataLines, isMergeSuspected } from '@/lib/catalog-import';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url))),
  );

describe('countDataLines', () => {
  it('ignores the header, blank lines and comma-only lines, handles CRLF', () => {
    expect(countDataLines('h1,h2\r\na,b\r\n\r\n,\r\nc,d\r\n')).toBe(2);
    expect(countDataLines('h1,h2')).toBe(0);
    expect(countDataLines('')).toBe(0);
  });
});

describe('isMergeSuspected', () => {
  it('is false when lines = imported + distinct error rows', () => {
    expect(isMergeSuspected(7, 2, [3, 3, 4, 5, 6, 7])).toBe(false);
  });
  it('is true on any mismatch', () => {
    expect(isMergeSuspected(5, 2, [3])).toBe(true);
    expect(isMergeSuspected(1, 2, [])).toBe(true);
  });
});

describe('analyzeCatalogBytes', () => {
  it('parses a valid UTF-8 file', () => {
    const a = analyzeCatalogBytes(fixture('catalog-utf8.csv'));
    expect(a.kind).toBe('parsed');
    if (a.kind === 'parsed') {
      expect(a.encoding).toBe('utf-8');
      expect(a.items.length).toBeGreaterThan(0);
      expect(a.rowErrors).toEqual([]);
      expect(a.mergeSuspected).toBe(false);
    }
  });

  it('returns a Thai error instead of throwing on a BOM file with invalid UTF-8', () => {
    const a = analyzeCatalogBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0xfe]));
    expect(a).toEqual({
      kind: 'error',
      message: 'อ่านไฟล์ไม่ได้ กรุณาบันทึกเป็น CSV (UTF-8) แล้วลองใหม่',
    });
  });

  it('passes the parser file error through', () => {
    const a = analyzeCatalogBytes(fixture('catalog-missing-column.csv'));
    expect(a.kind).toBe('error');
    if (a.kind === 'error') expect(a.message).toMatch(/ไม่พบคอลัมน์ที่จำเป็น/);
  });
});
