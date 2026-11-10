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
  ok: { label: 'พร้อมใช้', badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  'needs-choice': { label: 'ต้องเลือกสินค้า', badge: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
  'needs-sku': { label: 'ต้องค้นหาสินค้า', badge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  'needs-quantity': { label: 'ต้องกรอกจำนวน', badge: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  'needs-unit': { label: 'ต้องยืนยันหน่วย', badge: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
};

const BORDER: Record<LineState, string> = {
  ok: 'border-l-emerald-500',
  'needs-choice': 'border-l-amber-400',
  'needs-sku': 'border-l-rose-500',
  'needs-quantity': 'border-l-slate-400',
  'needs-unit': 'border-l-slate-400',
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
    <li aria-label={where} className={cn('grid gap-4 rounded-xl border border-l-4 bg-card p-4 shadow-sm md:grid-cols-[1fr_1.4fr]', BORDER[state])}>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          {where} · ข้อความลูกค้า
        </p>
        <p className="whitespace-pre-wrap break-words text-sm font-medium">{line.rawText}</p>
        <p>
          <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', style.badge)}>{style.label}</span>
        </p>
      </div>

      <div className="space-y-2">
        {item !== undefined && (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{item.nameTh ?? item.nameEn ?? item.sku}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{item.sku}</span> · {formatBaht(item.unitPriceSatang)} บาท / {item.unit}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsChanging((v) => !v)}>
              เปลี่ยนสินค้า
            </Button>
          </div>
        )}
        {line.reason !== '' && <p className="text-xs text-muted-foreground">{line.reason}</p>}

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

        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/60 p-3">
          <div className="w-32 space-y-1">
            <p aria-hidden="true" className="text-xs text-muted-foreground">
              จำนวน
            </p>
            <DecimalInput
              label={`จำนวน ${where}`}
              value={line.quantity}
              format={formatQuantity}
              parse={parseQuantity}
              onCommit={(quantity) => dispatch({ type: 'setQuantity', lineId: line.lineId, quantity })}
              suffix={<span data-testid="unit-label">{line.unit ?? ''}</span>}
            />
          </div>
          <div className="w-56 space-y-1">
            <p aria-hidden="true" className="text-xs text-muted-foreground">
              ส่วนลด
            </p>
            <DiscountInput
              label={`ส่วนลด ${where}`}
              typeLabel={`ประเภทส่วนลด ${where}`}
              value={line.discount}
              onChange={(discount) => dispatch({ type: 'setDiscount', lineId: line.lineId, discount })}
            />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">รวม</p>
            <p className="font-mono text-base font-semibold tabular-nums">
              {lineTotalSatang === null ? '-' : `${formatBaht(lineTotalSatang)} บาท`}
            </p>
          </div>
        </div>

        {line.unitNote !== null && <p className="text-xs text-muted-foreground">{line.unitNote}</p>}
        {state === 'needs-unit' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
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
