import { describe, expect, it } from 'vitest';
import {
  REJECTED_REASON,
  validateMatches,
  type CatalogLiteItem,
  type ExtractedItem,
  type RawMatch,
  type ValidatedLine,
} from '../src/index.ts';

function lite(sku: string, unit = 'ชิ้น'): CatalogLiteItem {
  return { sku, nameTh: `สินค้า ${sku}`, nameEn: null, unit, aliases: [], category: null };
}

function item(lineId: string, over: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    lineId,
    rawText: `raw ${lineId}`,
    productQuery: 'ท่อ',
    quantity: 3,
    unit: 'ชิ้น',
    specs: [],
    notes: null,
    ...over,
  };
}

function match(lineId: string, over: Partial<RawMatch> = {}): RawMatch {
  return {
    lineId,
    status: 'matched',
    sku: 'A',
    alternativeSkus: [],
    confidence: 'high',
    reason: 'ตรงกัน',
    ...over,
  };
}

function first(...args: Parameters<typeof validateMatches>): ValidatedLine {
  const r = validateMatches(...args)[0];
  if (r === undefined) throw new Error('no line');
  return r;
}

function cands(entries: Record<string, CatalogLiteItem[]>): Map<string, CatalogLiteItem[]> {
  return new Map(Object.entries(entries));
}

describe('validateMatches', () => {
  it('accepts a valid matched sku', () => {
    const line = first([item('L1')], [match('L1')], cands({ L1: [lite('A'), lite('B')] }));
    expect(line).toMatchObject({
      lineId: 'L1',
      rawText: 'raw L1',
      status: 'matched',
      sku: 'A',
      confidence: 'high',
      reason: 'ตรงกัน',
      quantity: 3,
      unit: 'ชิ้น',
      unitMismatch: false,
      unitNote: null,
    });
  });

  it('rejects a sku that is not among the line candidates', () => {
    const line = first([item('L1')], [match('L1', { sku: 'ZZ' })], cands({ L1: [lite('A')] }));
    expect(line.status).toBe('unmatched');
    expect(line.sku).toBeNull();
  });

  it('rejects a sku that is only a candidate of another line', () => {
    const lines = validateMatches(
      [item('L1'), item('L2')],
      [match('L1', { sku: 'A' }), match('L2', { sku: 'A' })],
      cands({ L1: [lite('A')], L2: [lite('B')] }),
    );
    expect(lines[0]?.status).toBe('matched');
    expect(lines[1]?.status).toBe('unmatched');
    expect(lines[1]?.sku).toBeNull();
  });

  it('downgrades matched + low to ambiguous with the original sku first', () => {
    const line = first(
      [item('L1')],
      [match('L1', { confidence: 'low', alternativeSkus: ['B', 'A', 'C'] })],
      cands({ L1: [lite('A'), lite('B'), lite('C')] }),
    );
    expect(line.status).toBe('ambiguous');
    expect(line.sku).toBeNull();
    expect(line.alternativeSkus).toEqual(['A', 'B', 'C']);
    expect(line.confidence).toBe('low');
  });

  it('turns ambiguous with a single valid alternative into unmatched, keeping the suggestion', () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: null, alternativeSkus: ['B', 'GHOST'], confidence: 'medium' })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('unmatched');
    expect(line.sku).toBeNull();
    expect(line.alternativeSkus).toEqual(['B']);
  });

  it('replaces confidence and reason when the validator rejects a sku outside the candidates', () => {
    const line = first(
      [item('L1')],
      [match('L1', { sku: 'ZZ', confidence: 'high', reason: 'ตรงกับ ZZ-1' })],
      cands({ L1: [lite('A')] }),
    );
    expect(line.status).toBe('unmatched');
    expect(line.confidence).toBe('low');
    expect(line.reason).toBe(REJECTED_REASON);
  });

  it('replaces confidence and reason when an ambiguous line has too few valid alternatives', () => {
    const line = first(
      [item('L1')],
      [
        match('L1', {
          status: 'ambiguous',
          sku: null,
          alternativeSkus: ['B', 'GHOST'],
          confidence: 'high',
          reason: 'มีหลายตัวเลือก',
        }),
      ],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('unmatched');
    expect(line.alternativeSkus).toEqual(['B']);
    expect(line.confidence).toBe('low');
    expect(line.reason).toBe(REJECTED_REASON);
  });

  it('keeps the model reason when matched + low is downgraded to ambiguous', () => {
    const line = first(
      [item('L1')],
      [match('L1', { confidence: 'low', alternativeSkus: ['B'], reason: 'ไม่แน่ใจขนาด' })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('ambiguous');
    expect(line.reason).toBe('ไม่แน่ใจขนาด');
  });

  it('passes through the model confidence and reason when it itself says unmatched', () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'unmatched', sku: null, confidence: 'medium', reason: 'ไม่มีสินค้านี้' })],
      cands({ L1: [lite('A')] }),
    );
    expect(line.confidence).toBe('medium');
    expect(line.reason).toBe('ไม่มีสินค้านี้');
  });

  it('turns ambiguous with no valid alternative into unmatched with empty alternatives', () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: null, alternativeSkus: ['GHOST'] })],
      cands({ L1: [lite('A')] }),
    );
    expect(line.status).toBe('unmatched');
    expect(line.alternativeSkus).toEqual([]);
  });

  it('keeps ambiguous with two or more valid alternatives', () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: null, alternativeSkus: ['A', 'B', 'B'] })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('ambiguous');
    expect(line.alternativeSkus).toEqual(['A', 'B']);
  });

  it("keeps the ambiguous answer's own valid sku, first, as an alternative", () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: 'B', alternativeSkus: ['A', 'B'], confidence: 'medium' })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('ambiguous');
    expect(line.sku).toBeNull();
    expect(line.alternativeSkus).toEqual(['B', 'A']);
  });

  it("counts the ambiguous answer's own sku toward the two-alternative minimum", () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: 'A', alternativeSkus: ['B'], confidence: 'medium' })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('ambiguous');
    expect(line.alternativeSkus).toEqual(['A', 'B']);
  });

  it("ignores an ambiguous answer's sku that is not a candidate", () => {
    const line = first(
      [item('L1')],
      [match('L1', { status: 'ambiguous', sku: 'GHOST', alternativeSkus: ['A', 'B'] })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.alternativeSkus).toEqual(['A', 'B']);
  });

  it('filters alternativeSkus not in candidates for a matched line', () => {
    const line = first(
      [item('L1')],
      [match('L1', { alternativeSkus: ['B', 'GHOST', 'A'] })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('matched');
    expect(line.sku).toBe('A');
    expect(line.alternativeSkus).toEqual(['B']);
  });

  it('marks a line missing from the AI results as unmatched', () => {
    const lines = validateMatches(
      [item('L1'), item('L2', { quantity: 7, unit: 'เส้น' })],
      [match('L1')],
      cands({ L1: [lite('A')], L2: [lite('B')] }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      lineId: 'L2',
      status: 'unmatched',
      sku: null,
      confidence: 'low',
      reason: 'ระบบจับคู่ไม่ได้',
      alternativeSkus: [],
      quantity: 7,
      unit: 'เส้น',
      unitMismatch: false,
      unitNote: null,
    });
  });

  it('ignores results for unknown lineIds and uses the first result for a duplicated lineId', () => {
    const lines = validateMatches(
      [item('L1')],
      [match('LX', { sku: 'A' }), match('L1', { sku: 'A' }), match('L1', { sku: 'B' })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sku).toBe('A');
  });

  it('treats a missing candidate list as empty (everything unmatched)', () => {
    const line = first([item('L1')], [match('L1')], new Map());
    expect(line.status).toBe('unmatched');
  });

  it('forces sku null and keeps unit as-is for an unmatched result', () => {
    const line = first(
      [item('L1', { unit: 'โหล', quantity: 2 })],
      [match('L1', { status: 'unmatched', sku: 'A', alternativeSkus: ['B'] })],
      cands({ L1: [lite('A'), lite('B')] }),
    );
    expect(line.status).toBe('unmatched');
    expect(line.sku).toBeNull();
    expect(line.quantity).toBe(2);
    expect(line.unit).toBe('โหล');
    expect(line.unitNote).toBeNull();
  });

  it('converts dozens to pieces and notes the conversion', () => {
    const line = first(
      [item('L1', { unit: 'โหล', quantity: 2 })],
      [match('L1')],
      cands({ L1: [lite('A', 'ชิ้น')] }),
    );
    expect(line.quantity).toBe(24);
    expect(line.unit).toBe('ชิ้น');
    expect(line.unitNote).toBe('แปลง 2 โหล = 24 ชิ้น');
    expect(line.unitMismatch).toBe(false);
  });

  it('flags a unit mismatch that cannot be converted', () => {
    const line = first(
      [item('L1', { unit: 'กล่อง', quantity: 2 })],
      [match('L1')],
      cands({ L1: [lite('A', 'ชิ้น')] }),
    );
    expect(line.unitMismatch).toBe(true);
    expect(line.unit).toBe('กล่อง');
    expect(line.quantity).toBe(2);
  });

  it('preserves item order and never merges two lines of the same product', () => {
    const lines = validateMatches(
      [item('L1', { quantity: 10 }), item('L2', { quantity: 5 })],
      [match('L2'), match('L1')],
      cands({ L1: [lite('A')], L2: [lite('A')] }),
    );
    expect(lines.map((l) => l.lineId)).toEqual(['L1', 'L2']);
    expect(lines.map((l) => l.quantity)).toEqual([10, 5]);
  });
});
