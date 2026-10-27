import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuoteError, type MatchResponse, type ValidatedLine } from '@tqc/core';
import {
  caseFingerprint,
  createCumulativePersister,
  cumulativeFileName,
  cumulativeResults,
  emptyCumulative,
  goodCaseIds,
  mergeCumulative as mergeWith,
  parseCumulative,
  writeFileAtomic,
  type CumulativeFile,
} from './cumulative.ts';
import { runCases, type RunMatchFn } from './runner.ts';
import type { CaseResult, EvalCase } from './score.ts';

const def = (id: string, over: Partial<EvalCase> = {}): EvalCase => ({
  id,
  category: 'thai',
  catalog: 'plumbing',
  inquiry: `inquiry ${id}`,
  expected: [{ sku: 'S1', status: 'matched', quantity: 1 }],
  ...over,
});
const defs: EvalCase[] = [def('a'), def('b', { category: 'english' }), def('c'), def('x')];
const mergeCumulative = (file: CumulativeFile, results: readonly CaseResult[], date: Date) =>
  mergeWith(file, results, date, defs);

const line = (sku: string): ValidatedLine => ({
  lineId: 'L1',
  rawText: 'x',
  quantity: 1,
  unit: null,
  status: 'matched',
  sku,
  alternativeSkus: [],
  confidence: 'high',
  reason: '',
  unitMismatch: false,
  unitNote: null,
});

function good(id: string, over: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    category: 'thai',
    errorCode: null,
    errorMessage: null,
    score: { correct: 1, total: 1, extra: 0 },
    fullyCorrect: true,
    ms: 1500,
    usage: { inputTokens: 100, outputTokens: 20 },
    actual: [line('S1')],
    ...over,
  };
}

function errored(id: string, code = 'AI_BUSY'): CaseResult {
  return {
    id,
    category: 'thai',
    errorCode: code,
    errorMessage: null,
    score: { correct: 0, total: 1, extra: 0 },
    fullyCorrect: false,
    ms: 900,
    usage: { inputTokens: 0, outputTokens: 0 },
    actual: [],
  };
}

const day1 = new Date('2026-10-27T10:00:00.000Z');
const day2 = new Date('2026-10-28T10:00:00.000Z');

describe('cumulativeFileName', () => {
  it('uses a filesystem-safe model name and no date', () => {
    expect(cumulativeFileName('gemini-3.6-flash')).toBe('gemini-3.6-flash-cumulative.json');
    expect(cumulativeFileName('models/x y:z')).toBe('models-x-y-z-cumulative.json');
  });
});

describe('mergeCumulative', () => {
  it('stores each non-errored result with id, category, lines, score, ms, tokens and run date', () => {
    const merged = mergeCumulative(emptyCumulative('google', 'm'), [good('a')], day1);
    expect(merged.cases.a).toEqual({
      id: 'a',
      category: 'thai',
      fingerprint: caseFingerprint(defs[0]!),
      actual: [line('S1')],
      score: { correct: 1, total: 1, extra: 0 },
      fullyCorrect: true,
      ms: 1500,
      usage: { inputTokens: 100, outputTokens: 20 },
      date: day1.toISOString(),
    });
    expect(merged.updated).toBe(day1.toISOString());
  });

  it('an errored result never overwrites a good one', () => {
    const first = mergeCumulative(emptyCumulative('google', 'm'), [good('a')], day1);
    const second = mergeCumulative(first, [errored('a')], day2);
    expect(second.cases.a?.date).toBe(day1.toISOString());
    expect(second.cases.a?.score.correct).toBe(1);
  });

  it('an errored result for a case with no good result is not stored', () => {
    const merged = mergeCumulative(emptyCumulative('google', 'm'), [errored('a', 'AI_QUOTA_EXCEEDED')], day1);
    expect(merged.cases).toEqual({});
  });

  it('a newer non-errored result replaces an older one, even when it is worse', () => {
    const first = mergeCumulative(emptyCumulative('google', 'm'), [good('a')], day1);
    const worse = good('a', { score: { correct: 0, total: 1, extra: 0 }, fullyCorrect: false, actual: [line('BAD')] });
    const second = mergeCumulative(first, [worse], day2);
    expect(second.cases.a?.score.correct).toBe(0);
    expect(second.cases.a?.date).toBe(day2.toISOString());
  });

  it('does not mutate its input', () => {
    const first = mergeCumulative(emptyCumulative('google', 'm'), [good('a')], day1);
    const snapshot = JSON.stringify(first);
    mergeCumulative(first, [good('b')], day2);
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it('a result with a non-QuoteError message counts as errored', () => {
    const other: CaseResult = { ...errored('a'), errorCode: null, errorMessage: '401 invalid key' };
    const merged = mergeCumulative(emptyCumulative('google', 'm'), [other], day1);
    expect(merged.cases).toEqual({});
  });
});

describe('goodCaseIds and cumulativeResults', () => {
  const file = mergeCumulative(emptyCumulative('google', 'm'), [good('a'), good('b', { category: 'english' })], day1);

  it('lists the ids that have a good result', () => {
    expect([...goodCaseIds(file, defs)].sort()).toEqual(['a', 'b']);
  });

  it('turns stored cases back into results in the order of the case list, ignoring unknown ids', () => {
    const results = cumulativeResults(file, [defs[1]!, def('zzz'), defs[2]!, defs[0]!]);
    expect(results.map((r) => r.id)).toEqual(['b', 'a']);
    expect(results[0]).toMatchObject({ errorCode: null, errorMessage: null, fullyCorrect: true });
  });
});

describe('parseCumulative', () => {
  it('round-trips a file', () => {
    const file = mergeCumulative(emptyCumulative('google', 'm'), [good('a')], day1);
    expect(parseCumulative(JSON.stringify(file))).toEqual(file);
  });

  it('rejects something that is not a cumulative file with a Thai message', () => {
    expect(() => parseCumulative('{"cases": []}')).toThrow(/cumulative/);
    expect(() => parseCumulative('not json')).toThrow(/cumulative/);
  });
});

describe('stale results (a case edited after its result was stored)', () => {
  const file = mergeCumulative(emptyCumulative('google', 'm'), [good('a'), good('b', { category: 'english' })], day1);

  it('fingerprints inquiry, catalog and expected, and nothing else', () => {
    const base = def('a');
    expect(caseFingerprint(base)).toBe(caseFingerprint(def('a')));
    expect(caseFingerprint(base)).toBe(caseFingerprint({ ...base, id: 'renamed', category: 'typo' }));
    expect(caseFingerprint(base)).not.toBe(caseFingerprint({ ...base, inquiry: 'changed' }));
    expect(caseFingerprint(base)).not.toBe(caseFingerprint({ ...base, catalog: 'office' }));
    expect(caseFingerprint(base)).not.toBe(
      caseFingerprint({ ...base, expected: [{ sku: 'S2', status: 'matched', quantity: 1 }] }),
    );
    expect(caseFingerprint(base)).not.toBe(
      caseFingerprint({ ...base, expected: [{ sku: 'S1', status: 'matched', quantity: 2 }] }),
    );
  });

  it('stores the fingerprint of the case that was run', () => {
    expect(file.cases.a?.fingerprint).toBe(caseFingerprint(defs[0]!));
  });

  it.each([
    ['inquiry', { inquiry: 'edited' }],
    ['catalog', { catalog: 'office' as const }],
    ['expected', { expected: [{ sku: 'OTHER', status: 'matched' as const, quantity: 1 }] }],
  ])('an edited %s is no longer a good result: not skipped by --resume, not counted', (_name, edit) => {
    const edited = [def('a', edit), defs[1]!];
    expect([...goodCaseIds(file, edited)]).toEqual(['b']);
    expect(cumulativeResults(file, edited).map((r) => r.id)).toEqual(['b']);
  });

  it('a result stored by an older version without a fingerprint counts as stale', () => {
    const legacy = JSON.parse(JSON.stringify(file)) as CumulativeFile;
    delete (legacy.cases.a as { fingerprint?: string }).fingerprint;
    expect([...goodCaseIds(legacy, defs)]).toEqual(['b']);
  });

  it('re-running the edited case replaces the stale entry', () => {
    const edited = [def('a', { inquiry: 'edited' }), defs[1]!];
    const merged = mergeWith(file, [good('a')], day2, edited);
    expect([...goodCaseIds(merged, edited)].sort()).toEqual(['a', 'b']);
    expect(merged.cases.a?.fingerprint).toBe(caseFingerprint(edited[0]!));
  });
});

describe('writeFileAtomic', () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'tqc-atomic-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('writes the file and leaves no temp file behind', () => {
    const dir = tmp();
    const target = join(dir, 'x-cumulative.json');
    writeFileAtomic(target, '{"a":1}');
    writeFileAtomic(target, '{"a":2}');
    expect(readFileSync(target, 'utf8')).toBe('{"a":2}');
    expect(readdirSync(dir)).toEqual(['x-cumulative.json']);
  });

  it('writes to a temp file in the same directory first, then renames it over the target', () => {
    const dir = tmp();
    const target = join(dir, 'f.json');
    const calls: string[] = [];
    writeFileAtomic(target, 'data', {
      writeFileSync: (path, text) => {
        calls.push(path === target ? 'write TARGET' : 'write temp');
        expect(dirname(path)).toBe(dirname(target));
        writeFileSync(path, text);
      },
      renameSync: (from, to) => {
        calls.push(`rename ${from === target ? 'TARGET' : 'temp'} -> ${to === target ? 'TARGET' : 'other'}`);
        renameSync(from, to);
      },
    });
    expect(calls).toEqual(['write temp', 'rename temp -> TARGET']);
    expect(readFileSync(target, 'utf8')).toBe('data');
  });

  it('a crash while writing leaves the previous file intact (no partial JSON) and no stray temp file', () => {
    const dir = tmp();
    const target = join(dir, 'f.json');
    writeFileAtomic(target, '{"complete":true}');
    expect(() =>
      writeFileAtomic(target, '{"complete":tr', {
        writeFileSync: (path, text) => {
          writeFileSync(path, text); // a half-written temp file...
          throw new Error('disk full'); // ...then the process dies
        },
        renameSync: () => {
          throw new Error('must not rename a failed write');
        },
      }),
    ).toThrow('disk full');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ complete: true });
    expect(readdirSync(dir)).toEqual(['f.json']);
  });

  it('a failed rename also leaves the previous file intact and cleans up the temp file', () => {
    const dir = tmp();
    const target = join(dir, 'f.json');
    writeFileAtomic(target, '{"complete":true}');
    expect(() =>
      writeFileAtomic(target, '{"next":1}', {
        renameSync: () => {
          throw new Error('locked');
        },
      }),
    ).toThrow('locked');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ complete: true });
    expect(readdirSync(dir)).toEqual(['f.json']);
  });
});

describe('createCumulativePersister (the file is saved after every case)', () => {
  const dirs: string[] = [];
  const tmpDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'tqc-persist-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const response = (): MatchResponse => ({
    extracted: { items: [], customer: { name: null, company: null, contact: null }, missingInfo: [], language: 'th' },
    lines: [line('S1')],
    usage: { inputTokens: 10, outputTokens: 2 },
  });
  const catalogs = { plumbing: [], office: [] };
  const four = [def('a'), def('b'), def('c'), def('d')];

  it('after N cases a crash in case N+1 still leaves the first N on disk', async () => {
    const dir = tmpDir();
    const path = join(dir, 'm-cumulative.json');
    const persister = createCumulativePersister({
      path,
      file: emptyCumulative('google', 'm'),
      cases: four,
      now: () => day1,
    });
    const run: RunMatchFn = async () => response();
    await expect(
      runCases({
        cases: four,
        catalogs,
        run,
        pauseMs: 0,
        sleep: async () => {},
        onCase: (r, i) => {
          if (i === 2) throw new Error('process died during case 3');
          persister.onCase(r);
        },
      }),
    ).rejects.toThrow('process died');
    const onDisk = parseCumulative(readFileSync(path, 'utf8'));
    expect(Object.keys(onDisk.cases).sort()).toEqual(['a', 'b']);
    expect(readdirSync(dir)).toEqual(['m-cumulative.json']);
  });

  it('keeps earlier good results when a later case errors, and never stores an errored one', async () => {
    const dir = tmpDir();
    const path = join(dir, 'm-cumulative.json');
    const persister = createCumulativePersister({
      path,
      file: emptyCumulative('google', 'm'),
      cases: four,
      now: () => day1,
    });
    const run: RunMatchFn = async ({ inquiry }) => {
      if (inquiry === 'inquiry b') throw new QuoteError('AI_BUSY');
      if (inquiry === 'inquiry c') throw new QuoteError('AI_QUOTA_EXCEEDED');
      return response();
    };
    const results = await runCases({
      cases: four,
      catalogs,
      run,
      pauseMs: 0,
      sleep: async () => {},
      onCase: (r) => persister.onCase(r),
    });
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(Object.keys(parseCumulative(readFileSync(path, 'utf8')).cases)).toEqual(['a']);
    expect(Object.keys(persister.current().cases)).toEqual(['a']);
  });

  it('does not touch the disk for an errored result', () => {
    const path = join(tmpDir(), 'm-cumulative.json');
    const persister = createCumulativePersister({ path, file: emptyCumulative('google', 'm'), cases: four });
    persister.onCase(errored('a'));
    expect(existsSync(path)).toBe(false);
  });
});
