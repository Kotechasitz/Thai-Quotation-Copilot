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
import { cn } from '@/lib/utils';

const DRAFT_FAILED = 'สร้างร่างใบเสนอราคาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

const STEPS = ['วางข้อความลูกค้า', 'ตรวจรายการที่ AI จับคู่', 'อนุมัติ แล้วพิมพ์หรือส่งออก'] as const;

/** Synthetic example (same style as samples/inquiries) so a demo can start with one click. */
const SAMPLE_INQUIRY = `สวัสดีครับ ขอใบเสนอราคาหน่อยครับ
ท่อ PVC ฟ้า 1 นิ้ว 30 เส้น
ข้อต่อตรง PVC 1 นิ้ว 60 ชิ้น
ข้องอ 90 องศา PVC 1 นิ้ว 40 ชิ้น
กาวทาท่อ 500 กรัม 4 กระป๋อง
ส่งที่ไซต์งานบางนานะครับ`;

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

  if (!isHydrated) return <p className="text-muted-foreground">กำลังโหลด...</p>;

  if (catalog === null) {
    return (
      <div className="surface mx-auto w-full max-w-xl space-y-4 p-6 text-center">
        <p className="eyebrow">เริ่มต้นใช้งาน</p>
        <p>ยังไม่มี catalog สินค้า ต้องนำเข้า catalog ก่อนจึงจะสร้างใบเสนอราคาได้</p>
        <Link href="/catalog" className={buttonVariants({ size: 'lg' })}>
          ไปหน้า Catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form onSubmit={handleSubmit} className="space-y-3">
        <StorageWarning persistent={persistent} writeFailed={writeFailed} />
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
            <Label htmlFor="inquiry" className="text-base">
              ข้อความจากลูกค้า
            </Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setInquiry(SAMPLE_INQUIRY)}>
                ใช้ตัวอย่าง
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={inquiry === ''} onClick={() => setInquiry('')}>
                ล้าง
              </Button>
            </div>
          </div>
          <Textarea
            id="inquiry"
            className="min-h-72 resize-y rounded-none border-0 bg-transparent px-5 py-4 text-base leading-7 shadow-none focus-visible:ring-0"
            value={inquiry}
            aria-invalid={isTooLong}
            placeholder="วางข้อความสั่งซื้อจากไลน์ อีเมล หรือแชทของลูกค้าที่นี่"
            onChange={(event) => setInquiry(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/50 px-5 py-3">
            <span className={cn('font-mono text-xs text-muted-foreground', isTooLong && 'font-medium text-red-600')}>
              {`${inquiry.length}/${MAX_INQUIRY_CHARS}`}
            </span>
            <Button type="submit" size="lg" className="h-10 px-5 font-semibold" disabled={!canSubmit}>
              {isLoading ? 'กำลังสร้างร่างใบเสนอราคา...' : 'สร้างร่างใบเสนอราคา'}
            </Button>
          </div>
        </section>

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
      </form>

      <aside className="space-y-4">
        <div className="surface p-5">
          <p className="eyebrow mb-3">Catalog ที่ใช้</p>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-lg text-emerald-700">
              ✓
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{storedCatalog?.sourceName}</p>
              <p className="text-sm text-muted-foreground">{storedCatalog?.rowCount} รายการ</p>
            </div>
          </div>
          <Link href="/catalog" className="mt-3 inline-block text-sm text-seal underline-offset-2 hover:underline">
            เปลี่ยน catalog
          </Link>
        </div>

        <div className="surface p-5">
          <p className="eyebrow mb-3">ขั้นตอน</p>
          <ol className="space-y-3 text-sm">
            {STEPS.map((step, index) => (
              <li key={step} className={cn('flex items-center gap-3', index > 0 && 'text-muted-foreground')}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-xs',
                    index === 0 ? 'bg-seal text-white' : 'border',
                  )}
                >
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {draft !== null && (
          <Link href="/review" className="surface flex items-center justify-between p-4 text-sm hover:bg-muted/40">
            <span>กลับไปร่างล่าสุด</span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </aside>
    </div>
  );
}
