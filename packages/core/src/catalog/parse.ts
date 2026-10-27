import Papa from 'papaparse';
import { z } from 'zod';
import type { CatalogItem } from '../types.ts';

export interface RowError {
  /** Spreadsheet row number: header = 1, first data row = 2. */
  row: number;
  column: string;
  message: string;
}

export interface FileError {
  message: string;
}

export interface CatalogParseResult {
  items: CatalogItem[];
  rowErrors: RowError[];
  fileError: FileError | null;
}

export function formatRowError(e: RowError): string {
  return `แถว ${e.row} · ${e.column}: ${e.message}`;
}

const NAME_COLUMN = 'name_th/name_en';
const REQUIRED_HEADERS = ['sku', 'unit', 'unit_price'] as const;

/** "1,250.00" / "฿1250" / " 99.5 " -> satang, exactly (no float multiplication). */
const priceSchema = z.string().transform((raw, ctx) => {
  const cleaned = raw.replace(/[,฿\s]/g, '');
  if (cleaned === '') {
    ctx.issues.push({ code: 'custom', message: 'ต้องไม่ว่าง', input: raw });
    return z.NEVER;
  }
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) {
    ctx.issues.push({ code: 'custom', message: `"${raw.trim()}" ไม่ใช่ตัวเลข`, input: raw });
    return z.NEVER;
  }
  const [, sign = '', whole = '0', fraction = ''] = match;
  if (fraction.length > 2) {
    ctx.issues.push({
      code: 'custom',
      message: `"${raw.trim()}" ทศนิยมเกิน 2 ตำแหน่ง`,
      input: raw,
    });
    return z.NEVER;
  }
  const satang = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (sign === '-' && satang !== 0) {
    ctx.issues.push({ code: 'custom', message: `"${raw.trim()}" ราคาติดลบ`, input: raw });
    return z.NEVER;
  }
  if (!Number.isSafeInteger(satang)) {
    ctx.issues.push({ code: 'custom', message: `"${raw.trim()}" ใหญ่เกินไป`, input: raw });
    return z.NEVER;
  }
  return satang;
});

const requiredText = z.string().trim().min(1, 'ต้องไม่ว่าง');
const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s));

const rowSchema = z
  .object({
    sku: requiredText,
    name_th: optionalText,
    name_en: optionalText,
    unit: requiredText,
    unit_price: priceSchema,
    aliases: z
      .string()
      .transform((s) =>
        s
          .split('|')
          .map((a) => a.trim())
          .filter((a) => a !== ''),
      ),
    category: optionalText,
    description: optionalText,
  })
  .superRefine((row, ctx) => {
    if (row.name_th === null && row.name_en === null) {
      ctx.addIssue({
        code: 'custom',
        path: [NAME_COLUMN],
        message: 'ต้องมี name_th หรือ name_en อย่างน้อยหนึ่งช่อง',
      });
    }
  });

type RawRow = Record<string, string | undefined>;

/** Header present but a cell missing (short row) or extra cells -> treat gaps as empty. */
function toRowInput(raw: RawRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['sku', 'name_th', 'name_en', 'unit', 'unit_price', 'aliases', 'category', 'description']) {
    const value = raw[key];
    out[key] = typeof value === 'string' ? value : '';
  }
  return out;
}

function isBlankRow(raw: RawRow): boolean {
  return Object.entries(raw).every(([key, value]) => {
    if (key === '__parsed_extra') return true;
    return typeof value !== 'string' || value.trim() === '';
  });
}

export function parseCatalogCsv(text: string): CatalogParseResult {
  // skipEmptyLines stays off so result index + 2 is always the spreadsheet row;
  // blank rows are skipped manually below.
  const parsed = Papa.parse<RawRow>(text, {
    header: true,
    delimiter: ',', // never auto-detect: the aliases column uses '|' and would fool the guesser
    skipEmptyLines: false,
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim().toLowerCase(),
  });

  // An unterminated quote swallows following lines into one field, so which rows
  // survived can't be trusted: refuse the whole file. Papa reports this either as
  // MissingQuotes (swallowed to EOF) or as InvalidQuotes on a record whose field now
  // contains a line break (a later quote closed the field). InvalidQuotes without a
  // line break (e.g. `"ab"c`) is row-local and the rest of the file still parses;
  // FieldMismatch is handled per row below. Papa's `row` is a 0-based record index
  // that includes the header, so the record is data[row - 1].
  const swallowedLines = (row: number | undefined): boolean => {
    const record = row === undefined ? undefined : parsed.data[row - 1];
    return (
      record !== undefined &&
      Object.values(record).some((v) => typeof v === 'string' && /[\r\n]/.test(v))
    );
  };
  const quoteError = parsed.errors.find(
    (e) => e.code === 'MissingQuotes' || (e.code === 'InvalidQuotes' && swallowedLines(e.row)),
  );
  if (quoteError) {
    // spreadsheet row = Papa row + 1.
    const near = typeof quoteError.row === 'number' ? ` ใกล้แถว ${quoteError.row + 1}` : '';
    return {
      items: [],
      rowErrors: [],
      fileError: { message: `ไฟล์มีเครื่องหมายคำพูด (") ที่ไม่ได้ปิด${near}` },
    };
  }

  const headers = new Set(parsed.meta.fields ?? []);
  const missing: string[] = REQUIRED_HEADERS.filter((h) => !headers.has(h));
  if (!headers.has('name_th') && !headers.has('name_en')) missing.push('name_th หรือ name_en');
  if (missing.length > 0) {
    return {
      items: [],
      rowErrors: [],
      fileError: { message: `ไม่พบคอลัมน์ที่จำเป็น: ${missing.join(', ')}` },
    };
  }

  const items: CatalogItem[] = [];
  const rowErrors: RowError[] = [];
  const skuRows = new Map<string, number>();

  parsed.data.forEach((raw, index) => {
    if (isBlankRow(raw)) return;
    const row = index + 2;
    const result = rowSchema.safeParse(toRowInput(raw));
    if (!result.success) {
      for (const issue of result.error.issues) {
        rowErrors.push({ row, column: String(issue.path[0] ?? ''), message: issue.message });
      }
      return;
    }
    const v = result.data;
    const firstRow = skuRows.get(v.sku);
    if (firstRow !== undefined) {
      rowErrors.push({ row, column: 'sku', message: `sku "${v.sku}" ซ้ำกับแถว ${firstRow}` });
      return;
    }
    skuRows.set(v.sku, row);
    items.push({
      sku: v.sku,
      nameTh: v.name_th,
      nameEn: v.name_en,
      unit: v.unit,
      unitPriceSatang: v.unit_price,
      aliases: v.aliases,
      category: v.category,
      description: v.description,
    });
  });

  return { items, rowErrors, fileError: null };
}
