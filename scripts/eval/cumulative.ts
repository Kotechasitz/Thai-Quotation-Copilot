import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ValidatedLine } from '@tqc/core';
import type { CaseResult, CaseScore, EvalCase, EvalCategory } from './score.ts';

/** One case's latest non-errored result, kept across days. */
export interface CumulativeCase {
  id: string;
  category: EvalCategory;
  /**
   * Fingerprint of the case (inquiry, catalog, expected) when it was run. A result whose fingerprint
   * no longer matches the case in cases.json is stale and counts as "no good result".
   */
  fingerprint: string;
  /**
   * Version of the code that produced the result (see computeCodeVersion). A result from other code, or
   * one stored before this field existed, is stale: it says nothing about the code being run now.
   */
  codeVersion: string;
  /** The lines the pipeline returned. */
  actual: ValidatedLine[];
  /** Scored line counts (correct / expected / extra). */
  score: CaseScore;
  fullyCorrect: boolean;
  ms: number;
  usage: { inputTokens: number; outputTokens: number };
  /** ISO timestamp of the run that produced this result. */
  date: string;
}

export interface CumulativeFile {
  provider: string;
  model: string;
  /** ISO timestamp of the last merge. */
  updated: string;
  cases: Record<string, CumulativeCase>;
}

/** `<model>-cumulative.json`, with anything unsafe for a file name replaced by "-". */
export function cumulativeFileName(model: string): string {
  const safe = model.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe}-cumulative.json`;
}

/**
 * Stable hash of what makes a result valid for a case: the inquiry, which catalog it runs against and
 * the expected lines. (The id and category are labels; the catalog's *contents* are not hashed.)
 */
export function caseFingerprint(c: EvalCase): string {
  const canonical = JSON.stringify({
    inquiry: c.inquiry,
    catalog: c.catalog,
    expected: c.expected.map((l) => ({ sku: l.sku, status: l.status, quantity: l.quantity })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The files whose content decides what the pipeline answers (repo-relative): prompts, schemas, validation,
 * the pipeline itself, retrieval, and the two sample catalogs the eval cases run against.
 */
export const CODE_VERSION_FILES = [
  'packages/core/src/ai/prompts.ts',
  'packages/core/src/ai/schemas.ts',
  'packages/core/src/ai/validate.ts',
  'packages/core/src/ai/pipeline.ts',
  'packages/core/src/retrieve/index.ts',
  'packages/core/src/retrieve/tokenize.ts',
  'samples/catalogs/plumbing.csv',
  'samples/catalogs/office.csv',
] as const;

const REPO_ROOT = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), 'utf8');
}

/**
 * First 12 hex characters of the sha256 over CODE_VERSION_FILES (path + content each, line endings
 * normalised so a CRLF checkout gives the same version). `read` is injectable for tests.
 */
export function computeCodeVersion(read: (relativePath: string) => string = readRepoFile): string {
  const hash = createHash('sha256');
  for (const path of CODE_VERSION_FILES) {
    hash.update(`${path}\n${read(path).replace(/\r\n/g, '\n')}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

let cachedCodeVersion: string | undefined;

/** The version of the code on disk now (computed once per process). */
export function currentCodeVersion(): string {
  cachedCodeVersion ??= computeCodeVersion();
  return cachedCodeVersion;
}

export function emptyCumulative(provider: string, model: string): CumulativeFile {
  return { provider, model, updated: new Date(0).toISOString(), cases: {} };
}

/** Parses a cumulative file; throws a Thai Error when it does not look like one. */
export function parseCumulative(json: string): CumulativeFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('ไฟล์ cumulative อ่านไม่ได้ (ไม่ใช่ JSON)');
  }
  const f = raw as Partial<CumulativeFile> | null;
  if (
    typeof f !== 'object' ||
    f === null ||
    typeof f.model !== 'string' ||
    typeof f.cases !== 'object' ||
    f.cases === null ||
    Array.isArray(f.cases)
  ) {
    throw new Error('ไฟล์ cumulative ไม่ถูกรูปแบบ (ต้องมี model และ cases เป็น object)');
  }
  return {
    provider: typeof f.provider === 'string' ? f.provider : '',
    model: f.model,
    updated: typeof f.updated === 'string' ? f.updated : new Date(0).toISOString(),
    cases: f.cases,
  };
}

/** True when the pipeline failed for this case (a QuoteError or anything else): no score to trust. */
export function isErrored(r: CaseResult): boolean {
  return r.errorCode !== null || r.errorMessage !== null;
}

/**
 * True when the file holds a result for exactly this version of the case (same fingerprint) produced by
 * exactly this version of the code (same codeVersion).
 */
export function hasCurrentResult(
  file: CumulativeFile,
  c: EvalCase,
  codeVersion: string = currentCodeVersion(),
): boolean {
  const stored = file.cases[c.id];
  return stored?.fingerprint === caseFingerprint(c) && stored.codeVersion === codeVersion;
}

/** How many of `cases` have a stored result that is not current (edited case or different code). */
export function countStaleResults(
  file: CumulativeFile,
  cases: readonly EvalCase[],
  codeVersion: string = currentCodeVersion(),
): number {
  return cases.filter((c) => file.cases[c.id] !== undefined && !hasCurrentResult(file, c, codeVersion)).length;
}

/**
 * Folds a run into the cumulative file without mutating it. A non-errored result replaces any earlier
 * one for the same case (the latest run wins) and is stamped with the fingerprint of the case as given
 * in `cases` and the code version; an errored result is dropped, so it can never overwrite a good one.
 */
export function mergeCumulative(
  file: CumulativeFile,
  results: readonly CaseResult[],
  date: Date,
  cases: readonly EvalCase[],
  codeVersion: string = currentCodeVersion(),
): CumulativeFile {
  const iso = date.toISOString();
  const byId = new Map(cases.map((c) => [c.id, c]));
  const stored = { ...file.cases };
  let changed = false;
  for (const r of results) {
    const c = byId.get(r.id);
    if (isErrored(r) || c === undefined) continue;
    stored[r.id] = {
      id: r.id,
      category: r.category,
      fingerprint: caseFingerprint(c),
      codeVersion,
      actual: r.actual,
      score: r.score,
      fullyCorrect: r.fullyCorrect,
      ms: r.ms,
      usage: r.usage,
      date: iso,
    };
    changed = true;
  }
  return { ...file, cases: stored, updated: changed ? iso : file.updated };
}

/** Ids of the cases in `cases` that already have a good result for their current version. */
export function goodCaseIds(
  file: CumulativeFile,
  cases: readonly EvalCase[],
  codeVersion: string = currentCodeVersion(),
): Set<string> {
  return new Set(cases.filter((c) => hasCurrentResult(file, c, codeVersion)).map((c) => c.id));
}

/** Current stored results as CaseResults, in the order of `cases`; stale or missing ones are left out. */
export function cumulativeResults(
  file: CumulativeFile,
  cases: readonly EvalCase[],
  codeVersion: string = currentCodeVersion(),
): CaseResult[] {
  const out: CaseResult[] = [];
  for (const c of cases) {
    const stored = file.cases[c.id];
    if (stored === undefined || !hasCurrentResult(file, c, codeVersion)) continue;
    out.push({
      id: stored.id,
      category: stored.category,
      errorCode: null,
      errorMessage: null,
      score: stored.score,
      fullyCorrect: stored.fullyCorrect,
      ms: stored.ms,
      usage: stored.usage,
      actual: stored.actual,
    });
  }
  return out;
}

/** The fs calls writeFileAtomic makes; tests swap them to simulate a crash. */
export interface AtomicFs {
  writeFileSync: (path: string, text: string) => void;
  renameSync: (from: string, to: string) => void;
}

/**
 * Writes `text` to a temp file next to `path`, then renames it over `path` (atomic on one volume), so a
 * crash leaves either the old complete file or the new complete file, never partial JSON. A failed write
 * or rename removes the temp file and rethrows.
 */
export function writeFileAtomic(
  path: string,
  text: string,
  fs: Partial<AtomicFs> = {},
): void {
  const write = fs.writeFileSync ?? ((p: string, t: string) => writeFileSync(p, t));
  const rename = fs.renameSync ?? renameSync;
  const temp = `${path}.${process.pid}.tmp`;
  try {
    write(temp, text);
    rename(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export interface PersisterOptions {
  /** Where the cumulative file lives (its directory must exist). */
  path: string;
  /** What is on disk now (or an empty file). */
  file: CumulativeFile;
  /** The full case set, used to fingerprint each result. */
  cases: readonly EvalCase[];
  /** Code version stamped on every saved result; defaults to the code on disk now. */
  codeVersion?: string;
  now?: () => Date;
}

/**
 * Saves the cumulative file after every case so a crash, Ctrl-C or quota abort loses nothing already
 * paid for. Errored results change nothing, so they do not touch the disk.
 */
export function createCumulativePersister(options: PersisterOptions): {
  onCase: (result: CaseResult) => void;
  current: () => CumulativeFile;
} {
  const { path, cases, codeVersion = currentCodeVersion(), now = () => new Date() } = options;
  let file = options.file;
  return {
    onCase(result) {
      if (isErrored(result)) return;
      file = mergeCumulative(file, [result], now(), cases, codeVersion);
      writeFileAtomic(path, JSON.stringify(file, null, 2));
    },
    current: () => file,
  };
}
