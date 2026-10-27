import { bahtText, formatBaht, formatThaiDate, type Discount, type Quotation } from '@tqc/core';

interface QuoteDocumentProps {
  quotation: Quotation;
}

const COLUMNS = ['ลำดับ', 'รหัสสินค้า', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ส่วนลด', 'จำนวนเงิน'] as const;
const NUMERIC_COLUMNS: ReadonlySet<string> = new Set(['จำนวน', 'ราคาต่อหน่วย', 'ส่วนลด', 'จำนวนเงิน']);

/** Dates are ISO calendar dates; one that cannot be formatted is shown as written rather than crash the page. */
function thaiDate(iso: string): string {
  try {
    return formatThaiDate(iso);
  } catch {
    return iso;
  }
}

/** Plain number, up to 3 decimals, no trailing zeros. */
const formatQuantity = (quantity: number): string => String(Number(quantity.toFixed(3)));

function formatDiscount(discount: Discount | null): string {
  if (discount === null) return '';
  return discount.type === 'percent' ? `${String(discount.value)}%` : formatBaht(discount.satang);
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'quote-doc__sum-row quote-doc__sum-row--strong' : 'quote-doc__sum-row'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SignatureBlock({ title }: { title: string }) {
  return (
    <div className="quote-doc__signature">
      <div className="quote-doc__signature-line" />
      <p className="quote-doc__signature-title">{title}</p>
      <p>วันที่ ......../......../............</p>
    </div>
  );
}

/**
 * The printable quotation (A4). Pure: it only draws the Quotation it is given, so the caller is responsible for
 * passing one that is approved. The table header is a real thead so browsers repeat it on every printed page.
 */
export function QuoteDocument({ quotation: q }: QuoteDocumentProps) {
  const t = q.totals;
  const customerLines = [q.customer.name, q.customer.company, q.customer.contact].filter(
    (v): v is string => v !== null && v.trim() !== '',
  );

  return (
    <article aria-label="ใบเสนอราคา" className="quote-doc">
      <header className="quote-doc__header">
        {q.company.logoDataUrl !== null && (
          // A user-supplied data URL: next/image cannot optimise it, and print needs the plain image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.company.logoDataUrl} alt={`โลโก้ ${q.company.name}`} className="quote-doc__logo" />
        )}
        <div className="quote-doc__company">
          <p className="quote-doc__company-name">{q.company.name}</p>
          <p>{q.company.address}</p>
          <p>เลขประจำตัวผู้เสียภาษี {q.company.taxId}</p>
          <p>โทร {q.company.phone}</p>
        </div>
        <div className="quote-doc__title">
          <h1>ใบเสนอราคา</h1>
          <p>เลขที่ {q.number}</p>
          <p>วันที่ {thaiDate(q.issueDate)}</p>
          <p>ยืนราคาถึง {thaiDate(q.validUntil)}</p>
        </div>
      </header>

      <section className="quote-doc__customer" aria-label="ข้อมูลลูกค้า">
        <p className="quote-doc__label">เสนอราคาถึง</p>
        {customerLines.length === 0 ? <p>-</p> : customerLines.map((text) => <p key={text}>{text}</p>)}
      </section>

      <table className="quote-doc__table">
        <thead>
          <tr>
            {COLUMNS.map((name) => (
              <th key={name} scope="col" className={NUMERIC_COLUMNS.has(name) ? 'is-number' : undefined}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.lines.map((line, i) => (
            <tr key={line.lineId}>
              <td>{i + 1}</td>
              <td>{line.sku}</td>
              <td>{line.name}</td>
              <td className="is-number">{formatQuantity(line.quantity)}</td>
              <td>{line.unit}</td>
              <td className="is-number">{formatBaht(line.unitPriceSatang)}</td>
              <td className="is-number">{formatDiscount(line.discount)}</td>
              <td className="is-number">{formatBaht(t.lines[i]?.netSatang ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="quote-doc__totals">
        <dl className="quote-doc__summary">
          <SummaryRow label="รวมเป็นเงิน" value={formatBaht(t.subtotalSatang)} />
          {t.billDiscountSatang > 0 && <SummaryRow label="ส่วนลดท้ายบิล" value={`-${formatBaht(t.billDiscountSatang)}`} />}
          <SummaryRow
            label={`ภาษีมูลค่าเพิ่ม ${String(q.vatRatePercent)}%${q.pricesIncludeVat ? ' (ราคารวม VAT แล้ว)' : ''}`}
            value={formatBaht(t.vatSatang)}
          />
          <SummaryRow label="ยอดรวมทั้งสิ้น" value={formatBaht(t.grandTotalSatang)} strong />
          {q.whtRatePercent > 0 && (
            <>
              <SummaryRow label={`หัก ณ ที่จ่าย ${String(q.whtRatePercent)}%`} value={formatBaht(t.whtSatang)} />
              <SummaryRow label="ยอดชำระสุทธิ" value={formatBaht(t.netPayableSatang)} strong />
            </>
          )}
        </dl>
      </div>

      <p className="quote-doc__words">({bahtText(t.grandTotalSatang)})</p>

      {q.paymentTerms.trim() !== '' && (
        <section className="quote-doc__block" aria-label="เงื่อนไขการชำระเงิน">
          <p className="quote-doc__label">เงื่อนไขการชำระเงิน</p>
          <p>{q.paymentTerms}</p>
        </section>
      )}
      {q.notes.trim() !== '' && (
        <section className="quote-doc__block" aria-label="หมายเหตุ">
          <p className="quote-doc__label">หมายเหตุ</p>
          <p className="quote-doc__notes">{q.notes}</p>
        </section>
      )}

      <div className="quote-doc__signatures">
        <SignatureBlock title="ผู้เสนอราคา" />
        <SignatureBlock title="ผู้อนุมัติ" />
      </div>
    </article>
  );
}
