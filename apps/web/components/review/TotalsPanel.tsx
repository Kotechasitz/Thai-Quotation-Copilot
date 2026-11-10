'use client';

import { bahtText, formatBaht, type Catalog, type WhtRate } from '@tqc/core';
import { DecimalInput } from '@/components/review/DecimalInput';
import { DiscountInput } from '@/components/review/DiscountInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import type { Draft, DraftAction, PreviewQuote } from '@/lib/draft';
import { parsePercent, type ParseResult } from '@/lib/draft-input';

const WHT_RATES: readonly WhtRate[] = [0, 1, 2, 3, 5];

interface TotalsPanelProps {
  draft: Draft;
  catalog: Catalog;
  preview: PreviewQuote;
  dispatch: (action: DraftAction) => void;
}

const baht = (satang: number): string => `${formatBaht(satang)} บาท`;

/** A blank VAT rate is not "no VAT" - it is a missing value, so it is refused like any other bad text. */
function parseVatRate(text: string): ParseResult<number | null> {
  const result = parsePercent(text, 'อัตรา VAT');
  return result.ok && result.value === null ? { ok: false, error: 'กรุณากรอก อัตรา VAT' } : result;
}

function Row({ label, testId, value, strong = false }: { label: string; testId: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-4 border-t border-dashed pt-2 text-base font-semibold' : 'flex justify-between gap-4 text-sm'}>
      <dt>{label}</dt>
      <dd data-testid={testId} className="font-mono tabular-nums">
        {value}
      </dd>
    </div>
  );
}

export function TotalsPanel({ draft, catalog, preview, dispatch }: TotalsPanelProps) {
  return (
    <section aria-label="สรุปยอด" className="surface space-y-4 p-5">
      <h2 className="eyebrow">สรุปยอด</h2>

      <div className="grid gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">ส่วนลดท้ายบิล</p>
          <DiscountInput
            label="ส่วนลดท้ายบิล"
            typeLabel="ประเภทส่วนลดท้ายบิล"
            value={draft.billDiscount}
            onChange={(billDiscount) => dispatch({ type: 'setBill', patch: { billDiscount } })}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">อัตรา VAT (%)</p>
          <DecimalInput
            label="อัตรา VAT (%)"
            value={draft.vatRatePercent}
            format={String}
            parse={parseVatRate}
            onCommit={(value) => {
              if (value !== null) dispatch({ type: 'setBill', patch: { vatRatePercent: value } });
            }}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">หัก ณ ที่จ่าย</p>
          <NativeSelect
            aria-label="หัก ณ ที่จ่าย"
            value={String(draft.whtRatePercent)}
            onChange={(event) =>
              dispatch({ type: 'setBill', patch: { whtRatePercent: Number(event.target.value) as WhtRate } })
            }
          >
            {WHT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 0 ? '0% (ไม่หัก)' : `${rate}%`}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {!preview.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : (
        <>
          {preview.skippedLines > 0 && (
            <p className="text-sm text-yellow-900">
              ยอดรวมยังไม่ครบ: อีก {preview.skippedLines} บรรทัดยังไม่พร้อม จึงยังไม่ถูกนับ
            </p>
          )}
          <dl className="space-y-1.5">
            <Row label="รวมเป็นเงิน" testId="subtotal" value={baht(preview.totals.subtotalSatang)} />
            <Row
              label="ส่วนลดท้ายบิล"
              testId="bill-discount"
              value={preview.totals.billDiscountSatang > 0 ? `-${baht(preview.totals.billDiscountSatang)}` : baht(0)}
            />
            <Row label={`ภาษีมูลค่าเพิ่ม ${draft.vatRatePercent}%`} testId="vat" value={baht(preview.totals.vatSatang)} />
            <Row label="ยอดรวมทั้งสิ้น" testId="grand-total" value={baht(preview.totals.grandTotalSatang)} strong />
            <Row
              label={`หัก ณ ที่จ่าย ${draft.whtRatePercent}%`}
              testId="wht"
              value={baht(preview.totals.whtSatang)}
            />
            <Row label="ยอดชำระสุทธิ" testId="net-payable" value={baht(preview.totals.netPayableSatang)} strong />
          </dl>
          {catalog.pricesIncludeVat && (
            <p className="text-xs text-muted-foreground">
              ราคารวม VAT แล้ว (ราคาใน catalog รวมภาษีมูลค่าเพิ่ม ฐานภาษี {baht(preview.totals.vatBaseSatang)})
            </p>
          )}
          <p className="text-sm">{bahtText(preview.totals.grandTotalSatang)}</p>
        </>
      )}
    </section>
  );
}
