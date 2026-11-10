'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { CATALOG_TEMPLATE_CSV, formatBaht } from '@tqc/core';
import { RowErrorList } from '@/components/catalog/RowErrorList';
import { StorageWarning } from '@/components/StorageWarning';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { analyzeCatalogBytes, type CatalogAnalysis } from '@/lib/catalog-import';
import { STORAGE_KEYS, useStoredState, type StoredCatalog } from '@/lib/storage';
import { parseStoredCatalog } from '@/lib/stored-schemas';
import { cn } from '@/lib/utils';

const SAMPLES = [
  { file: 'plumbing.csv', label: 'งานประปา' },
  { file: 'office.csv', label: 'เครื่องเขียน/สำนักงาน' },
] as const;

const ENCODING_LABELS = {
  'utf-8': 'UTF-8',
  'windows-874': 'Windows-874 (ภาษาไทยแบบเก่าของ Excel)',
} as const;

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CATALOG_TEMPLATE_CSV)}`;
const PREVIEW_ROWS = 5;
export const CATALOG_TOO_LARGE = 'catalog ใหญ่เกินที่เบราว์เซอร์จะเก็บได้ ข้อมูลจะหายเมื่อปิดหน้า';
const SAMPLE_ERROR = 'โหลดไฟล์ตัวอย่างไม่ได้ กรุณาลองใหม่';

interface Imported {
  sourceName: string;
  analysis: CatalogAnalysis;
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function CatalogUpload() {
  const [stored, setStored, { persistent, writeFailed }] = useStoredState<StoredCatalog | null>(
    STORAGE_KEYS.catalog,
    null,
    parseStoredCatalog,
  );
  const [imported, setImported] = useState<Imported | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pricesIncludeVat, setPricesIncludeVat] = useState(false);
  // Only the most recent file/sample may update the screen if several reads overlap.
  const latestRequest = useRef(0);

  const showBytes = (sourceName: string, bytes: Uint8Array) => {
    setLoadError(null);
    setImported({ sourceName, analysis: analyzeCatalogBytes(bytes) });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const request = ++latestRequest.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (request === latestRequest.current) showBytes(file.name, bytes);
    } catch {
      if (request === latestRequest.current) {
        setImported(null);
        setLoadError('อ่านไฟล์ไม่ได้ กรุณาลองใหม่');
      }
    }
    input.value = ''; // lets the user pick the same file again after fixing it
  };

  const handleSampleClick = async (file: string) => {
    const request = ++latestRequest.current;
    try {
      const response = await fetch(`/samples/${file}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (request === latestRequest.current) showBytes(file, bytes);
    } catch {
      if (request === latestRequest.current) {
        setImported(null);
        setLoadError(SAMPLE_ERROR);
      }
    }
  };

  const parsed = imported?.analysis.kind === 'parsed' ? imported.analysis : null;

  const handleImportClick = () => {
    if (!imported || !parsed || parsed.items.length === 0) return;
    setStored({
      catalog: { items: parsed.items, pricesIncludeVat },
      sourceName: imported.sourceName,
      rowCount: parsed.items.length,
      savedAt: new Date().toISOString(),
    });
    setImported(null);
  };

  return (
    <div className="space-y-6">
      <StorageWarning
        persistent={persistent}
        writeFailed={writeFailed}
        writeFailedMessage={CATALOG_TOO_LARGE}
      />

      {stored && (
        <section
          data-testid="stored-catalog"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm"
        >
          <h2 className="font-semibold">catalog ที่ใช้อยู่ตอนนี้</h2>
          <p>
            {`${stored.sourceName} · ${stored.rowCount} รายการ · บันทึกเมื่อ ${formatSavedAt(stored.savedAt)}`}
          </p>
          <p className="text-muted-foreground">
            {stored.catalog.pricesIncludeVat ? 'ราคารวม VAT แล้ว' : 'ราคายังไม่รวม VAT'}
          </p>
        </section>
      )}

      <section className="surface space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">นำเข้า catalog</h2>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-file">เลือกไฟล์ catalog (CSV)</Label>
          <Input id="catalog-file" type="file" accept=".csv,text/csv" onChange={handleFileChange} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="prices-include-vat"
            aria-label="ราคาใน catalog รวม VAT แล้ว"
            checked={pricesIncludeVat}
            onCheckedChange={setPricesIncludeVat}
          />
          <Label htmlFor="prices-include-vat">ราคาใน catalog รวม VAT แล้ว</Label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={TEMPLATE_HREF}
            download="catalog-template.csv"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            ดาวน์โหลด template
          </a>
          {SAMPLES.map(({ file, label }) => (
            <Button
              key={file}
              type="button"
              variant="secondary"
              onClick={() => void handleSampleClick(file)}
            >
              {`โหลด catalog ตัวอย่าง: ${label}`}
            </Button>
          ))}
        </div>
      </section>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}

      {imported?.analysis.kind === 'error' && (
        <p className="text-sm text-red-700">{imported.analysis.message}</p>
      )}

      {imported && parsed && (
        <section className="surface space-y-3 overflow-x-auto p-5 sm:p-6">
          <h2 className="text-lg font-semibold">{`ผลการอ่านไฟล์ ${imported.sourceName}`}</h2>
          <p className="text-sm">{`encoding ที่ตรวจเจอ: ${ENCODING_LABELS[parsed.encoding]}`}</p>
          <p className="text-sm">{`พบ ${parsed.dataLineCount} แถวในไฟล์, นำเข้าได้ ${parsed.items.length} รายการ`}</p>
          {parsed.mergeSuspected && (
            <Alert>
              <AlertDescription>
                บางแถวอาจถูกรวมเป็นแถวเดียว (มักเกิดจากเครื่องหมาย &quot; ที่ไม่ครบคู่) กรุณาตรวจไฟล์ก่อนนำเข้า
              </AlertDescription>
            </Alert>
          )}
          <RowErrorList errors={parsed.rowErrors} />

          {parsed.items.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <caption className="pb-1 text-left text-muted-foreground">
                  {`ตัวอย่าง ${Math.min(PREVIEW_ROWS, parsed.items.length)} รายการแรก`}
                </caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-1 pr-2">sku</th>
                    <th className="py-1 pr-2">ชื่อ</th>
                    <th className="py-1 pr-2">หน่วย</th>
                    <th className="py-1 text-right">ราคา (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.items.slice(0, PREVIEW_ROWS).map((item) => (
                    <tr key={item.sku} className="border-b">
                      <td className="py-1 pr-2">{item.sku}</td>
                      <td className="py-1 pr-2">{item.nameTh ?? item.nameEn}</td>
                      <td className="py-1 pr-2">{item.unit}</td>
                      <td className="py-1 text-right">{formatBaht(item.unitPriceSatang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button type="button" onClick={handleImportClick}>
                {parsed.rowErrors.length > 0
                  ? `นำเข้าเฉพาะแถวที่ถูก (${parsed.items.length} รายการ)`
                  : `นำเข้า catalog (${parsed.items.length} รายการ)`}
              </Button>
              <p className="text-sm text-muted-foreground">การนำเข้าจะแทนที่ catalog เดิมทั้งหมด</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
