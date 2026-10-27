import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FULL_CATALOG_THRESHOLD,
  MAX_CANDIDATES,
  buildIndex,
  parseCatalogCsv,
  searchCandidates,
  toLite,
  type CatalogIndex,
  type CatalogLiteItem,
} from '../src/index.ts';
import { tokenize } from '../src/retrieve/tokenize.ts';

const sampleCsv = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../samples/catalogs/${name}`, import.meta.url)), 'utf8');

function loadLite(name: string): CatalogLiteItem[] {
  const parsed = parseCatalogCsv(sampleCsv(name));
  expect(parsed.fileError).toBeNull();
  expect(parsed.rowErrors).toEqual([]);
  return parsed.items.map(toLite);
}

const lite = (sku: string, nameTh: string | null, nameEn: string | null = null): CatalogLiteItem => ({
  sku,
  nameTh,
  nameEn,
  unit: 'ชิ้น',
  aliases: [],
  category: null,
});

describe('tokenize', () => {
  it('splits Thai runs into bigrams and trigrams, Latin into words, numbers as tokens', () => {
    const t = tokenize('ท่อ PVC 4 8.5');
    expect(t).toEqual(expect.arrayContaining(['ท่', '่อ', 'ท่อ', 'pvc', '4', '8.5']));
  });

  it('marks a whole Thai word so it differs from the same letters inside a longer word', () => {
    expect(tokenize('ท่อ')).toContain('#ท่อ');
    expect(tokenize('ฝาครอบท่อ')).not.toContain('#ท่อ');
    expect(tokenize('ฝาครอบท่อ')).toContain('ท่อ');
  });

  it('drops unit words that follow a number (size and angle are scored separately)', () => {
    expect(tokenize('4 หุน')).toEqual(['4']);
    expect(tokenize('2 นิ้ว 25 มม. 90 องศา')).toEqual(['2', '25', '90']);
    expect(tokenize('1/2 in 3/4" 45 deg 63 mm')).toEqual(['1', '2', '3', '4', '45', '63']);
    expect(tokenize('inch')).toEqual(['inch']);
  });

  it('treats Thai digits like ASCII digits and ignores case', () => {
    expect(tokenize('PVC ๔')).toEqual(expect.arrayContaining(['pvc', '4']));
  });

  it('returns unique tokens', () => {
    const t = tokenize('pvc pvc 4 4');
    expect(new Set(t).size).toBe(t.length);
  });

  it('returns nothing for empty or punctuation-only text', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' - / ')).toEqual([]);
  });
});

describe('searchCandidates on plumbing.csv (larger than the threshold, so the top candidates are returned)', () => {
  let items: CatalogLiteItem[];
  let index: CatalogIndex;
  const rank = (c: { sku: string }[], sku: string) => c.findIndex((x) => x.sku === sku);

  beforeAll(() => {
    items = loadLite('plumbing.csv');
    index = buildIndex(items);
  });

  it('sample catalog is a realistic size, well above the full-catalog threshold', () => {
    expect(items.length).toBeGreaterThanOrEqual(100);
    expect(items.length).toBeGreaterThan(FULL_CATALOG_THRESHOLD);
    expect(index.size).toBe(items.length);
  });

  it('the full-catalog threshold equals the candidate cap, so the AI never gets more than 20 rows', () => {
    expect(FULL_CATALOG_THRESHOLD).toBe(MAX_CANDIDATES);
    expect(MAX_CANDIDATES).toBe(20);
  });

  it('Thai alias works: ท่อ พีวีซี + 4 หุน ranks the 1/2 in PVC pipe first', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['4 หุน'] });
    expect(c[0]?.sku).toBe('PVC-PIPE-04');
  });

  it('works across languages: pvc pipe + 1/2" ranks the same sku first', () => {
    const c = searchCandidates(index, { productQuery: 'pvc pipe', specs: ['1/2"'] });
    expect(c[0]?.sku).toBe('PVC-PIPE-04');
  });

  it('1/2 in must not beat 3/4 in: 6 หุน ranks the 3/4 in pipe first', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['6 หุน'] }, items.length);
    expect(c[0]?.sku).toBe('PVC-PIPE-06');
    expect(rank(c, 'PVC-PIPE-04')).toBeGreaterThan(0);
  });

  it('1/2 in is not confused with 1 1/2 in or 2 1/2 in (mixed numbers)', () => {
    for (const spec of ['4 หุน', '1/2 นิ้ว']) {
      const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: [spec] }, items.length);
      expect(c[0]?.sku).toBe('PVC-PIPE-04');
      expect(rank(c, 'PVC-PIPE-12')).toBeGreaterThan(rank(c, 'PVC-PIPE-04'));
      expect(rank(c, 'PVC-PIPE-20')).toBeGreaterThan(rank(c, 'PVC-PIPE-04'));
    }
  });

  it('class number before the size does not corrupt it: "ชั้น 8.5 1/2 นิ้ว" is 1/2 in', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อร้อยสายไฟ', specs: ['ชั้น 8.5 1/2 นิ้ว'] });
    expect(c[0]?.sku).toBe('PVC-CND-04');
  });

  it('1 in is told apart from 1/2 in and 3/4 in', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['8 หุน'] });
    expect(c[0]?.sku).toBe('PVC-PIPE-08');
  });

  it('size written in inches matches the size written in หุน', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ PVC', specs: ['3/4 นิ้ว'] });
    expect(c[0]?.sku).toBe('PVC-PIPE-06');
  });

  it('word order does not matter: 90 องศา ข้องอ ranks the 90 degree elbow first, 45 below it', () => {
    const c = searchCandidates(index, { productQuery: '90 องศา ข้องอ', specs: [] }, items.length);
    expect(c[0]?.sku).toMatch(/^PVC-ELB90-|^PPR-ELB90-|^GI-ELB90-/);
    const best90 = Math.min(...c.map((x, i) => (/ELB90/.test(x.sku) ? i : Infinity)));
    const best45 = Math.min(...c.map((x, i) => (/ELB45/.test(x.sku) ? i : Infinity)));
    expect(best90).toBe(0);
    expect(best45).toBeGreaterThan(best90);
  });

  it('angle and size combine: ข้องอ 45 องศา พีวีซี 6 หุน ranks that exact elbow first', () => {
    const c = searchCandidates(index, { productQuery: 'ข้องอ 45 องศา พีวีซี', specs: ['6 หุน'] });
    expect(c[0]?.sku).toBe('PVC-ELB45-06');
  });

  it('English-only catalog row is findable', () => {
    const c = searchCandidates(index, { productQuery: 'pipe wrench', specs: ['14 inch'] });
    expect(c[0]?.sku).toBe('TOOL-WR-14');
  });

  it('mm sizes are not confused with inch sizes', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ PPR', specs: ['25 มม.'] });
    expect(c[0]?.sku).toBe('PPR-PIPE-25');
  });

  it('returns exactly the top MAX_CANDIDATES (20) by default, unique skus, sorted by score descending', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['4 หุน'] });
    expect(c).toHaveLength(MAX_CANDIDATES);
    expect(new Set(c.map((x) => x.sku)).size).toBe(MAX_CANDIDATES);
    for (let i = 1; i < c.length; i++) {
      expect(c[i - 1]!.score).toBeGreaterThanOrEqual(c[i]!.score);
    }
  });

  it('the default top 20 agrees with a full ranking (explicit large k) on the best match', () => {
    // The re-rank pool is 3 x k, so the tail can differ between k = 20 and k = 144; the head must not.
    const q = { productQuery: 'ท่อ พีวีซี', specs: ['4 หุน'] };
    const top = searchCandidates(index, q).map((x) => x.sku);
    const all = searchCandidates(index, q, items.length).map((x) => x.sku);
    expect(all.length).toBeGreaterThan(MAX_CANDIDATES);
    expect(top[0]).toBe(all[0]);
    expect(all.slice(0, 5)).toEqual(top.slice(0, 5));
  });

  it('a query matching nothing returns no candidates (the catalog is no longer sent whole)', () => {
    expect(searchCandidates(index, { productQuery: 'zzzqqq', specs: [] })).toEqual([]);
  });

  it('k below the default still truncates the result', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ', specs: [] }, 5);
    expect(c).toHaveLength(5);
  });
});

describe('searchCandidates on office.csv', () => {
  it('finds an English product by English query and by Thai name', () => {
    const index = buildIndex(loadLite('office.csv'));
    expect(searchCandidates(index, { productQuery: 'A4 copy paper', specs: ['80gsm'] })[0]?.sku).toBe(
      'PAP-A4-80',
    );
    expect(searchCandidates(index, { productQuery: 'stapler', specs: ['heavy duty'] })[0]?.sku).toBe(
      'DSK-STP-H',
    );
    expect(searchCandidates(index, { productQuery: 'กรรไกร', specs: [] })[0]?.sku).toBe('DSK-SCS-8');
  });
});

describe('size and angle re-ranking', () => {
  const small = [
    lite('A-HALF', 'ท่อ 4 หุน'),
    lite('A-THREEQ', 'ท่อ 6 หุน'),
    lite('A-NOSIZE', 'ท่อ ตรง'),
    lite('E-90', 'ข้องอ 90 องศา'),
    lite('E-45', 'ข้องอ 45 องศา'),
    lite('E-NONE', 'ข้องอ'),
  ];
  const index = buildIndex(small);

  it('a size match outranks a size conflict, and an item with no size sits between them', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ', specs: ['4 หุน'] }).map((x) => x.sku);
    expect(c.indexOf('A-HALF')).toBeLessThan(c.indexOf('A-NOSIZE'));
    expect(c.indexOf('A-NOSIZE')).toBeLessThan(c.indexOf('A-THREEQ'));
  });

  it('an angle conflict ranks below an item with no angle', () => {
    const c = searchCandidates(index, { productQuery: 'ข้องอ 90 องศา', specs: [] }).map((x) => x.sku);
    expect(c[0]).toBe('E-90');
    expect(c.indexOf('E-NONE')).toBeLessThan(c.indexOf('E-45'));
  });

  it('angle alone decides: a conflicting angle ranks below an item with no angle even when it is shorter', () => {
    // Neither candidate contains the token "90", so token overlap is neutral between them;
    // E-45 is the shorter name, so without the angle penalty it would win.
    const idx = buildIndex([
      lite('E-45', 'ข้องอ 45 องศา'),
      lite('E-LONG', 'ข้องอ ชนิดหนาพิเศษ สีเทา'),
      lite('E-90', 'ข้องอ 90 องศา'),
    ]);
    const c = searchCandidates(idx, { productQuery: 'ข้องอ ตั้งฉาก', specs: ['90 องศา'] }).map(
      (x) => x.sku,
    );
    expect(c).toEqual(['E-90', 'E-LONG', 'E-45']);
  });

  it('size can come from the product query itself', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ 6 หุน', specs: [] });
    expect(c[0]?.sku).toBe('A-THREEQ');
  });
});

describe('degenerate input', () => {
  it('empty catalog yields no candidates', () => {
    const index = buildIndex([]);
    expect(index.size).toBe(0);
    expect(searchCandidates(index, { productQuery: 'ท่อ', specs: [] })).toEqual([]);
  });

  it('empty query still returns the catalog (<= threshold) with zero scores', () => {
    const index = buildIndex([lite('X', 'ท่อ'), lite('Y', 'ข้อต่อ')]);
    const c = searchCandidates(index, { productQuery: '', specs: [] });
    expect(c.map((x) => x.sku)).toEqual(['X', 'Y']);
  });

  it('a catalog of exactly 20 rows is returned whole, in catalog order when nothing matches', () => {
    const rows = Array.from({ length: FULL_CATALOG_THRESHOLD }, (_, i) => lite(`R${i}`, `สินค้า ${i}`));
    const c = searchCandidates(buildIndex(rows), { productQuery: 'zzzqqq', specs: [] });
    expect(c.map((x) => x.sku)).toEqual(rows.map((r) => r.sku));
    expect(c.every((x) => x.score === 0)).toBe(true);
  });

  it('a catalog of 21 rows is no longer sent whole: nothing matching means nothing returned', () => {
    const rows = Array.from({ length: FULL_CATALOG_THRESHOLD + 1 }, (_, i) => lite(`R${i}`, `สินค้า ${i}`));
    expect(searchCandidates(buildIndex(rows), { productQuery: 'zzzqqq', specs: [] })).toEqual([]);
  });

  it('on a small catalog k does not truncate the full result', () => {
    const rows = Array.from({ length: 10 }, (_, i) => lite(`R${i}`, `ท่อ ${i}`));
    expect(searchCandidates(buildIndex(rows), { productQuery: 'ท่อ', specs: [] }, 3)).toHaveLength(10);
  });
});

describe('searchCandidates on large-10k.csv', () => {
  let index: CatalogIndex;
  let items: CatalogLiteItem[];

  beforeAll(() => {
    items = loadLite('large-10k.csv');
    index = buildIndex(items);
  });

  it('has exactly 10,000 rows, above the full-catalog threshold', () => {
    expect(items).toHaveLength(10_000);
    expect(index.size).toBe(10_000);
  });

  it('returns at most k candidates (default MAX_CANDIDATES), best first', () => {
    const c = searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['4 หุน'] });
    expect(c).toHaveLength(MAX_CANDIDATES);
    for (let i = 1; i < c.length; i++) expect(c[i - 1]!.score).toBeGreaterThanOrEqual(c[i]!.score);
    expect(searchCandidates(index, { productQuery: 'ท่อ พีวีซี', specs: ['4 หุน'] }, 7)).toHaveLength(7);
  });

  it('a query with no matching tokens returns no candidates', () => {
    expect(searchCandidates(index, { productQuery: 'zzzqqq', specs: [] })).toEqual([]);
  });

  it('top candidates for a sized query carry that size', () => {
    const byId = new Map(items.map((i) => [i.sku, i]));
    const c = searchCandidates(index, { productQuery: 'ball valve brass', specs: ['1 in'] });
    const top = c.slice(0, 3).map((x) => byId.get(x.sku)!);
    expect(top).toHaveLength(3);
    for (const t of top) {
      expect(`${t.nameTh ?? ''} ${t.nameEn ?? ''}`).toMatch(/1 in|8 หุน/);
    }
  });

  it('averages <= 50 ms per query over 100 varied queries', () => {
    const products = [
      'ท่อ พีวีซี',
      'pvc pipe',
      'ข้องอ 90 องศา',
      'brass ball valve',
      'บอลวาล์ว ทองเหลือง',
      'ข้อต่อตรง',
      'copy paper',
      'ปากกา สีน้ำเงิน',
      'stainless elbow 45 deg',
      'แคลมป์รัดท่อ',
    ];
    const specs = [
      ['4 หุน'],
      ['1/2"'],
      ['2 นิ้ว'],
      ['63 mm'],
      ['25 มม.'],
      ['1 1/4 นิ้ว'],
      ['แพ็ค 12'],
      [],
      ['สีดำ', '6 หุน'],
      ['heavy duty'],
    ];
    const queries = products.flatMap((productQuery) => specs.map((s) => ({ productQuery, specs: s })));
    expect(queries).toHaveLength(100);

    searchCandidates(index, queries[0]!); // warm-up
    const start = performance.now();
    for (const q of queries) searchCandidates(index, q);
    const avg = (performance.now() - start) / queries.length;
    console.log(`retrieval avg: ${avg.toFixed(2)} ms/query over ${queries.length} queries`);
    expect(avg).toBeLessThanOrEqual(50);
  });
});
