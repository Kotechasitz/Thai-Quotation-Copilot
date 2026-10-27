import type { Discount, QuoteTotals, WhtRate } from '../pricing/compute.ts';

export interface CompanyProfile {
  name: string;
  address: string;
  taxId: string;
  phone: string;
  logoDataUrl: string | null;
  defaultPaymentTerms: string;
  defaultValidityDays: number;
}

export interface CustomerInfo {
  name: string | null;
  company: string | null;
  contact: string | null;
}

export interface QuoteLine {
  lineId: string;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceSatang: number;
  discount: Discount | null;
}

export interface Quotation {
  schemaVersion: 1;
  number: string;
  /** ISO calendar date, YYYY-MM-DD. */
  issueDate: string;
  /** ISO calendar date, YYYY-MM-DD. */
  validUntil: string;
  company: CompanyProfile;
  customer: CustomerInfo;
  lines: QuoteLine[];
  billDiscount: Discount | null;
  vatRatePercent: number;
  pricesIncludeVat: boolean;
  whtRatePercent: WhtRate;
  paymentTerms: string;
  notes: string;
  totals: QuoteTotals;
  approvedAt: string | null;
}
