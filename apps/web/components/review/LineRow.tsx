'use client';

import { useState } from 'react';
import { formatBaht, type Catalog, type CatalogIndex, type CatalogItem } from '@tqc/core';
import { CatalogSearch } from '@/components/review/CatalogSearch';
import { DecimalInput } from '@/components/review/DecimalInput';
import { DiscountInput } from '@/components/review/DiscountInput';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { lineState, type DraftAction, type DraftLine, type LineState } from '@/lib/draft';
import { parseQuantity } from '@/lib/draft-input';
import { cn } from '@/lib/utils';

/** Colour is never the only signal: every state also has a text label. */
const STATE_STYLE: Record<LineState, { label: string; badge: string }> = {
  ok: { label: 'พร้อมใช้', badge: 'bg-green-100 text-green-800' },
  'needs-choice': { label: 'ต้องเลือกสินค้า', badge: 'bg-yellow-100 text-yellow-900' },
  'needs-sku': { label: 'ต้องค้นหาสินค้า', badge: 'bg-red-100 text-red-800' },
  'needs-quantity': { label: 'ต้องกรอกจำนวน', badge: 'bg-zinc-200 text-zinc-800' },
  'needs-unit': { label: 'ต้องยืนยันหน่วย', badge: 'bg-zinc-200 text-zinc-800' },
};

const BORDER: Record<LineState, string> = {
  ok: 'border-l-green-500',
  'needs-choice': 'border-l-yellow-400',
  'needs-sku': 'border-l-red-500',
  'needs-quantity': 'border-l-zinc-400',
  'needs-unit': 'border-l-zinc-400',
};

interface LineRowProps {
  line: DraftLine;
  /** 1-based position, used in accessible names. */
  position: number;
  catalog: Catalog;
  bySku: ReadonlyMap<string, CatalogItem>;
  searchIndex: CatalogIndex;
  /** Line total after its discount (satang), when the line is ready. */
  lineTotalSatang: number | null;
  dispatch: (action: DraftAction) => void;
}

const formatQuantity = (n: number): string => String(n);

export function LineRow({ line, position, catalog, bySku, searchIndex, lineTotalSatang, dispatch }: LineRowProps) {
  const [isChanging, setIsChanging] = useState(false);
  const state = lineState(line, catalog);
  const style = STATE_STYLE[state];
  const item = line.resolvedSku === null ? undefined : bySku.get(line.resolvedSku);
  const where = `บรรทัดที่ ${position}`;

  const handleSelect = (sku: string) => {
    dispatch({ type: 'selectSku', lineId: line.lineId, sku, catalog });
    setIsChanging(false);
  };

  const suggestedSku = line.status === 'unmatched' && line.alternativeSkus.length === 1 ? (line.alternativeSkus[0] ?? null) : null;
  const showDropdown = item === undefined && line.status === 'ambiguous';
  const showSearch = item === undefined || isChanging;

  return (
    <li aria-label={where} className={cn('grid gap-3 rounded-lg border border-l-4 bg-white p-3 md:grid-cols-[1fr_1.4fr]', BORDER[state])}>
      <div className="space-y-1">
        <p className="text-xs text-zinc-500">
          {where} · ข้อความลูกค้า
        </p>
        <p className="whitespace-pre-wrap break-words text-sm font-medium">{line.rawText}</p>
        <p>
          <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', style.badge)}>{style.label}</span>
        </p>
      </div>

      <div className="space-y-2">
        {item !== undefined && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{item.nameTh ?? item.nameEn ?? item.sku}</p>
              <p className="text-xs text-zinc-600">
                <span className="font-mono">{item.sku}</span> · {formatBaht(item.unitPriceSatang)} บาท / {item.unit}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsChanging((v) => !v)}>
              เปลี่ยนสินค้า
            </Button>
          </div>
        )}
        {line.reason !== '' && <p className="text-xs text-zinc-600">{line.reason}</p>}

        {showDropdown && (
          <NativeSelect
            aria-label={`เลือกสินค้า ${where}`}
            value=""
            onChange={(event) => {
              if (event.target.value !== '') handleSelect(event.target.value);
            }}
          >
            <option value="">เลือกสินค้า...</option>
            {line.alternativeSkus.map((sku) => {
              const alt = bySku.get(sku);
              return alt === undefined ? null : (
                <option key={sku} value={sku}>
                  {`${sku} · ${alt.nameTh ?? alt.nameEn ?? sku} · ${formatBaht(alt.unitPriceSatang)} บาท / ${alt.unit}`}
                </option>
              );
            })}
          </NativeSelect>
        )}

        {showSearch && (
          <CatalogSearch
            label={`ค้นหาสินค้า ${where}`}
            searchIndex={searchIndex}
            bySku={bySku}
            initialQuery={line.productQuery}
            suggestedSku={suggestedSku}
            onSelect={handleSelect}
          />
        )}

        <div className="flex flex-wrap items-start gap-3">
          <div className="w-28">
            <DecimalInput
              label={`จำนวน ${where}`}
              value={line.quantity}
              format={formatQuantity}
              parse={parseQuantity}
              onCommit={(quantity) => dispatch({ type: 'setQuantity', lineId: line.lineId, quantity })}
            />
          </div>
          <span data-testid="unit-label" className="pt-1.5 text-sm">
            {line.unit ?? ''}
          </span>
          <div className="w-44">
            <DiscountInput
              label={`ส่วนลด ${where}`}
              typeLabel={`ประเภทส่วนลด ${where}`}
              value={line.discount}
              onChange={(discount) => dispatch({ type: 'setDiscount', lineId: line.lineId, discount })}
            />
          </div>
          <p className="ml-auto pt-1.5 text-sm font-semibold tabular-nums">
            {lineTotalSatang === null ? '-' : `${formatBaht(lineTotalSatang)} บาท`}
          </p>
        </div>

        {line.unitNote !== null && <p className="text-xs text-zinc-600">{line.unitNote}</p>}
        {state === 'needs-unit' && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-zinc-100 px-2 py-1.5 text-sm">
            <span>
              ยืนยันว่าจะเสนอราคาเป็น {line.quantity} {item?.unit ?? '-'} (ไม่แปลงจาก {line.quantity} {line.unit ?? '-'})
            </span>
            <Button type="button" size="sm" onClick={() => dispatch({ type: 'confirmUnit', lineId: line.lineId })}>
              ยืนยันหน่วย
            </Button>
          </div>
        )}

        <div className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`ลบ${where}`}
            onClick={() => dispatch({ type: 'removeLine', lineId: line.lineId })}
          >
            ลบบรรทัด
          </Button>
        </div>
      </div>
    </li>
  );
}
