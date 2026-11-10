'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Draft } from '@/lib/draft';

export const CLIPBOARD_UNAVAILABLE = 'คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความด้านบนแล้วคัดลอกเอง';

interface CustomerQuestionsProps {
  missingInfo: Draft['missingInfo'];
  lines: Draft['lines'];
}

type CopyState = 'idle' | 'copied' | 'unavailable';

/** Questions the AI thinks the customer should be asked. Nothing is ever sent to the customer from here. */
export function CustomerQuestions({ missingInfo, lines }: CustomerQuestionsProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const rawTextByLine = new Map(lines.map((l) => [l.lineId, l.rawText]));

  const handleCopyClick = async () => {
    const text = missingInfo.map((m, i) => `${i + 1}. ${m.question}`).join('\n');
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('unavailable');
    }
  };

  return (
    <section aria-labelledby="customer-questions-heading" className="space-y-2 surface p-4">
      <h2 id="customer-questions-heading" className="text-base font-semibold">
        คำถามถึงลูกค้า
      </h2>
      {missingInfo.length === 0 ? (
        <p className="text-sm text-muted-foreground">ไม่มีคำถามถึงลูกค้า</p>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {missingInfo.map((m, index) => {
              const context = m.lineId === null ? undefined : rawTextByLine.get(m.lineId);
              return (
                // Questions have no id and are never reordered, so the position is a stable key here.
                <li key={index}>
                  {m.question}
                  {context !== undefined && <span className="block text-xs text-muted-foreground">เกี่ยวกับ: {context}</span>}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={handleCopyClick}>
              คัดลอก
            </Button>
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {copyState === 'copied' && 'คัดลอกแล้ว'}
              {copyState === 'unavailable' && CLIPBOARD_UNAVAILABLE}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">ระบบไม่ส่งข้อความถึงลูกค้าให้อัตโนมัติ คัดลอกไปส่งเองได้</p>
        </>
      )}
    </section>
  );
}
