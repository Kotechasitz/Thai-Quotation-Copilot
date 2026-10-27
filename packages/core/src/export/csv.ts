import { bahtText } from '../pricing/bahtText.ts';
import type { Discount } from '../pricing/compute.ts';
import { formatBaht } from '../pricing/money.ts';
import type { Quotation } from '../quote/model.ts';

const BOM = '﻿';
const EOL = '\r\n';
const HEADER = ['ลำดับ', 'รหัสสินค้า', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'จำนวนเงิน'];

/** RFC 4180: quote when the field contains a comma, quote, CR or LF; double inner quotes. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function record(fields: string[]): string {
  return fields.map(field).join(',');
}

/** Plain number, up to 3 decimals, no trailing zeros. */
function formatQuantity(quantity: number): string {
  return String(Number(quantity.toFixed(3)));
}

function formatDiscount(discount: Discount | null): string {
  if (discount === null) return '';
  return discount.type === 'percent' ? `${String(discount.value)}%` : formatBaht(discount.satang);
}

function summary(label: string, amount: string): string {
  return record(['', '', label, '', '', '', '', amount]);
}

export function toCsv(q: Quotation): string {
  const t = q.totals;
  const out: string[] = [record(HEADER)];

  q.lines.forEach((l, i) => {
    out.push(
      record([
        String(i + 1),
        l.sku,
        l.name,
        formatQuantity(l.quantity),
        l.unit,
        formatBaht(l.unitPriceSatang),
        formatDiscount(l.discount),
        formatBaht(t.lines[i]?.netSatang ?? 0),
      ]),
    );
  });

  out.push(summary('รวม', formatBaht(t.subtotalSatang)));
  if (t.billDiscountSatang > 0) {
    out.push(summary('ส่วนลดท้ายบิล', formatBaht(t.billDiscountSatang)));
  }
  out.push(summary(`ภาษีมูลค่าเพิ่ม ${String(q.vatRatePercent)}%`, formatBaht(t.vatSatang)));
  out.push(summary('ยอดรวมทั้งสิ้น', formatBaht(t.grandTotalSatang)));
  if (q.whtRatePercent > 0) {
    out.push(summary(`หัก ณ ที่จ่าย ${String(q.whtRatePercent)}%`, formatBaht(t.whtSatang)));
    out.push(summary('ยอดชำระสุทธิ', formatBaht(t.netPayableSatang)));
  }
  out.push(summary('ตัวอักษร', bahtText(t.grandTotalSatang)));

  return BOM + out.join(EOL);
}
