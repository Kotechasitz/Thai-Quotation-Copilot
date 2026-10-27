import { describe, expect, it } from 'vitest';
import {
  bahtText,
  computeQuote,
  toCsv,
  toJson,
  type Discount,
  type Quotation,
  type QuoteLine,
  type WhtRate,
} from '../src/index.ts';

function line(over: Partial<QuoteLine> = {}): QuoteLine {
  return {
    lineId: 'l1',
    sku: 'P-001',
    name: 'ท่อ PVC 4 หุน',
    unit: 'เส้น',
    quantity: 10,
    unitPriceSatang: 12500,
    discount: null,
    ...over,
  };
}

function quote(
  over: {
    lines?: QuoteLine[];
    billDiscount?: Discount | null;
    vatRatePercent?: number;
    pricesIncludeVat?: boolean;
    whtRatePercent?: WhtRate;
  } = {},
): Quotation {
  const lines = over.lines ?? [line()];
  const billDiscount = over.billDiscount ?? null;
  const vatRatePercent = over.vatRatePercent ?? 7;
  const pricesIncludeVat = over.pricesIncludeVat ?? false;
  const whtRatePercent = over.whtRatePercent ?? 0;
  return {
    schemaVersion: 1,
    number: 'QT-256910-001',
    issueDate: '2026-10-22',
    validUntil: '2026-11-21',
    company: {
      name: 'บริษัท ตัวอย่างวัสดุ จำกัด',
      address: '1 ถนนตัวอย่าง กรุงเทพฯ',
      taxId: '0000000000000',
      phone: '02-000-0000',
      logoDataUrl: null,
      defaultPaymentTerms: 'ชำระภายใน 30 วัน',
      defaultValidityDays: 30,
    },
    customer: { name: 'คุณตัวอย่าง', company: null, contact: null },
    lines,
    billDiscount,
    vatRatePercent,
    pricesIncludeVat,
    whtRatePercent,
    paymentTerms: 'ชำระภายใน 30 วัน',
    notes: '',
    totals: computeQuote({
      lines: lines.map((l) => ({
        unitPriceSatang: l.unitPriceSatang,
        quantity: l.quantity,
        discount: l.discount,
      })),
      billDiscount,
      vatRatePercent,
      pricesIncludeVat,
      whtRatePercent,
    }),
    approvedAt: null,
  };
}

const HEADER = 'ลำดับ,รหัสสินค้า,รายการ,จำนวน,หน่วย,ราคาต่อหน่วย,ส่วนลด,จำนวนเงิน';

function rows(csv: string): string[] {
  expect(csv.startsWith('﻿')).toBe(true);
  return csv.slice(1).split('\r\n');
}

describe('toCsv', () => {
  it('starts with a BOM, has the header, and uses CRLF line endings', () => {
    const csv = toCsv(quote());
    expect(csv.startsWith('﻿')).toBe(true);
    expect(rows(csv)[0]).toBe(HEADER);
    expect(csv.includes('\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('writes item rows with quoted formatBaht values (only those containing commas) and plain quantity', () => {
    const r = rows(toCsv(quote()));
    // 10 x 125.00 = 1,250.00
    expect(r[1]).toBe('1,P-001,ท่อ PVC 4 หุน,10,เส้น,125.00,,"1,250.00"');
  });

  it('prints fractional quantity without trailing zeros', () => {
    const r = rows(toCsv(quote({ lines: [line({ quantity: 2.5 }), line({ quantity: 1.125 })] })));
    expect(r[1]?.split(',')[3]).toBe('2.5');
    expect(r[2]?.split(',')[3]).toBe('1.125');
  });

  it('prints line discounts: percent as N%, amount as baht, none empty', () => {
    const r = rows(
      toCsv(
        quote({
          lines: [
            line({ discount: { type: 'percent', value: 10 } }),
            line({ discount: { type: 'amount', satang: 10000 } }),
            line({ discount: null }),
          ],
        }),
      ),
    );
    expect(r[1]).toContain(',10%,');
    expect(r[2]).toContain(',100.00,');
    // net of the first line: 1,250.00 - 125.00 = 1,125.00
    expect(r[1]?.endsWith(',"1,125.00"')).toBe(true);
    expect(r[3]).toBe('3,P-001,ท่อ PVC 4 หุน,10,เส้น,125.00,,"1,250.00"');
  });

  it('quotes and escapes names containing commas and double quotes', () => {
    const csv = toCsv(quote({ lines: [line({ name: 'ท่อ, "พิเศษ" 4 หุน' })] }));
    expect(csv).toContain('"ท่อ, ""พิเศษ"" 4 หุน"');
  });

  it('quotes fields containing newlines', () => {
    const csv = toCsv(quote({ lines: [line({ name: 'บรรทัด1\nบรรทัด2' })] }));
    expect(csv).toContain('"บรรทัด1\nบรรทัด2"');
  });

  it('appends summary rows in order for a plain 7% VAT quote', () => {
    const q = quote();
    const r = rows(toCsv(q));
    // subtotal 125000, vat 8750, grand 133750; the pre-VAT base is always shown
    expect(r.slice(2)).toEqual([
      ',,รวมเป็นเงิน,,,,,"1,250.00"',
      ',,มูลค่าก่อนภาษีมูลค่าเพิ่ม,,,,,"1,250.00"',
      ',,ภาษีมูลค่าเพิ่ม 7%,,,,,87.50',
      ',,ยอดรวมทั้งสิ้น,,,,,"1,337.50"',
      `,,ตัวอักษร,,,,,${bahtText(q.totals.grandTotalSatang)}`,
    ]);
  });

  it('includes the bill-discount rows (negative, then the after-discount amount) only when it is > 0', () => {
    const withDisc = rows(toCsv(quote({ billDiscount: { type: 'amount', satang: 5000 } })));
    expect(withDisc).toContain(',,ส่วนลดท้ายบิล,,,,,-50.00');
    expect(withDisc).toContain(',,ยอดหลังหักส่วนลด,,,,,"1,200.00"');
    const zero = rows(toCsv(quote({ billDiscount: { type: 'amount', satang: 0 } })));
    expect(zero.some((x) => x.includes('ส่วนลดท้ายบิล'))).toBe(false);
    expect(zero.some((x) => x.includes('ยอดหลังหักส่วนลด'))).toBe(false);
    const none = rows(toCsv(quote()));
    expect(none.some((x) => x.includes('ส่วนลดท้ายบิล'))).toBe(false);
  });

  it('includes withholding rows only when whtRatePercent > 0 (WHT shown negative)', () => {
    const none = rows(toCsv(quote({ whtRatePercent: 0 })));
    expect(none.some((x) => x.includes('หัก ณ ที่จ่าย'))).toBe(false);
    expect(none.some((x) => x.includes('ยอดชำระสุทธิ'))).toBe(false);

    const q = quote({ whtRatePercent: 3 });
    const r = rows(toCsv(q));
    // wht = 3% of 125000 = 3750; net payable = 133750 - 3750 = 130000
    expect(r.slice(2)).toEqual([
      ',,รวมเป็นเงิน,,,,,"1,250.00"',
      ',,มูลค่าก่อนภาษีมูลค่าเพิ่ม,,,,,"1,250.00"',
      ',,ภาษีมูลค่าเพิ่ม 7%,,,,,87.50',
      ',,ยอดรวมทั้งสิ้น,,,,,"1,337.50"',
      ',,หัก ณ ที่จ่าย 3%,,,,,-37.50',
      ',,ยอดชำระสุทธิ,,,,,"1,300.00"',
      `,,ตัวอักษร,,,,,${bahtText(q.totals.grandTotalSatang)}`,
    ]);
  });

  it('reconciles an inclusive-price quote with bill discount and withholding tax', () => {
    // lines 10,700.00 inclusive, bill discount 100.00 -> 10,600.00 incl. VAT; base 9,906.54, VAT 693.46
    const q = quote({
      lines: [line({ quantity: 1, unitPriceSatang: 1_070_000 })],
      billDiscount: { type: 'amount', satang: 10_000 },
      pricesIncludeVat: true,
      whtRatePercent: 3,
    });
    const r = rows(toCsv(q));
    expect(r.slice(2)).toEqual([
      ',,รวมเป็นเงิน,,,,,"10,700.00"',
      ',,ส่วนลดท้ายบิล,,,,,-100.00',
      ',,ยอดหลังหักส่วนลด,,,,,"10,600.00"',
      ',,มูลค่าก่อนภาษีมูลค่าเพิ่ม,,,,,"9,906.54"',
      ',,ภาษีมูลค่าเพิ่ม 7% (รวมอยู่ในราคาแล้ว),,,,,693.46',
      ',,ยอดรวมทั้งสิ้น,,,,,"10,600.00"',
      ',,หัก ณ ที่จ่าย 3%,,,,,-297.20',
      ',,ยอดชำระสุทธิ,,,,,"10,302.80"',
      `,,ตัวอักษร,,,,,${bahtText(1_060_000)}`,
    ]);
  });

  it('prints a fractional VAT rate as-is and still prints VAT when prices include VAT', () => {
    const r = rows(toCsv(quote({ vatRatePercent: 7.5, pricesIncludeVat: true })));
    expect(r.some((x) => x.startsWith(',,ภาษีมูลค่าเพิ่ม 7.5% (รวมอยู่ในราคาแล้ว),'))).toBe(true);
  });

  it('writes the baht text in the amount column', () => {
    const q = quote();
    const csv = toCsv(q);
    expect(csv).toContain(bahtText(q.totals.grandTotalSatang));
  });

  it('reads money from q.totals, not by recomputing', () => {
    const q = quote();
    q.totals = { ...q.totals, subtotalSatang: 99900 };
    expect(toCsv(q)).toContain(',,รวมเป็นเงิน,,,,,999.00');
  });
});

describe('toJson', () => {
  it('round-trips and carries schemaVersion 1', () => {
    const q = quote({ whtRatePercent: 3, billDiscount: { type: 'percent', value: 5 } });
    const parsed = JSON.parse(toJson(q));
    expect(parsed).toEqual(q);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('is pretty-printed with 2-space indent', () => {
    expect(toJson(quote())).toContain('\n  "schemaVersion": 1');
  });
});
