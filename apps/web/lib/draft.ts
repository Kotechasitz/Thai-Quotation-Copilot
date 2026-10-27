import {
  computeQuote,
  resolveUnit,
  type Catalog,
  type CatalogItem,
  type CompanyProfile,
  type CustomerInfo,
  type Discount,
  type MatchResponse,
  type QuoteLine,
  type QuoteTotals,
  type Quotation,
  type ValidatedLine,
  type WhtRate,
} from '@tqc/core';

/**
 * One request line as the user is editing it. Prices are never stored here: they come from the catalog by sku.
 *
 * Unit invariant for a line with a resolved sku: `quantity` is always expressed in `unit`, and `unit` is the
 * catalog unit of the sku, except while a unit mismatch awaits the user's confirmation (then `unit` is the
 * unit the quantity is still in; confirming switches `unit` to the catalog unit without converting).
 */
export interface DraftLine extends ValidatedLine {
  /** The sku the user (or the AI, when it was sure) settled on; null while still to be chosen. */
  resolvedSku: string | null;
  discount: Discount | null;
  /** The user confirmed a unit mismatch. */
  confirmed: boolean;
  /** What the AI extracted as the product to look for; prefills the catalog search. */
  productQuery: string;
  /** The customer's own quantity and unit, never changed; conversions are always computed from this. */
  requested: { quantity: number | null; unit: string | null };
  /** True once the user typed a quantity: from then on it is taken as-is, in `unit`, and never converted. */
  quantityEdited: boolean;
  /** Catalog unit of `resolvedSku` when the unit was last reconciled (null while unresolved). */
  catalogUnit: string | null;
}

export interface Draft {
  inquiry: string;
  customer: CustomerInfo;
  lines: DraftLine[];
  missingInfo: { lineId: string | null; question: string }[];
  billDiscount: Discount | null;
  vatRatePercent: number;
  whtRatePercent: WhtRate;
  number: string;
  notes: string;
  paymentTerms: string;
  /** ISO calendar date (YYYY-MM-DD, Asia/Bangkok) the draft was created. */
  issueDate: string;
  /** Fingerprint of the catalog the draft was last reconciled with (see catalogKey). */
  catalogKey: string;
  /** ISO timestamp (never a calendar date), or null while not approved. */
  approvedAt: string | null;
}

export type DraftAction =
  | {
      type: 'loadMatch';
      response: MatchResponse;
      catalog: Catalog;
      inquiry: string;
      paymentTerms: string;
      /** ISO calendar date; passed in so the reducer stays pure. */
      issueDate: string;
    }
  | { type: 'selectSku'; lineId: string; sku: string; catalog: Catalog }
  | { type: 'setQuantity'; lineId: string; quantity: number | null }
  | { type: 'setDiscount'; lineId: string; discount: Discount | null }
  | { type: 'confirmUnit'; lineId: string }
  | { type: 'removeLine'; lineId: string }
  | {
      type: 'setBill';
      patch: Partial<
        Pick<
          Draft,
          'billDiscount' | 'vatRatePercent' | 'whtRatePercent' | 'notes' | 'paymentTerms' | 'customer' | 'number'
        >
      >;
    }
  | { type: 'catalogChanged'; catalog: Catalog }
  | { type: 'approve'; now: string; catalog: Catalog };

export type LineState = 'ok' | 'needs-choice' | 'needs-sku' | 'needs-quantity' | 'needs-unit';

export const DEFAULT_VAT_PERCENT = 7;
export const CATALOG_CHANGED_REASON = 'catalog เปลี่ยนแล้ว ไม่พบสินค้าเดิมในรายการ กรุณาค้นหาใหม่';
export const PREVIEW_ERROR = 'คำนวณยอดไม่ได้ กรุณาตรวจสอบจำนวนและส่วนลดของแต่ละบรรทัด';

export const EMPTY_DRAFT: Draft = {
  inquiry: '',
  customer: { name: null, company: null, contact: null },
  lines: [],
  missingInfo: [],
  billDiscount: null,
  vatRatePercent: DEFAULT_VAT_PERCENT,
  whtRatePercent: 0,
  number: '',
  notes: '',
  paymentTerms: '',
  issueDate: '1970-01-01',
  catalogKey: '',
  approvedAt: null,
};

// ---------------------------------------------------------------------------------------------
// Catalog helpers

const skuMaps = new WeakMap<Catalog, Map<string, CatalogItem>>();

/** sku -> catalog row, built once per catalog object. */
export function skuMap(catalog: Catalog): Map<string, CatalogItem> {
  let map = skuMaps.get(catalog);
  if (map === undefined) {
    map = new Map(catalog.items.map((i) => [i.sku, i]));
    skuMaps.set(catalog, map);
  }
  return map;
}

/**
 * Cheap fingerprint of everything in a catalog that ends up on a quotation (sku, names, unit,
 * price, VAT flag). Two catalogs with the same key quote identically, so the draft only needs
 * reconciling when the key differs. FNV-1a, 32 bit - collisions are irrelevant for a change check.
 */
export function catalogKey(catalog: Catalog): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x1f; // field separator
    hash = Math.imul(hash, 0x01000193);
  };
  for (const item of catalog.items) {
    feed(item.sku);
    feed(item.nameTh ?? '');
    feed(item.nameEn ?? '');
    feed(item.unit);
    feed(String(item.unitPriceSatang));
  }
  return `${catalog.items.length}:${catalog.pricesIncludeVat ? 'inc' : 'exc'}:${(hash >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------------------------
// Dates (calendar dates are ISO strings; Buddhist-era display happens at the edge via Intl)

/** Today's calendar date in Asia/Bangkok as YYYY-MM-DD. */
export function bangkokToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO calendar date + whole days, in UTC calendar arithmetic (no timezone shift). */
export function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) throw new RangeError(`invalid ISO date: ${iso}`);
  const shifted = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Line state

function isValidQuantity(quantity: number | null): quantity is number {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return false;
  return Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-6;
}

export function lineState(line: DraftLine, catalog: Catalog): LineState {
  if (line.resolvedSku === null) return line.status === 'ambiguous' ? 'needs-choice' : 'needs-sku';
  if (!skuMap(catalog).has(line.resolvedSku)) return 'needs-sku';
  if (!isValidQuantity(line.quantity)) return 'needs-quantity';
  if (line.unitMismatch && !line.confirmed) return 'needs-unit';
  return 'ok';
}

// ---------------------------------------------------------------------------------------------
// Pricing (the catalog is the only source of prices)

function quoteLineName(item: CatalogItem): string {
  return item.nameTh ?? item.nameEn ?? item.sku;
}

/** QuoteLines for the lines that are ready (state 'ok'); the others are left out. */
function readyQuoteLines(draft: Draft, catalog: Catalog): QuoteLine[] {
  const bySku = skuMap(catalog);
  const result: QuoteLine[] = [];
  for (const line of draft.lines) {
    if (lineState(line, catalog) !== 'ok') continue;
    const item = bySku.get(line.resolvedSku as string) as CatalogItem;
    result.push({
      lineId: line.lineId,
      sku: item.sku,
      name: quoteLineName(item),
      unit: item.unit,
      quantity: line.quantity as number,
      unitPriceSatang: item.unitPriceSatang,
      discount: line.discount,
    });
  }
  return result;
}

function totalsFor(lines: QuoteLine[], draft: Draft, catalog: Catalog): QuoteTotals {
  return computeQuote({
    lines: lines.map((l) => ({ unitPriceSatang: l.unitPriceSatang, quantity: l.quantity, discount: l.discount })),
    billDiscount: draft.billDiscount,
    vatRatePercent: draft.vatRatePercent,
    pricesIncludeVat: catalog.pricesIncludeVat,
    whtRatePercent: draft.whtRatePercent,
  });
}

export type PreviewQuote =
  | { ok: true; totals: QuoteTotals; lineTotals: Map<string, number>; skippedLines: number }
  | { ok: false; error: string };

/** Running totals for the review screen: only ready lines count, and a RangeError never escapes. */
export function previewQuote(draft: Draft, catalog: Catalog): PreviewQuote {
  const lines = readyQuoteLines(draft, catalog);
  try {
    const totals = totalsFor(lines, draft, catalog);
    const lineTotals = new Map(lines.map((l, i) => [l.lineId, (totals.lines[i] as { netSatang: number }).netSatang]));
    return { ok: true, totals, lineTotals, skippedLines: draft.lines.length - lines.length };
  } catch {
    return { ok: false, error: PREVIEW_ERROR };
  }
}

export function canApprove(draft: Draft, catalog: Catalog): boolean {
  if (draft.lines.length === 0) return false;
  if (!draft.lines.every((l) => lineState(l, catalog) === 'ok')) return false;
  return previewQuote(draft, catalog).ok;
}

/**
 * Whether the draft is approved *as it is now*: an approval time is recorded, every line is still ready,
 * and the draft was built against the catalog that is current. A stale `approvedAt` never counts.
 */
export function isApproved(draft: Draft, catalog: Catalog): boolean {
  return draft.approvedAt !== null && draft.catalogKey === catalogKey(catalog) && canApprove(draft, catalog);
}

/** The finished document. Throws unless every line is ready, so nothing is silently left out. */
export function toQuotation(draft: Draft, catalog: Catalog, company: CompanyProfile): Quotation {
  const lines = readyQuoteLines(draft, catalog);
  if (lines.length === 0 || lines.length !== draft.lines.length) {
    throw new Error('toQuotation: every line must be ready (state "ok")');
  }
  return {
    schemaVersion: 1,
    number: draft.number,
    issueDate: draft.issueDate,
    validUntil: addDays(draft.issueDate, company.defaultValidityDays),
    company,
    customer: draft.customer,
    lines,
    billDiscount: draft.billDiscount,
    vatRatePercent: draft.vatRatePercent,
    pricesIncludeVat: catalog.pricesIncludeVat,
    whtRatePercent: draft.whtRatePercent,
    paymentTerms: draft.paymentTerms,
    notes: draft.notes,
    totals: totalsFor(lines, draft, catalog),
    approvedAt: draft.approvedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Reducer

function updateLine(state: Draft, lineId: string, change: (line: DraftLine) => DraftLine): Draft {
  const index = state.lines.findIndex((l) => l.lineId === lineId);
  if (index < 0) return state;
  const current = state.lines[index] as DraftLine;
  const updated = change(current);
  if (updated === current) return state;
  const lines = state.lines.slice();
  lines[index] = updated;
  return { ...state, lines };
}

function sameDiscount(a: Discount | null, b: Discount | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type === 'percent') return b.type === 'percent' && a.value === b.value;
  return b.type === 'amount' && a.satang === b.satang;
}

function loadMatch(action: Extract<DraftAction, { type: 'loadMatch' }>): Draft {
  const { response, catalog } = action;
  const extractedById = new Map(response.extracted.items.map((i) => [i.lineId, i]));
  const bySku = skuMap(catalog);
  return {
    inquiry: action.inquiry,
    customer: { ...response.extracted.customer },
    // Lines are kept exactly as the pipeline returned them: two lines with the same sku stay two lines.
    lines: response.lines.map((l): DraftLine => {
      const extracted = extractedById.get(l.lineId);
      const line: DraftLine = {
        ...l,
        alternativeSkus: [...l.alternativeSkus],
        resolvedSku: l.status === 'matched' ? l.sku : null,
        discount: null,
        confirmed: false,
        productQuery: extracted?.productQuery ?? l.rawText,
        requested: { quantity: extracted?.quantity ?? l.quantity, unit: extracted?.unit ?? l.unit },
        quantityEdited: false,
        catalogUnit: null,
      };
      // The pipeline already converted matched lines; recomputing from `requested` gives the same answer
      // and puts every line under the same unit invariant.
      const item = line.resolvedSku === null ? undefined : bySku.get(line.resolvedSku);
      return item === undefined ? line : reconcileUnit(line, item);
    }),
    missingInfo: response.extracted.missingInfo.map((m) => ({ ...m })),
    billDiscount: null,
    vatRatePercent: DEFAULT_VAT_PERCENT,
    whtRatePercent: 0,
    number: '',
    notes: '',
    paymentTerms: action.paymentTerms,
    issueDate: action.issueDate,
    catalogKey: catalogKey(catalog),
    approvedAt: null,
  };
}

/**
 * Puts `line` on `item` and settles the unit question under the invariant on DraftLine.
 * - quantity not typed by the user: recomputed from what the customer asked for (dozen -> pieces, etc.);
 * - quantity typed by the user: kept exactly as typed, never converted; if its unit differs from the
 *   product's unit the line needs the user's confirmation instead.
 * Any earlier confirmation is dropped, because it was about a different product/unit.
 */
function reconcileUnit(line: DraftLine, item: CatalogItem): DraftLine {
  const base = { ...line, resolvedSku: item.sku, catalogUnit: item.unit, confirmed: false };
  if (!line.quantityEdited) {
    const { quantity, unit } = line.requested;
    const resolved = resolveUnit(unit, item.unit, quantity);
    if (resolved.unitMismatch) return { ...base, quantity, unit, unitNote: null, unitMismatch: true };
    const askedInOtherUnit =
      resolved.note === null && quantity === null && unit !== null && unit.trim() !== item.unit.trim();
    return {
      ...base,
      quantity: resolved.quantity,
      unit: item.unit,
      unitNote: resolved.note ?? (askedInOtherUnit ? `ลูกค้าระบุเป็น ${unit} - กรอกจำนวนเป็น ${item.unit}` : null),
      unitMismatch: false,
    };
  }
  const same = resolveUnit(line.unit, item.unit, line.quantity);
  if (same.unitMismatch || same.note !== null) return { ...base, unitNote: null, unitMismatch: true };
  return { ...base, unit: item.unit, unitNote: null, unitMismatch: false };
}

function selectSku(state: Draft, action: Extract<DraftAction, { type: 'selectSku' }>): Draft {
  const item = skuMap(action.catalog).get(action.sku);
  if (item === undefined) return state;
  return updateLine(state, action.lineId, (line) =>
    line.resolvedSku === item.sku ? line : reconcileUnit(line, item),
  );
}

function reconcileCatalog(state: Draft, catalog: Catalog): Draft {
  const key = catalogKey(catalog);
  if (key === state.catalogKey) return state;
  const bySku = skuMap(catalog);

  const lines = state.lines.map((line): DraftLine => {
    const alternatives = line.alternativeSkus.filter((s) => bySku.has(s) && s !== line.resolvedSku);
    const item = line.resolvedSku === null ? undefined : bySku.get(line.resolvedSku);

    if (line.resolvedSku !== null && item === undefined) {
      // The sku this line was priced from no longer exists: back to the user, never repriced by guess.
      // Unconverted again, so the customer's own quantity/unit is what the next choice starts from.
      return {
        ...line,
        status: 'unmatched',
        sku: null,
        resolvedSku: null,
        alternativeSkus: alternatives,
        confidence: 'low',
        reason: CATALOG_CHANGED_REASON,
        quantity: line.quantityEdited ? line.quantity : line.requested.quantity,
        unit: line.quantityEdited ? line.unit : line.requested.unit,
        unitMismatch: false,
        unitNote: null,
        confirmed: false,
        catalogUnit: null,
      };
    }
    if (item !== undefined) {
      // Same sku, same unit: nothing about the unit changed (a price change leaves confirmations alone).
      if (line.catalogUnit === item.unit) return { ...line, alternativeSkus: alternatives };
      return { ...reconcileUnit(line, item), alternativeSkus: alternatives };
    }
    if (line.status === 'ambiguous' && alternatives.length < 2) {
      return { ...line, status: 'unmatched', alternativeSkus: alternatives };
    }
    return { ...line, alternativeSkus: alternatives };
  });

  return { ...state, lines, catalogKey: key };
}

function reduce(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case 'loadMatch':
      return loadMatch(action);
    case 'selectSku':
      return selectSku(state, action);
    case 'setQuantity':
      // Typed quantities are taken as-is in the line's unit; the conversion note no longer applies.
      return updateLine(state, action.lineId, (l) =>
        l.quantity === action.quantity ? l : { ...l, quantity: action.quantity, quantityEdited: true, unitNote: null },
      );
    case 'setDiscount':
      return updateLine(state, action.lineId, (l) =>
        sameDiscount(l.discount, action.discount) ? l : { ...l, discount: action.discount },
      );
    case 'confirmUnit':
      // Confirming means "quote this quantity in the catalog unit": from here on the line reads, prices and
      // exports in that one unit.
      return updateLine(state, action.lineId, (l) => (l.confirmed ? l : { ...l, confirmed: true, unit: l.catalogUnit ?? l.unit }));
    case 'removeLine': {
      const lines = state.lines.filter((l) => l.lineId !== action.lineId);
      return lines.length === state.lines.length ? state : { ...state, lines };
    }
    case 'setBill':
      return { ...state, ...action.patch };
    case 'catalogChanged':
      return reconcileCatalog(state, action.catalog);
    case 'approve':
      // Approving something that is not ready is refused here too, not only by the disabled button.
      return canApprove(state, action.catalog) ? { ...state, approvedAt: action.now } : state;
  }
}

/** Any change after approval withdraws the approval; the user has to approve the new version. */
export function draftReducer(state: Draft, action: DraftAction): Draft {
  const next = reduce(state, action);
  if (next === state || action.type === 'approve' || action.type === 'loadMatch' || next.approvedAt === null) {
    return next;
  }
  return { ...next, approvedAt: null };
}
