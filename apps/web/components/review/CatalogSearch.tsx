'use client';

import { useMemo, useState } from 'react';
import { formatBaht, searchCandidates, type CatalogIndex, type CatalogItem } from '@tqc/core';
import { Input } from '@/components/ui/input';

export const MAX_SEARCH_RESULTS = 10;

interface CatalogSearchProps {
  /** Accessible name of the search box, e.g. "ค้นหาสินค้า บรรทัดที่ 2". */
  label: string;
  /** Built once per catalog by the parent (buildIndex over the price-free rows). */
  searchIndex: CatalogIndex;
  bySku: ReadonlyMap<string, CatalogItem>;
  /** Starting text, usually the product the AI extracted for this line. */
  initialQuery: string;
  /** A single alternative the pipeline kept for an unmatched line; listed first, never applied automatically. */
  suggestedSku: string | null;
  onSelect: (sku: string) => void;
}

/** Search-as-you-type over the catalog held in the browser. Selecting a row hands its sku to the parent. */
export function CatalogSearch({ label, searchIndex, bySku, initialQuery, suggestedSku, onSelect }: CatalogSearchProps) {
  const [query, setQuery] = useState(initialQuery);

  const results = useMemo(() => {
    const text = query.trim();
    if (text === '') return [];
    // A catalog of up to 20 rows is returned whole (ranked); a score of 0 means no token matched.
    return searchCandidates(searchIndex, { productQuery: text, specs: [] }, MAX_SEARCH_RESULTS)
      .filter((c) => c.score > 0)
      .map((c) => c.sku);
  }, [searchIndex, query]);

  const suggested = suggestedSku !== null && bySku.has(suggestedSku) ? suggestedSku : null;
  const skus = (suggested === null ? results : [suggested, ...results.filter((s) => s !== suggested)]).slice(
    0,
    MAX_SEARCH_RESULTS,
  );

  return (
    <div className="space-y-2">
      <Input
        type="text"
        aria-label={label}
        value={query}
        placeholder="พิมพ์ชื่อสินค้า รหัส หรือขนาด"
        onChange={(event) => setQuery(event.target.value)}
      />
      {skus.length > 0 ? (
        <ul className="divide-y surface text-sm">
          {skus.map((sku) => {
            const item = bySku.get(sku);
            if (item === undefined) return null;
            return (
              <li key={sku}>
                <button
                  type="button"
                  aria-label={`เลือก ${sku} ${item.nameTh ?? item.nameEn ?? sku} ${formatBaht(item.unitPriceSatang)} บาท / ${item.unit}${sku === suggested ? ' (แนะนำ)' : ''}`}
                  className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  onClick={() => onSelect(sku)}
                >
                  {sku === suggested && (
                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                      แนะนำ
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{sku}</span>
                  <span className="min-w-0 flex-1 truncate">{item.nameTh ?? item.nameEn ?? sku}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBaht(item.unitPriceSatang)} / {item.unit}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        query.trim() !== '' && <p className="text-sm text-muted-foreground">ไม่พบสินค้าที่ตรงกับคำค้น</p>
      )}
    </div>
  );
}
