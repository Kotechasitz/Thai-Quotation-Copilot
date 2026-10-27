import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, parseCatalogCsv } from '@tqc/core';
import { loadCases, parseCases } from './cases.ts';

const casesUrl = new URL('./cases.json', import.meta.url);

function catalogSkus(name: 'plumbing' | 'office'): Set<string> {
  const bytes = new Uint8Array(readFileSync(new URL(`../../samples/catalogs/${name}.csv`, import.meta.url)));
  const { items, fileError } = parseCatalogCsv(decodeCsvBytes(bytes).text);
  expect(fileError).toBeNull();
  return new Set(items.map((i) => i.sku));
}

describe('eval cases.json', () => {
  const cases = loadCases(casesUrl);

  it('has 25 cases with the planned category mix', () => {
    expect(cases).toHaveLength(25);
    const counts: Record<string, number> = {};
    for (const c of cases) counts[c.category] = (counts[c.category] ?? 0) + 1;
    expect(counts).toEqual({
      thai: 5,
      english: 3,
      mixed: 4,
      typo: 3,
      ambiguous: 3,
      'missing-qty': 3,
      unit: 3,
      injection: 1,
    });
  });

  it('has unique ids', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('only expects skus that exist in the named catalog', () => {
    const skus = { plumbing: catalogSkus('plumbing'), office: catalogSkus('office') };
    for (const c of cases) {
      for (const line of c.expected) {
        if (line.sku !== null) {
          expect(skus[c.catalog].has(line.sku), `${c.id}: ${line.sku} not in ${c.catalog}`).toBe(true);
        }
      }
    }
  });

  it('keeps expected quantities null for missing-qty lines and never expects FREE-999', () => {
    for (const c of cases) {
      expect(c.expected.some((l) => l.sku === 'FREE-999')).toBe(false);
    }
    const missing = cases.filter((c) => c.category === 'missing-qty');
    for (const c of missing) {
      expect(c.expected.some((l) => l.quantity === null), `${c.id} has no null quantity`).toBe(true);
    }
  });

  it('marks every ambiguous case with an ambiguous line that has no sku', () => {
    for (const c of cases.filter((x) => x.category === 'ambiguous')) {
      expect(c.expected.some((l) => l.status === 'ambiguous' && l.sku === null)).toBe(true);
    }
  });
});

describe('parseCases', () => {
  it('fails fast and names the case id when a case is malformed', () => {
    const bad = JSON.stringify([
      { id: 'ok-1', category: 'thai', catalog: 'plumbing', inquiry: 'x', expected: [{ sku: 'A', status: 'matched', quantity: 1 }] },
      { id: 'broken-2', category: 'nope', catalog: 'plumbing', inquiry: 'x', expected: [] },
    ]);
    expect(() => parseCases(bad)).toThrow(/broken-2/);
  });

  it('rejects a matched line without a sku and a non-matched line with one', () => {
    const base = { id: 'c', category: 'thai', catalog: 'plumbing', inquiry: 'x' };
    expect(() => parseCases(JSON.stringify([{ ...base, expected: [{ sku: null, status: 'matched', quantity: 1 }] }]))).toThrow(/c/);
    expect(() => parseCases(JSON.stringify([{ ...base, expected: [{ sku: 'A', status: 'ambiguous', quantity: 1 }] }]))).toThrow(/c/);
  });
});
