// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportBar } from '@/components/review/ExportBar';
import { downloadText } from '@/lib/download';
import { approvedDraft, buildDraft, catalogOf, COMPANY, matchedLine } from './quote-fixtures';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));

const CSV = 'ดาวน์โหลด CSV';
const JSON_LABEL = 'ดาวน์โหลด JSON';
const PRINT = 'พิมพ์ / บันทึก PDF';
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(downloadText).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExportBar', () => {
  it('disables all three buttons, with an explanation, until the draft is approved', () => {
    const catalog = catalogOf();
    render(<ExportBar draft={buildDraft([matchedLine('L1')], catalog)} catalog={catalog} company={COMPANY} />);
    for (const name of [CSV, JSON_LABEL, PRINT]) expect(button(name).disabled).toBe(true);
    expect(screen.getByText(/อนุมัติใบเสนอราคาก่อน/)).toBeTruthy();
  });

  it('does not count a stale approval: approvedAt set but a line no longer ready', () => {
    const catalog = catalogOf();
    const draft = approvedDraft([matchedLine('L1')], catalog);
    draft.lines[0]!.quantity = null;
    render(<ExportBar draft={draft} catalog={catalog} company={COMPANY} />);
    expect(button(CSV).disabled).toBe(true);
  });

  it('does not count an approval made against another catalog', () => {
    const catalog = catalogOf();
    const draft = approvedDraft([matchedLine('L1')], catalog);
    render(<ExportBar draft={draft} catalog={catalogOf(catalog.items, true)} company={COMPANY} />);
    expect(button(JSON_LABEL).disabled).toBe(true);
  });

  it('enables the buttons once approved', () => {
    const catalog = catalogOf();
    render(<ExportBar draft={approvedDraft([matchedLine('L1')], catalog)} catalog={catalog} company={COMPANY} />);
    for (const name of [CSV, JSON_LABEL, PRINT]) expect(button(name).disabled).toBe(false);
    expect(screen.queryByText(/อนุมัติใบเสนอราคาก่อน/)).toBeNull();
  });

  it('downloads QT-256910-001.csv starting with a BOM', async () => {
    const catalog = catalogOf();
    render(<ExportBar draft={approvedDraft([matchedLine('L1')], catalog)} catalog={catalog} company={COMPANY} />);
    await userEvent.setup().click(button(CSV));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [name, text, mime] = vi.mocked(downloadText).mock.calls[0]!;
    expect(name).toBe('QT-256910-001.csv');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('PVC-4');
    expect(mime).toContain('text/csv');
  });

  it('downloads the full quotation as JSON', async () => {
    const catalog = catalogOf();
    render(<ExportBar draft={approvedDraft([matchedLine('L1')], catalog)} catalog={catalog} company={COMPANY} />);
    await userEvent.setup().click(button(JSON_LABEL));
    const [name, text, mime] = vi.mocked(downloadText).mock.calls[0]!;
    expect(name).toBe('QT-256910-001.json');
    expect(mime).toContain('application/json');
    const parsed = JSON.parse(text) as { schemaVersion: number; number: string; lines: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.number).toBe('QT-256910-001');
    expect(parsed.lines).toHaveLength(1);
  });

  it('falls back to quotation.csv when the number is blank', async () => {
    const catalog = catalogOf();
    render(<ExportBar draft={approvedDraft([matchedLine('L1')], catalog, '')} catalog={catalog} company={COMPANY} />);
    await userEvent.setup().click(button(CSV));
    expect(vi.mocked(downloadText).mock.calls[0]![0]).toBe('quotation.csv');
  });

  it('opens the print page', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const catalog = catalogOf();
    render(<ExportBar draft={approvedDraft([matchedLine('L1')], catalog)} catalog={catalog} company={COMPANY} />);
    await userEvent.setup().click(button(PRINT));
    expect(open).toHaveBeenCalledWith('/quote/print', '_blank');
  });
});
