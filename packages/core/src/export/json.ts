import type { Quotation } from '../quote/model.ts';

export function toJson(q: Quotation): string {
  return JSON.stringify(q, null, 2);
}
