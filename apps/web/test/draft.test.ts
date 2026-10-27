import {
  computeQuote,
  type Catalog,
  type CatalogItem,
  type CompanyProfile,
  type MatchResponse,
  type ValidatedLine,
} from '@tqc/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  addDays,
  bangkokToday,
  canApprove,
  catalogKey,
  isApproved,
  draftReducer,
  lineState,
  previewQuote,
  toQuotation,
  type Draft,
  type DraftAction,
} from '@/lib/draft';

const item = (sku: string, unit: string, unitPriceSatang: number, nameTh: string | null = `สินค้า ${sku}`): CatalogItem => ({
  sku,
  nameTh,
  nameEn: null,
  unit,
  unitPriceSatang,
  aliases: [],
  category: null,
  description: null,
});

const catalog = (items: CatalogItem[], pricesIncludeVat = false): Catalog => ({ items, pricesIncludeVat });

const CATALOG = catalog([
  item('P-1', 'เส้น', 10_000),
  item('P-2', 'เส้น', 25_050),
  item('P-3', 'ชิ้น', 1_999),
]);

const company: CompanyProfile = {
  name: 'บริษัท ตัวอย่างวัสดุ จำกัด',
  address: '99/9',
  taxId: '0000000000000',
  phone: '02-000-0000',
  logoDataUrl: null,
  defaultPaymentTerms: 'ชำระภายใน 30 วัน',
  defaultValidityDays: 30,
};

const line = (over: Partial<ValidatedLine> & { lineId: string }): ValidatedLine => ({
  rawText: `raw ${over.lineId}`,
  quantity: 1,
  unit: 'เส้น',
  status: 'matched',
  sku: 'P-1',
  alternativeSkus: [],
  confidence: 'high',
  reason: 'ตรง',
  unitMismatch: false,
  unitNote: null,
  ...over,
});

function response(lines: ValidatedLine[]): MatchResponse {
  return {
    extracted: {
      items: lines.map((l) => ({
        lineId: l.lineId,
        rawText: l.rawText,
        productQuery: `query ${l.lineId}`,
        quantity: l.quantity,
        unit: l.unit,
        specs: [],
        notes: null,
      })),
      customer: { name: 'สมชาย', company: null, contact: '081-000-0000' },
      missingInfo: [{ lineId: 'L1', question: 'ต้องการยาวกี่เมตร' }],
      language: 'th',
    },
    lines,
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function load(lines: ValidatedLine[], cat: Catalog = CATALOG): Draft {
  return draftReducer(EMPTY_DRAFT, {
    type: 'loadMatch',
    response: response(lines),
    catalog: cat,
    inquiry: 'ข้อความลูกค้า',
    paymentTerms: 'ชำระภายใน 30 วัน',
    issueDate: '2026-10-22',
  });
}

const run = (state: Draft, ...actions: DraftAction[]): Draft => actions.reduce(draftReducer, state);

const AMBIGUOUS = line({
  lineId: 'L1',
  status: 'ambiguous',
  sku: null,
  alternativeSkus: ['P-1', 'P-2'],
  confidence: 'medium',
});

describe('loadMatch', () => {
  it('resolves matched lines to their sku and leaves ambiguous/unmatched unresolved', () => {
    const draft = load([
      line({ lineId: 'L1' }),
      line({ lineId: 'L2', status: 'ambiguous', sku: null, alternativeSkus: ['P-1', 'P-2'] }),
      line({ lineId: 'L3', status: 'unmatched', sku: null }),
    ]);
    expect(draft.lines.map((l) => l.resolvedSku)).toEqual(['P-1', null, null]);
    expect(draft.lines.every((l) => l.discount === null && !l.confirmed)).toBe(true);
  });

  it('copies customer, questions and inquiry, and takes defaults from the arguments', () => {
    const draft = load([line({ lineId: 'L1' })]);
    expect(draft.inquiry).toBe('ข้อความลูกค้า');
    expect(draft.customer).toEqual({ name: 'สมชาย', company: null, contact: '081-000-0000' });
    expect(draft.missingInfo).toEqual([{ lineId: 'L1', question: 'ต้องการยาวกี่เมตร' }]);
    expect(draft.issueDate).toBe('2026-10-22');
    expect(draft.paymentTerms).toBe('ชำระภายใน 30 วัน');
    expect(draft.number).toBe('');
    expect(draft.vatRatePercent).toBe(7);
    expect(draft.whtRatePercent).toBe(0);
    expect(draft.approvedAt).toBeNull();
    expect(draft.lines[0]?.productQuery).toBe('query L1');
  });

  it('keeps two lines with the same sku as two lines (Review Focus 2)', () => {
    const draft = load([
      line({ lineId: 'L1', quantity: 10 }),
      line({ lineId: 'L2', quantity: 5 }),
    ]);
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines.map((l) => l.quantity)).toEqual([10, 5]);
    const quote = toQuotation(draft, CATALOG, company);
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines.map((l) => l.quantity)).toEqual([10, 5]);
  });
});

describe('lineState and canApprove', () => {
  it('is ok for a matched line with a quantity', () => {
    const draft = load([line({ lineId: 'L1' })]);
    expect(lineState(draft.lines[0]!, CATALOG)).toBe('ok');
    expect(canApprove(draft, CATALOG)).toBe(true);
  });

  it('blocks approval for an unselected ambiguous line, then allows it after a choice', () => {
    const draft = load([AMBIGUOUS]);
    expect(lineState(draft.lines[0]!, CATALOG)).toBe('needs-choice');
    expect(canApprove(draft, CATALOG)).toBe(false);
    const chosen = draftReducer(draft, { type: 'selectSku', lineId: 'L1', sku: 'P-2', catalog: CATALOG });
    expect(chosen.lines[0]?.resolvedSku).toBe('P-2');
    expect(lineState(chosen.lines[0]!, CATALOG)).toBe('ok');
    expect(canApprove(chosen, CATALOG)).toBe(true);
  });

  it('blocks approval for an unmatched line', () => {
    const draft = load([line({ lineId: 'L1', status: 'unmatched', sku: null })]);
    expect(lineState(draft.lines[0]!, CATALOG)).toBe('needs-sku');
    expect(canApprove(draft, CATALOG)).toBe(false);
  });

  it('blocks approval when the quantity is missing', () => {
    const draft = load([line({ lineId: 'L1', quantity: null })]);
    expect(lineState(draft.lines[0]!, CATALOG)).toBe('needs-quantity');
    expect(canApprove(draft, CATALOG)).toBe(false);
  });

  it('blocks approval for an unconfirmed unit mismatch, and allows it after confirmUnit', () => {
    const draft = load([line({ lineId: 'L1', unit: 'กล่อง', unitMismatch: true })]);
    expect(lineState(draft.lines[0]!, CATALOG)).toBe('needs-unit');
    expect(canApprove(draft, CATALOG)).toBe(false);
    const confirmed = draftReducer(draft, { type: 'confirmUnit', lineId: 'L1' });
    expect(lineState(confirmed.lines[0]!, CATALOG)).toBe('ok');
    // confirming means "quote it in the catalog unit": the line now reads, prices and exports in เส้น
    expect(confirmed.lines[0]?.unit).toBe('เส้น');
    expect(confirmed.lines[0]?.unit).toBe(confirmed.lines[0]?.catalogUnit);
    expect(toQuotation(confirmed, CATALOG, company).lines[0]).toMatchObject({ quantity: 1, unit: 'เส้น' });
    expect(canApprove(confirmed, CATALOG)).toBe(true);
  });

  it('blocks approval when there are no lines at all', () => {
    expect(canApprove(load([]), CATALOG)).toBe(false);
    const removed = draftReducer(load([line({ lineId: 'L1' })]), { type: 'removeLine', lineId: 'L1' });
    expect(removed.lines).toHaveLength(0);
    expect(canApprove(removed, CATALOG)).toBe(false);
  });

  it('needs the whole set of lines to be ok', () => {
    const draft = load([line({ lineId: 'L1' }), { ...AMBIGUOUS, lineId: 'L2' }]);
    expect(canApprove(draft, CATALOG)).toBe(false);
    expect(canApprove(draftReducer(draft, { type: 'removeLine', lineId: 'L2' }), CATALOG)).toBe(true);
  });

  it('treats a quantity of 0 or below as needs-quantity (Review Focus 5)', () => {
    const draft = load([line({ lineId: 'L1' })]);
    for (const quantity of [0, -3]) {
      const next = draftReducer(draft, { type: 'setQuantity', lineId: 'L1', quantity });
      expect(lineState(next.lines[0]!, CATALOG)).toBe('needs-quantity');
      expect(canApprove(next, CATALOG)).toBe(false);
    }
  });

  it('treats a quantity with more than 3 decimals or a non-finite one as needs-quantity', () => {
    const draft = load([line({ lineId: 'L1' })]);
    for (const quantity of [1.2345, Number.NaN, Number.POSITIVE_INFINITY]) {
      const next = draftReducer(draft, { type: 'setQuantity', lineId: 'L1', quantity });
      expect(lineState(next.lines[0]!, CATALOG)).toBe('needs-quantity');
    }
    const ok = draftReducer(draft, { type: 'setQuantity', lineId: 'L1', quantity: 1.25 });
    expect(lineState(ok.lines[0]!, CATALOG)).toBe('ok');
  });

  it('is not approvable when a stored discount would make computeQuote throw', () => {
    const draft = load([line({ lineId: 'L1' })]);
    const bad = draftReducer(draft, { type: 'setBill', patch: { billDiscount: { type: 'amount', satang: 10.5 } } });
    expect(canApprove(bad, CATALOG)).toBe(false);
    expect(previewQuote(bad, CATALOG).ok).toBe(false);
  });
});

describe('selectSku', () => {
  it('converts the unit when the chosen sku uses a different counting unit', () => {
    const draft = load([
      line({ lineId: 'L1', status: 'ambiguous', sku: null, alternativeSkus: ['P-1', 'P-3'], quantity: 2, unit: 'โหล' }),
    ]);
    const chosen = draftReducer(draft, { type: 'selectSku', lineId: 'L1', sku: 'P-3', catalog: CATALOG });
    expect(chosen.lines[0]?.quantity).toBe(24);
    expect(chosen.lines[0]?.unit).toBe('ชิ้น');
    expect(chosen.lines[0]?.unitNote).not.toBeNull();
    expect(lineState(chosen.lines[0]!, CATALOG)).toBe('ok');
  });

  it('asks for confirmation when the chosen sku has an unrelated unit', () => {
    const draft = load([
      line({ lineId: 'L1', status: 'ambiguous', sku: null, alternativeSkus: ['P-1', 'P-3'], quantity: 3, unit: 'กล่อง' }),
    ]);
    const chosen = draftReducer(draft, { type: 'selectSku', lineId: 'L1', sku: 'P-1', catalog: CATALOG });
    expect(lineState(chosen.lines[0]!, CATALOG)).toBe('needs-unit');
  });

  it('ignores a sku that is not in the catalog', () => {
    const draft = load([AMBIGUOUS]);
    const next = draftReducer(draft, { type: 'selectSku', lineId: 'L1', sku: 'NOPE', catalog: CATALOG });
    expect(next).toBe(draft);
  });
});

describe('approve and editing', () => {
  const approved = (): Draft =>
    draftReducer(load([line({ lineId: 'L1' }), line({ lineId: 'L2', sku: 'P-2' })]), {
      type: 'approve',
      now: '2026-10-22T10:00:00.000Z',
      catalog: CATALOG,
    });

  it('records the approval time', () => {
    expect(approved().approvedAt).toBe('2026-10-22T10:00:00.000Z');
  });

  it('sets the quote number together with the approval when one is given, otherwise leaves it alone', () => {
    const draft = load([line({ lineId: 'L1' })]);
    const numbered = draftReducer(draft, { type: 'approve', now: 'T', catalog: CATALOG, number: 'QT-256910-001' });
    expect(numbered.number).toBe('QT-256910-001');
    expect(numbered.approvedAt).toBe('T');
    const kept = draftReducer({ ...draft, number: 'MY-1' }, { type: 'approve', now: 'T', catalog: CATALOG });
    expect(kept.number).toBe('MY-1');
  });

  it('does not take the number when the approval itself is refused', () => {
    const draft = load([line({ lineId: 'L1', quantity: null })]);
    const next = draftReducer(draft, { type: 'approve', now: 'T', catalog: CATALOG, number: 'QT-256910-001' });
    expect(next.number).toBe('');
    expect(next.approvedAt).toBeNull();
  });

  it.each<[string, DraftAction]>([
    ['selectSku', { type: 'selectSku', lineId: 'L1', sku: 'P-2', catalog: CATALOG }],
    ['setQuantity', { type: 'setQuantity', lineId: 'L1', quantity: 9 }],
    ['setDiscount', { type: 'setDiscount', lineId: 'L1', discount: { type: 'percent', value: 5 } }],
    ['setBill', { type: 'setBill', patch: { notes: 'หมายเหตุใหม่' } }],
    ['removeLine', { type: 'removeLine', lineId: 'L2' }],
  ])('clears the approval after %s', (_name, action) => {
    const next = draftReducer(approved(), action);
    expect(next.approvedAt).toBeNull();
  });

  it('keeps the approval when nothing changes (re-selecting the same sku)', () => {
    const base = approved();
    const next = draftReducer(base, { type: 'selectSku', lineId: 'L1', sku: 'P-1', catalog: CATALOG });
    expect(next.approvedAt).toBe(base.approvedAt);
  });

  it('only changes the targeted line', () => {
    const base = load([line({ lineId: 'L1' }), line({ lineId: 'L2', sku: 'P-2' })]);
    const next = draftReducer(base, { type: 'setQuantity', lineId: 'L2', quantity: 7 });
    expect(next.lines[0]).toBe(base.lines[0]);
    expect(next.lines[1]?.quantity).toBe(7);
  });

  it('applies setBill patches', () => {
    const next = draftReducer(load([line({ lineId: 'L1' })]), {
      type: 'setBill',
      patch: { whtRatePercent: 3, vatRatePercent: 10, number: 'QT-1', paymentTerms: 'เงินสด' },
    });
    expect([next.whtRatePercent, next.vatRatePercent, next.number, next.paymentTerms]).toEqual([3, 10, 'QT-1', 'เงินสด']);
  });
});

describe('catalogChanged (Review Focus 4)', () => {
  it('turns a line whose sku vanished into unmatched and reprices the rest from the new catalog', () => {
    const base = draftReducer(
      load([line({ lineId: 'L1', sku: 'P-1', quantity: 2 }), line({ lineId: 'L2', sku: 'P-2', quantity: 1 })]),
      { type: 'approve', now: '2026-10-22T10:00:00.000Z', catalog: CATALOG },
    );
    const newCatalog = catalog([item('P-2', 'เส้น', 30_000), item('P-3', 'ชิ้น', 100)]);
    const next = draftReducer(base, { type: 'catalogChanged', catalog: newCatalog });

    expect(next.lines[0]).toMatchObject({ status: 'unmatched', resolvedSku: null, sku: null });
    expect(next.lines[0] && lineState(next.lines[0], newCatalog)).toBe('needs-sku');
    expect(next.lines[1]?.resolvedSku).toBe('P-2');
    expect(next.approvedAt).toBeNull();
    expect(canApprove(next, newCatalog)).toBe(false);

    const afterRemoval = draftReducer(next, { type: 'removeLine', lineId: 'L1' });
    const quote = toQuotation(afterRemoval, newCatalog, company);
    expect(quote.lines[0]?.unitPriceSatang).toBe(30_000);
    expect(quote.totals.subtotalSatang).toBe(30_000);
  });

  it('keeps the original alternatives that still exist so the single one can be suggested', () => {
    const base = load([AMBIGUOUS]);
    const next = draftReducer(base, { type: 'catalogChanged', catalog: catalog([item('P-2', 'เส้น', 1)]) });
    expect(next.lines[0]?.status).toBe('unmatched');
    expect(next.lines[0]?.alternativeSkus).toEqual(['P-2']);
  });

  it('flags a unit mismatch when the sku survives with a different unit', () => {
    const base = load([line({ lineId: 'L1', sku: 'P-1', unit: 'เส้น' })]);
    const newCatalog = catalog([item('P-1', 'กล่อง', 10_000)]);
    const next = draftReducer(base, { type: 'catalogChanged', catalog: newCatalog });
    expect(lineState(next.lines[0]!, newCatalog)).toBe('needs-unit');
  });

  it('is a no-op (approval kept) when the catalog content is the same', () => {
    const base = draftReducer(load([line({ lineId: 'L1' })]), { type: 'approve', now: 'T', catalog: CATALOG });
    const same = catalog(CATALOG.items.map((i) => ({ ...i })));
    expect(draftReducer(base, { type: 'catalogChanged', catalog: same })).toBe(base);
    expect(catalogKey(same)).toBe(catalogKey(CATALOG));
  });

  it('re-baselines on a price change so the same change is not applied twice', () => {
    const base = draftReducer(load([line({ lineId: 'L1' })]), { type: 'approve', now: 'T', catalog: CATALOG });
    const repriced = catalog([item('P-1', 'เส้น', 99_900), ...CATALOG.items.slice(1)]);
    const next = draftReducer(base, { type: 'catalogChanged', catalog: repriced });
    expect(next.approvedAt).toBeNull();
    expect(next.catalogKey).toBe(catalogKey(repriced));
    expect(next.catalogKey).not.toBe(catalogKey(CATALOG));
  });
});

describe('toQuotation', () => {
  it('prices from the catalog by sku and matches computeQuote for the same inputs', () => {
    const cat = catalog(CATALOG.items, true);
    const draft = run(
      load([line({ lineId: 'L1', sku: 'P-1', quantity: 3 }), line({ lineId: 'L2', sku: 'P-2', quantity: 1.5 })], cat),
      { type: 'setDiscount', lineId: 'L1', discount: { type: 'percent', value: 10 } },
      { type: 'setBill', patch: { billDiscount: { type: 'amount', satang: 500 }, whtRatePercent: 3, number: 'QT-X', notes: 'n' } },
    );
    const quote = toQuotation(draft, cat, company);

    expect(quote.lines.map((l) => l.unitPriceSatang)).toEqual([10_000, 25_050]);
    expect(quote.pricesIncludeVat).toBe(true);
    const expected = computeQuote({
      lines: [
        { unitPriceSatang: 10_000, quantity: 3, discount: { type: 'percent', value: 10 } },
        { unitPriceSatang: 25_050, quantity: 1.5, discount: null },
      ],
      billDiscount: { type: 'amount', satang: 500 },
      vatRatePercent: 7,
      pricesIncludeVat: true,
      whtRatePercent: 3,
    });
    expect(quote.totals).toEqual(expected);
    expect(quote).toMatchObject({
      schemaVersion: 1,
      number: 'QT-X',
      issueDate: '2026-10-22',
      validUntil: '2026-11-21',
      notes: 'n',
      whtRatePercent: 3,
      approvedAt: null,
    });
    expect(quote.company).toBe(company);
  });

  it('names a line nameTh, then nameEn, then sku, and uses the catalog unit', () => {
    const cat = catalog([
      item('A', 'เส้น', 100, 'ท่อ'),
      { ...item('B', 'ชิ้น', 100, null), nameEn: 'Elbow' },
      item('C', 'กล่อง', 100, null),
    ]);
    const draft = load(
      [line({ lineId: 'L1', sku: 'A' }), line({ lineId: 'L2', sku: 'B', unit: 'ชิ้น' }), line({ lineId: 'L3', sku: 'C', unit: 'กล่อง' })],
      cat,
    );
    const quote = toQuotation(draft, cat, company);
    expect(quote.lines.map((l) => [l.name, l.unit])).toEqual([
      ['ท่อ', 'เส้น'],
      ['Elbow', 'ชิ้น'],
      ['C', 'กล่อง'],
    ]);
  });

  it('refuses to build a quotation while a line is not ready', () => {
    const draft = load([AMBIGUOUS]);
    expect(() => toQuotation(draft, CATALOG, company)).toThrow();
  });

  it('carries the approval timestamp through untouched', () => {
    const draft = draftReducer(load([line({ lineId: 'L1' })]), { type: 'approve', now: '2026-10-22T10:00:00.000Z', catalog: CATALOG });
    expect(toQuotation(draft, CATALOG, company).approvedAt).toBe('2026-10-22T10:00:00.000Z');
  });
});

describe('previewQuote', () => {
  it('totals only the lines that are ready and reports how many were left out', () => {
    const draft = load([line({ lineId: 'L1', quantity: 2 }), { ...AMBIGUOUS, lineId: 'L2' }]);
    const preview = previewQuote(draft, CATALOG);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.skippedLines).toBe(1);
    expect(preview.totals.subtotalSatang).toBe(20_000);
    expect(preview.lineTotals.get('L1')).toBe(20_000);
    expect(preview.lineTotals.has('L2')).toBe(false);
  });
});

describe('dates', () => {
  it('bangkokToday uses the Asia/Bangkok calendar day', () => {
    expect(bangkokToday(new Date('2026-10-22T18:30:00Z'))).toBe('2026-10-23');
    expect(bangkokToday(new Date('2026-10-22T16:59:00Z'))).toBe('2026-10-22');
  });

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-10-22', 30)).toBe('2026-11-21');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
  });
});

// ---------------------------------------------------------------------------------------------
// Unit invariant (fix round 1): quantity is in `unit`; conversions only from `requested`, only until typed.

const U_CATALOG = catalog([item('A', 'ชิ้น', 100), item('B', 'ชิ้น', 200), item('C', 'กล่อง', 1000)]);

const unitLine = (over: Partial<ValidatedLine>): ValidatedLine =>
  line({ lineId: 'L1', status: 'unmatched', sku: null, ...over });

describe('unit invariant', () => {
  it('converts a dozen once at selection, and keeps the customer request separately', () => {
    const d0 = load([unitLine({ unit: 'โหล', quantity: 2 })], U_CATALOG);
    expect(d0.lines[0]?.requested).toEqual({ quantity: 2, unit: 'โหล' });
    const d1 = draftReducer(d0, { type: 'selectSku', lineId: 'L1', sku: 'A', catalog: U_CATALOG });
    expect(d1.lines[0]).toMatchObject({ quantity: 24, unit: 'ชิ้น', quantityEdited: false, catalogUnit: 'ชิ้น' });
    expect(d1.lines[0]?.unitNote).toContain('24');
  });

  it('reselecting a product after the user typed a quantity keeps the typed quantity (no second x12)', () => {
    let d = load([unitLine({ unit: 'โหล', quantity: 2 })], U_CATALOG);
    d = draftReducer(d, { type: 'selectSku', lineId: 'L1', sku: 'A', catalog: U_CATALOG });
    d = draftReducer(d, { type: 'setQuantity', lineId: 'L1', quantity: 2 });
    expect(d.lines[0]).toMatchObject({ quantity: 2, unit: 'ชิ้น', quantityEdited: true });
    d = draftReducer(d, { type: 'selectSku', lineId: 'L1', sku: 'B', catalog: U_CATALOG });
    expect(d.lines[0]?.quantity).toBe(2);
    expect(lineState(d.lines[0]!, U_CATALOG)).toBe('ok');
    expect(toQuotation(d, U_CATALOG, company).lines[0]?.quantity).toBe(2);
  });

  it('a typed quantity moved to a product with another unit needs confirmation instead of conversion', () => {
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'ชิ้น', quantity: 5 })], U_CATALOG);
    d = draftReducer(d, { type: 'setQuantity', lineId: 'L1', quantity: 7 });
    d = draftReducer(d, { type: 'selectSku', lineId: 'L1', sku: 'C', catalog: U_CATALOG });
    expect(d.lines[0]?.quantity).toBe(7);
    expect(lineState(d.lines[0]!, U_CATALOG)).toBe('needs-unit');
    expect(d.lines[0]?.unit).toBe('ชิ้น'); // still the unit the quantity was typed in
    d = draftReducer(d, { type: 'confirmUnit', lineId: 'L1' });
    expect(lineState(d.lines[0]!, U_CATALOG)).toBe('ok');
    expect(d.lines[0]).toMatchObject({ unit: 'กล่อง', quantity: 7 });
    expect(toQuotation(d, U_CATALOG, company).lines[0]).toMatchObject({ quantity: 7, unit: 'กล่อง' });
  });

  it('dozen with no quantity: unit becomes the catalog unit, a note explains, and a typed number is taken as pieces', () => {
    const d0 = load([line({ lineId: 'L1', sku: 'A', unit: 'โหล', quantity: null })], U_CATALOG);
    expect(d0.lines[0]).toMatchObject({ unit: 'ชิ้น', quantity: null, unitMismatch: false });
    expect(d0.lines[0]?.unitNote).toBe('ลูกค้าระบุเป็น โหล - กรอกจำนวนเป็น ชิ้น');
    expect(lineState(d0.lines[0]!, U_CATALOG)).toBe('needs-quantity');
    const d1 = draftReducer(d0, { type: 'setQuantity', lineId: 'L1', quantity: 2 });
    expect(lineState(d1.lines[0]!, U_CATALOG)).toBe('ok');
    expect(toQuotation(d1, U_CATALOG, company).lines[0]).toMatchObject({ quantity: 2, unit: 'ชิ้น' });
  });

  it('same for an unresolved dozen line with no quantity once a sku is picked', () => {
    let d = load([unitLine({ unit: 'โหล', quantity: null })], U_CATALOG);
    d = draftReducer(d, { type: 'selectSku', lineId: 'L1', sku: 'A', catalog: U_CATALOG });
    expect(d.lines[0]).toMatchObject({ unit: 'ชิ้น', unitMismatch: false });
    d = draftReducer(d, { type: 'setQuantity', lineId: 'L1', quantity: 2 });
    d = draftReducer(d, { type: 'selectSku', lineId: 'L1', sku: 'B', catalog: U_CATALOG });
    expect(d.lines[0]?.quantity).toBe(2);
    expect(toQuotation(d, U_CATALOG, company).lines[0]?.unit).toBe('ชิ้น');
  });

  it('setQuantity clears the stale conversion note', () => {
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'โหล', quantity: 2 })], U_CATALOG);
    expect(d.lines[0]?.unitNote).not.toBeNull();
    d = draftReducer(d, { type: 'setQuantity', lineId: 'L1', quantity: 30 });
    expect(d.lines[0]?.unitNote).toBeNull();
  });

  it('catalogChanged: a confirmed mismatch is not carried over when the catalog unit changes again', () => {
    const c1 = catalog([item('A', 'กล่อง', 1000)]);
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'เส้น', quantity: 5, unitMismatch: true })], c1);
    d = draftReducer(d, { type: 'confirmUnit', lineId: 'L1' });
    expect(lineState(d.lines[0]!, c1)).toBe('ok');
    const c2 = catalog([item('A', 'ม้วน', 1000)]);
    d = draftReducer(d, { type: 'catalogChanged', catalog: c2 });
    expect(d.lines[0]?.confirmed).toBe(false);
    expect(lineState(d.lines[0]!, c2)).toBe('needs-unit');
  });

  it('catalogChanged: the dozen conversion is applied when the new unit makes it possible', () => {
    const c1 = catalog([item('A', 'กล่อง', 1000)]);
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'โหล', quantity: 2, unitMismatch: true })], c1);
    d = draftReducer(d, { type: 'confirmUnit', lineId: 'L1' });
    const c2 = catalog([item('A', 'ชิ้น', 100)]);
    d = draftReducer(d, { type: 'catalogChanged', catalog: c2 });
    expect(d.lines[0]).toMatchObject({ quantity: 24, unit: 'ชิ้น', unitMismatch: false, confirmed: false });
    expect(lineState(d.lines[0]!, c2)).toBe('ok');
    expect(toQuotation(d, c2, company).lines[0]?.quantity).toBe(24);
  });

  it('catalogChanged: a typed quantity is never converted, a unit change asks for confirmation', () => {
    const c1 = catalog([item('A', 'กล่อง', 1000)]);
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'โหล', quantity: 2, unitMismatch: true })], c1);
    d = draftReducer(d, { type: 'setQuantity', lineId: 'L1', quantity: 3 });
    const c2 = catalog([item('A', 'ชิ้น', 100)]);
    d = draftReducer(d, { type: 'catalogChanged', catalog: c2 });
    expect(d.lines[0]?.quantity).toBe(3);
    expect(lineState(d.lines[0]!, c2)).toBe('needs-unit');
  });

  it('catalogChanged: a price-only change keeps a confirmed unit mismatch confirmed', () => {
    const c1 = catalog([item('A', 'กล่อง', 1000)]);
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'เส้น', quantity: 5, unitMismatch: true })], c1);
    d = draftReducer(d, { type: 'confirmUnit', lineId: 'L1' });
    const c2 = catalog([item('A', 'กล่อง', 2000)]);
    d = draftReducer(d, { type: 'catalogChanged', catalog: c2 });
    expect(lineState(d.lines[0]!, c2)).toBe('ok');
  });

  it('catalogChanged: a vanished sku goes back to the customer\'s own quantity and unit', () => {
    const c1 = catalog([item('A', 'ชิ้น', 100)]);
    let d = load([line({ lineId: 'L1', sku: 'A', unit: 'โหล', quantity: 2 })], c1);
    expect(d.lines[0]?.quantity).toBe(24);
    d = draftReducer(d, { type: 'catalogChanged', catalog: catalog([item('B', 'ชิ้น', 100)]) });
    expect(d.lines[0]).toMatchObject({ resolvedSku: null, quantity: 2, unit: 'โหล', unitNote: null });
  });
});

describe('approve gate and isApproved', () => {
  it('approve is a no-op while the draft is not ready', () => {
    const draft = load([unitLine({})]);
    const next = draftReducer(draft, { type: 'approve', now: 'T', catalog: CATALOG });
    expect(next).toBe(draft);
    expect(next.approvedAt).toBeNull();
  });

  it('isApproved is true only for a ready draft built on the current catalog', () => {
    const ready = draftReducer(load([line({ lineId: 'L1' })]), { type: 'approve', now: 'T', catalog: CATALOG });
    expect(isApproved(ready, CATALOG)).toBe(true);
    // not approved at all
    expect(isApproved(load([line({ lineId: 'L1' })]), CATALOG)).toBe(false);
    // stale: the catalog moved on and the draft has not been reconciled yet (the flash after a reload)
    const repriced = catalog([item('P-1', 'เส้น', 99_900), ...CATALOG.items.slice(1)]);
    expect(isApproved(ready, repriced)).toBe(false);
    // stale: approvedAt recorded but a line is no longer ready
    const broken = { ...ready, lines: [{ ...ready.lines[0]!, quantity: null }] };
    expect(broken.approvedAt).not.toBeNull();
    expect(isApproved(broken, CATALOG)).toBe(false);
  });
});
