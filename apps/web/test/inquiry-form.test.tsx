// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_INQUIRY_CHARS, type MatchResponse } from '@tqc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryForm } from '@/components/InquiryForm';
import { BAD_REPLY_ERROR, parseMatchReply } from '@/lib/match-client';
import type { MatchApiResponse } from '@/lib/api-schema';
import type { Draft } from '@/lib/draft';
import { STORAGE_KEYS, resetDefaultStore, type StoredCatalog } from '@/lib/storage';
import { memoryStorage } from './memory-storage';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const CATALOG: StoredCatalog = {
  catalog: {
    items: [
      {
        sku: 'PVC-4',
        nameTh: 'ท่อ PVC 4 หุน',
        nameEn: null,
        unit: 'เส้น',
        unitPriceSatang: 10_000,
        aliases: [],
        category: null,
        description: null,
      },
    ],
    pricesIncludeVat: false,
  },
  sourceName: 'test.csv',
  rowCount: 1,
  savedAt: '2026-10-22T00:00:00.000Z',
};

const MATCH: MatchResponse = {
  extracted: {
    items: [
      { lineId: 'L1', rawText: 'ท่อ 4 หุน 10 เส้น', productQuery: 'ท่อ', quantity: 10, unit: 'เส้น', specs: [], notes: null },
    ],
    customer: { name: null, company: null, contact: null },
    missingInfo: [],
    language: 'th',
  },
  lines: [
    {
      lineId: 'L1',
      rawText: 'ท่อ 4 หุน 10 เส้น',
      quantity: 10,
      unit: 'เส้น',
      status: 'matched',
      sku: 'PVC-4',
      alternativeSkus: [],
      confidence: 'high',
      reason: 'ตรง',
      unitMismatch: false,
      unitNote: null,
    },
  ],
  usage: { inputTokens: 1, outputTokens: 1 },
};

function stubFetch(response: MatchApiResponse | 'reject' | 'not-json') {
  const fetchMock = vi.fn(async () => {
    if (response === 'reject') throw new TypeError('network down');
    if (response === 'not-json') return new Response('<html>oops</html>', { status: 502 });
    return new Response(JSON.stringify(response), { status: response.ok ? 200 : 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const submitButton = () => screen.getByRole('button', { name: 'สร้างร่างใบเสนอราคา' }) as HTMLButtonElement;
const box = () => screen.getByRole('textbox', { name: 'ข้อความจากลูกค้า' }) as HTMLTextAreaElement;

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetDefaultStore();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDefaultStore();
});

function withCatalog() {
  window.localStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify(CATALOG));
}

describe('InquiryForm', () => {
  it('links to the catalog page when no catalog has been imported', () => {
    render(<InquiryForm />);
    expect(screen.getByRole('link', { name: /ไปหน้า Catalog/ }).getAttribute('href')).toBe('/catalog');
    expect(screen.queryByRole('textbox', { name: 'ข้อความจากลูกค้า' })).toBeNull();
  });

  it('counts characters, and disables the button while the text is empty', async () => {
    withCatalog();
    render(<InquiryForm />);
    const user = userEvent.setup();
    expect(screen.getByText(`0/${MAX_INQUIRY_CHARS}`)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);

    await user.type(box(), 'ท่อ 10 เส้น');
    expect(screen.getByText(`11/${MAX_INQUIRY_CHARS}`)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);

    await user.clear(box());
    await user.type(box(), '   ');
    expect(submitButton().disabled).toBe(true);
  });

  it('keeps a paste over the limit whole, flags it in red and blocks submit until it is shortened', async () => {
    withCatalog();
    const fetchMock = stubFetch({ ok: true, data: MATCH });
    render(<InquiryForm />);
    const user = userEvent.setup();
    expect(box().maxLength).toBe(-1); // no silent truncation

    const over = MAX_INQUIRY_CHARS + 100;
    box().focus();
    await user.paste('ก'.repeat(over));
    expect(box().value).toHaveLength(over);
    const message = `ข้อความยาวเกิน 5,000 ตัวอักษร (${String(over)}) — ตัดให้สั้นลงก่อนส่ง`;
    expect(screen.getByText(message).getAttribute('role')).toBe('alert');
    expect(screen.getByText(`${String(over)}/${MAX_INQUIRY_CHARS}`).className).toContain('text-red');
    expect(submitButton().disabled).toBe(true);
    expect(box().getAttribute('aria-invalid')).toBe('true');

    await user.keyboard('{Enter}'); // cannot be submitted from the keyboard either
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(box());
    await user.paste('ก'.repeat(MAX_INQUIRY_CHARS));
    expect(screen.queryByText(/ข้อความยาวเกิน/)).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('posts the text with a price-free catalog, stores the draft and opens the review page', async () => {
    withCatalog();
    const fetchMock = stubFetch({ ok: true, data: MATCH });
    render(<InquiryForm />);
    const user = userEvent.setup();
    await user.type(box(), 'ท่อ 4 หุน 10 เส้น');
    await user.click(submitButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith('/review'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/match');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { inquiry: string; catalog: Record<string, unknown>[] };
    expect(body.inquiry).toBe('ท่อ 4 หุน 10 เส้น');
    expect(body.catalog).toHaveLength(1);
    expect(body.catalog[0]).not.toHaveProperty('unitPriceSatang');
    expect(JSON.stringify(body)).not.toContain('10000');

    const draft = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.draft) ?? 'null') as Draft;
    expect(draft.inquiry).toBe('ท่อ 4 หุน 10 เส้น');
    expect(draft.lines[0]?.resolvedSku).toBe('PVC-4');
    expect(draft.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(draft.paymentTerms).toBe('ชำระเงินภายใน 30 วันนับจากวันส่งสินค้า'); // company default
  });

  it('disables the button and says so while waiting', async () => {
    withCatalog();
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    render(<InquiryForm />);
    const user = userEvent.setup();
    await user.type(box(), 'ท่อ');
    await user.click(submitButton());

    expect(await screen.findByText(/กำลังสร้างร่าง/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /กำลังสร้างร่าง/ }) as HTMLButtonElement).disabled).toBe(true);
    release(new Response(JSON.stringify({ ok: true, data: MATCH }), { status: 200 }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/review'));
  });

  it('shows the server message and a retry button, and keeps the typed text', async () => {
    withCatalog();
    const fetchMock = stubFetch({ ok: false, error: { code: 'AI_BUSY', message: 'ระบบ AI กำลังมีผู้ใช้งานมาก' } });
    render(<InquiryForm />);
    const user = userEvent.setup();
    await user.type(box(), 'ท่อ 4 หุน');
    await user.click(submitButton());

    expect(await screen.findByText('ระบบ AI กำลังมีผู้ใช้งานมาก')).toBeTruthy();
    expect(box().value).toBe('ท่อ 4 หุน');
    expect(push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.draft)).toBeNull();

    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ ok: true, data: MATCH }), { status: 200 }));
    await user.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/review'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows a Thai message when the network fails or the reply is not JSON', async () => {
    withCatalog();
    stubFetch('reject');
    const { unmount } = render(<InquiryForm />);
    const user = userEvent.setup();
    await user.type(box(), 'ท่อ');
    await user.click(submitButton());
    expect(await screen.findByText(/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/)).toBeTruthy();
    expect(box().value).toBe('ท่อ');
    unmount();

    stubFetch('not-json');
    render(<InquiryForm />);
    await user.type(box(), 'ท่อ');
    await user.click(submitButton());
    expect(await screen.findByText(/เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ/)).toBeTruthy();
  });

  it('offers the existing draft instead of hiding it', () => {
    withCatalog();
    window.localStorage.setItem(
      STORAGE_KEYS.draft,
      JSON.stringify({
        inquiry: 'x',
        customer: { name: null, company: null, contact: null },
        lines: [],
        missingInfo: [],
        billDiscount: null,
        vatRatePercent: 7,
        whtRatePercent: 0,
        number: '',
        notes: '',
        paymentTerms: '',
        issueDate: '2026-10-22',
        catalogKey: 'k',
        approvedAt: null,
      }),
    );
    render(<InquiryForm />);
    expect(screen.getByRole('link', { name: /กลับไปร่างล่าสุด/ }).getAttribute('href')).toBe('/review');
  });

  it('rejects a reply with missing fields instead of crashing, and the button comes back', async () => {
    withCatalog();
    const broken = {
      ok: true,
      data: { extracted: { customer: { name: null, company: null, contact: null }, language: 'th' }, lines: [], usage: { inputTokens: 1, outputTokens: 1 } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })));
    render(<InquiryForm />);
    const user = userEvent.setup();
    await user.type(box(), 'ท่อ');
    await user.click(submitButton());

    expect(await screen.findByText(BAD_REPLY_ERROR)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
    expect(box().value).toBe('ท่อ');
    expect(push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEYS.draft)).toBeNull();
  });
});

describe('parseMatchReply', () => {
  it('accepts a complete success reply and an error reply', () => {
    expect(parseMatchReply({ ok: true, data: MATCH })?.ok).toBe(true);
    expect(parseMatchReply({ ok: false, error: { code: 'AI_BUSY', message: 'x' } })).toEqual({
      ok: false,
      error: { code: 'AI_BUSY', message: 'x' },
    });
  });

  it.each([
    ['null', null],
    ['no ok', { data: MATCH }],
    ['no extracted.items', { ok: true, data: { ...MATCH, extracted: { ...MATCH.extracted, items: undefined } } }],
    ['no missingInfo', { ok: true, data: { ...MATCH, extracted: { ...MATCH.extracted, missingInfo: undefined } } }],
    ['bad line status', { ok: true, data: { ...MATCH, lines: [{ ...MATCH.lines[0], status: 'maybe' }] } }],
    ['error without message', { ok: false, error: {} }],
  ])('rejects %s', (_name, value) => {
    expect(parseMatchReply(value)).toBeNull();
  });
});
