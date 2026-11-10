'use client';

import { formatThaiDate } from '@tqc/core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { addDays, type Draft, type DraftAction } from '@/lib/draft';

interface QuoteDetailsProps {
  draft: Draft;
  validityDays: number;
  dispatch: (action: DraftAction) => void;
}

/** A hand-edited draft could hold an impossible date; show it as-is rather than crash the screen. */
function thaiDate(iso: string): string {
  try {
    return formatThaiDate(iso);
  } catch {
    return iso;
  }
}

const orNull = (text: string): string | null => (text === '' ? null : text);

/** Customer and document fields. The AI fills the customer in; the number is filled in later and stays editable. */
export function QuoteDetails({ draft, validityDays, dispatch }: QuoteDetailsProps) {
  const setCustomer = (field: 'name' | 'company' | 'contact', text: string) =>
    dispatch({ type: 'setBill', patch: { customer: { ...draft.customer, [field]: orNull(text) } } });

  return (
    <section aria-labelledby="quote-details-heading" className="space-y-3 surface p-4">
      <h2 id="quote-details-heading" className="text-base font-semibold">
        ข้อมูลลูกค้าและเอกสาร
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="customer-name">ชื่อลูกค้า</Label>
          <Input id="customer-name" value={draft.customer.name ?? ''} onChange={(e) => setCustomer('name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="customer-company">บริษัทลูกค้า</Label>
          <Input
            id="customer-company"
            value={draft.customer.company ?? ''}
            onChange={(e) => setCustomer('company', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="customer-contact">ช่องทางติดต่อ</Label>
          <Input
            id="customer-contact"
            value={draft.customer.contact ?? ''}
            onChange={(e) => setCustomer('contact', e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="quote-number">เลขที่ใบเสนอราคา</Label>
          <Input
            id="quote-number"
            value={draft.number}
            onChange={(e) => dispatch({ type: 'setBill', patch: { number: e.target.value } })}
          />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">วันที่</p>
          <p>{thaiDate(draft.issueDate)}</p>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">ยืนราคาถึง</p>
          <p>{thaiDate(addDays(draft.issueDate, validityDays))}</p>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="payment-terms">เงื่อนไขการชำระเงิน</Label>
        <Input
          id="payment-terms"
          value={draft.paymentTerms}
          onChange={(e) => dispatch({ type: 'setBill', patch: { paymentTerms: e.target.value } })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="quote-notes">หมายเหตุ</Label>
        <Textarea
          id="quote-notes"
          className="min-h-16"
          value={draft.notes}
          onChange={(e) => dispatch({ type: 'setBill', patch: { notes: e.target.value } })}
        />
      </div>
    </section>
  );
}
