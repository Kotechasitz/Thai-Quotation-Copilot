import { QuoteError, type CatalogLiteItem, type MatchResponse } from '@tqc/core';
import {
  costUsd,
  scoreCase,
  summarize,
  type CaseResult,
  type EvalCase,
  type PriceTable,
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
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
  }
  return results;
}

export function selectCases(cases: readonly EvalCase[], only: string | undefined): EvalCase[] {
  if (only === undefined) return [...cases];
  const found = cases.filter((c) => c.id === only);
  if (found.length === 0) {
    throw new Error(`ไม่พบเคส "${only}" (มี: ${cases.map((c) => c.id).join(', ')})`);
  }
  return found;
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

/** Compares what ran with what was selected; a shortfall means runCases aborted early. */
export function runStatus(results: readonly CaseResult[], planned: number): RunStatus {
  const notRun = Math.max(0, planned - results.length);
  return { aborted: notRun > 0, ran: results.length, planned, notRun };
}

export interface ReportOptions {
  /** Number of cases selected for the run; lets the report say when it stopped early. */
  plannedCases?: number;
  prices: PriceTable;
  /** "<provider>/<model>" key into the price table. */
  priceKey: string;
}

export function formatReport(results: readonly CaseResult[], options: ReportOptions): string {
  const summary = summarize(results);
  const status = runStatus(results, options.plannedCases ?? results.length);
  const lines: string[] = [];
  if (status.aborted) {
    lines.push(`ยกเลิกกลางทาง: รันได้ ${status.ran} จาก ${status.planned} ข้อ — ตัวเลขนี้ใช้ไม่ได้`);
    lines.push('');
  }
  lines.push('ผลการประเมิน (นับระดับบรรทัด: sku + สถานะ + จำนวน ต้องตรงทั้งหมด)');
  lines.push('');
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
  return lines.join('\n');
}
