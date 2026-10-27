// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Catalog, Quotation } from '@tqc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuoteDocument } from '@/components/print/QuoteDocument';
import { PrintScreen } from '@/components/print/PrintScreen';
import { draftReducer, toQuotation, type Draft } from '@/lib/draft';
import { STORAGE_KEYS, resetDefaultStore } from '@/lib/storage';
import { memoryStorage } from './memory-storage';
import { COMPANY, approvedDraft, buildDraft, catalogOf, item, matchedLine } from './quote-fixtures';

const NOW = '2026-10-22T10:00:00.000Z';

function seed(draft: Draft | null, catalog: Catalog | null = catalogOf()) {
  if (catalog !== null) {
    window.localStorage.setItem(
      STORAGE_KEYS.catalog,
      JSON.stringify({ catalog, sourceName: 't.csv', rowCount: catalog.items.length, savedAt: NOW }),
    );
  }
  if (draft !== null) window.localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
}

/** Approved draft after applying `patch` (an edit would withdraw the approval, so patch first, then approve). */
function approvedWith(patch: Partial<Draft>, catalog: Catalog = catalogOf(), lines = [matchedLine('L1')]): Draft {
  const edited = draftReducer(buildDraft(lines, catalog), {
    type: 'setBill',
    patch: { ...patch, number: patch.number ?? 'QT-256910-001' },
  });
  return draftReducer(edited, { type: 'approve', now: NOW, catalog });
}

function quotationOf(draft: Draft, catalog: Catalog = catalogOf()): Quotation {
  return toQuotation(draft, catalog, COMPANY);
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetDefaultStore();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDefaultStore();
});

describe('PrintScreen gate', () => {
  it('asks for a draft when there is none', () => {
    seed(null);
    render(<PrintScreen />);
    expect(screen.getByText(/ยังไม่มีร่างใบเสนอราคา/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /กลับไปหน้าตรวจแก้/ }).getAttribute('href')).toBe('/review');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('shows the explanation and no document for a draft that is not approved', () => {
    seed(buildDraft([matchedLine('L1')]));
    render(<PrintScreen />);
    expect(screen.getByText(/ยังไม่ได้อนุมัติ/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /กลับไปหน้าตรวจแก้/ }).getAttribute('href')).toBe('/review');
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: 'พิมพ์ / บันทึก PDF' })).toBeNull();
  });

  it('does not render a document for a stale approval (approvedAt set, a line broken)', () => {
    const draft = approvedDraft();
    draft.lines[0]!.quantity = null;
    seed(draft);
    render(<PrintScreen />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText(/ยังไม่ได้อนุมัติ/)).toBeTruthy();
  });

  it('does not render a document when the approval was made against another catalog', () => {
    seed(approvedDraft(), catalogOf([item('PVC-4', 'ท่อ PVC 4 หุน', 'เส้น', 10_100)]));
    render(<PrintScreen />);
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('renders the document for an approved draft and prints on demand', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    seed(approvedDraft());
    render(<PrintScreen />);
    expect(screen.getByRole('article', { name: 'ใบเสนอราคา' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('QuoteDocument', () => {
  const doc = () => screen.getByRole('article', { name: 'ใบเสนอราคา' });

  it('shows company, customer, number and Buddhist-era dates', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({ notes: 'ส่งฟรีในกรุงเทพ' }))} />);
    const d = within(doc());
    expect(d.getByText('บริษัท ตัวอย่างวัสดุ จำกัด')).toBeTruthy();
    expect(d.getByText(/0000000000000/)).toBeTruthy();
    expect(d.getByText(/02-000-0000/)).toBeTruthy();
    expect(d.getByText(/คุณสมชาย/)).toBeTruthy();
    expect(d.getByText(/บริษัท ลูกค้าตัวอย่าง จำกัด/)).toBeTruthy();
    expect(d.getByText(/QT-256910-001/)).toBeTruthy();
    expect(d.getByText(/22 ตุลาคม 2569/)).toBeTruthy();
    expect(d.getByText(/21 พฤศจิกายน 2569/)).toBeTruthy(); // issue date + 30 days
    expect(d.getByText(/ชำระภายใน 30 วัน/)).toBeTruthy();
    expect(d.getByText(/ส่งฟรีในกรุงเทพ/)).toBeTruthy();
  });

  it('draws the logo only when the company has one', () => {
    const q = quotationOf(approvedWith({}));
    const { unmount } = render(<QuoteDocument quotation={q} />);
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    render(<QuoteDocument quotation={{ ...q, company: { ...q.company, logoDataUrl: 'data:image/png;base64,AAAA' } }} />);
    expect(screen.getByRole('img', { name: /โลโก้/ }).getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('lists the lines with the eight columns and per-line amount', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({}, catalogOf(), [matchedLine('L1'), matchedLine('L2', 'TAPE-1', 3, 'ม้วน')]))} />);
    const table = within(doc()).getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['ลำดับ', 'รหัสสินค้า', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'จำนวนเงิน']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body).toHaveLength(2);
    expect(within(body[0]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '1',
      'PVC-4',
      'ท่อ PVC 4 หุน',
      '10',
      'เส้น',
      '100.00',
      '',
      '1,000.00',
    ]);
    expect(within(body[1]!).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '2',
      'TAPE-1',
      'เทปพันเกลียว',
      '3',
      'ม้วน',
      '15.00',
      '',
      '45.00',
    ]);
  });

  it('keeps the header row in a thead so it repeats on every printed page', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({}))} />);
    const table = within(doc()).getByRole('table');
    expect(table.querySelector('thead th')?.textContent).toBe('ลำดับ');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows subtotal, VAT, grand total and the amount in words; no WHT or bill discount by default', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({}))} />);
    const d = within(doc());
    expect(d.getByText('รวมเป็นเงิน').nextElementSibling?.textContent).toBe('1,000.00');
    expect(d.getByText('ภาษีมูลค่าเพิ่ม 7%').nextElementSibling?.textContent).toBe('70.00');
    expect(d.getByText('ยอดรวมทั้งสิ้น').nextElementSibling?.textContent).toBe('1,070.00');
    expect(d.getByText(/หนึ่งพันเจ็ดสิบบาทถ้วน/)).toBeTruthy();
    expect(d.queryByText(/ส่วนลดท้ายบิล/)).toBeNull();
    expect(d.queryByText(/หัก ณ ที่จ่าย/)).toBeNull();
    expect(d.queryByText('ยอดชำระสุทธิ')).toBeNull();
    expect(d.queryByText(/ราคารวม VAT แล้ว/)).toBeNull();
  });

  it('adds the bill discount row only when there is one', () => {
    const draft = approvedWith({ billDiscount: { type: 'amount', satang: 10_000 } });
    render(<QuoteDocument quotation={quotationOf(draft)} />);
    expect(within(doc()).getByText('ส่วนลดท้ายบิล').nextElementSibling?.textContent).toBe('-100.00');
  });

  it('adds withholding tax and net payable only when WHT is above zero', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({ whtRatePercent: 3 }))} />);
    const d = within(doc());
    expect(d.getByText('หัก ณ ที่จ่าย 3%').nextElementSibling?.textContent).toBe('30.00');
    expect(d.getByText('ยอดชำระสุทธิ').nextElementSibling?.textContent).toBe('1,040.00');
  });

  it('marks the VAT row when catalog prices already include VAT', () => {
    const catalog = catalogOf(undefined, true);
    render(<QuoteDocument quotation={quotationOf(approvedWith({}, catalog), catalog)} />);
    const d = within(doc());
    expect(d.getByText(/ภาษีมูลค่าเพิ่ม 7%.*ราคารวม VAT แล้ว/)).toBeTruthy();
    expect(d.getByText('ยอดรวมทั้งสิ้น').nextElementSibling?.textContent).toBe('1,000.00');
  });

  it('shows line discounts as percent or baht', () => {
    const catalog = catalogOf();
    let draft = buildDraft([matchedLine('L1'), matchedLine('L2', 'TAPE-1', 3, 'ม้วน')], catalog);
    draft = draftReducer(draft, { type: 'setDiscount', lineId: 'L1', discount: { type: 'percent', value: 10 } });
    draft = draftReducer(draft, { type: 'setDiscount', lineId: 'L2', discount: { type: 'amount', satang: 500 } });
    draft = draftReducer(draft, { type: 'approve', now: NOW, catalog });
    render(<QuoteDocument quotation={quotationOf(draft, catalog)} />);
    const rows = within(doc()).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getAllByRole('cell')[6]?.textContent).toBe('10%');
    expect(within(rows[0]!).getAllByRole('cell')[7]?.textContent).toBe('900.00');
    expect(within(rows[1]!).getAllByRole('cell')[6]?.textContent).toBe('5.00');
    expect(within(rows[1]!).getAllByRole('cell')[7]?.textContent).toBe('40.00');
  });

  it('has two signature blocks with blank lines and date lines', () => {
    render(<QuoteDocument quotation={quotationOf(approvedWith({}))} />);
    const d = within(doc());
    expect(d.getByText('ผู้เสนอราคา')).toBeTruthy();
    expect(d.getByText('ผู้อนุมัติ')).toBeTruthy();
    expect(d.getAllByText(/วันที่/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders a 40-line quotation as 40 numbered rows', () => {
    const lines = Array.from({ length: 40 }, (_, i) => matchedLine(`L${i + 1}`, i % 2 === 0 ? 'PVC-4' : 'TAPE-1', i + 1, i % 2 === 0 ? 'เส้น' : 'ม้วน'));
    render(<QuoteDocument quotation={quotationOf(approvedWith({}, catalogOf(), lines))} />);
    const rows = within(doc()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(40);
    expect(within(rows[39]!).getAllByRole('cell')[0]?.textContent).toBe('40');
    expect(within(doc()).getByText('รวมเป็นเงิน').nextElementSibling?.textContent).toBe('46,300.00'); // 400 pipes x 100.00 + 420 tapes x 15.00
  });
});
