'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { CustomerQuestions } from '@/components/review/CustomerQuestions';
import { ExportBar } from '@/components/review/ExportBar';
import { QuoteDetails } from '@/components/review/QuoteDetails';
import { ReviewTable } from '@/components/review/ReviewTable';
import { TotalsPanel } from '@/components/review/TotalsPanel';
import { PageHeader } from '@/components/PageHeader';
import { StorageWarning } from '@/components/StorageWarning';
import { Button, buttonVariants } from '@/components/ui/button';
import { DEFAULT_COMPANY } from '@/lib/company';
import { canApprove, catalogKey, isApproved, lineState, previewQuote } from '@/lib/draft';
import { nextQuoteNumber } from '@/lib/quoteNumber';
import { STORAGE_KEYS, getDefaultStore, useStoredState, type StoredCatalog } from '@/lib/storage';
import { parseCompany, parseStoredCatalog } from '@/lib/stored-schemas';
import { useDraft, useHydrated } from '@/lib/use-draft';

const DRAFT_NOT_SAVED = 'ร่างใบเสนอราคาบันทึกในเครื่องไม่ได้ ข้อมูลจะหายเมื่อปิดหน้า';

function formatApprovedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // approvedAt is a timestamp (not a calendar date), so it goes through Intl, never formatThaiDate.
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function EmptyState({ message, href, linkLabel }: { message: string; href: string; linkLabel: string }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-10 sm:px-6">
      <p className="text-muted-foreground">{message}</p>
      <p>
        <Link href={href} className={buttonVariants({ variant: 'outline' })}>
          {linkLabel}
        </Link>
      </p>
    </main>
  );
}

/** Review a draft quotation: fix every yellow/red/grey line, check the totals, then approve. */
export function ReviewScreen() {
  const isHydrated = useHydrated();
  const { draft, dispatch, persistent, writeFailed } = useDraft();
  const [storedCatalog] = useStoredState<StoredCatalog | null>(STORAGE_KEYS.catalog, null, parseStoredCatalog);
  const [company] = useStoredState(STORAGE_KEYS.company, DEFAULT_COMPANY, parseCompany);
  const catalog = storedCatalog?.catalog ?? null;

  // Synchronise the draft with the catalog in storage: another tab (or the catalog page) may have replaced it.
  const currentCatalogKey = useMemo(() => (catalog === null ? null : catalogKey(catalog)), [catalog]);
  const draftCatalogKey = draft?.catalogKey ?? null;
  useEffect(() => {
    if (catalog !== null && draftCatalogKey !== null && currentCatalogKey !== draftCatalogKey) {
      dispatch({ type: 'catalogChanged', catalog });
    }
  }, [catalog, currentCatalogKey, draftCatalogKey, dispatch]);

  const preview = useMemo(
    () => (draft === null || catalog === null ? null : previewQuote(draft, catalog)),
    [draft, catalog],
  );

  if (!isHydrated) {
    return <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 text-muted-foreground sm:px-6">กำลังโหลด...</main>;
  }
  if (draft === null) {
    return <EmptyState message="ยังไม่มีร่างใบเสนอราคา วางข้อความจากลูกค้าที่หน้าแรกเพื่อเริ่มสร้างร่าง" href="/" linkLabel="กลับไปหน้าแรก" />;
  }
  if (catalog === null || preview === null) {
    return (
      <EmptyState
        message="ไม่พบ catalog สินค้าในเครื่องนี้ จึงตรวจแก้ร่างไม่ได้ กรุณานำเข้า catalog อีกครั้ง"
        href="/catalog"
        linkLabel="ไปหน้า Catalog"
      />
    );
  }

  const notReady = draft.lines.filter((l) => lineState(l, catalog) !== 'ok').length;
  const isApprovable = canApprove(draft, catalog);
  // Not just `approvedAt !== null`: a stale approval (catalog changed, line broken) must never show as approved.
  const approved = isApproved(draft, catalog);
  const lineTotals = preview.ok ? preview.lineTotals : new Map<string, number>();

  const handleApproveClick = () => {
    const now = new Date();
    // A number is only drawn from the counter when the field is blank: re-approving keeps the existing one.
    const number = draft.number.trim() === '' ? nextQuoteNumber(getDefaultStore(), now) : undefined;
    dispatch({ type: 'approve', now: now.toISOString(), catalog, number });
  };

  const readyCount = draft.lines.length - notReady;

  const approvalBox = (
    <div className="surface flex flex-wrap items-center gap-3 p-4">
      {!approved ? (
        <Button type="button" size="lg" className="h-10 w-full font-semibold" disabled={!isApprovable} onClick={handleApproveClick}>
          อนุมัติ
        </Button>
      ) : (
        <>
          <Button type="button" variant="outline" disabled>
            อนุมัติแล้ว
          </Button>
          <p role="status" className="text-sm text-green-800">
            อนุมัติแล้วเมื่อ {formatApprovedAt(draft.approvedAt as string)} (เมื่อแก้ไข จะยกเลิกการอนุมัติ)
          </p>
        </>
      )}
      {!approved && !isApprovable && (
        <p className="text-sm text-muted-foreground">
          {notReady > 0
            ? `ยังมี ${notReady} บรรทัดที่ต้องแก้ก่อนอนุมัติ`
            : draft.lines.length === 0
              ? 'ต้องมีสินค้าอย่างน้อย 1 บรรทัดจึงจะอนุมัติได้'
              : 'ตรวจสอบจำนวนและส่วนลดอีกครั้งก่อนอนุมัติ'}
        </p>
      )}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="ขั้นที่ 2 จาก 3"
        title="ตรวจแก้ร่างใบเสนอราคา"
        description={draft.number.trim() === '' ? undefined : <p className="font-mono text-sm">{draft.number}</p>}
        aside={
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">
              พร้อมใช้ {readyCount}
            </span>
            {notReady > 0 && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">
                ต้องแก้ {notReady}
              </span>
            )}
          </div>
        }
      />
      <StorageWarning persistent={persistent} writeFailed={writeFailed} writeFailedMessage={DRAFT_NOT_SAVED} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <details className="surface px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">ข้อความต้นฉบับจากลูกค้า</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{draft.inquiry}</p>
          </details>
          <ReviewTable draft={draft} catalog={catalog} lineTotals={lineTotals} dispatch={dispatch} />
          <CustomerQuestions missingInfo={draft.missingInfo} lines={draft.lines} />
          <QuoteDetails draft={draft} validityDays={company.defaultValidityDays} dispatch={dispatch} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <TotalsPanel draft={draft} catalog={catalog} preview={preview} dispatch={dispatch} />
          {approvalBox}
          <ExportBar draft={draft} catalog={catalog} company={company} />
        </aside>
      </div>
    </main>
  );
}
