import type { CatalogLiteItem } from '../types.ts';
import { resolveUnit } from '../normalize/units.ts';
import type { ExtractedItem, RawMatch } from './schemas.ts';

export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface ValidatedLine {
  lineId: string;
  rawText: string;
  quantity: number | null;
  unit: string | null;
  status: MatchStatus;
  sku: string | null;
  alternativeSkus: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  unitMismatch: boolean;
  unitNote: string | null;
}

export const NO_RESULT_REASON = 'ระบบจับคู่ไม่ได้';
/** Replaces the model's reason when the validator itself downgrades a line to unmatched. */
export const REJECTED_REASON = 'ระบบตรวจแล้วไม่พบสินค้าที่ตรงในรายการ กรุณาค้นหาเอง';

/**
 * Checks every AI answer against the candidates the code gave it for that line.
 * Returns exactly one ValidatedLine per extracted item, in order; never drops, merges or adds lines.
 */
export function validateMatches(
  items: ExtractedItem[],
  raw: RawMatch[],
  candidatesByLine: Map<string, CatalogLiteItem[]>,
): ValidatedLine[] {
  const resultByLine = new Map<string, RawMatch>();
  for (const r of raw) {
    if (!resultByLine.has(r.lineId)) resultByLine.set(r.lineId, r);
  }

  return items.map((item): ValidatedLine => {
    const base = {
      lineId: item.lineId,
      rawText: item.rawText,
      quantity: item.quantity,
      unit: item.unit,
      unitMismatch: false,
      unitNote: null as string | null,
    };
    const result = resultByLine.get(item.lineId);
    if (result === undefined) {
      return {
        ...base,
        status: 'unmatched',
        sku: null,
        alternativeSkus: [],
        confidence: 'low',
        reason: NO_RESULT_REASON,
      };
    }

    const candidates = candidatesByLine.get(item.lineId) ?? [];
    const bySku = new Map(candidates.map((c) => [c.sku, c]));
    const alternatives = (skus: string[]): string[] => [
      ...new Set(skus.filter((s) => bySku.has(s))),
    ];

    let status: MatchStatus = result.status;
    let sku: string | null = result.sku;
    let alts = alternatives(result.alternativeSkus);
    let rejected = false;

    if (status === 'matched') {
      if (sku === null || !bySku.has(sku)) {
        status = 'unmatched';
        sku = null;
        alts = [];
        rejected = true;
      } else if (result.confidence === 'low') {
        status = 'ambiguous';
        alts = alternatives([sku, ...result.alternativeSkus]);
        sku = null;
      } else {
        alts = alts.filter((s) => s !== sku);
      }
    }

    if (status === 'ambiguous') {
      // An ambiguous answer may still name its best guess in `sku`; keep it (first) as one of the options.
      if (sku !== null && bySku.has(sku)) alts = alternatives([sku, ...alts]);
      sku = null;
      if (alts.length < 2) {
        status = 'unmatched';
        rejected = true;
      }
    }
    if (status === 'unmatched') sku = null;

    if (status === 'matched' && sku !== null) {
      const chosen = bySku.get(sku) as CatalogLiteItem;
      const resolved = resolveUnit(item.unit, chosen.unit, item.quantity);
      return {
        ...base,
        quantity: resolved.quantity,
        unit: resolved.note !== null ? chosen.unit : item.unit,
        unitNote: resolved.note,
        unitMismatch: resolved.unitMismatch,
        status,
        sku,
        alternativeSkus: alts,
        confidence: result.confidence,
        reason: result.reason,
      };
    }

    return {
      ...base,
      status,
      sku: null,
      alternativeSkus: alts,
      confidence: rejected ? 'low' : result.confidence,
      reason: rejected ? REJECTED_REASON : result.reason,
    };
  });
}
