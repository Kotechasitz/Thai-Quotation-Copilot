'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { CompanyProfile } from '@tqc/core';
import { StorageWarning } from '@/components/StorageWarning';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_COMPANY } from '@/lib/company';
import { MAX_LOGO_BYTES, STORAGE_KEYS, useStoredState } from '@/lib/storage';
import { parseCompany } from '@/lib/stored-schemas';

export const LOGO_TOO_LARGE = 'โลโก้ต้องไม่เกิน 200 KB';
export const SAVE_FAILED = 'บันทึกลงเครื่องไม่สำเร็จ ข้อมูลที่แก้ไขจะหายเมื่อปิดหน้า';
const LOGO_WRONG_TYPE = 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP';
const LOGO_READ_ERROR = 'อ่านไฟล์โลโก้ไม่ได้ กรุณาลองใหม่';
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Unsaved changes on top of the stored profile (text fields stay strings while typing). */
interface Edits {
  name?: string;
  address?: string;
  taxId?: string;
  phone?: string;
  defaultPaymentTerms?: string;
  defaultValidityDays?: string;
  logoDataUrl?: string | null;
}

type TextField = Exclude<keyof Edits, 'logoDataUrl'>;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function validate(values: Required<Edits>): { profile: CompanyProfile } | { errors: string[] } {
  const errors: string[] = [];
  const name = values.name.trim();
  if (name === '') errors.push('กรุณากรอกชื่อบริษัท');

  const taxId = values.taxId.replace(/[\s-]/g, '');
  if (taxId !== '' && !/^\d{13}$/.test(taxId)) {
    errors.push('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
  }

  const days = Number(values.defaultValidityDays);
  if (values.defaultValidityDays.trim() === '' || !Number.isInteger(days) || days < 1 || days > 365) {
    errors.push('ยืนราคาต้องเป็นจำนวนวันเต็ม 1-365 วัน');
  }
  if (errors.length > 0) return { errors };

  return {
    profile: {
      name,
      address: values.address.trim(),
      taxId,
      phone: values.phone.trim(),
      logoDataUrl: values.logoDataUrl,
      defaultPaymentTerms: values.defaultPaymentTerms.trim(),
      defaultValidityDays: days,
    },
  };
}

export function CompanyForm() {
  const [stored, setStored, { persistent }] = useStoredState<CompanyProfile>(
    STORAGE_KEYS.company,
    DEFAULT_COMPANY,
    parseCompany,
  );
  const [edits, setEdits] = useState<Edits>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<'saved' | 'failed' | null>(null);

  // What the form shows: the user's pending edit when there is one, otherwise the stored value.
  const values: Required<Edits> = {
    name: edits.name ?? stored.name,
    address: edits.address ?? stored.address,
    taxId: edits.taxId ?? stored.taxId,
    phone: edits.phone ?? stored.phone,
    defaultPaymentTerms: edits.defaultPaymentTerms ?? stored.defaultPaymentTerms,
    defaultValidityDays: edits.defaultValidityDays ?? String(stored.defaultValidityDays),
    logoDataUrl: edits.logoDataUrl === undefined ? stored.logoDataUrl : edits.logoDataUrl,
  };

  const handleTextChange = (field: TextField) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    setEdits((prev) => ({ ...prev, [field]: value }));
    setSaveResult(null);
  };

  const handleLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setSaveResult(null);
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(LOGO_TOO_LARGE);
    } else if (!LOGO_TYPES.includes(file.type)) {
      setLogoError(LOGO_WRONG_TYPE);
    } else {
      try {
        const dataUrl = await readAsDataUrl(file);
        setLogoError(null);
        setEdits((prev) => ({ ...prev, logoDataUrl: dataUrl }));
      } catch {
        setLogoError(LOGO_READ_ERROR);
      }
    }
    input.value = '';
  };

  const handleLogoRemove = () => {
    setLogoError(null);
    setSaveResult(null);
    setEdits((prev) => ({ ...prev, logoDataUrl: null }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(values);
    if ('errors' in result) {
      setErrors(result.errors);
      setSaveResult(null);
      return;
    }
    setErrors([]);
    const isPersisted = setStored(result.profile);
    setEdits({});
    setSaveResult(isPersisted ? 'saved' : 'failed');
  };

  return (
    <form onSubmit={handleSubmit} className="surface space-y-5 p-5 sm:p-6" noValidate>
      <StorageWarning persistent={persistent} />

      <div className="space-y-1.5">
        <Label htmlFor="company-name">ชื่อบริษัท</Label>
        <Input id="company-name" value={values.name} onChange={handleTextChange('name')} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company-address">ที่อยู่</Label>
        <Input id="company-address" value={values.address} onChange={handleTextChange('address')} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="company-tax-id">เลขประจำตัวผู้เสียภาษี</Label>
          <Input
            id="company-tax-id"
            inputMode="numeric"
            value={values.taxId}
            onChange={handleTextChange('taxId')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company-phone">เบอร์โทร</Label>
          <Input id="company-phone" value={values.phone} onChange={handleTextChange('phone')} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company-payment-terms">เงื่อนไขการชำระเงินเริ่มต้น</Label>
        <Input
          id="company-payment-terms"
          value={values.defaultPaymentTerms}
          onChange={handleTextChange('defaultPaymentTerms')}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="company-validity-days">ยืนราคา (วัน)</Label>
        <Input
          id="company-validity-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={values.defaultValidityDays}
          onChange={handleTextChange('defaultValidityDays')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="company-logo">โลโก้ (PNG, JPEG หรือ WebP ไม่เกิน 200 KB)</Label>
        <Input id="company-logo" type="file" accept={LOGO_TYPES.join(',')} onChange={handleLogoChange} />
        {logoError && <p className="text-sm text-red-700">{logoError}</p>}
        {values.logoDataUrl && (
          <div className="flex items-center gap-3">
            {/* A data URL: next/image optimisation does not apply, and the logo never leaves the browser. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={values.logoDataUrl} alt="โลโก้บริษัท" className="max-h-16 max-w-40 object-contain" />
            <Button type="button" variant="outline" onClick={handleLogoRemove}>
              ลบโลโก้
            </Button>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <ul aria-label="ข้อมูลที่ต้องแก้ไข" className="list-disc space-y-0.5 pl-5 text-sm text-red-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit">บันทึก</Button>
        {saveResult === 'saved' && (
          <p role="status" className="text-sm text-emerald-700">
            บันทึกแล้ว
          </p>
        )}
        {saveResult === 'failed' && (
          <p role="status" className="text-sm text-red-700">
            {SAVE_FAILED}
          </p>
        )}
      </div>
    </form>
  );
}
