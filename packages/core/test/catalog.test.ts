import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_TEMPLATE_CSV,
  decodeCsvBytes,
  formatRowError,
  parseCatalogCsv,
  type CatalogItem,
} from '../src/index.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

const loadFixture = (name: string) => {
  const decoded = decodeCsvBytes(fixture(name));
  return { ...decoded, result: parseCatalogCsv(decoded.text) };
};

const HEADER = 'sku,name_th,name_en,unit,unit_price,aliases,category,description\n';
const priceOf = (raw: string): number | undefined => {
  const { items, rowErrors } = parseCatalogCsv(`${HEADER}A-1,ชื่อ,,ชิ้น,${raw},,,\n`);
  expect(rowErrors).toEqual([]);
  return items[0]?.unitPriceSatang;
};

const EXPECTED_ITEMS: CatalogItem[] = [
  {
    sku: 'PVC-001',
    nameTh: 'ท่อ PVC ชั้น 8.5 4 หุน',
    nameEn: 'PVC Pipe Class 8.5 1/2 in',
    unit: 'เส้น',
    unitPriceSatang: 125000,
    aliases: ['พีวีซี', 'ท่อฟ้า'],
    category: 'ท่อ',
    description: 'ท่อพีวีซีสีฟ้า ยาว 4 เมตร',
  },
  {
    sku: 'PVC-002',
    nameTh: 'ข้อต่อตรง PVC 4 หุน',
    nameEn: null,
    unit: 'ชิ้น',
    unitPriceSatang: 3500,
    aliases: [],
    category: 'ข้อต่อ',
    description: null,
  },
  {
    sku: 'ELB-001',
    nameTh: null,
    nameEn: 'Elbow 90 deg 1/2 in',
    unit: 'ชิ้น',
    unitPriceSatang: 9950,
    aliases: [],
    category: null,
    description: null,
  },
];

describe('decodeCsvBytes + parseCatalogCsv on encoded fixtures', () => {
  it('decodes UTF-8 without BOM', () => {
    const { encoding, result } = loadFixture('catalog-utf8.csv');
    expect(encoding).toBe('utf-8');
    expect(result.fileError).toBeNull();
    expect(result.rowErrors).toEqual([]);
    expect(result.items).toEqual(EXPECTED_ITEMS);
  });

  it('decodes UTF-8 with BOM and strips the BOM', () => {
    const { encoding, text, result } = loadFixture('catalog-utf8-bom.csv');
    expect(encoding).toBe('utf-8');
    expect(text.startsWith('\uFEFF')).toBe(false);
    expect(result.items).toEqual(EXPECTED_ITEMS);
  });

  it('falls back to windows-874 and decodes Thai names correctly', () => {
    const { encoding, result } = loadFixture('catalog-win874.csv');
    expect(encoding).toBe('windows-874');
    expect(result.rowErrors).toEqual([]);
    expect(result.items).toEqual(EXPECTED_ITEMS);
    expect(result.items[0]?.nameTh).toBe('ท่อ PVC ชั้น 8.5 4 หุน');
  });

  it('does not let a BOM left in the text break the first header', () => {
    const result = parseCatalogCsv(`\uFEFF${HEADER}A-1,ชื่อ,,ชิ้น,10,,,\n`);
    expect(result.fileError).toBeNull();
    expect(result.items).toHaveLength(1);
  });
});

describe('unit_price parsing', () => {
  it('handles thousands separators', () => expect(priceOf('"1,250.00"')).toBe(125000));
  it('handles the baht sign', () => expect(priceOf('฿1250')).toBe(125000));
  it('trims whitespace', () => expect(priceOf(' 99.5 ')).toBe(9950));
  it('converts without float error', () => expect(priceOf('19.99')).toBe(1999));
  it('accepts zero', () => expect(priceOf('0')).toBe(0));
});

describe('catalog-bad-rows.csv', () => {
  const { result } = loadFixture('catalog-bad-rows.csv');
  const errorAt = (row: number) => result.rowErrors.filter((e) => e.row === row);

  it('has no file-level error', () => expect(result.fileError).toBeNull());

  it('reports non-numeric price with spreadsheet row number', () => {
    expect(errorAt(3)).toEqual([
      { row: 3, column: 'unit_price', message: '"abc" ไม่ใช่ตัวเลข' },
    ]);
    expect(formatRowError(errorAt(3)[0]!)).toBe('แถว 3 · unit_price: "abc" ไม่ใช่ตัวเลข');
  });

  it('rejects negative prices', () => {
    expect(errorAt(4)).toHaveLength(1);
    expect(errorAt(4)[0]).toMatchObject({ row: 4, column: 'unit_price' });
  });

  it('flags a duplicate sku on the second occurrence only', () => {
    expect(errorAt(2)).toEqual([]);
    expect(errorAt(5)).toEqual([
      { row: 5, column: 'sku', message: 'sku "PVC-001" ซ้ำกับแถว 2' },
    ]);
  });

  it('requires at least one of name_th / name_en', () => {
    expect(errorAt(6)).toHaveLength(1);
    expect(errorAt(6)[0]?.row).toBe(6);
  });

  it('skips fully blank rows without error but keeps later row numbers correct', () => {
    expect(errorAt(7)).toEqual([]);
    expect(errorAt(8)).toHaveLength(1);
    expect(errorAt(8)[0]).toMatchObject({ row: 8, column: 'unit_price' });
  });

  it('rejects prices with more than 2 decimals', () => {
    expect(errorAt(8)[0]?.message).toContain('ทศนิยมเกิน 2 ตำแหน่ง');
  });

  it('keeps valid rows in items', () => {
    expect(result.items.map((i) => i.sku)).toEqual(['PVC-001', 'PVC-006']);
    expect(result.rowErrors.map((e) => e.row)).toEqual([3, 4, 5, 6, 8]);
  });
});

describe('aliases', () => {
  it('splits on | and trims', () => {
    const { items } = parseCatalogCsv(`${HEADER}A-1,ชื่อ,,ชิ้น,10,พีวีซี| ท่อฟ้า ||,,\n`);
    expect(items[0]?.aliases).toEqual(['พีวีซี', 'ท่อฟ้า']);
  });
  it('is [] when empty', () => {
    const { items } = parseCatalogCsv(`${HEADER}A-1,ชื่อ,,ชิ้น,10,,,\n`);
    expect(items[0]?.aliases).toEqual([]);
  });
});

describe('header handling (Review Focus 1)', () => {
  it('ignores column order and extra columns', () => {
    const reordered = loadFixture('catalog-reordered.csv').result;
    expect(reordered.fileError).toBeNull();
    expect(reordered.rowErrors).toEqual([]);
    expect(reordered.items).toEqual(loadFixture('catalog-utf8.csv').result.items);
  });

  it('reports one file-level error naming the missing required column', () => {
    const { result } = loadFixture('catalog-missing-column.csv');
    expect(result.fileError).toEqual({ message: 'ไม่พบคอลัมน์ที่จำเป็น: unit_price' });
    expect(result.rowErrors).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it('lists all missing columns comma-separated', () => {
    const { fileError } = parseCatalogCsv('sku,name_th\nA-1,ชื่อ\n');
    expect(fileError?.message).toBe('ไม่พบคอลัมน์ที่จำเป็น: unit, unit_price');
  });

  it('requires at least one of the name_th / name_en headers', () => {
    const { fileError } = parseCatalogCsv('sku,unit,unit_price\nA-1,ชิ้น,10\n');
    expect(fileError?.message).toBe('ไม่พบคอลัมน์ที่จำเป็น: name_th หรือ name_en');
  });

  it('accepts a file with only name_en', () => {
    const r = parseCatalogCsv('sku,name_en,unit,unit_price\nA-1,Pipe,pcs,10\n');
    expect(r.fileError).toBeNull();
    expect(r.items[0]).toMatchObject({ nameTh: null, nameEn: 'Pipe' });
  });

  it('treats Thai headers as missing columns (single file error)', () => {
    const r = parseCatalogCsv('รหัส,ชื่อ,หน่วย,ราคา\nA-1,ชื่อ,ชิ้น,10\n');
    expect(r.fileError).not.toBeNull();
    expect(r.rowErrors).toEqual([]);
    expect(r.items).toEqual([]);
  });

  it('matches headers case-insensitively', () => {
    const r = parseCatalogCsv('SKU,Name_TH,UNIT,Unit_Price\nA-1,ชื่อ,ชิ้น,10\n');
    expect(r.fileError).toBeNull();
    expect(r.items).toHaveLength(1);
  });

  it('handles an empty file as a file-level error', () => {
    expect(parseCatalogCsv('').fileError).not.toBeNull();
  });
});

describe('malformed CSV structure', () => {
  it('turns an unterminated quote into a single file-level error (no partial import)', () => {
    const r = parseCatalogCsv(`${HEADER}A,"oops,,u,5,,,
B,ชื่อ,,ชิ้น,5,,,
C,ชื่อ,,ชิ้น,5,,,
`);
    expect(r.fileError).toEqual({ message: 'ไฟล์มีเครื่องหมายคำพูด (") ที่ไม่ได้ปิด ใกล้แถว 2' });
    expect(r.items).toEqual([]);
    expect(r.rowErrors).toEqual([]);
  });

  it('reports the spreadsheet row of the unterminated quote', () => {
    const r = parseCatalogCsv(`${HEADER}A,x,,u,5,,,
B,x,,u,5,,,
C,"oops,,u,5,,,
D,x,,u,5,,,
`);
    expect(r.fileError?.message).toBe('ไฟล์มีเครื่องหมายคำพูด (") ที่ไม่ได้ปิด ใกล้แถว 4');
  });

  it('does not reject the file for a row-local malformed quote (InvalidQuotes)', () => {
    const r = parseCatalogCsv(`${HEADER}A,"ab"c,"x",u,5\nB,ชื่อ,,ชิ้น,5,,,\nC,ชื่อ,,ชิ้น,5,,,\n`);
    expect(r.fileError).toBeNull();
    expect(r.items.map((i) => i.sku)).toEqual(['B', 'C']);
    expect(r.rowErrors.length).toBeGreaterThan(0);
    expect(r.rowErrors.every((e) => e.row === 2)).toBe(true);
  });

  it('rejects the file when a stray quote swallows following rows without MissingQuotes', () => {
    const r = parseCatalogCsv(
      `${HEADER}A,x,,u,5,,,\nC,"oops,,u,5,,,\nD,ชื่อ,,ชิ้น,"1,250.00",,,\nE,x,,u,5,,,\n`,
    );
    expect(r.fileError).toEqual({ message: 'ไฟล์มีเครื่องหมายคำพูด (") ที่ไม่ได้ปิด ใกล้แถว 3' });
    expect(r.items).toEqual([]);
    expect(r.rowErrors).toEqual([]);
  });

  it('imports a properly quoted multi-line cell normally', () => {
    const r = parseCatalogCsv(
      `${HEADER}A,ชื่อ A,,ชิ้น,5,,,"บรรทัดแรก\nบรรทัดสอง"\nB,ชื่อ B,,ชิ้น,6,,,\n`,
    );
    expect(r.fileError).toBeNull();
    expect(r.rowErrors).toEqual([]);
    expect(r.items.map((i) => i.sku)).toEqual(['A', 'B']);
    expect(r.items[0]?.description).toBe('บรรทัดแรก\nบรรทัดสอง');
  });

  it('does not turn too few / too many fields into a file error', () => {
    const r = parseCatalogCsv(`${HEADER}A,ชื่อ,,ชิ้น,5
B,ชื่อ,,ชิ้น,6,,,,extra,more
`);
    expect(r.fileError).toBeNull();
    expect(r.items.map((i) => i.sku)).toEqual(['A', 'B']);
  });
});

describe('CATALOG_TEMPLATE_CSV', () => {
  it('starts with a UTF-8 BOM', () => expect(CATALOG_TEMPLATE_CSV.startsWith('\uFEFF')).toBe(true));
  it('parses without any error and yields 2 items', () => {
    const r = parseCatalogCsv(CATALOG_TEMPLATE_CSV);
    expect(r.fileError).toBeNull();
    expect(r.rowErrors).toEqual([]);
    expect(r.items).toHaveLength(2);
  });
});
