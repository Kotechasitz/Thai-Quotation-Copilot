'use client';

import { useMemo } from 'react';
import { buildIndex, toLite, type Catalog } from '@tqc/core';
import { LineRow } from '@/components/review/LineRow';
import { skuMap, type Draft, type DraftAction } from '@/lib/draft';

interface ReviewTableProps {
  draft: Draft;
  catalog: Catalog;
  /** Line totals (satang) for lines that are ready, keyed by lineId. */
  lineTotals: ReadonlyMap<string, number>;
  dispatch: (action: DraftAction) => void;
}

/** One row per request line, in the order the customer wrote them. */
export function ReviewTable({ draft, catalog, lineTotals, dispatch }: ReviewTableProps) {
  // Built once per catalog (the search index never sees prices), shared by every row's search box.
  const searchIndex = useMemo(() => buildIndex(catalog.items.map(toLite)), [catalog]);
  const bySku = skuMap(catalog);

  if (draft.lines.length === 0) {
    return <p className="surface p-4 text-sm text-muted-foreground">ไม่มีบรรทัดสินค้าในร่างนี้ กลับไปหน้าแรกเพื่อสร้างร่างใหม่</p>;
  }

  return (
    <ol className="space-y-3">
      {draft.lines.map((line, index) => (
        <LineRow
          key={line.lineId}
          line={line}
          position={index + 1}
          catalog={catalog}
          bySku={bySku}
          searchIndex={searchIndex}
          lineTotalSatang={lineTotals.get(line.lineId) ?? null}
          dispatch={dispatch}
        />
      ))}
    </ol>
  );
}
