import { describe, expect, it } from 'vitest';
import { QuoteError, type MatchResponse, type ValidatedLine } from '@tqc/core';
import { costUsd, parsePrices } from './score.ts';
import {
  formatReport,
  resultFileName,
  runStatus,
  runCases,
  selectCases,
  type RunMatchFn,
} from './runner.ts';
import type { EvalCase } from './score.ts';

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
