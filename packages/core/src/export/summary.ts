import { formatBaht } from '../pricing/money.ts';
import type { Quotation } from '../quote/model.ts';

export interface SummaryRow {
  label: string;
  /** Already formatted; deductions carry a leading minus sign. */
  value: string;
  strong: boolean;
}

/** A deduction, shown with a leading minus so the column adds up for the reader. */
const negative = (satang: number): string => `-${formatBaht(satang)}`;

/**
 * The totals block of a quotation, in the order it is read. Shared by the CSV export and the printed document so the
 * two can never disagree on rows, order, labels or signs. All amounts come from `q.totals`; nothing is recomputed.
 */
export function summaryRows(q: Quotation): SummaryRow[] {
  const t = q.totals;
  const rows: SummaryRow[] = [{ label: 'รวมเป็นเงิน', value: formatBaht(t.subtotalSatang), strong: false }];
  if (t.billDiscountSatang > 0) {
    rows.push({ label: 'ส่วนลดท้ายบิล', value: negative(t.billDiscountSatang), strong: false });
    rows.push({ label: 'ยอดหลังหักส่วนลด', value: formatBaht(t.afterDiscountSatang), strong: false });
  }
  rows.push({ label: 'มูลค่าก่อนภาษีมูลค่าเพิ่ม', value: formatBaht(t.vatBaseSatang), strong: false });
  rows.push({
    label: `ภาษีมูลค่าเพิ่ม ${String(q.vatRatePercent)}%${q.pricesIncludeVat ? ' (รวมอยู่ในราคาแล้ว)' : ''}`,
    value: formatBaht(t.vatSatang),
    strong: false,
  });
  rows.push({ label: 'ยอดรวมทั้งสิ้น', value: formatBaht(t.grandTotalSatang), strong: true });
  if (q.whtRatePercent > 0) {
    rows.push({ label: `หัก ณ ที่จ่าย ${String(q.whtRatePercent)}%`, value: negative(t.whtSatang), strong: false });
    rows.push({ label: 'ยอดชำระสุทธิ', value: formatBaht(t.netPayableSatang), strong: true });
  }
  return rows;
}
