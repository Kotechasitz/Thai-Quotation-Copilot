import { describe, expect, it } from 'vitest';
import { QuoteError, type MatchResponse, type ValidatedLine } from '@tqc/core';
import { costUsd, parsePrices } from './score.ts';
import { emptyCumulative, mergeCumulative as mergeWith, type CumulativeFile } from './cumulative.ts';
import {
  formatCumulativeSection,
  formatReport,
  planCases,
  resultFileName,
  runStatus,
  runCases,
  selectCases,
  type RunMatchFn,
} from './runner.ts';
import type { CaseResult, EvalCase } from './score.ts';

function matchedLine(sku: string, quantity: number | null): ValidatedLine {
  return {
    lineId: 'L1',
    rawText: 'x',
    quantity,
    unit: null,
    status: 'matched',
    sku,
    alternativeSkus: [],
    confidence: 'high',
    reason: '',
    unitMismatch: false,
    unitNote: null,
  };
}

function response(lines: ValidatedLine[]): MatchResponse {
  return {
    extracted: { items: [], customer: { name: null, company: null, contact: null }, missingInfo: [], language: 'th' },
    lines,
    usage: { inputTokens: 100, outputTokens: 20 },
  };
}

const cases: EvalCase[] = [
  { id: 'a', category: 'thai', catalog: 'plumbing', inquiry: 'qa', expected: [{ sku: 'S1', status: 'matched', quantity: 1 }] },
  { id: 'b', category: 'english', catalog: 'office', inquiry: 'qb', expected: [{ sku: 'S2', status: 'matched', quantity: 2 }] },
  { id: 'c', category: 'english', catalog: 'office', inquiry: 'qc', expected: [{ sku: 'S3', status: 'matched', quantity: 3 }] },
];
const catalogs = { plumbing: [], office: [] };

describe('runCases', () => {
  it('runs sequentially, pauses between cases (not after the last) and scores each', async () => {
    const order: string[] = [];
    const pauses: number[] = [];
    const run: RunMatchFn = async ({ inquiry }) => {
      order.push(inquiry);
      return response(inquiry === 'qa' ? [matchedLine('S1', 1)] : [matchedLine('WRONG', 2)]);
    };
    const results = await runCases({
      cases,
      catalogs,
      run,
      pauseMs: 4000,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    });
    expect(order).toEqual(['qa', 'qb', 'qc']);
    expect(pauses).toEqual([4000, 4000]);
    expect(results.map((r) => r.fullyCorrect)).toEqual([true, false, false]);
    expect(results[0]?.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('records a QuoteError by code and scores the case as all wrong', async () => {
    const run: RunMatchFn = async () => {
      throw new QuoteError('AI_BUSY');
    };
    const results = await runCases({ cases: cases.slice(0, 1), catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(results[0]).toMatchObject({ errorCode: 'AI_BUSY', fullyCorrect: false, score: { correct: 0, total: 1, extra: 0 } });
  });

  it('stops after three consecutive unexpected (non QuoteError) failures', async () => {
    let calls = 0;
    const run: RunMatchFn = async () => {
      calls += 1;
      throw new Error('401 invalid key');
    };
    const many = [...cases, ...cases.map((c) => ({ ...c, id: `${c.id}2` }))];
    const results = await runCases({ cases: many, catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(calls).toBe(3);
    expect(results).toHaveLength(3);
    expect(results[0]?.errorMessage).toContain('401');
  });

  it('treats an extra line as not fully correct', async () => {
    const run: RunMatchFn = async () => response([matchedLine('S1', 1), matchedLine('FREE-999', 1)]);
    const results = await runCases({ cases: cases.slice(0, 1), catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(results[0]).toMatchObject({ fullyCorrect: false, score: { correct: 1, total: 1, extra: 1 } });
  });
});

describe('selectCases', () => {
  it('returns all cases without --only and one case with it', () => {
    expect(selectCases(cases, undefined)).toHaveLength(3);
    expect(selectCases(cases, 'b').map((c) => c.id)).toEqual(['b']);
  });

  it('throws a Thai error listing the unknown id', () => {
    expect(() => selectCases(cases, 'zzz')).toThrow(/zzz/);
  });
});

describe('resultFileName', () => {
  it('uses the date and a filesystem-safe model name', () => {
    expect(resultFileName(new Date(2026, 9, 27), 'gemini-3.6-flash')).toBe('2026-10-27-gemini-3.6-flash.json');
    expect(resultFileName(new Date(2026, 9, 27), 'models/x y:z')).toBe('2026-10-27-models-x-y-z.json');
  });
});

describe('costUsd and formatReport', () => {
  const prices = { 'google/known': { inputPerM: 0.5, outputPerM: 2 } };

  it('computes cost from per-million prices and returns null for unknown models', () => {
    expect(costUsd(prices, 'google/known', { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(1.5);
    expect(costUsd(prices, 'google/other', { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });

  it('prints per-category accuracy, overall, and "ไม่ทราบราคา" for a model without a price', async () => {
    const run: RunMatchFn = async () => response([matchedLine('S1', 1)]);
    const results = await runCases({ cases: cases.slice(0, 1), catalogs, run, pauseMs: 0, sleep: async () => {} });
    const text = formatReport(results, { prices, priceKey: 'google/unknown' });
    expect(text).toContain('thai');
    expect(text).toContain('1/1');
    expect(text).toContain('ไม่ทราบราคา');
    const known = formatReport(results, { prices, priceKey: 'google/known' });
    expect(known).not.toContain('ไม่ทราบราคา');
  });
});

describe('aborted and error reporting', () => {
  const prices = { 'google/known': { inputPerM: 0, outputPerM: 0 } };
  const many = [...cases, ...cases.map((c) => ({ ...c, id: `${c.id}2` }))];

  it('reports how many cases were not run when the run aborted', async () => {
    const run: RunMatchFn = async () => {
      throw new Error('401 invalid key');
    };
    const results = await runCases({ cases: many, catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(runStatus(results, many.length)).toEqual({ aborted: true, ran: 3, planned: 6, notRun: 3 });
    const text = formatReport(results, { prices, priceKey: 'google/known', plannedCases: many.length });
    expect(text).toContain('ยกเลิกกลางทาง: รันได้ 3 จาก 6 ข้อ — ตัวเลขนี้ใช้ไม่ได้');
  });

  it('does not report an abort for a complete run', async () => {
    const run: RunMatchFn = async () => response([matchedLine('S1', 1)]);
    const results = await runCases({ cases: cases.slice(0, 1), catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(runStatus(results, 1)).toEqual({ aborted: false, ran: 1, planned: 1, notRun: 0 });
    const text = formatReport(results, { prices, priceKey: 'google/known', plannedCases: 1 });
    expect(text).not.toContain('ยกเลิกกลางทาง');
    expect(text).not.toContain('ยังไม่พร้อมขึ้นสไลด์');
  });

  it('warns that accuracy is not slide-ready when any case ended in a QuoteError', async () => {
    const run: RunMatchFn = async ({ inquiry }) => {
      if (inquiry === 'qb') throw new QuoteError('AI_BUSY');
      return response([matchedLine('S1', 1)]);
    };
    const results = await runCases({ cases, catalogs, run, pauseMs: 0, sleep: async () => {} });
    const text = formatReport(results, { prices, priceKey: 'google/known', plannedCases: cases.length });
    expect(text).toContain('ยังไม่พร้อมขึ้นสไลด์');
    expect(text).toContain('--only b');
  });
});

describe('parsePrices', () => {
  it('ignores underscore-prefixed note fields such as _source', () => {
    const table = parsePrices(
      JSON.stringify({ _source: 'note', 'google/m': { inputPerM: 0, outputPerM: 0 } }),
    );
    expect(Object.keys(table)).toEqual(['google/m']);
  });
});

describe('selectCases with a comma-separated --only', () => {
  it('returns the listed cases, trimmed, in case-file order', () => {
    expect(selectCases(cases, 'c, a').map((c) => c.id)).toEqual(['a', 'c']);
    expect(selectCases(cases, 'b,b').map((c) => c.id)).toEqual(['b']);
  });

  it('names every unknown id in the error', () => {
    expect(() => selectCases(cases, 'a,zzz,yyy')).toThrow(/zzz.*yyy|yyy.*zzz/);
  });

  it('rejects an empty list', () => {
    expect(() => selectCases(cases, ' , ')).toThrow();
  });
});

describe('planCases (--resume and --max-cases)', () => {
  it('skips cases that already have a good result when resuming', () => {
    expect(planCases(cases, { done: new Set(['a', 'c']) }).map((c) => c.id)).toEqual(['b']);
  });

  it('runs everything when there is nothing to skip', () => {
    expect(planCases(cases, {}).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('--max-cases keeps only the first N cases left to run (after skipping)', () => {
    expect(planCases(cases, { done: new Set(['a']), maxCases: 1 }).map((c) => c.id)).toEqual(['b']);
    expect(planCases(cases, { maxCases: 2 }).map((c) => c.id)).toEqual(['a', 'b']);
    expect(planCases(cases, { maxCases: 99 })).toHaveLength(3);
  });

  it('rejects a --max-cases that is not a positive integer', () => {
    expect(() => planCases(cases, { maxCases: 0 })).toThrow();
    expect(() => planCases(cases, { maxCases: 1.5 })).toThrow();
  });
});

describe('stopping on AI_QUOTA_EXCEEDED', () => {
  const prices = { 'google/known': { inputPerM: 0, outputPerM: 0 } };

  it('stops immediately: no more requests, the quota case is recorded, the run reads as aborted', async () => {
    let calls = 0;
    const run: RunMatchFn = async ({ inquiry }) => {
      calls += 1;
      if (inquiry === 'qb') throw new QuoteError('AI_QUOTA_EXCEEDED');
      return response([matchedLine('S1', 1)]);
    };
    const pauses: number[] = [];
    const results = await runCases({
      cases,
      catalogs,
      run,
      pauseMs: 10,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    });
    expect(calls).toBe(2);
    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(results[1]?.errorCode).toBe('AI_QUOTA_EXCEEDED');
    expect(pauses).toEqual([10]);
    const status = runStatus(results, cases.length);
    expect(status).toEqual({ aborted: true, ran: 2, planned: 3, notRun: 1 });
    const text = formatReport(results, { prices, priceKey: 'google/known', plannedCases: cases.length });
    expect(text).toContain('ยกเลิกกลางทาง');
    expect(text).toContain('โควตา');
  });

  it('a quota error on the very last planned case still means aborted (exit 1), though nothing is left unrun', async () => {
    const run: RunMatchFn = async () => {
      throw new QuoteError('AI_QUOTA_EXCEEDED');
    };
    const results = await runCases({ cases: cases.slice(0, 1), catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(runStatus(results, 1)).toEqual({ aborted: true, ran: 1, planned: 1, notRun: 0 });
    const text = formatReport(results, { prices, priceKey: 'google/known', plannedCases: 1 });
    expect(text).toContain('ยกเลิกกลางทาง');
    expect(text).toContain('โควตา');
  });

  it('a quota error on the last of several cases is aborted too, with the earlier cases kept', async () => {
    const run: RunMatchFn = async ({ inquiry }) => {
      if (inquiry === 'qc') throw new QuoteError('AI_QUOTA_EXCEEDED');
      return response([matchedLine('S1', 1)]);
    };
    const results = await runCases({ cases, catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(results).toHaveLength(3);
    expect(runStatus(results, 3).aborted).toBe(true);
  });

  it('a clean complete run is not aborted', async () => {
    const run: RunMatchFn = async () => response([matchedLine('S1', 1)]);
    const results = await runCases({ cases, catalogs, run, pauseMs: 0, sleep: async () => {} });
    expect(runStatus(results, 3).aborted).toBe(false);
  });
});

describe('cumulative report section', () => {
  const prices = { 'google/known': { inputPerM: 0, outputPerM: 0 } };
  const allCases: EvalCase[] = [
    ...cases,
    { id: 'd', category: 'thai', catalog: 'plumbing', inquiry: 'qd', expected: [{ sku: 'S4', status: 'matched', quantity: 4 }] },
  ];
  const day = new Date('2026-10-27T10:00:00.000Z');
  const mergeCumulative = (file: CumulativeFile, results: readonly CaseResult[], when: Date) =>
    mergeWith(file, results, when, allCases);
  const result = (id: string, category: 'thai' | 'english', ok: boolean): CaseResult => ({
    id,
    category,
    errorCode: null,
    errorMessage: null,
    score: { correct: ok ? 1 : 0, total: 1, extra: 0 },
    fullyCorrect: ok,
    ms: 1000,
    usage: { inputTokens: 50, outputTokens: 10 },
    actual: [],
  });

  it('counts good cases out of all cases, per category and overall, and says it is not complete', () => {
    const file = mergeCumulative(
      emptyCumulative('google', 'known'),
      [result('a', 'thai', true), result('b', 'english', false)],
      day,
    );
    const text = formatCumulativeSection(file, allCases, { prices, priceKey: 'google/known' });
    expect(text).toContain('2/4');
    expect(text).toContain('thai');
    expect(text).toContain('english');
    expect(text).toContain('รวม');
    expect(text).toContain('ยังไม่ครบ 4 ข้อ — ตัวเลขนี้ยังใช้ขึ้นสไลด์ไม่ได้');
    expect(text).toContain('c, d');
  });

  it('drops the warning once every case has a good result', () => {
    const file = mergeCumulative(
      emptyCumulative('google', 'known'),
      [result('a', 'thai', true), result('b', 'english', true), result('c', 'english', true), result('d', 'thai', false)],
      day,
    );
    const text = formatCumulativeSection(file, allCases, { prices, priceKey: 'google/known' });
    expect(text).toContain('4/4');
    expect(text).not.toContain('ยังไม่ครบ');
  });

  it('formatReport appends it after the per-run section when given the cumulative file', () => {
    const file = mergeCumulative(emptyCumulative('google', 'known'), [result('a', 'thai', true)], day);
    const text = formatReport([result('a', 'thai', true)], {
      prices,
      priceKey: 'google/known',
      cumulative: { file, cases: allCases },
    });
    const runAt = text.indexOf('ผลการประเมิน');
    const cumAt = text.indexOf('ยังไม่ครบ 4 ข้อ');
    expect(runAt).toBeGreaterThanOrEqual(0);
    expect(cumAt).toBeGreaterThan(runAt);
  });
});

describe('cumulative section and the code version', () => {
  const prices = { 'google/known': { inputPerM: 0, outputPerM: 0 } };
  const defsList: EvalCase[] = [
    { id: 'a', category: 'thai', catalog: 'plumbing', inquiry: 'qa', expected: [{ sku: 'S1', status: 'matched', quantity: 1 }] },
    { id: 'b', category: 'thai', catalog: 'plumbing', inquiry: 'qb', expected: [{ sku: 'S2', status: 'matched', quantity: 2 }] },
  ];
  const ok = (id: string): CaseResult => ({
    id,
    category: 'thai',
    errorCode: null,
    errorMessage: null,
    score: { correct: 1, total: 1, extra: 0 },
    fullyCorrect: true,
    ms: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    actual: [],
  });

  it('prints the current code version and how many stored results were ignored as stale', () => {
    const file = mergeWith(emptyCumulative('google', 'known'), [ok('a'), ok('b')], new Date(), defsList, 'aaaaaaaaaaaa');
    const same = formatCumulativeSection(file, defsList, { prices, priceKey: 'google/known', codeVersion: 'aaaaaaaaaaaa' });
    expect(same).toContain('เวอร์ชันโค้ด: aaaaaaaaaaaa');
    expect(same).toContain('มีผลแล้ว 2/2');
    expect(same).toContain('ผลเก่าที่ไม่นับ (โค้ดหรือเคสเปลี่ยน): 0');

    const changed = formatCumulativeSection(file, defsList, { prices, priceKey: 'google/known', codeVersion: 'bbbbbbbbbbbb' });
    expect(changed).toContain('เวอร์ชันโค้ด: bbbbbbbbbbbb');
    expect(changed).toContain('มีผลแล้ว 0/2');
    expect(changed).toContain('ผลเก่าที่ไม่นับ (โค้ดหรือเคสเปลี่ยน): 2');
    expect(changed).toContain('ยังไม่ครบ 2 ข้อ');
  });
});

describe('cumulative section ignores stale results', () => {
  const prices = { 'google/known': { inputPerM: 0, outputPerM: 0 } };
  const original: EvalCase[] = [
    { id: 'a', category: 'thai', catalog: 'plumbing', inquiry: 'qa', expected: [{ sku: 'S1', status: 'matched', quantity: 1 }] },
    { id: 'b', category: 'thai', catalog: 'plumbing', inquiry: 'qb', expected: [{ sku: 'S2', status: 'matched', quantity: 2 }] },
  ];
  const ok = (id: string): CaseResult => ({
    id,
    category: 'thai',
    errorCode: null,
    errorMessage: null,
    score: { correct: 1, total: 1, extra: 0 },
    fullyCorrect: true,
    ms: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    actual: [],
  });

  it('an edited case no longer counts and is listed as missing, so the 25/25 claim cannot rest on it', () => {
    const file = mergeWith(emptyCumulative('google', 'known'), [ok('a'), ok('b')], new Date(), original);
    const before = formatCumulativeSection(file, original, { prices, priceKey: 'google/known' });
    expect(before).toContain('มีผลแล้ว 2/2');
    expect(before).not.toContain('ยังไม่ครบ');

    const edited = [original[0]!, { ...original[1]!, inquiry: 'qb edited' }];
    const after = formatCumulativeSection(file, edited, { prices, priceKey: 'google/known' });
    expect(after).toContain('มีผลแล้ว 1/2');
    expect(after).toContain('ยังไม่ครบ 2 ข้อ — ตัวเลขนี้ยังใช้ขึ้นสไลด์ไม่ได้');
    expect(after).toContain('(1): b');
  });
});
