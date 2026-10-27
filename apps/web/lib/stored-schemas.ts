import type { CompanyProfile } from '@tqc/core';
import { z } from 'zod';
import type { StoredCatalog } from '@/lib/storage';

const nullableText = z.string().nullable();

const companySchema = z.object({
  name: z.string(),
  address: z.string(),
  taxId: z.string(),
  phone: z.string(),
  logoDataUrl: nullableText,
  defaultPaymentTerms: z.string(),
  defaultValidityDays: z.number().int(),
});

const catalogItemSchema = z.object({
  sku: z.string(),
  nameTh: nullableText,
  nameEn: nullableText,
  unit: z.string(),
  unitPriceSatang: z.number().int().nonnegative(),
  aliases: z.array(z.string()),
  category: nullableText,
  description: nullableText,
});

const storedCatalogSchema = z.object({
  catalog: z.object({
    items: z.array(catalogItemSchema),
    pricesIncludeVat: z.boolean(),
  }),
  sourceName: z.string(),
  rowCount: z.number().int().nonnegative(),
  savedAt: z.string(),
});

/** Wrong-shape JSON (old version, hand-edited) -> null, so the hook falls back to its default. */
export function parseCompany(raw: unknown): CompanyProfile | null {
  const result = companySchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseStoredCatalog(raw: unknown): StoredCatalog | null {
  const result = storedCatalogSchema.safeParse(raw);
  return result.success ? result.data : null;
}
