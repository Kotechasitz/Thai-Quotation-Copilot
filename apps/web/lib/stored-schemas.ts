import type { CompanyProfile } from '@tqc/core';
import { z } from 'zod';
import type { Draft } from '@/lib/draft';
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

const discountSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('percent'), value: z.number().finite() }),
    z.object({ type: z.literal('amount'), satang: z.number().int() }),
  ])
  .nullable();

const draftLineSchema = z.object({
  lineId: z.string(),
  rawText: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  status: z.enum(['matched', 'ambiguous', 'unmatched']),
  sku: z.string().nullable(),
  alternativeSkus: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
  unitMismatch: z.boolean(),
  unitNote: z.string().nullable(),
  resolvedSku: z.string().nullable(),
  discount: discountSchema,
  confirmed: z.boolean(),
  productQuery: z.string(),
  requested: z.object({ quantity: z.number().nullable(), unit: nullableText }),
  quantityEdited: z.boolean(),
  catalogUnit: nullableText,
});

const draftSchema = z.object({
  inquiry: z.string(),
  customer: z.object({ name: nullableText, company: nullableText, contact: nullableText }),
  lines: z.array(draftLineSchema),
  missingInfo: z.array(z.object({ lineId: nullableText, question: z.string() })),
  billDiscount: discountSchema,
  vatRatePercent: z.number().finite().min(0).max(100),
  whtRatePercent: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
  number: z.string(),
  notes: z.string(),
  paymentTerms: z.string(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  catalogKey: z.string(),
  approvedAt: nullableText,
});

/** A draft saved by an older/other version of the app is dropped (null) rather than half-loaded. */
export function parseDraft(raw: unknown): Draft | null {
  const result = draftSchema.safeParse(raw);
  return result.success ? result.data : null;
}
