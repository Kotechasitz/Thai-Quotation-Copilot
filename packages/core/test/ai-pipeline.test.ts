import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  AI_CONCURRENCY,
  AI_TIMEOUT_MS,
  MATCH_BATCH_SIZE,
  MATCH_INSTRUCTIONS,
  MAX_INQUIRY_CHARS,
  MAX_ITEMS,
  QUOTE_ERROR_MESSAGES,
  QuoteError,
  parseCatalogCsv,
  runMatch,
  toLite,
  type CatalogLiteItem,
  type ExtractedItem,
  type ExtractedRequest,
  type QuoteErrorCode,
  type RawMatch,
} from '../src/index.ts';
import { mapLimit } from '../src/util/mapLimit.ts';

const plumbingCsv = readFileSync(
  fileURLToPath(new URL('../../../samples/catalogs/plumbing.csv', import.meta.url)),
  'utf8',
);
const catalog: CatalogLiteItem[] = parseCatalogCsv(plumbingCsv).items.map(toLite);

const SKU_A = 'PVC-PIPE-04';
const SKU_B = 'PVC-PIPE-06';

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0];

function item(n: number, over: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    lineId: `X${n}`, // deliberately wrong ids: the pipeline must overwrite them
    rawText: `ท่อ PVC ${n}`,
    productQuery: 'ท่อ PVC',
    quantity: n,
    unit: 'เส้น',
    specs: [],
    notes: null,
    ...over,
  };
}

function extraction(items: ExtractedItem[], over: Partial<ExtractedRequest> = {}): ExtractedRequest {
  return {
    items,
    customer: { name: null, company: null, contact: null },
    missingInfo: [],
    language: 'th',
    ...over,
  };
}

function reply(obj: unknown, inTok = 10, outTok = 5) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: inTok, noCache: inTok, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: outTok, text: outTok, reasoning: undefined },
    },
    warnings: [],
  };
}

function rawReply(text: string) {
  return { ...reply({}), content: [{ type: 'text' as const, text }] };
}

const isMatchCall = (o: CallOptions): boolean =>
  o.prompt.some((m) => m.role === 'system' && m.content === MATCH_INSTRUCTIONS);

/** Reads the "Line Lx" headers out of a match prompt. */
function lineIdsOf(o: CallOptions): string[] {
  const text = JSON.stringify(o.prompt);
  return [...text.matchAll(/Line (L\d+)/g)].map((m) => m[1] as string);
}

function matchedAll(o: CallOptions, sku = SKU_A) {
  const results: RawMatch[] = lineIdsOf(o).map((lineId) => ({
    lineId,
    status: 'matched',
    sku,
    alternativeSkus: [],
    confidence: 'high',
    reason: 'ตรงกัน',
  }));
  return { results };
}

/** Standard model: extraction call returns `extracted`, match calls answer via `onMatch`. */
function makeModel(
  extracted: ExtractedRequest,
  onMatch: (o: CallOptions, n: number) => unknown | Promise<unknown> = (o) => matchedAll(o),
) {
  let matchCalls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (o: CallOptions) => {
      if (!isMatchCall(o)) return reply(extracted, 100, 50);
      matchCalls += 1;
      return reply(await onMatch(o, matchCalls), 20, 10);
    },
  });
  return model;
}

async function codeOf(p: Promise<unknown>): Promise<QuoteErrorCode> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(QuoteError);
    return (e as QuoteError).code;
  }
  throw new Error('expected runMatch to reject');
}

describe('runMatch happy path', () => {
  it('extracts, matches and sums usage across both calls', async () => {
    const model = makeModel(extraction([item(1, { rawText: 'ท่อ 4 หุน 10 เส้น' }), item(2)]), (o) => ({
      results: lineIdsOf(o).map((lineId, i) => ({
        lineId,
        status: 'matched',
        sku: i === 0 ? SKU_A : SKU_B,
        alternativeSkus: [],
        confidence: 'high',
        reason: 'ตรงกัน',
      })),
    }));
    const res = await runMatch({ model, inquiry: 'ขอใบเสนอราคา ท่อ PVC', catalog });
    expect(res.lines).toHaveLength(2);
    expect(res.lines.map((l) => l.sku)).toEqual([SKU_A, SKU_B]);
    expect(res.lines.map((l) => l.status)).toEqual(['matched', 'matched']);
    expect(res.lines.map((l) => l.lineId)).toEqual(['L1', 'L2']);
    expect(res.extracted.items.map((i) => i.lineId)).toEqual(['L1', 'L2']);
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 60 });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('never puts a price in the prompt of either call', async () => {
    const model = makeModel(extraction([item(1)]));
    await runMatch({ model, inquiry: 'ท่อ PVC 4 หุน', catalog });
    const second = JSON.stringify(model.doGenerateCalls[1]?.prompt);
    expect(second).toContain(SKU_A);
    expect(second).not.toMatch(/46\.00|unit_?price|ราคา|บาท|satang/i);
  });

  it('forwards providerOptions to every call', async () => {
    const model = makeModel(extraction([item(1)]));
    await runMatch({ model, inquiry: 'ท่อ', catalog, providerOptions: { google: { foo: 'bar' } } });
    for (const call of model.doGenerateCalls) {
      expect(call.providerOptions).toEqual({ google: { foo: 'bar' } });
    }
  });

  it('keeps the same product on two lines as two separate lines (review focus 2)', async () => {
    const same = extraction([
      item(1, { rawText: 'ท่อ 4 หุน 10 เส้น', quantity: 10 }),
      item(2, { rawText: 'ท่อ 4 หุนอีก 5 เส้น', quantity: 5 }),
    ]);
    const res = await runMatch({
      model: makeModel(same),
      inquiry: 'ท่อ 4 หุน 10 เส้น แล้วก็ท่อ 4 หุนอีก 5 เส้น',
      catalog,
    });
    expect(res.lines).toHaveLength(2);
    expect(res.lines.map((l) => l.sku)).toEqual([SKU_A, SKU_A]);
    expect(res.lines[0]?.lineId).not.toBe(res.lines[1]?.lineId);
    expect(res.lines.map((l) => l.quantity)).toEqual([10, 5]);
  });

  it('overwrites model lineIds with L1..Ln and remaps missingInfo', async () => {
    const extracted = extraction(
      [item(1, { lineId: 'a' }), item(2, { lineId: 'a' }), item(3, { lineId: 'zz' })],
      {
        missingInfo: [
          { lineId: 'zz', question: 'ขนาดเท่าไหร่' },
          { lineId: null, question: 'ส่งที่ไหน' },
          { lineId: 'unknown', question: 'อื่น ๆ' },
        ],
      },
    );
    const res = await runMatch({ model: makeModel(extracted), inquiry: 'ท่อ', catalog });
    expect(res.extracted.items.map((i) => i.lineId)).toEqual(['L1', 'L2', 'L3']);
    expect(res.extracted.missingInfo.map((m) => m.lineId)).toEqual(['L3', null, null]);
    expect(res.lines.map((l) => l.lineId)).toEqual(['L1', 'L2', 'L3']);
  });

  it('with an empty catalog skips the match call and returns every line unmatched', async () => {
    const model = makeModel(extraction([item(1), item(2)]));
    const res = await runMatch({ model, inquiry: 'ท่อ', catalog: [] });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(res.lines.map((l) => l.status)).toEqual(['unmatched', 'unmatched']);
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('downgrades a hallucinated sku to unmatched', async () => {
    const model = makeModel(extraction([item(1)]), (o) => matchedAll(o, 'NOT-IN-CATALOG'));
    const res = await runMatch({ model, inquiry: 'ท่อ', catalog });
    expect(res.lines[0]?.status).toBe('unmatched');
    expect(res.lines[0]?.sku).toBeNull();
  });
});

describe('runMatch batching and concurrency', () => {
  it('splits 23 items into 10/10/3 with at most 2 in flight', async () => {
    const sizes: number[] = [];
    let inFlight = 0;
    let peak = 0;
    const model = makeModel(extraction(Array.from({ length: 23 }, (_, i) => item(i + 1))), async (o) => {
      sizes.push(lineIdsOf(o).length);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return matchedAll(o);
    });
    const res = await runMatch({ model, inquiry: 'ท่อเยอะ', catalog });
    expect(MATCH_BATCH_SIZE).toBe(10);
    expect(AI_CONCURRENCY).toBe(2);
    expect([...sizes].sort((a, b) => b - a)).toEqual([10, 10, 3]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
    expect(res.lines).toHaveLength(23);
    expect(res.lines.map((l) => l.lineId)).toEqual(Array.from({ length: 23 }, (_, i) => `L${i + 1}`));
    expect(res.lines.every((l) => l.status === 'matched')).toBe(true);
  });
});

describe('runMatch input limits', () => {
  it.each(['', '   ', '\n\t '])('rejects blank inquiry %j without calling the model', async (inquiry) => {
    const model = makeModel(extraction([item(1)]));
    expect(await codeOf(runMatch({ model, inquiry, catalog }))).toBe('EMPTY_INPUT');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('rejects an inquiry over 5,000 characters but accepts exactly 5,000', async () => {
    const model = makeModel(extraction([item(1)]));
    expect(MAX_INQUIRY_CHARS).toBe(5000);
    expect(await codeOf(runMatch({ model, inquiry: 'ก'.repeat(5001), catalog }))).toBe('INPUT_TOO_LONG');
    expect(model.doGenerateCalls).toHaveLength(0);
    await expect(runMatch({ model, inquiry: 'ก'.repeat(5000), catalog })).resolves.toBeDefined();
  });

  it('returns NO_ITEMS when extraction finds nothing', async () => {
    const model = makeModel(extraction([]));
    expect(await codeOf(runMatch({ model, inquiry: 'สวัสดีครับ', catalog }))).toBe('NO_ITEMS');
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('returns TOO_MANY_ITEMS for 51 items but accepts 50', async () => {
    expect(MAX_ITEMS).toBe(50);
    const many = makeModel(extraction(Array.from({ length: 51 }, (_, i) => item(i + 1))));
    expect(await codeOf(runMatch({ model: many, inquiry: 'เยอะ', catalog }))).toBe('TOO_MANY_ITEMS');
    expect(many.doGenerateCalls).toHaveLength(1);
    const ok = makeModel(extraction(Array.from({ length: 50 }, (_, i) => item(i + 1))));
    expect((await runMatch({ model: ok, inquiry: 'เยอะ', catalog })).lines).toHaveLength(50);
  });
});

describe('runMatch invalid output', () => {
  it('retries a schema failure once and succeeds', async () => {
    let extractCalls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (o: CallOptions) => {
        if (isMatchCall(o)) return reply(matchedAll(o), 20, 10);
        extractCalls += 1;
        return extractCalls === 1 ? rawReply('this is not json') : reply(extraction([item(1)]), 100, 50);
      },
    });
    const res = await runMatch({ model, inquiry: 'ท่อ', catalog });
    expect(extractCalls).toBe(2);
    expect(res.lines).toHaveLength(1);
    // usage includes the failed first attempt (10 in / 5 out from the bad reply) plus the good calls
    expect(res.usage).toEqual({ inputTokens: 130, outputTokens: 65 });
  });

  it('gives AI_INVALID_OUTPUT when extraction fails the schema twice', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => rawReply('{"items": "nope"}') });
    expect(await codeOf(runMatch({ model, inquiry: 'ท่อ', catalog }))).toBe('AI_INVALID_OUTPUT');
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('retries and then fails the match call the same way', async () => {
    let matchCalls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (o: CallOptions) => {
        if (!isMatchCall(o)) return reply(extraction([item(1)]));
        matchCalls += 1;
        return rawReply('{"results": 5}');
      },
    });
    expect(await codeOf(runMatch({ model, inquiry: 'ท่อ', catalog }))).toBe('AI_INVALID_OUTPUT');
    expect(matchCalls).toBe(2);
  });
});

describe('runMatch API errors and timeouts', () => {
  const apiError = (statusCode: number, retryable: boolean) =>
    new APICallError({
      message: `HTTP ${statusCode}`,
      url: 'https://example.invalid',
      requestBodyValues: {},
      statusCode,
      isRetryable: retryable,
      // keep the SDK's own backoff near-instant in tests
      responseHeaders: { 'retry-after-ms': '1' },
    });

  it('maps a 429 that survives the SDK retries to AI_BUSY', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(429, true);
      },
    });
    expect(await codeOf(runMatch({ model, inquiry: 'ท่อ', catalog }))).toBe('AI_BUSY');
    expect(model.doGenerateCalls).toHaveLength(4); // 1 try + maxRetries 3
  });

  it('maps a non-retryable 429 to AI_BUSY too', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw apiError(429, false);
      },
    });
    expect(await codeOf(runMatch({ model, inquiry: 'ท่อ', catalog }))).toBe('AI_BUSY');
  });

  it('rethrows other API errors untouched', async () => {
    const boom = apiError(500, false);
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw boom;
      },
    });
    await expect(runMatch({ model, inquiry: 'ท่อ', catalog })).rejects.toBe(boom);
  });

  it('gives AI_TIMEOUT when the overall deadline passes', async () => {
    expect(AI_TIMEOUT_MS).toBe(60_000);
    const model = new MockLanguageModelV4({
      doGenerate: (o: CallOptions) =>
        new Promise((_, reject) => {
          o.abortSignal?.addEventListener('abort', () => reject(o.abortSignal?.reason), { once: true });
        }),
    });
    expect(await codeOf(runMatch({ model, inquiry: 'ท่อ', catalog, timeoutMs: 30 }))).toBe('AI_TIMEOUT');
  });

  it('rethrows the abort when the caller cancels (not a timeout)', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (o: CallOptions) =>
        new Promise((_, reject) => {
          o.abortSignal?.addEventListener('abort', () => reject(o.abortSignal?.reason), { once: true });
        }),
    });
    const ctl = new AbortController();
    const p = runMatch({ model, inquiry: 'ท่อ', catalog, signal: ctl.signal });
    setTimeout(() => ctl.abort(), 20);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(err).not.toBeInstanceOf(QuoteError);
    expect((err as Error).name).toMatch(/Abort/);
  });
});

describe('QUOTE_ERROR_MESSAGES', () => {
  it('has Thai text for every code and QuoteError uses it', () => {
    const codes: QuoteErrorCode[] = [
      'INPUT_TOO_LONG',
      'EMPTY_INPUT',
      'NO_ITEMS',
      'TOO_MANY_ITEMS',
      'AI_INVALID_OUTPUT',
      'AI_BUSY',
      'AI_TIMEOUT',
    ];
    for (const code of codes) {
      expect(QUOTE_ERROR_MESSAGES[code]).toMatch(/[฀-๿]/);
      const e = new QuoteError(code);
      expect(e.code).toBe(code);
      expect(e.message).toBe(QUOTE_ERROR_MESSAGES[code]);
    }
    expect(QUOTE_ERROR_MESSAGES.AI_BUSY).toBe('ระบบไม่ว่าง ลองใหม่อีกสักครู่');
  });
});

describe('mapLimit', () => {
  it('preserves order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n * 5));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it('handles empty input and stops starting new work after a failure', async () => {
    expect(await mapLimit([], 2, async (n: number) => n)).toEqual([]);
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});
