import type { Catalog, CatalogItem, CompanyProfile, MatchResponse, ValidatedLine } from '@tqc/core';
import { DEFAULT_COMPANY } from '@/lib/company';
import { EMPTY_DRAFT, draftReducer, type Draft } from '@/lib/draft';

export const item = (sku: string, nameTh: string, unit: string, unitPriceSatang: number): CatalogItem => ({
  sku,
  nameTh,
  nameEn: null,
  unit,
  unitPriceSatang,
  aliases: [],
  category: null,
  description: null,
});

export const ITEMS: CatalogItem[] = [
  item('PVC-4', 'ท่อ PVC 4 หุน', 'เส้น', 10_000),
  item('TAPE-1', 'เทปพันเกลียว', 'ม้วน', 1_500),
];

export const catalogOf = (items: CatalogItem[] = ITEMS, pricesIncludeVat = false): Catalog => ({
  items,
  pricesIncludeVat,
});

export const COMPANY: CompanyProfile = { ...DEFAULT_COMPANY };

export const matchedLine = (lineId: string, sku = 'PVC-4', quantity = 10, unit = 'เส้น'): ValidatedLine => ({
  lineId,
  rawText: `${sku} ${quantity} ${unit}`,
  quantity,
  unit,
  status: 'matched',
  sku,
  alternativeSkus: [],
  confidence: 'high',
  reason: 'ตรงกัน',
  unitMismatch: false,
  unitNote: null,
});

export function buildDraft(lines: ValidatedLine[], catalog: Catalog = catalogOf()): Draft {
  const response: MatchResponse = {
    extracted: {
      items: lines.map((l) => ({
        lineId: l.lineId,
        rawText: l.rawText,
        productQuery: 'ท่อ',
        quantity: l.quantity,
        unit: l.unit,
        specs: [],
        notes: null,
      })),
      customer: { name: 'คุณสมชาย', company: 'บริษัท ลูกค้าตัวอย่าง จำกัด', contact: null },
      missingInfo: [],
      language: 'th',
    },
    lines,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return draftReducer(EMPTY_DRAFT, {
    type: 'loadMatch',
    response,
    catalog,
    inquiry: 'ข้อความต้นฉบับ',
    paymentTerms: 'ชำระภายใน 30 วัน',
    issueDate: '2026-10-22',
  });
}

export function approvedDraft(
  lines: ValidatedLine[] = [matchedLine('L1')],
  catalog: Catalog = catalogOf(),
  number = 'QT-256910-001',
): Draft {
  const draft = buildDraft(lines, catalog);
  return draftReducer({ ...draft, number }, { type: 'approve', now: '2026-10-22T10:00:00.000Z', catalog });
}
