import { MAX_INQUIRY_CHARS, type MatchResponse, type QuoteErrorCode } from '@tqc/core';
import { z } from 'zod';

export const MAX_CATALOG_ITEMS = 10_000;

/** What the AI is allowed to see: no price fields. Unknown keys are stripped (zod default), so prices can never be forwarded. */
const catalogLiteItemSchema = z.object({
  sku: z.string(),
  nameTh: z.string().nullable(),
  nameEn: z.string().nullable(),
  unit: z.string(),
  aliases: z.array(z.string()),
  category: z.string().nullable(),
});

export const matchRequestSchema = z.object({
  // Empty is allowed here on purpose: runMatch answers EMPTY_INPUT (400) with the Thai message.
  inquiry: z.string().max(MAX_INQUIRY_CHARS),
  catalog: z.array(catalogLiteItemSchema).min(1).max(MAX_CATALOG_ITEMS),
});

export type MatchRequest = z.infer<typeof matchRequestSchema>;

export type ApiErrorCode = QuoteErrorCode | 'BAD_REQUEST' | 'CONFIG' | 'INTERNAL';

export type MatchApiResponse =
  | { ok: true; data: MatchResponse }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  EMPTY_INPUT: 400,
  INPUT_TOO_LONG: 400,
  NO_ITEMS: 422,
  TOO_MANY_ITEMS: 422,
  AI_INVALID_OUTPUT: 502,
  AI_BUSY: 503,
  AI_TIMEOUT: 504,
  AI_QUOTA_EXCEEDED: 429,
  CONFIG: 500,
  INTERNAL: 500,
};

export const API_ERROR_MESSAGES = {
  BAD_REQUEST: 'คำขอไม่ถูกต้อง กรุณาตรวจสอบข้อความและ catalog แล้วลองใหม่',
  CONFIG: 'ระบบยังไม่ได้ตั้งค่า AI กรุณาติดต่อผู้ดูแลระบบ',
  INTERNAL: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
} as const;
