import { describe, expect, it } from 'vitest';
import type { ValidatedLine } from '@tqc/core';
import { scoreCase } from './score.ts';

function line(partial: Partial<ValidatedLine> & Pick<ValidatedLine, 'status'>): ValidatedLine {
  return {
    lineId: 'L1',
    rawText: 'x',
    quantity: 1,
    unit: null,
    sku: null,
    alternativeSkus: [],
    confidence: 'high',
    reason: '',
    unitMismatch: false,
    unitNote: null,
    ...partial,
  };
}

describe('scoreCase', () => {
  it('counts every line when sku, status and quantity all match', () => {
    const result = scoreCase(
      [
        { sku: 'A', status: 'matched', quantity: 2 },
        { sku: 'B', status: 'matched', quantity: 5 },
      ],
      [line({ status: 'matched', sku: 'A', quantity: 2 }), line({ status: 'matched', sku: 'B', quantity: 5 })],
    );
    expect(result).toEqual({ correct: 2, total: 2, extra: 0 });
  });

  it('does not count a line whose status is right but sku is wrong', () => {
    const result = scoreCase(
      [{ sku: 'A', status: 'matched', quantity: 2 }],
      [line({ status: 'matched', sku: 'WRONG', quantity: 2 })],
    );
    expect(result).toEqual({ correct: 0, total: 1, extra: 0 });
  });

  it('does not count a line whose quantity is wrong', () => {
    const result = scoreCase(
      [{ sku: 'A', status: 'matched', quantity: 24 }],
      [line({ status: 'matched', sku: 'A', quantity: 2 })],
    );
    expect(result).toEqual({ correct: 0, total: 1, extra: 0 });
  });

  it('counts an ambiguous line with expected sku null when the status is ambiguous', () => {
    const result = scoreCase(
      [{ sku: null, status: 'ambiguous', quantity: 20 }],
      [line({ status: 'ambiguous', sku: null, quantity: 20, alternativeSkus: ['A', 'B'] })],
    );
    expect(result).toEqual({ correct: 1, total: 1, extra: 0 });
  });

  it('does not count an ambiguous expectation answered with a confident match', () => {
    const result = scoreCase(
      [{ sku: null, status: 'ambiguous', quantity: 20 }],
      [line({ status: 'matched', sku: 'A', quantity: 20 })],
    );
    expect(result).toEqual({ correct: 0, total: 1, extra: 0 });
  });

  it('matches a null expected quantity only against a null actual quantity', () => {
    const expected = [{ sku: 'A', status: 'matched' as const, quantity: null }];
    expect(scoreCase(expected, [line({ status: 'matched', sku: 'A', quantity: null })]).correct).toBe(1);
    expect(scoreCase(expected, [line({ status: 'matched', sku: 'A', quantity: 1 })]).correct).toBe(0);
  });

  it('reports actual lines beyond the expected ones as extra', () => {
    const result = scoreCase(
      [{ sku: 'A', status: 'matched', quantity: 2 }],
      [
        line({ status: 'matched', sku: 'A', quantity: 2 }),
        line({ status: 'unmatched', sku: null, quantity: null }),
      ],
    );
    expect(result).toEqual({ correct: 1, total: 1, extra: 1 });
  });

  it('is order independent', () => {
    const result = scoreCase(
      [
        { sku: 'A', status: 'matched', quantity: 2 },
        { sku: 'B', status: 'matched', quantity: 5 },
      ],
      [line({ status: 'matched', sku: 'B', quantity: 5 }), line({ status: 'matched', sku: 'A', quantity: 2 })],
    );
    expect(result).toEqual({ correct: 2, total: 2, extra: 0 });
  });

  it('matches as a multiset: two identical expected lines need two identical actual lines', () => {
    const expected = [
      { sku: 'A', status: 'matched' as const, quantity: 10 },
      { sku: 'A', status: 'matched' as const, quantity: 10 },
    ];
    const one = scoreCase(expected, [line({ status: 'matched', sku: 'A', quantity: 10 })]);
    expect(one).toEqual({ correct: 1, total: 2, extra: 0 });
    const two = scoreCase(expected, [
      line({ status: 'matched', sku: 'A', quantity: 10 }),
      line({ status: 'matched', sku: 'A', quantity: 10 }),
    ]);
    expect(two).toEqual({ correct: 2, total: 2, extra: 0 });
  });

  it('does not let one actual line satisfy two expectations, and counts the surplus as extra', () => {
    const result = scoreCase(
      [{ sku: 'A', status: 'matched', quantity: 10 }],
      [
        line({ status: 'matched', sku: 'A', quantity: 10 }),
        line({ status: 'matched', sku: 'A', quantity: 10 }),
      ],
    );
    expect(result).toEqual({ correct: 1, total: 1, extra: 1 });
  });

  it('scores an empty actual list as zero correct and no extras', () => {
    expect(scoreCase([{ sku: 'A', status: 'matched', quantity: 1 }], [])).toEqual({
      correct: 0,
      total: 1,
      extra: 0,
    });
  });
});
