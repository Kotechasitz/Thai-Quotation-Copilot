'use client';

import { toCsv, toJson, type Catalog, type CompanyProfile } from '@tqc/core';
import { Button } from '@/components/ui/button';
import { downloadText } from '@/lib/download';
import { isApproved, toQuotation, type Draft } from '@/lib/draft';

interface ExportBarProps {
  draft: Draft;
  catalog: Catalog;
  company: CompanyProfile;
}

export const PRINT_PATH = '/quote/print';

/** Export buttons for the review screen. Everything is gated on the draft being approved as it is right now. */
export function ExportBar({ draft, catalog, company }: ExportBarProps) {
  const approved = isApproved(draft, catalog);
  const baseName = draft.number.trim() === '' ? 'quotation' : draft.number.trim();

  const handleCsvClick = () =>
    downloadText(`${baseName}.csv`, toCsv(toQuotation(draft, catalog, company)), 'text/csv;charset=utf-8');
  const handleJsonClick = () =>
    downloadText(`${baseName}.json`, toJson(toQuotation(draft, catalog, company)), 'application/json;charset=utf-8');
  const handlePrintClick = () => window.open(PRINT_PATH, '_blank');

  return (
    <section aria-label="ส่งออกเอกสาร" className="space-y-2 surface p-4">
      <h2 className="text-base font-semibold">ส่งออกเอกสาร</h2>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!approved} onClick={handleCsvClick}>
          ดาวน์โหลด CSV
        </Button>
        <Button type="button" variant="outline" disabled={!approved} onClick={handleJsonClick}>
          ดาวน์โหลด JSON
        </Button>
        <Button type="button" disabled={!approved} onClick={handlePrintClick}>
          พิมพ์ / บันทึก PDF
        </Button>
      </div>
      {!approved && <p className="text-sm text-muted-foreground">อนุมัติใบเสนอราคาก่อน จึงจะดาวน์โหลดหรือพิมพ์ได้</p>}
    </section>
  );
}
