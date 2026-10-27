import type { MatchStatus, ValidatedLine } from '@tqc/core';

export const EVAL_CATEGORIES = [
  'thai',
  'english',
  'mixed',
  'typo',
  'ambiguous',
  'missing-qty',
  'unit',
  'injection',
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export interface ExpectedLine {
  sku: string | null;
  status: MatchStatus;
  quantity: number | null;
}

export interface EvalCase {
  id: string;
  category: EvalCategory;
  catalog: 'plumbing' | 'office';
  inquiry: string;
  expected: ExpectedLine[];
}

export interface CaseScore {
  correct: number;
  total: number;
  extra: number;
}

function sameQuantity(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}

function sameLine(expected: ExpectedLine, actual: ValidatedLine): boolean {
  return (
    expected.status === actual.status &&
    expected.sku === actual.sku &&
    sameQuantity(expected.quantity, actual.quantity)
  );
}

/**
 * A line is correct when sku, status and quantity all match. Lines are paired as a multiset
 * (order does not matter, one actual line satisfies at most one expectation). `extra` is how many
 * more lines the pipeline returned than the case expects.
 */
export function scoreCase(expected: readonly ExpectedLine[], actual: readonly ValidatedLine[]): CaseScore {
  const unused = [...actual];
  let correct = 0;
  for (const want of expected) {
    const at = unused.findIndex((got) => sameLine(want, got));
    if (at >= 0) {
      unused.splice(at, 1);
      correct += 1;
    }
  }
  return { correct, total: expected.length, extra: Math.max(0, actual.length - expected.length) };
}

export interface Price {
  inputPerM: number;
  outputPerM: number;
}

export type PriceTable = Record<string, Price>;

/** Parses prices.json; keys starting with "_" (e.g. "_source") are notes, not models. */
export function parsePrices(json: string): PriceTable {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith('_'))) as PriceTable;
}

/** Cost in USD for the given token counts, or null when the model has no entry in the table. */
export function costUsd(
  prices: PriceTable,
  key: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const price = prices[key];
  if (price === undefined) return null;
  return (usage.inputTokens * price.inputPerM + usage.outputTokens * price.outputPerM) / 1_000_000;
}

export interface CaseResult {
  id: string;
  category: EvalCategory;
  /** Present when the pipeline threw a QuoteError. */
  errorCode: string | null;
  /** Present when the pipeline failed with something that is not a QuoteError. */
  errorMessage: string | null;
  score: CaseScore;
  fullyCorrect: boolean;
  ms: number;
  usage: { inputTokens: number; outputTokens: number };
  actual: ValidatedLine[];
}

export interface CategorySummary {
  category: EvalCategory;
  cases: number;
  casesFullyCorrect: number;
  correct: number;
  total: number;
}

export interface Summary {
  categories: CategorySummary[];
  overall: { cases: number; casesFullyCorrect: number; correct: number; total: number; extra: number };
  avgMs: number;
  usage: { inputTokens: number; outputTokens: number };
  errorsByCode: Record<string, number>;
}

export function summarize(results: readonly CaseResult[]): Summary {
  const categories: CategorySummary[] = [];
  for (const category of EVAL_CATEGORIES) {
    const inCategory = results.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    categories.push({
      category,
      cases: inCategory.length,
      casesFullyCorrect: inCategory.filter((r) => r.fullyCorrect).length,
      correct: inCategory.reduce((n, r) => n + r.score.correct, 0),
      total: inCategory.reduce((n, r) => n + r.score.total, 0),
    });
  }
  const errorsByCode: Record<string, number> = {};
  for (const r of results) {
    const key = r.errorCode ?? (r.errorMessage !== null ? 'OTHER' : null);
    if (key !== null) errorsByCode[key] = (errorsByCode[key] ?? 0) + 1;
  }
  return {
    categories,
    overall: {
      cases: results.length,
      casesFullyCorrect: results.filter((r) => r.fullyCorrect).length,
      correct: results.reduce((n, r) => n + r.score.correct, 0),
      total: results.reduce((n, r) => n + r.score.total, 0),
      extra: results.reduce((n, r) => n + r.score.extra, 0),
    },
    avgMs: results.length === 0 ? 0 : results.reduce((n, r) => n + r.ms, 0) / results.length,
    usage: {
      inputTokens: results.reduce((n, r) => n + r.usage.inputTokens, 0),
      outputTokens: results.reduce((n, r) => n + r.usage.outputTokens, 0),
    },
    errorsByCode,
  };
}
