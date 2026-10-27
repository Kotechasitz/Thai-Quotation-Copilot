import type { CompanyProfile } from '@tqc/core';

/** Fictional demo company - synthetic data only. */
export const DEFAULT_COMPANY: CompanyProfile = {
  name: 'บริษัท ตัวอย่างวัสดุ จำกัด',
  address: '99/9 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10000',
  taxId: '0000000000000',
  phone: '02-000-0000',
  logoDataUrl: null,
  defaultPaymentTerms: 'ชำระเงินภายใน 30 วันนับจากวันส่งสินค้า',
  defaultValidityDays: 30,
};
