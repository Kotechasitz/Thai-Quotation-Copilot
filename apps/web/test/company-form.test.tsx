// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CompanyProfile } from '@tqc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CompanyForm, SAVE_FAILED } from '@/components/settings/CompanyForm';
import { DEFAULT_COMPANY } from '@/lib/company';
import { STORAGE_KEYS, getDefaultStore, resetDefaultStore } from '@/lib/storage';
import { memoryStorage, quotaStorage } from './memory-storage';

const stored = (): CompanyProfile | null => {
  const raw = window.localStorage.getItem(STORAGE_KEYS.company);
  return raw === null ? null : (JSON.parse(raw) as CompanyProfile);
};

const png = (bytes = 10, name = 'logo.png') =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetDefaultStore();
});

afterEach(() => {
  cleanup();
  resetDefaultStore();
});

describe('CompanyForm', () => {
  it('starts with the fictional demo company and its default terms', async () => {
    render(<CompanyForm />);
    expect((screen.getByLabelText('ชื่อบริษัท') as HTMLInputElement).value).toBe(
      'บริษัท ตัวอย่างวัสดุ จำกัด',
    );
    expect((screen.getByLabelText('ยืนราคา (วัน)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('เงื่อนไขการชำระเงินเริ่มต้น') as HTMLInputElement).value).toBe(
      'ชำระเงินภายใน 30 วันนับจากวันส่งสินค้า',
    );
    expect(screen.queryByText(/บันทึกในเครื่องไม่ได้/)).toBeNull();
  });

  it('saves edited values and shows them again after a re-mount (page refresh)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CompanyForm />);
    const name = screen.getByLabelText('ชื่อบริษัท');
    await user.clear(name);
    await user.type(name, 'ห้างหุ้นส่วนทดสอบ');
    const days = screen.getByLabelText('ยืนราคา (วัน)');
    await user.clear(days);
    await user.type(days, '45');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(stored()).toMatchObject({
      name: 'ห้างหุ้นส่วนทดสอบ',
      defaultValidityDays: 45,
      taxId: DEFAULT_COMPANY.taxId,
    });

    unmount();
    resetDefaultStore();
    render(<CompanyForm />);
    expect((screen.getByLabelText('ชื่อบริษัท') as HTMLInputElement).value).toBe('ห้างหุ้นส่วนทดสอบ');
    expect((screen.getByLabelText('ยืนราคา (วัน)') as HTMLInputElement).value).toBe('45');
  });

  it('refuses to save an empty name, a bad tax id and an invalid validity, and stores nothing', async () => {
    const user = userEvent.setup();
    render(<CompanyForm />);
    await user.clear(screen.getByLabelText('ชื่อบริษัท'));
    await user.clear(screen.getByLabelText('เลขประจำตัวผู้เสียภาษี'));
    await user.type(screen.getByLabelText('เลขประจำตัวผู้เสียภาษี'), '123');
    await user.clear(screen.getByLabelText('ยืนราคา (วัน)'));
    await user.type(screen.getByLabelText('ยืนราคา (วัน)'), '0');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByText('กรุณากรอกชื่อบริษัท')).toBeTruthy();
    expect(screen.getByText('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก')).toBeTruthy();
    expect(screen.getByText('ยืนราคาต้องเป็นจำนวนวันเต็ม 1-365 วัน')).toBeTruthy();
    expect(stored()).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rejects a logo over 200 KB and keeps the old one', async () => {
    const user = userEvent.setup();
    render(<CompanyForm />);
    await user.upload(screen.getByLabelText(/โลโก้/), png(200 * 1024 + 1));

    expect(await screen.findByText('โลโก้ต้องไม่เกิน 200 KB')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'โลโก้บริษัท' })).toBeNull();
  });

  it('accepts a logo of exactly 200 KB as a data URL, saves it, and can remove it', async () => {
    const user = userEvent.setup();
    render(<CompanyForm />);
    await user.upload(screen.getByLabelText(/โลโก้/), png(200 * 1024));

    const img = await screen.findByRole('img', { name: 'โลโก้บริษัท' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.queryByText('โลโก้ต้องไม่เกิน 200 KB')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(stored()?.logoDataUrl).toMatch(/^data:image\/png/));

    await user.click(screen.getByRole('button', { name: 'ลบโลโก้' }));
    expect(screen.queryByRole('img', { name: 'โลโก้บริษัท' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(stored()?.logoDataUrl).toBeNull());
  });

  it('warns when the profile cannot be persisted', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    resetDefaultStore();
    render(<CompanyForm />);
    expect(await screen.findByText('บันทึกในเครื่องไม่ได้ ข้อมูลจะหายเมื่อปิดหน้า')).toBeTruthy();
  });

  it('shows the failure text instead of "บันทึกแล้ว" when the write does not reach storage', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: quotaStorage([STORAGE_KEYS.company]),
    });
    resetDefaultStore();
    const user = userEvent.setup();
    render(<CompanyForm />);
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByText(SAVE_FAILED)).toBeTruthy();
    expect(screen.queryByText('บันทึกแล้ว')).toBeNull();
  });

  it('still saves the company when a different key (the catalog) already ran out of quota', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: quotaStorage([STORAGE_KEYS.catalog]),
    });
    resetDefaultStore();
    expect(getDefaultStore().set(STORAGE_KEYS.catalog, { big: true })).toBe(false);

    const user = userEvent.setup();
    render(<CompanyForm />);
    const name = screen.getByLabelText('ชื่อบริษัท');
    await user.clear(name);
    await user.type(name, 'บริษัท เล็ก จำกัด');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByText('บันทึกแล้ว')).toBeTruthy();
    expect(stored()?.name).toBe('บริษัท เล็ก จำกัด');
  });

  it('falls back to the defaults when the stored profile has the wrong shape', async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.company,
      JSON.stringify({ name: 123, defaultValidityDays: 'thirty' }),
    );
    resetDefaultStore();
    render(<CompanyForm />);
    expect((screen.getByLabelText('ชื่อบริษัท') as HTMLInputElement).value).toBe(DEFAULT_COMPANY.name);
    expect((screen.getByLabelText('ยืนราคา (วัน)') as HTMLInputElement).value).toBe('30');
  });

  it('reads a valid stored profile of the exact shape', async () => {
    const custom: CompanyProfile = { ...DEFAULT_COMPANY, name: 'ร้านเก่า', logoDataUrl: null };
    window.localStorage.setItem(STORAGE_KEYS.company, JSON.stringify(custom));
    resetDefaultStore();
    render(<CompanyForm />);
    expect((screen.getByLabelText('ชื่อบริษัท') as HTMLInputElement).value).toBe('ร้านเก่า');
  });
});
