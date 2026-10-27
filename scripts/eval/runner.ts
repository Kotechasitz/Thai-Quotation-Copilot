import { QuoteError, type CatalogLiteItem, type MatchResponse } from '@tqc/core';
import {
  countStaleResults,
  cumulativeResults,
  currentCodeVersion,
  hasCurrentResult,
  type CumulativeFile,
} from './cumulative.ts';
import {
  costUsd,
  scoreCase,
  summarize,
  type CaseResult,
  type EvalCase,
  type PriceTable,
  type Summary,
} from './score.ts';

/** The slice of runMatch the runner needs; tests inject a fake. */
export type RunMatchFn = (args: { inquiry: string; catalog: CatalogLiteItem[] }) => Promise<MatchResponse>;

export interface RunCasesArgs {
  cases: readonly EvalCase[];
  catalogs: Record<EvalCase['catalog'], CatalogLiteItem[]>;
  run: RunMatchFn;
  /** Pause between cases so the free tier's requests-per-minute limit is not hit. */
  pauseMs: number;
  sleep?: (ms: number) => Promise<void>;
  onCase?: (result: CaseResult, index: number, total: number) => void;
}

/** After this many back-to-back unexpected failures (bad key, no network) the run is pointless. */
export const MAX_CONSECUTIVE_FAILURES = 3;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runCases(args: RunCasesArgs): Promise<CaseResult[]> {
  const { cases, catalogs, run, pauseMs, sleep = defaultSleep, onCase } = args;
  const results: CaseResult[] = [];
  let consecutiveFailures = 0;

  for (const [index, c] of cases.entries()) {
    if (index > 0 && pauseMs > 0) await sleep(pauseMs);

    const started = performance.now();
    let result: CaseResult;
    try {
      const response = await run({ inquiry: c.inquiry, catalog: catalogs[c.catalog] });
      const score = scoreCase(c.expected, response.lines);
      result = {
        id: c.id,
        category: c.category,
        errorCode: null,
        errorMessage: null,
        score,
        fullyCorrect: score.correct === score.total && score.extra === 0,
        ms: performance.now() - started,
        usage: response.usage,
        actual: response.lines,
      };
      consecutiveFailures = 0;
    } catch (error) {
      const quoteError = error instanceof QuoteError ? error : null;
      result = {
        id: c.id,
        category: c.category,
        errorCode: quoteError?.code ?? null,
        errorMessage: quoteError === null ? (error instanceof Error ? error.message : String(error)) : null,
        score: { correct: 0, total: c.expected.length, extra: 0 },
        fullyCorrect: false,
        ms: performance.now() - started,
        usage: { inputTokens: 0, outputTokens: 0 },
        actual: [],
      };
      consecutiveFailures = quoteError === null ? consecutiveFailures + 1 : 0;
    }

    results.push(result);
    onCase?.(result, index, cases.length);
    // The per-day quota is gone: every further request would fail the same way until tomorrow.
    if (result.errorCode === 'AI_QUOTA_EXCEEDED') break;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
  }
  return results;
}

/** `--only a,b,c`: the listed cases, in case-file order. Unknown ids are an error. */
export function selectCases(cases: readonly EvalCase[], only: string | undefined): EvalCase[] {
  if (only === undefined) return [...cases];
  const wanted = only
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (wanted.length === 0) throw new Error('--only ต้องระบุ id ของเคสอย่างน้อย 1 ข้อ');
  const known = new Set(cases.map((c) => c.id));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `ไม่พบเคส ${unknown.map((id) => `"${id}"`).join(', ')} (มี: ${cases.map((c) => c.id).join(', ')})`,
    );
  }
  const set = new Set(wanted);
  return cases.filter((c) => set.has(c.id));
}

export interface PlanOptions {
  /** Case ids that already have a good result (`--resume`); they are skipped. */
  done?: ReadonlySet<string>;
  /** `--max-cases`: attempt at most this many of the cases left. */
  maxCases?: number;
}

/** The cases a run should attempt: minus those already done, then capped at `maxCases`. */
export function planCases(cases: readonly EvalCase[], options: PlanOptions): EvalCase[] {
  const { done, maxCases } = options;
  if (maxCases !== undefined && (!Number.isInteger(maxCases) || maxCases < 1)) {
    throw new Error('--max-cases ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  }
  const left = cases.filter((c) => done?.has(c.id) !== true);
  return maxCases === undefined ? left : left.slice(0, maxCases);
}

/** `<YYYY-MM-DD>-<model>.json` in local time, with anything unsafe for a file name replaced by "-". */
export function resultFileName(date: Date, model: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safe = model.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${day}-${safe}.json`;
}

function pct(correct: number, total: number): string {
  return total === 0 ? '-' : `${((correct / total) * 100).toFixed(0)}%`;
}

export interface RunStatus {
  aborted: boolean;
  ran: number;
  planned: number;
  notRun: number;
}

/**
 * Compares what ran with what was selected; a shortfall means runCases aborted early. An
 * AI_QUOTA_EXCEEDED result is an abort even when it was the last planned case: the day's quota is gone,
 * so the run did not finish what it set out to do and must exit non-zero.
 */
export function runStatus(results: readonly CaseResult[], planned: number): RunStatus {
  const notRun = Math.max(0, planned - results.length);
  const quotaHit = results.some((r) => r.errorCode === 'AI_QUOTA_EXCEEDED');
  return { aborted: notRun > 0 || quotaHit, ran: results.length, planned, notRun };
}

export interface ReportOptions {
  /** Number of cases selected for the run; lets the report say when it stopped early. */
  plannedCases?: number;
  prices: PriceTable;
  /** "<provider>/<model>" key into the price table. */
  priceKey: string;
  /** Version of the code being scored (see computeCodeVersion); defaults to the code on disk now. */
  codeVersion?: string;
  /** When given, a second section is appended that is computed over the cumulative file. */
  cumulative?: { file: CumulativeFile; cases: readonly EvalCase[] };
}

function tableLines(summary: Summary): string[] {
  const lines: string[] = [];
  lines.push(`${'category'.padEnd(13)}${'บรรทัดถูก'.padEnd(12)}${'%'.padEnd(7)}เคสถูกทั้งหมด`);
  for (const c of summary.categories) {
    lines.push(
      `${c.category.padEnd(13)}${`${c.correct}/${c.total}`.padEnd(12)}${pct(c.correct, c.total).padEnd(7)}${c.casesFullyCorrect}/${c.cases}`,
    );
  }
  const o = summary.overall;
  lines.push('-'.repeat(44));
  lines.push(
    `${'รวม'.padEnd(13)}${`${o.correct}/${o.total}`.padEnd(12)}${pct(o.correct, o.total).padEnd(7)}${o.casesFullyCorrect}/${o.cases}`,
  );
  return lines;
}

/**
 * Accuracy over every case that has a good result in the cumulative file (all days so far), and how many
 * of the full case set that is. Until all cases have one the number is not ready for a slide.
 */
export function formatCumulativeSection(
  file: CumulativeFile,
  cases: readonly EvalCase[],
  options: Pick<ReportOptions, 'prices' | 'priceKey' | 'codeVersion'>,
): string {
  const codeVersion = options.codeVersion ?? currentCodeVersion();
  const results = cumulativeResults(file, cases, codeVersion);
  const summary = summarize(results);
  const lines: string[] = [];
  lines.push('ผลสะสมทุกวัน (เคสที่มีผลที่ใช้ได้ ล่าสุดของแต่ละเคส)');
  lines.push(`มีผลแล้ว ${results.length}/${cases.length} ข้อ`);
  lines.push(`เวอร์ชันโค้ด: ${codeVersion}`);
  lines.push(`ผลเก่าที่ไม่นับ (โค้ดหรือเคสเปลี่ยน): ${countStaleResults(file, cases, codeVersion)}`);
  lines.push('');
  lines.push(...tableLines(summary));
  lines.push('');
  lines.push(`บรรทัดเกิน (extra): ${summary.overall.extra}`);
  lines.push(
    `token สะสม: input ${summary.usage.inputTokens.toLocaleString('en-US')}, output ${summary.usage.outputTokens.toLocaleString('en-US')}`,
  );
  const cost = costUsd(options.prices, options.priceKey, summary.usage);
  if (cost !== null) lines.push(`ค่าใช้จ่ายสะสม: $${cost.toFixed(4)} (${options.priceKey})`);
  // Missing = no result for the *current* version of the case: an edited case's old score is stale.
  const missing = cases.filter((c) => !hasCurrentResult(file, c, codeVersion)).map((c) => c.id);
  if (missing.length > 0) {
    lines.push('');
    lines.push(`ยังไม่ครบ ${cases.length} ข้อ — ตัวเลขนี้ยังใช้ขึ้นสไลด์ไม่ได้`);
    lines.push(`ข้อที่ยังไม่มีผล (${missing.length}): ${missing.join(', ')}`);
  } else {
    lines.push('');
    lines.push(`ครบ ${cases.length} ข้อแล้ว`);
  }
  return lines.join('\n');
}

export function formatReport(results: readonly CaseResult[], options: ReportOptions): string {
  const summary = summarize(results);
  const status = runStatus(results, options.plannedCases ?? results.length);
  const lines: string[] = [];
  if (status.aborted) {
    lines.push(
      status.notRun > 0
        ? `ยกเลิกกลางทาง: รันได้ ${status.ran} จาก ${status.planned} ข้อ — ตัวเลขนี้ใช้ไม่ได้`
        : `ยกเลิกกลางทาง: โควตา AI หมดที่เคสสุดท้าย (ข้อสุดท้ายไม่มีผล) — ตัวเลขนี้ใช้ไม่ได้`,
    );
    lines.push('');
  }
  if (results.some((r) => r.errorCode === 'AI_QUOTA_EXCEEDED')) {
    lines.push('โควตา AI รายวันหมด: หยุดส่งคำขอแล้ว — รันต่อพรุ่งนี้ด้วย npm run eval:daily (ผลที่ได้แล้วถูกเก็บในไฟล์สะสม)');
    lines.push('');
  }
  lines.push('ผลการประเมิน (นับระดับบรรทัด: sku + สถานะ + จำนวน ต้องตรงทั้งหมด)');
  lines.push('');
  lines.push(...tableLines(summary));
  const o = summary.overall;
  lines.push('');
  lines.push(`บรรทัดเกิน (extra): ${o.extra}`);
  lines.push(`เวลาเฉลี่ยต่อเคส: ${(summary.avgMs / 1000).toFixed(1)} วินาที`);
  lines.push(
    `token: input ${summary.usage.inputTokens.toLocaleString('en-US')}, output ${summary.usage.outputTokens.toLocaleString('en-US')}`,
  );
  const cost = costUsd(options.prices, options.priceKey, summary.usage);
  lines.push(
    cost === null
      ? `ค่าใช้จ่าย: ไม่ทราบราคา (ไม่มี "${options.priceKey}" ใน prices.json)`
      : `ค่าใช้จ่าย: $${cost.toFixed(4)} (${options.priceKey})`,
  );
  const errorEntries = Object.entries(summary.errorsByCode);
  lines.push(
    errorEntries.length === 0
      ? 'เคสที่เกิด error: 0'
      : `เคสที่เกิด error: ${errorEntries.map(([code, n]) => `${code}=${n}`).join(', ')}`,
  );

  const errored = results.filter((r) => r.errorCode !== null || r.errorMessage !== null);
  if (errored.length > 0) {
    lines.push('');
    lines.push(
      `คำเตือน: ${errored.length} เคสเกิด error ความแม่นยำนี้ยังไม่พร้อมขึ้นสไลด์ ต้องรันเคสเหล่านั้นใหม่ก่อน (${errored.map((r) => `--only ${r.id}`).join(' / ')})`,
    );
  }

  const wrong = results.filter((r) => !r.fullyCorrect);
  if (wrong.length > 0) {
    lines.push('');
    lines.push('เคสที่ยังไม่ถูกทั้งหมด:');
    for (const r of wrong) {
      const why = r.errorCode ?? r.errorMessage ?? `${r.score.correct}/${r.score.total}${r.score.extra > 0 ? ` +${r.score.extra} extra` : ''}`;
      lines.push(`  ${r.id}: ${why}`);
    }
  }
  if (options.cumulative !== undefined) {
    lines.push('');
    lines.push('='.repeat(44));
    lines.push(formatCumulativeSection(options.cumulative.file, options.cumulative.cases, options));
  }
  return lines.join('\n');
}
