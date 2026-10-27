import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUOTE_ERROR_MESSAGES, QuoteError, type MatchResponse, type QuoteErrorCode } from '@tqc/core';

const { runMatchMock, getModelConfigMock } = vi.hoisted(() => ({
  runMatchMock: vi.fn(),
  getModelConfigMock: vi.fn(),
}));

vi.mock('@tqc/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tqc/core')>()),
  runMatch: runMatchMock,
}));
vi.mock('@tqc/providers', () => ({ getModelConfig: getModelConfigMock }));

import { POST } from '../app/api/match/route';

const SECRET_INQUIRY = 'ท่อพีวีซี 4 หุน 10 เส้น ลับเฉพาะลูกค้า-XYZ-7781';
const FAKE_MODEL = { fake: 'model' };

const catalog = [
  { sku: 'P-1', nameTh: 'ท่อ PVC 4 หุน', nameEn: null, unit: 'เส้น', aliases: ['ท่อ'], category: 'ท่อ' },
];

const okResponse: MatchResponse = {
  extracted: { items: [] } as unknown as MatchResponse['extracted'],
  lines: [],
  usage: { inputTokens: 120, outputTokens: 45 },
};

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface ErrorBody {
  ok: false;
  error: { code: string; message: string };
}

describe('POST /api/match', () => {
  beforeEach(() => {
    runMatchMock.mockReset();
    getModelConfigMock.mockReset();
    getModelConfigMock.mockReturnValue({ model: FAKE_MODEL, providerOptions: { google: { x: 1 } } });
    runMatchMock.mockResolvedValue(okResponse);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request validation', () => {
    it('returns 400 BAD_REQUEST when the body is not JSON', async () => {
      const res = await POST(jsonRequest('{not json'));
      const body = (await res.json()) as ErrorBody;
      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toMatch(/[฀-๿]/);
      expect(runMatchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when the catalog is empty', async () => {
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog: [] }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe('BAD_REQUEST');
      expect(runMatchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when the inquiry is missing or not a string', async () => {
      expect((await POST(jsonRequest({ catalog }))).status).toBe(400);
      expect((await POST(jsonRequest({ inquiry: 42, catalog }))).status).toBe(400);
    });

    it('returns 400 when a catalog item is malformed', async () => {
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog: [{ sku: 'P-1' }] }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when the catalog exceeds 10,000 items', async () => {
      const big = Array.from({ length: 10_001 }, (_, i) => ({ ...catalog[0], sku: `S-${i}` }));
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog: big }));
      expect(res.status).toBe(400);
    });

    it('accepts exactly 10,000 catalog items', async () => {
      const big = Array.from({ length: 10_000 }, (_, i) => ({ ...catalog[0], sku: `S-${i}` }));
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog: big }));
      expect(res.status).toBe(200);
    });

    it('returns 400 for an inquiry over 5,000 characters', async () => {
      const res = await POST(jsonRequest({ inquiry: 'ก'.repeat(5001), catalog }));
      const body = (await res.json()) as ErrorBody;
      expect(res.status).toBe(400);
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('lets an empty inquiry through the schema so runMatch answers EMPTY_INPUT (400)', async () => {
      runMatchMock.mockRejectedValue(new QuoteError('EMPTY_INPUT'));
      const res = await POST(jsonRequest({ inquiry: '', catalog }));
      const body = (await res.json()) as ErrorBody;
      expect(runMatchMock).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(400);
      expect(body.error.code).toBe('EMPTY_INPUT');
    });

    it('never forwards prices: unknown fields such as unitPriceSatang are stripped before runMatch', async () => {
      const priced = [{ ...catalog[0], unitPriceSatang: 12345, description: 'secret' }];
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog: priced, extra: 'x' }));
      expect(res.status).toBe(200);
      const args = runMatchMock.mock.calls[0]![0] as { catalog: Array<Record<string, unknown>> };
      expect(args.catalog).toEqual(catalog);
      expect(JSON.stringify(args)).not.toContain('12345');
      expect(Object.keys(args.catalog[0]!)).not.toContain('unitPriceSatang');
      expect(Object.keys(args)).not.toContain('extra');
    });
  });

  describe('success', () => {
    it('returns 200 { ok: true, data } and passes model, options, inquiry and catalog to runMatch', async () => {
      const res = await POST(jsonRequest({ inquiry: 'ท่อ 4 หุน', catalog }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, data: okResponse });
      const args = runMatchMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(args.model).toBe(FAKE_MODEL);
      expect(args.providerOptions).toEqual({ google: { x: 1 } });
      expect(args.inquiry).toBe('ท่อ 4 หุน');
      expect(args.catalog).toEqual(catalog);
      expect(args.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('error mapping', () => {
    const table: Array<[QuoteErrorCode, number]> = [
      ['EMPTY_INPUT', 400],
      ['INPUT_TOO_LONG', 400],
      ['NO_ITEMS', 422],
      ['TOO_MANY_ITEMS', 422],
      ['AI_INVALID_OUTPUT', 502],
      ['AI_BUSY', 503],
      ['AI_TIMEOUT', 504],
      ['AI_QUOTA_EXCEEDED', 429],
    ];

    it.each(table)('maps QuoteError %s to HTTP %i with its Thai message', async (code, status) => {
      runMatchMock.mockRejectedValue(new QuoteError(code));
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog }));
      const body = (await res.json()) as ErrorBody;
      expect(res.status).toBe(status);
      expect(body).toEqual({ ok: false, error: { code, message: QUOTE_ERROR_MESSAGES[code] } });
    });

    it('AI_BUSY carries a Thai message', async () => {
      runMatchMock.mockRejectedValue(new QuoteError('AI_BUSY'));
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog }));
      expect(((await res.json()) as ErrorBody).error.message).toMatch(/[฀-๿]/);
    });

    it('returns 500 CONFIG when getModelConfig throws, without calling runMatch or leaking its message', async () => {
      getModelConfigMock.mockImplementation(() => {
        throw new Error('ต้องตั้งค่า GOOGLE_GENERATIVE_AI_API_KEY');
      });
      const res = await POST(jsonRequest({ inquiry: 'ท่อ', catalog }));
      const body = (await res.json()) as ErrorBody;
      expect(res.status).toBe(500);
      expect(body.error.code).toBe('CONFIG');
      expect(body.error.message).not.toContain('GOOGLE_GENERATIVE_AI_API_KEY');
      expect(runMatchMock).not.toHaveBeenCalled();
    });

    it('returns 500 INTERNAL for an unexpected error without echoing its message', async () => {
      runMatchMock.mockRejectedValue(new Error(`boom ${SECRET_INQUIRY}`));
      const res = await POST(jsonRequest({ inquiry: SECRET_INQUIRY, catalog }));
      const text = await res.text();
      expect(res.status).toBe(500);
      expect((JSON.parse(text) as ErrorBody).error.code).toBe('INTERNAL');
      expect(text).not.toContain(SECRET_INQUIRY);
    });
  });

  describe('logging', () => {
    function spyConsole() {
      return (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
    }
    function allLogged(spies: ReturnType<typeof spyConsole>): string {
      return spies
        .flatMap((s) => s.mock.calls.flat())
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join('\n');
    }

    it('logs only status, ms and token counts on success - never the inquiry or catalog', async () => {
      const spies = spyConsole();
      await POST(jsonRequest({ inquiry: SECRET_INQUIRY, catalog }));
      const logged = allLogged(spies);
      expect(logged).toContain('"inputTokens":120');
      expect(logged).toContain('"outputTokens":45');
      expect(logged).toContain('"status":200');
      expect(logged).not.toContain(SECRET_INQUIRY);
      expect(logged).not.toContain('P-1');
      expect(logged).not.toContain('ท่อ PVC');
    });

    it('does not log the inquiry on failures, including unexpected errors that echo it', async () => {
      const spies = spyConsole();
      runMatchMock.mockRejectedValueOnce(new Error(`boom ${SECRET_INQUIRY}`));
      await POST(jsonRequest({ inquiry: SECRET_INQUIRY, catalog }));
      runMatchMock.mockRejectedValueOnce(new QuoteError('AI_BUSY'));
      await POST(jsonRequest({ inquiry: SECRET_INQUIRY, catalog }));
      const logged = allLogged(spies);
      expect(logged).toContain('AI_BUSY');
      expect(logged).not.toContain(SECRET_INQUIRY);
      expect(logged).not.toContain('boom');
    });

    it('does not log the body when it fails schema validation', async () => {
      const spies = spyConsole();
      await POST(jsonRequest({ inquiry: SECRET_INQUIRY, catalog: [] }));
      expect(allLogged(spies)).not.toContain(SECRET_INQUIRY);
    });
  });
});
