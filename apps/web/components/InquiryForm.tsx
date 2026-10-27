'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_INQUIRY_CHARS } from '@tqc/core';
import { StorageWarning } from '@/components/StorageWarning';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DEFAULT_COMPANY } from '@/lib/company';
import { bangkokToday } from '@/lib/draft';
import { requestMatch } from '@/lib/match-client';
import { STORAGE_KEYS, useStoredState, type StoredCatalog } from '@/lib/storage';
import { parseCompany, parseStoredCatalog } from '@/lib/stored-schemas';
import { useDraft, useHydrated } from '@/lib/use-draft';

const DRAFT_FAILED = 'สร้างร่างใบเสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

/** The home page's form: paste the customer's message, get a draft quotation to review. */
export function InquiryForm() {
  const router = useRouter();
  const isHydrated = useHydrated();
  const [storedCatalog] = useStoredState<StoredCatalog | null>(STORAGE_KEYS.catalog, null, parseStoredCatalog);
  const [company] = useStoredState(STORAGE_KEYS.company, DEFAULT_COMPANY, parseCompany);
  const { draft, dispatch, persistent, writeFailed } = useDraft();
  const [inquiry, setInquiry] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  // Leaving the page cancels a request still in flight.
  useEffect(() => () => pending.current?.abort(), []);

  const catalog = storedCatalog?.catalog ?? null;
  const isTooLong = inquiry.length > MAX_INQUIRY_CHARS;
  const canSubmit = catalog !== null && inquiry.trim() !== '' && !isTooLong && !isLoading;

  const submit = async () => {
    if (catalog === null || inquiry.trim() === '' || isTooLong || isLoading) return;
    const controller = new AbortController();
    pending.current = controller;
    setIsLoading(true);
    setError(null);
    // Whatever happens below, the button must come back unless we are leaving for the review page.
    let isLeaving = false;
    try {
      const result = await requestMatch(inquiry, catalog, controller.signal);
      if (result.ok) {
        dispatch({
          type: 'loadMatch',
          response: result.data,
          catalog,
          inquiry,
          paymentTerms: company.defaultPaymentTerms,
          issueDate: bangkokToday(),
        });
        isLeaving = true; // stays "loading" until the page changes, so a second click cannot start another request
        router.push('/review');
        return;
      }
      if (result.aborted === true) {
        isLeaving = true; // the page is going away; nothing to reset
        return;
      }
      setError(result.message); // the typed text is kept for the retry
    } catch {
      setError(DRAFT_FAILED);
    } finally {
      if (!isLeaving) setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  if (!isHydrated) return <p className="text-zinc-600">กำลังโหลด...</p>;

  if (catalog === null) {
    return (
      <div className="space-y-3">
        <p className="text-zinc-700">ยังไม่มี catalog สินค้า ต้องนำเข้า catalog ก่อนจึงจะสร้างใบเสนอราคาได้</p>
        <Link href="/catalog" className={buttonVariants()}>
          ไปหน้า Catalog
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <StorageWarning persistent={persistent} writeFailed={writeFailed} />
      <Label htmlFor="inquiry">ข้อความจากลูกค้า</Label>
      <Textarea
        id="inquiry"
        className="min-h-48"
        value={inquiry}
        aria-invalid={isTooLong}
        placeholder="วางข้อความสั่งซื้อจากไลน์ อีเมล หรือแชทของลูกค้าที่นี่"
        onChange={(event) => setInquiry(event.target.value)}
      />
      <div className="flex items-center justify-between text-sm text-zinc-600">
        <span className={isTooLong ? 'font-medium text-red-600' : undefined}>{`${inquiry.length}/${MAX_INQUIRY_CHARS}`}</span>
        <span>catalog: {storedCatalog?.sourceName} ({storedCatalog?.rowCount} รายการ)</span>
      </div>

      {isTooLong && (
        <p role="alert" className="text-sm text-red-600">
          {`ข้อความยาวเกิน ${MAX_INQUIRY_CHARS.toLocaleString('en-US')} ตัวอักษร (${String(inquiry.length)}) — ตัดให้สั้นลงก่อนส่ง`}
        </p>
      )}

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void submit()}>
              ลองใหม่
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {isLoading ? 'กำลังสร้างร่างใบเสนอราคา...' : 'สร้างร่างใบเสนอราคา'}
        </Button>
        {draft !== null && (
          <Link href="/review" className={buttonVariants({ variant: 'outline' })}>
            กลับไปร่างล่าสุด
          </Link>
        )}
      </div>
    </form>
  );
}
