// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogUpload } from '@/components/catalog/CatalogUpload';
import { memoryStorage, quotaStorage } from './memory-storage';
import { CATALOG_TOO_LARGE } from '@/components/catalog/CatalogUpload';
import { STORAGE_KEYS, resetDefaultStore, type StoredCatalog } from '@/lib/storage';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(resolve(process.cwd(), '../../packages/core/test/fixtures', name)),
  );

const csvFile = (bytes: Uint8Array | string, name = 'catalog.csv'): File =>
  new File([typeof bytes === 'string' ? bytes : (bytes as BlobPart)], name, { type: 'text/csv' });

async function upload(file: File) {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText('เลือกไฟล์ catalog (CSV)'), file);
  return user;
}

const stored = (): StoredCatalog | null => {
  const raw = window.localStorage.getItem(STORAGE_KEYS.catalog);
  return raw === null ? null : (JSON.parse(raw) as StoredCatalog);
};

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetDefaultStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDefaultStore();
});

describe('CatalogUpload', () => {
  it('shows row errors with row/column and an import button for the valid rows only', async () => {
    render(<CatalogUpload />);
    await upload(csvFile(fixture('catalog-bad-rows.csv'), 'bad.csv'));

    expect(await screen.findByText('แถว 3 · unit_price: "abc" ไม่ใช่ตัวเลข')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'นำเข้าเฉพาะแถวที่ถูก (2 รายการ)' })).toBeTruthy();
    expect(screen.getByText(/UTF-8/)).toBeTruthy();
    // 7 non-empty data lines = 2 imported + 5 rows with errors -> nothing merged
    expect(screen.getByText('พบ 7 แถวในไฟล์, นำเข้าได้ 2 รายการ')).toBeTruthy();
    expect(screen.queryByText(/อาจถูกรวมเป็นแถวเดียว/)).toBeNull();
  });

  it('shows a file-level error and no import button when a required column is missing', async () => {
    render(<CatalogUpload />);
    await upload(csvFile(fixture('catalog-missing-column.csv')));

    expect(await screen.findByText(/ไม่พบคอลัมน์ที่จำเป็น/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /นำเข้า/ })).toBeNull();
  });

  it('shows a Thai error (no crash) for a BOM file whose bytes are not valid UTF-8', async () => {
    render(<CatalogUpload />);
    await upload(csvFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x73, 0xff, 0xfe, 0x6b])));

    expect(
      await screen.findByText('อ่านไฟล์ไม่ได้ กรุณาบันทึกเป็น CSV (UTF-8) แล้วลองใหม่'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /นำเข้า/ })).toBeNull();
  });

  it('detects Windows-874 and renders the Thai names correctly in the preview', async () => {
    render(<CatalogUpload />);
    await upload(csvFile(fixture('catalog-win874.csv'), 'excel.csv'));

    expect(await screen.findByText(/Windows-874 \(ภาษาไทยแบบเก่าของ Excel\)/)).toBeTruthy();
    expect(screen.getByText('ท่อ PVC ชั้น 8.5 4 หุน')).toBeTruthy();
    expect(screen.getByText('1,250.00')).toBeTruthy();
  });

  it('warns when the physical line count does not match imported rows + error rows', async () => {
    // a quoted description that spans two physical lines is one record but two lines
    const text = [
      'sku,name_th,name_en,unit,unit_price,aliases,category,description',
      'A-1,สินค้า,,ชิ้น,10,,,"บรรทัดแรก',
      'บรรทัดสอง"',
      '',
    ].join('\n');
    render(<CatalogUpload />);
    await upload(csvFile(text));

    expect(await screen.findByText('พบ 2 แถวในไฟล์, นำเข้าได้ 1 รายการ')).toBeTruthy();
    expect(screen.getByText(/อาจถูกรวมเป็นแถวเดียว/)).toBeTruthy();
  });

  it('truncates the error list to 50 entries and says how many more there are', async () => {
    const rows = Array.from({ length: 53 }, (_, i) => `S-${i},สินค้า ${i},,ชิ้น,abc,,,`);
    const text = ['sku,name_th,name_en,unit,unit_price,aliases,category,description', ...rows].join('\n');
    render(<CatalogUpload />);
    await upload(csvFile(text));

    expect(await screen.findByText('และอีก 3 รายการ')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'แถวที่มีข้อผิดพลาด' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByRole('button', { name: /นำเข้า/ })).toBeNull();
  });

  it('saves the valid rows, replaces the stored catalog and shows what is stored', async () => {
    render(<CatalogUpload />);
    const user = await upload(csvFile(fixture('catalog-bad-rows.csv'), 'bad.csv'));
    await user.click(await screen.findByRole('button', { name: 'นำเข้าเฉพาะแถวที่ถูก (2 รายการ)' }));

    await waitFor(() => expect(stored()).not.toBeNull());
    const saved = stored()!;
    expect(saved.catalog.items.map((i) => i.sku)).toEqual(['PVC-001', 'PVC-006']);
    expect(saved.catalog.pricesIncludeVat).toBe(false);
    expect(saved.sourceName).toBe('bad.csv');
    expect(saved.rowCount).toBe(2);
    const current = await screen.findByTestId('stored-catalog');
    expect(current.textContent).toContain('bad.csv');
    expect(current.textContent).toContain('2 รายการ');

    // a second import replaces, not appends
    await user.upload(
      screen.getByLabelText('เลือกไฟล์ catalog (CSV)'),
      csvFile(fixture('catalog-utf8.csv'), 'second.csv'),
    );
    await user.click(await screen.findByRole('button', { name: /^นำเข้า/ }));
    await waitFor(() => expect(stored()!.sourceName).toBe('second.csv'));
    expect(stored()!.catalog.items.some((i) => i.sku === 'PVC-006')).toBe(false);
  });

  it('keeps "prices include VAT" off by default and stores it when switched on', async () => {
    render(<CatalogUpload />);
    const toggle = screen.getByRole('checkbox', { name: 'ราคาใน catalog รวม VAT แล้ว' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    const user = await upload(csvFile(fixture('catalog-utf8.csv')));
    await user.click(toggle);
    await user.click(await screen.findByRole('button', { name: /^นำเข้า/ }));
    await waitFor(() => expect(stored()?.catalog.pricesIncludeVat).toBe(true));
  });

  it('warns that data will be lost when localStorage is unavailable, and still imports in memory', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    resetDefaultStore();
    render(<CatalogUpload />);

    expect(await screen.findByText('บันทึกในเครื่องไม่ได้ ข้อมูลจะหายเมื่อปิดหน้า')).toBeTruthy();
    const user = await upload(csvFile(fixture('catalog-utf8.csv'), 'mem.csv'));
    await user.click(await screen.findByRole('button', { name: /^นำเข้า/ }));
    expect((await screen.findByTestId('stored-catalog')).textContent).toContain('mem.csv');
  });

  it('does not warn when localStorage works', async () => {
    render(<CatalogUpload />);
    await screen.findByRole('link', { name: 'ดาวน์โหลด template' });
    expect(screen.queryByText(/บันทึกในเครื่องไม่ได้/)).toBeNull();
  });

  it('loads a bundled sample catalog with one click', async () => {
    const plumbing = readFileSync(
      resolve(process.cwd(), 'public/samples/plumbing.csv'),
    );
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(plumbing)));
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogUpload />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'โหลด catalog ตัวอย่าง: งานประปา' }));

    expect(await screen.findByRole('button', { name: /^นำเข้า/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/samples/plumbing.csv');
    expect(screen.getByText(/UTF-8/)).toBeTruthy();
  });

  it('shows an error when a sample cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    render(<CatalogUpload />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: 'โหลด catalog ตัวอย่าง: เครื่องเขียน/สำนักงาน' }),
    );
    expect(await screen.findByText('โหลดไฟล์ตัวอย่างไม่ได้ กรุณาลองใหม่')).toBeTruthy();
  });

  it('offers the template as a UTF-8 CSV download', () => {
    render(<CatalogUpload />);
    const link = screen.getByRole('link', { name: 'ดาวน์โหลด template' });
    expect(link.getAttribute('download')).toBe('catalog-template.csv');
    expect(link.getAttribute('href')).toMatch(/^data:text\/csv;charset=utf-8,%EF%BB%BFsku/);
  });
});

describe('CatalogUpload storage failures and bad stored data', () => {
  it('shows the specific message when the catalog write fails, keeps it in memory, and drops the stale copy', async () => {
    const oldCatalog: StoredCatalog = {
      catalog: { items: [], pricesIncludeVat: false },
      sourceName: 'old.csv',
      rowCount: 0,
      savedAt: '2026-10-01T00:00:00.000Z',
    };
    // an older catalog is already stored; later writes of the catalog key hit the quota
    const backend = quotaStorage([STORAGE_KEYS.catalog], {
      [STORAGE_KEYS.catalog]: JSON.stringify(oldCatalog),
    });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: backend });
    resetDefaultStore();

    render(<CatalogUpload />);
    expect((await screen.findByTestId('stored-catalog')).textContent).toContain('old.csv');
    const user = await upload(csvFile(fixture('catalog-utf8.csv'), 'new.csv'));
    await user.click(await screen.findByRole('button', { name: /^นำเข้า/ }));

    expect(await screen.findByText(CATALOG_TOO_LARGE)).toBeTruthy();
    expect(screen.queryByText('บันทึกในเครื่องไม่ได้ ข้อมูลจะหายเมื่อปิดหน้า')).toBeNull();
    expect((await screen.findByTestId('stored-catalog')).textContent).toContain('new.csv');
    expect(backend.getItem(STORAGE_KEYS.catalog)).toBeNull();
  });

  it('renders without a stored catalog when the stored JSON has the wrong shape', async () => {
    window.localStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify({ catalog: 'nope', items: 3 }));
    resetDefaultStore();
    render(<CatalogUpload />);
    expect(await screen.findByRole('link', { name: 'ดาวน์โหลด template' })).toBeTruthy();
    expect(screen.queryByTestId('stored-catalog')).toBeNull();
  });

  it('ignores stored JSON that is not even JSON', async () => {
    window.localStorage.setItem(STORAGE_KEYS.catalog, '{broken');
    resetDefaultStore();
    render(<CatalogUpload />);
    expect(await screen.findByRole('link', { name: 'ดาวน์โหลด template' })).toBeTruthy();
    expect(screen.queryByTestId('stored-catalog')).toBeNull();
  });
});
