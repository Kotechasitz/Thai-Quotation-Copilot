import { extractAngle, extractSize } from '../normalize/size.ts';
import type { CatalogLiteItem, Size } from '../types.ts';
import { tokenize } from './tokenize.ts';

/** Default number of candidates handed to the AI per requested item. */
export const MAX_CANDIDATES = 20;
/**
 * Catalogs at or below this many rows are sent to the AI whole (ranked, never filtered). Equal to
 * MAX_CANDIDATES so a bigger catalog always yields the top 20 by score: sending a 144-row catalog for
 * every line cost ~25k input tokens per eval case.
 */
export const FULL_CATALOG_THRESHOLD = MAX_CANDIDATES;

const NAME_WEIGHT = 1;
const CATEGORY_WEIGHT = 0.3;
/** Candidates pulled from the token ranking before size/angle re-ranking, as a multiple of k. */
const RERANK_POOL_FACTOR = 3;
const MATCH_BOOST = 1.5;
const CONFLICT_PENALTY = 0.4;
const NUMBER_EPSILON = 1e-6;
/**
 * Pseudo-count added to an item's token count before taking the square root. Without it,
 * product names this short (3-6 words) swing the score by 30%+ over one descriptor such
 * as "ชั้น 13.5", which drowned out real evidence like a whole-word match.
 */
const LENGTH_SMOOTHING = 8;

interface Postings {
  docs: number[];
  weights: number[];
}

export interface CatalogIndex {
  /** Number of catalog rows indexed. */
  readonly size: number;
  readonly skus: readonly string[];
  readonly postings: ReadonlyMap<string, Postings>;
  /** Length per document for score normalisation (see buildIndex), not a raw token count. */
  readonly docLengths: Float64Array;
  readonly sizes: readonly (Size | null)[];
  readonly angles: readonly (number | null)[];
}

export interface Candidate {
  sku: string;
  score: number;
}

export interface CandidateQuery {
  productQuery: string;
  specs: string[];
}

function firstNonNull<T>(texts: string[], extract: (s: string) => T | null): T | null {
  for (const t of texts) {
    const v = extract(t);
    if (v !== null) return v;
  }
  return null;
}

const THAI_TOKEN = /^#?[฀-๿]/;

/** Thai text yields ~3 tokens per character (bigram, trigram, word), Latin one per word. */
function tokenWeight(tokens: Set<string>): number {
  let w = 0;
  for (const t of tokens) w += THAI_TOKEN.test(t) ? 1 / 3 : 1;
  return w;
}

export function buildIndex(items: CatalogLiteItem[]): CatalogIndex {
  const postings = new Map<string, Postings>();
  const docLengths = new Float64Array(items.length);
  const sizes: (Size | null)[] = [];
  const angles: (number | null)[] = [];

  items.forEach((item, doc) => {
    const nameTexts = [item.nameTh, item.nameEn, ...item.aliases].filter(
      (t): t is string => typeof t === 'string' && t !== '',
    );

    const nameTokens = [item.nameTh, item.nameEn].map((t) => new Set(t ? tokenize(t) : []));
    const aliasTokens = new Set(item.aliases.flatMap((a) => tokenize(a)));

    const weights = new Map<string, number>();
    for (const tokens of [...nameTokens, aliasTokens]) {
      for (const tok of tokens) weights.set(tok, NAME_WEIGHT);
    }
    if (item.category) {
      for (const tok of tokenize(item.category)) {
        if (!weights.has(tok)) weights.set(tok, CATEGORY_WEIGHT);
      }
    }

    // nameTh and nameEn describe the same product, so a bilingual row is not "twice as long"
    // as a monolingual one: length is that of its most compact name. Aliases exist to be
    // matched, so they don't count towards length.
    const lengths = nameTokens.filter((t) => t.size > 0).map(tokenWeight);
    docLengths[doc] = Math.max(1, ...(lengths.length > 0 ? [Math.min(...lengths)] : [1]));
    for (const [tok, weight] of weights) {
      let p = postings.get(tok);
      if (!p) {
        p = { docs: [], weights: [] };
        postings.set(tok, p);
      }
      p.docs.push(doc);
      p.weights.push(weight);
    }

    sizes.push(firstNonNull(nameTexts, extractSize));
    angles.push(firstNonNull(nameTexts, extractAngle));
  });

  return { size: items.length, skus: items.map((i) => i.sku), postings, docLengths, sizes, angles };
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUMBER_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/** 1.5 on agreement, 0.4 on conflict, 1 when either side is unknown or the units differ. */
function sizeFactor(want: Size | null, have: Size | null): number {
  if (want === null || have === null || want.unit !== have.unit) return 1;
  return sameNumber(want.value, have.value) ? MATCH_BOOST : CONFLICT_PENALTY;
}

function angleFactor(want: number | null, have: number | null): number {
  if (want === null || have === null) return 1;
  return sameNumber(want, have) ? MATCH_BOOST : CONFLICT_PENALTY;
}

/**
 * Candidate catalog rows for one requested item, best first.
 *
 * Score = sum of IDF of matching tokens / sqrt(item length + LENGTH_SMOOTHING). Size and
 * angle (taken from the specs first, then the product query) then boost agreeing rows and
 * demote conflicting ones. Catalogs of at most FULL_CATALOG_THRESHOLD rows return every sku;
 * larger ones return the top k rows that matched at least one token.
 */
export function searchCandidates(
  index: CatalogIndex,
  query: CandidateQuery,
  k: number = MAX_CANDIDATES,
): Candidate[] {
  const n = index.size;
  if (n === 0 || k <= 0) return [];

  const queryText = [...query.specs, query.productQuery];
  const wantSize = firstNonNull(queryText, extractSize);
  const wantAngle = firstNonNull(queryText, extractAngle);

  const scores = new Float64Array(n);
  const touched: number[] = [];
  const seen = new Uint8Array(n);

  for (const tok of tokenize(`${query.productQuery} ${query.specs.join(' ')}`)) {
    const p = index.postings.get(tok);
    if (!p) continue;
    const df = p.docs.length;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (let i = 0; i < df; i++) {
      const doc = p.docs[i]!;
      if (seen[doc] === 0) {
        seen[doc] = 1;
        touched.push(doc);
      }
      scores[doc]! += idf * p.weights[i]!;
    }
  }

  const byScoreThenOrder = (a: number, b: number): number => scores[b]! - scores[a]! || a - b;

  const fullCatalog = n <= FULL_CATALOG_THRESHOLD;
  let pool: number[];
  if (fullCatalog) {
    pool = Array.from({ length: n }, (_, i) => i);
  } else {
    touched.sort(byScoreThenOrder);
    pool = touched.slice(0, k * RERANK_POOL_FACTOR);
  }

  const final = new Map<number, number>();
  for (const doc of pool) {
    const base = scores[doc]! / Math.sqrt(LENGTH_SMOOTHING + index.docLengths[doc]!);
    final.set(
      doc,
      base * sizeFactor(wantSize, index.sizes[doc]!) * angleFactor(wantAngle, index.angles[doc]!),
    );
  }

  const ranked = pool.sort((a, b) => final.get(b)! - final.get(a)! || a - b);
  return ranked.slice(0, fullCatalog ? n : k).map((doc) => ({ sku: index.skus[doc]!, score: final.get(doc)! }));
}
