// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogItem, MatchResponse, ValidatedLine } from '@tqc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewScreen } from '@/components/review/ReviewScreen';
import { EMPTY_DRAFT, draftReducer, type Draft } from '@/lib/draft';
import { STORAGE_KEYS, resetDefaultStore, type StoredCatalog } from '@/lib/storage';
import { memoryStorage, quotaStorage } from './memory-storage';

const item = (sku: string, nameTh: string, unit: string, unitPriceSatang: number): CatalogItem => ({
  sku,
  nameTh,
  nameEn: null,
  unit,
  unitPriceSatang,
  aliases: [],
  category: null,
  description: null,
});

const ITEMS: CatalogItem[] = [
  item('PVC-4', 'ท่อ PVC 4 หุน', 'เส้น', 10_000),
  item('ELB-A', 'ข้องอ 90 องศา 4 หุน', 'ชิ้น', 2_000),
  item('ELB-B', 'ข้องอ 90 องศา 6 หุน', 'ชิ้น', 3_000),
  item('TAPE-1', 'เทปพันเกลียว', 'ม้วน', 1_500),
];

const storedCatalog = (items: CatalogItem[] = ITEMS, pricesIncludeVat = false): StoredCatalog => ({
  catalog: { items, pricesIncludeVat },
  sourceName: 'test.csv',
  rowCount: items.length,
  savedAt: '2026-10-22T00:00:00.000Z',
});

const L1: ValidatedLine = {
  lineId: 'L1',
  rawText: 'ท่อ 4 หุน 10 เส้น',
  quantity: 10,
  unit: 'เส้น',
  status: 'matched',
  sku: 'PVC-4',
  alternativeSkus: [],
  confidence: 'high',
  reason: 'ตรงกับท่อ PVC 4 หุน',
  unitMismatch: false,
  unitNote: null,
};
const L2: ValidatedLine = {
  lineId: 'L2',
  rawText: 'ข้องอ 90 องศา 5 ตัว',
  quantity: 5,
  unit: 'ชิ้น',
  status: 'ambiguous',
  sku: null,
  alternativeSkus: ['ELB-A', 'ELB-B'],
  confidence: 'medium',
  reason: 'ไม่ระบุขนาด',
  unitMismatch: false,
  unitNote: null,
};
const L3: ValidatedLine = {
  lineId: 'L3',
  rawText: 'เทปพันเกลียว 3 ม้วน',
  quantity: 3,
  unit: 'ม้วน',
  status: 'unmatched',
  sku: null,
  alternativeSkus: ['TAPE-1'],
  confidence: 'low',
  reason: 'ระบบตรวจแล้วไม่พบสินค้าที่ตรงในรายการ กรุณาค้นหาเอง',
  unitMismatch: false,
  unitNote: null,
};

function buildDraft(lines: ValidatedLine[], stored: StoredCatalog = storedCatalog()): Draft {
  const response: MatchResponse = {
    extracted: {
      items: lines.map((l) => ({
        lineId: l.lineId,
        rawText: l.rawText,
        productQuery: l.lineId === 'L3' ? 'เทปพันเกลียว' : 'ท่อ',
        quantity: l.quantity,
        unit: l.unit,
        specs: [],
        notes: null,
      })),
      customer: { name: 'คุณสมชาย', company: null, contact: null },
      missingInfo: [
        { lineId: 'L2', question: 'ข้องอขนาดกี่หุน' },
        { lineId: null, question: 'ส่งที่ไหน' },
      ],
      language: 'th',
    },
    lines,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  return draftReducer(EMPTY_DRAFT, {
    type: 'loadMatch',
    response,
    catalog: stored.catalog,
    inquiry: 'ข้อความต้นฉบับ',
    paymentTerms: 'ชำระภายใน 30 วัน',
    issueDate: '2026-10-22',
  });
}

function seed(draft: Draft | null, stored: StoredCatalog | null = storedCatalog()) {
  if (stored !== null) window.localStorage.setItem(STORAGE_KEYS.catalog, JSON.stringify(stored));
  if (draft !== null) window.localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
}

const savedDraft = (): Draft => JSON.parse(window.localStorage.getItem(STORAGE_KEYS.draft) ?? 'null') as Draft;
const row = (n: number) => screen.getByRole('listitem', { name: `บรรทัดที่ ${n}` });
const replaceText = (user: ReturnType<typeof userEvent.setup>, input: HTMLInputElement, text: string) =>
  user.type(input, text, { initialSelectionStart: 0, initialSelectionEnd: input.value.length });
const approveButton = () => screen.getByRole('button', { name: 'อนุมัติ' }) as HTMLButtonElement;

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  resetDefaultStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetDefaultStore();
});

describe('ReviewScreen without data', () => {
  it('points back to the home page when there is no draft', () => {
    seed(null);
    render(<ReviewScreen />);
    expect(screen.getByText(/ยังไม่มีร่างใบเสนอราคา/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /กลับไปหน้าแรก/ }).getAttribute('href')).toBe('/');
  });

  it('points to the catalog page when a draft exists but the catalog is gone', () => {
    seed(buildDraft([L1]), null);
    render(<ReviewScreen />);
    expect(screen.getByRole('link', { name: /ไปหน้า Catalog/ }).getAttribute('href')).toBe('/catalog');
  });
});

describe('ReviewScreen lines', () => {
  it('shows the original customer text next to every line, plus the AI reason', () => {
    seed(buildDraft([L1, L2, L3]));
    render(<ReviewScreen />);
    expect(within(row(1)).getByText('ท่อ 4 หุน 10 เส้น')).toBeTruthy();
    expect(within(row(2)).getByText('ข้องอ 90 องศา 5 ตัว')).toBeTruthy();
    expect(within(row(3)).getByText('เทปพันเกลียว 3 ม้วน')).toBeTruthy();
    expect(within(row(1)).getByText('ตรงกับท่อ PVC 4 หุน')).toBeTruthy();
    expect(within(row(2)).getByText('ไม่ระบุขนาด')).toBeTruthy();
  });

  it('labels each status in text as well as colour', () => {
    seed(buildDraft([L1, L2, L3, { ...L1, lineId: 'L4', quantity: null }]));
    render(<ReviewScreen />);
    expect(within(row(1)).getByText('พร้อมใช้')).toBeTruthy();
    expect(within(row(2)).getByText('ต้องเลือกสินค้า')).toBeTruthy();
    expect(within(row(3)).getByText('ต้องค้นหาสินค้า')).toBeTruthy();
    expect(within(row(4)).getByText('ต้องกรอกจำนวน')).toBeTruthy();
  });

  it('prices a line from the catalog by sku', () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    expect(within(row(1)).getByText(/PVC-4/)).toBeTruthy();
    expect(within(row(1)).getByText('1,000.00 บาท')).toBeTruthy(); // 10 x 100.00
  });

  it('keeps two lines with the same sku as two rows', () => {
    seed(buildDraft([L1, { ...L1, lineId: 'L2', rawText: 'ท่อ 4 หุนอีก 5 เส้น', quantity: 5 }]));
    render(<ReviewScreen />);
    expect(screen.getAllByRole('listitem', { name: /^บรรทัดที่ / })).toHaveLength(2);
  });
});

describe('approval gate', () => {
  it('disables อนุมัติ while a yellow line is unresolved and enables it after choosing from the dropdown', async () => {
    seed(buildDraft([L1, L2]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    expect(approveButton().disabled).toBe(true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'เลือกสินค้า บรรทัดที่ 2' }), 'ELB-B');

    expect(within(row(2)).getByText('พร้อมใช้')).toBeTruthy();
    expect(approveButton().disabled).toBe(false);
    expect(savedDraft().lines[1]?.resolvedSku).toBe('ELB-B');
  });

  it('keeps it disabled for a red line, and a line without quantity', () => {
    seed(buildDraft([L1, L3]));
    const { unmount } = render(<ReviewScreen />);
    expect(approveButton().disabled).toBe(true);
    unmount();
    window.localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(buildDraft([{ ...L1, quantity: null }])));
    render(<ReviewScreen />);
    expect(approveButton().disabled).toBe(true);
  });

  it('asks the user to confirm a unit mismatch', async () => {
    seed(buildDraft([{ ...L1, unit: 'กล่อง', unitMismatch: true }]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    expect(within(row(1)).getByText('ต้องยืนยันหน่วย')).toBeTruthy();
    expect(approveButton().disabled).toBe(true);
    // the prompt names both units and the quantity that will be quoted
    expect(within(row(1)).getByText('ยืนยันว่าจะเสนอราคาเป็น 10 เส้น (ไม่แปลงจาก 10 กล่อง)')).toBeTruthy();
    expect(within(row(1)).getByTestId('unit-label').textContent?.trim()).toBe('กล่อง');
    await user.click(within(row(1)).getByRole('button', { name: 'ยืนยันหน่วย' }));
    expect(approveButton().disabled).toBe(false);
    // after confirming, the label, the stored line and the total all use the catalog unit
    expect(within(row(1)).getByTestId('unit-label').textContent?.trim()).toBe('เส้น');
    expect(savedDraft().lines[0]?.unit).toBe('เส้น');
    expect(within(row(1)).getByText('1,000.00 บาท')).toBeTruthy(); // 10 x 100.00 per เส้น
  });

  it('records the approval and withdraws it when anything is edited afterwards', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();

    await user.click(approveButton());
    expect(savedDraft().approvedAt).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('อนุมัติแล้ว');

    const quantity = screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' });
    await user.clear(quantity);
    await user.type(quantity, '12');

    expect(savedDraft().approvedAt).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(approveButton().disabled).toBe(false);
  });
});

describe('searching the catalog', () => {
  it('prefills the search with the product query and suggests the single alternative first', async () => {
    seed(buildDraft([L3]));
    render(<ReviewScreen />);
    const user = userEvent.setup();

    const search = within(row(1)).getByRole('textbox', { name: 'ค้นหาสินค้า บรรทัดที่ 1' }) as HTMLInputElement;
    expect(search.value).toBe('เทปพันเกลียว');
    const suggestions = within(row(1)).getAllByRole('button', { name: /TAPE-1/ });
    expect(suggestions[0]?.textContent).toContain('แนะนำ');
    // every result button has a real accessible name: sku, name, price and unit
    expect(suggestions[0]?.getAttribute('aria-label')).toBe('เลือก TAPE-1 เทปพันเกลียว 15.00 บาท / ม้วน (แนะนำ)');
    // suggestion is not applied until the user picks it
    expect(savedDraft().lines[0]?.resolvedSku).toBeNull();

    await user.click(suggestions[0] as HTMLElement);
    expect(savedDraft().lines[0]?.resolvedSku).toBe('TAPE-1');
    expect(within(row(1)).getByText('พร้อมใช้')).toBeTruthy();
  });

  it('searches as the user types and lists sku, name and unit', async () => {
    seed(buildDraft([{ ...L3, alternativeSkus: [] }]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const search = within(row(1)).getByRole('textbox', { name: 'ค้นหาสินค้า บรรทัดที่ 1' });
    await user.clear(search);
    await user.type(search, 'ข้องอ');
    const results = within(row(1)).getAllByRole('button', { name: /ELB-/ });
    expect(results.length).toBe(2);
    expect(results[0]?.textContent).toMatch(/ELB-[AB].*ข้องอ.*ชิ้น/);
  });

  it('says so when nothing matches', async () => {
    seed(buildDraft([{ ...L3, alternativeSkus: [] }]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const search = within(row(1)).getByRole('textbox', { name: 'ค้นหาสินค้า บรรทัดที่ 1' });
    await user.clear(search);
    await user.type(search, 'zzzzzz');
    expect(within(row(1)).getByText('ไม่พบสินค้าที่ตรงกับคำค้น')).toBeTruthy();
  });

  it('lets a resolved line switch product through a search', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.click(within(row(1)).getByRole('button', { name: 'เปลี่ยนสินค้า' }));
    const search = within(row(1)).getByRole('textbox', { name: 'ค้นหาสินค้า บรรทัดที่ 1' });
    await user.clear(search);
    await user.type(search, 'เทปพัน');
    await user.click(within(row(1)).getByRole('button', { name: /TAPE-1/ }));
    expect(savedDraft().lines[0]?.resolvedSku).toBe('TAPE-1');
  });
});

describe('number inputs', () => {
  it('shows a Thai error for an invalid quantity, does not store it, and restores the stored value on blur', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const quantity = screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' }) as HTMLInputElement;

    await replaceText(user, quantity, '0');
    expect(within(row(1)).getByText('จำนวนต้องมากกว่า 0')).toBeTruthy();
    expect(savedDraft().lines[0]?.quantity).toBe(10); // the last valid value is untouched

    await user.tab();
    expect(quantity.value).toBe('10');
    expect(within(row(1)).queryByText('จำนวนต้องมากกว่า 0')).toBeNull();
  });

  it('rejects a quantity with more than 3 decimals', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const quantity = screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' });
    await replaceText(user, quantity as HTMLInputElement, '1.2345');
    expect(within(row(1)).getByText('จำนวนมีทศนิยมได้ไม่เกิน 3 ตำแหน่ง')).toBeTruthy();
    expect(savedDraft().lines[0]?.quantity).not.toBe(1.2345);
  });

  it('stores a valid quantity and reprices the line', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const quantity = screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' });
    await user.clear(quantity);
    await user.type(quantity, '2.5');
    expect(savedDraft().lines[0]?.quantity).toBe(2.5);
    expect(within(row(1)).getByText('250.00 บาท')).toBeTruthy();
  });

  it('stores a baht line discount as integer satang', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'ประเภทส่วนลด บรรทัดที่ 1' }), 'amount');
    await user.type(screen.getByRole('textbox', { name: 'ส่วนลด บรรทัดที่ 1' }), '150.5');
    expect(savedDraft().lines[0]?.discount).toEqual({ type: 'amount', satang: 15_050 });
    expect(within(row(1)).getByText('849.50 บาท')).toBeTruthy();
  });

  it('clamps a discount larger than the line so the total never goes negative (Review Focus 5)', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'ประเภทส่วนลด บรรทัดที่ 1' }), 'amount');
    await user.type(screen.getByRole('textbox', { name: 'ส่วนลด บรรทัดที่ 1' }), '5000');
    expect(within(row(1)).getByText('0.00 บาท')).toBeTruthy();
    expect(approveButton().disabled).toBe(false);
  });

  it('rejects a percent discount over 100 without storing it', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'ส่วนลด บรรทัดที่ 1' }), '150');
    expect(within(row(1)).getByText('ส่วนลด ต้องอยู่ระหว่าง 0 ถึง 100%')).toBeTruthy();
    // "1" and "15" were valid on the way; "150" was refused, so 15 is what is stored
    expect(savedDraft().lines[0]?.discount).toEqual({ type: 'percent', value: 15 });
  });

  it('survives amounts too large for computeQuote (no crash, error panel, no approval)', () => {
    const huge = storedCatalog([item('PVC-4', 'ท่อ PVC 4 หุน', 'เส้น', 9_000_000_000_000_000)]);
    seed(buildDraft([L1], huge), huge);
    render(<ReviewScreen />);
    expect(screen.getByText(/คำนวณยอดไม่ได้/)).toBeTruthy();
    expect(approveButton().disabled).toBe(true);
    expect(within(row(1)).getByText('พร้อมใช้')).toBeTruthy(); // the screen is still usable
  });
});

describe('totals', () => {
  it('shows subtotal, VAT with its rate, grand total, withholding, net payable and the amount in words', async () => {
    seed(buildDraft([L1])); // 10 x 100.00 = 1,000.00
    render(<ReviewScreen />);
    const user = userEvent.setup();
    const totals = screen.getByRole('region', { name: 'สรุปยอด' });
    expect(within(totals).getByText('1,000.00 บาท', { selector: '[data-testid="subtotal"]' })).toBeTruthy();
    expect(within(totals).getByText('ภาษีมูลค่าเพิ่ม 7%')).toBeTruthy();
    expect(within(totals).getByText('70.00 บาท', { selector: '[data-testid="vat"]' })).toBeTruthy();
    expect(within(totals).getByText('1,070.00 บาท', { selector: '[data-testid="grand-total"]' })).toBeTruthy();
    expect(within(totals).getByText('หนึ่งพันเจ็ดสิบบาทถ้วน')).toBeTruthy();

    await user.selectOptions(within(totals).getByRole('combobox', { name: 'หัก ณ ที่จ่าย' }), '3');
    expect(savedDraft().whtRatePercent).toBe(3);
    expect(within(totals).getByText('30.00 บาท', { selector: '[data-testid="wht"]' })).toBeTruthy();
    expect(within(totals).getByText('1,040.00 บาท', { selector: '[data-testid="net-payable"]' })).toBeTruthy();
  });

  it('notes when catalog prices already include VAT', () => {
    const stored = storedCatalog(ITEMS, true);
    seed(buildDraft([L1], stored), stored);
    render(<ReviewScreen />);
    const totals = screen.getByRole('region', { name: 'สรุปยอด' });
    expect(within(totals).getByText(/ราคารวม VAT แล้ว/)).toBeTruthy();
    expect(within(totals).getByText('1,000.00 บาท', { selector: '[data-testid="grand-total"]' })).toBeTruthy();
  });

  it('warns that totals are partial while lines are unresolved', () => {
    seed(buildDraft([L1, L2]));
    render(<ReviewScreen />);
    expect(screen.getByText(/ยอดรวมยังไม่ครบ/)).toBeTruthy();
  });
});

describe('customer questions panel', () => {
  it('lists missingInfo with a copy button that copies the questions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard stub; override it after setup.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    seed(buildDraft([L1, L2]));
    render(<ReviewScreen />);

    const panel = screen.getByRole('region', { name: 'คำถามถึงลูกค้า' });
    expect(within(panel).getByText('ข้องอขนาดกี่หุน')).toBeTruthy();
    expect(within(panel).getByText('ส่งที่ไหน')).toBeTruthy();

    await user.click(within(panel).getByRole('button', { name: 'คัดลอก' }));
    expect(writeText).toHaveBeenCalledWith('1. ข้องอขนาดกี่หุน\n2. ส่งที่ไหน');
    expect(await within(panel).findByText('คัดลอกแล้ว')).toBeTruthy();
  });

  it('explains how to copy by hand when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    seed(buildDraft([L1, L2]));
    render(<ReviewScreen />);
    await user.click(screen.getByRole('button', { name: 'คัดลอก' }));
    expect(await screen.findByText(/คัดลอกอัตโนมัติไม่ได้/)).toBeTruthy();
  });

  it('says there is nothing to ask when missingInfo is empty', () => {
    const draft = buildDraft([L1]);
    draft.missingInfo = [];
    seed(draft);
    render(<ReviewScreen />);
    expect(screen.getByText('ไม่มีคำถามถึงลูกค้า')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'คัดลอก' })).toBeNull();
  });
});

describe('catalog changed while a draft is open (Review Focus 4)', () => {
  it('turns a vanished sku red, reprices the others from the new catalog and drops the approval', () => {
    const draft = draftReducer(buildDraft([L1, { ...L1, lineId: 'L2', sku: 'ELB-A', unit: 'ชิ้น', quantity: 2 }]), {
      type: 'approve',
      now: '2026-10-22T10:00:00.000Z',
      catalog: storedCatalog().catalog,
    });
    const newItems = [item('ELB-A', 'ข้องอ 90 องศา 4 หุน', 'ชิ้น', 5_000), item('TAPE-1', 'เทปพันเกลียว', 'ม้วน', 1_500)];
    seed(draft, storedCatalog(newItems)); // storage already holds the NEW catalog

    render(<ReviewScreen />);

    expect(within(row(1)).getByText('ต้องค้นหาสินค้า')).toBeTruthy();
    expect(within(row(2)).getByText('100.00 บาท')).toBeTruthy(); // 2 x 50.00 from the new catalog
    expect(savedDraft().approvedAt).toBeNull();
    expect(approveButton().disabled).toBe(true);
  });
});

describe('unit handling on screen', () => {
  it('explains a dozen request with no quantity and takes the typed number in the catalog unit', async () => {
    seed(buildDraft([{ ...L1, sku: 'ELB-A', unit: 'โหล', quantity: null }]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    expect(within(row(1)).getByText('ลูกค้าระบุเป็น โหล - กรอกจำนวนเป็น ชิ้น')).toBeTruthy();
    expect(within(row(1)).getByText('ต้องกรอกจำนวน')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' }), '2');
    expect(within(row(1)).getByText('พร้อมใช้')).toBeTruthy();
    expect(within(row(1)).getByText('40.00 บาท')).toBeTruthy(); // 2 x 20.00, no x12
  });

  it('keeps the typed quantity when the same product is picked again', async () => {
    seed(buildDraft([{ ...L2, unit: 'โหล', quantity: 2 }]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'เลือกสินค้า บรรทัดที่ 1' }), 'ELB-A');
    expect(savedDraft().lines[0]?.quantity).toBe(24);
    const quantity = screen.getByRole('textbox', { name: 'จำนวน บรรทัดที่ 1' }) as HTMLInputElement;
    await user.type(quantity, '{Backspace}{Backspace}2', { initialSelectionStart: 0, initialSelectionEnd: 2 });
    await user.click(within(row(1)).getByRole('button', { name: 'เปลี่ยนสินค้า' }));
    await user.type(within(row(1)).getByRole('textbox', { name: 'ค้นหาสินค้า บรรทัดที่ 1' }), ' 6 หุน');
    await user.click(within(row(1)).getByRole('button', { name: /เลือก ELB-B/ }));
    expect(savedDraft().lines[0]?.resolvedSku).toBe('ELB-B');
    expect(savedDraft().lines[0]?.quantity).toBe(2);
  });
});

describe('quote number on approval', () => {
  const numberInput = () => screen.getByLabelText('เลขที่ใบเสนอราคา') as HTMLInputElement;
  const counter = () => JSON.parse(window.localStorage.getItem(STORAGE_KEYS.counter) ?? 'null') as unknown;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-22T05:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('assigns the next number from the monthly counter together with the approval', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    expect(numberInput().value).toBe('');
    await userEvent.setup().click(approveButton());
    expect(savedDraft().number).toBe('QT-256910-001');
    expect(savedDraft().approvedAt).not.toBeNull();
    expect(numberInput().value).toBe('QT-256910-001');
    expect(counter()).toEqual({ month: '256910', seq: 1 });
  });

  it('keeps a number the user typed and does not touch the counter', async () => {
    seed({ ...buildDraft([L1]), number: 'MY-001' });
    render(<ReviewScreen />);
    await userEvent.setup().click(approveButton());
    expect(savedDraft().number).toBe('MY-001');
    expect(counter()).toBeNull();
  });

  it('keeps the number when re-approving after an edit, without using up another one', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.click(approveButton());
    await user.type(numberInput(), 'A');
    expect(savedDraft().approvedAt).toBeNull();
    await user.click(approveButton());
    expect(savedDraft().number).toBe('QT-256910-001A');
    expect(counter()).toEqual({ month: '256910', seq: 1 });
  });

  it('unlocks the export buttons only once approved', async () => {
    seed(buildDraft([L1]));
    render(<ReviewScreen />);
    expect((screen.getByRole('button', { name: 'ดาวน์โหลด CSV' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(approveButton());
    expect((screen.getByRole('button', { name: 'ดาวน์โหลด CSV' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'พิมพ์ / บันทึก PDF' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('approval display', () => {
  it('does not show a stale approval (approvedAt set but a line is no longer ready)', () => {
    const draft = buildDraft([L1]);
    draft.approvedAt = '2026-10-22T10:00:00.000Z';
    draft.lines[0]!.quantity = null;
    seed(draft);
    render(<ReviewScreen />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(approveButton().disabled).toBe(true);
  });
});

describe('storage trouble', () => {
  it('warns when the draft cannot be saved but keeps working in memory', async () => {
    const backend = quotaStorage([STORAGE_KEYS.draft]);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: backend });
    resetDefaultStore();
    backend.setItem(STORAGE_KEYS.catalog, JSON.stringify(storedCatalog()));
    // The draft is only in memory: seed through the shared store.
    const { getDefaultStore } = await import('@/lib/storage');
    getDefaultStore().set(STORAGE_KEYS.draft, buildDraft([L1]));

    render(<ReviewScreen />);
    const user = userEvent.setup();
    await user.click(approveButton());
    expect(screen.getByText(/บันทึกในเครื่องไม่ได้/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('อนุมัติแล้ว');
  });
});
