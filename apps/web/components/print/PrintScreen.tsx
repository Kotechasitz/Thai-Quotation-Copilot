'use client';

import Link from 'next/link';
import { QuoteDocument } from '@/components/print/QuoteDocument';
import { Button, buttonVariants } from '@/components/ui/button';
import { DEFAULT_COMPANY } from '@/lib/company';
import { isApproved, toQuotation } from '@/lib/draft';
import { STORAGE_KEYS, useStoredState, type StoredCatalog } from '@/lib/storage';
import { parseCompany, parseStoredCatalog } from '@/lib/stored-schemas';
import { useDraft, useHydrated } from '@/lib/use-draft';

function Notice({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-8">
      <p className="text-zinc-700">{message}</p>
      <p>
        <Link href="/review" className={buttonVariants({ variant: 'outline' })}>
          กลับไปหน้าตรวจแก้ร่าง
        </Link>
      </p>
    </main>
  );
}

/** The print page: shows the quotation only while the saved draft is approved as it is now. */
export function PrintScreen() {
  const isHydrated = useHydrated();
  const { draft } = useDraft();
  const [storedCatalog] = useStoredState<StoredCatalog | null>(STORAGE_KEYS.catalog, null, parseStoredCatalog);
  const [company] = useStoredState(STORAGE_KEYS.company, DEFAULT_COMPANY, parseCompany);
  const catalog = storedCatalog?.catalog ?? null;

  if (!isHydrated) {
    return <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8 text-zinc-600">กำลังโหลด...</main>;
  }
  if (draft === null || catalog === null) {
    return <Notice message="ยังไม่มีร่างใบเสนอราคาในเครื่องนี้ กรุณาสร้างและอนุมัติร่างก่อนพิมพ์" />;
  }
  // Not just `approvedAt !== null`: a stale approval (catalog changed, a line broken) must never print.
  if (!isApproved(draft, catalog)) {
    return <Notice message="ใบเสนอราคานี้ยังไม่ได้อนุมัติ (หรือมีการแก้ไขหลังอนุมัติ) กรุณาตรวจแก้และอนุมัติก่อนพิมพ์" />;
  }

  const quotation = toQuotation(draft, catalog, company);

  return (
    <main className="quote-print">
      <div className="quote-print__toolbar no-print">
        <Button type="button" onClick={() => window.print()}>
          พิมพ์ / บันทึก PDF
        </Button>
        <Link href="/review" className={buttonVariants({ variant: 'outline' })}>
          กลับไปหน้าตรวจแก้ร่าง
        </Link>
      </div>
      <QuoteDocument quotation={quotation} />
    </main>
  );
}
