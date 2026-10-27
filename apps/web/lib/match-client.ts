import { extractionSchema, toLite, type Catalog, type MatchResponse } from '@tqc/core';
import { z } from 'zod';
import type { MatchApiResponse } from '@/lib/api-schema';

export const NETWORK_ERROR = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
export const BAD_REPLY_ERROR = 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ กรุณาลองใหม่อีกครั้ง';

export type MatchResult = { ok: true; data: MatchResponse } | { ok: false; message: string; aborted?: boolean };

const validatedLineSchema = z.object({
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
});

/** The whole reply is checked: the draft reducer relies on every field being there. */
const replySchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    data: z.object({
      extracted: extractionSchema,
      lines: z.array(validatedLineSchema),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export function parseMatchReply(value: unknown): MatchApiResponse | null {
  const result = replySchema.safeParse(value);
  return result.success ? (result.data as MatchApiResponse) : null;
}

/**
 * Asks the server to match the inquiry. Only the price-free catalog (toLite) leaves the browser;
 * every failure comes back as a Thai message instead of a thrown error.
 */
export async function requestMatch(inquiry: string, catalog: Catalog, signal?: AbortSignal): Promise<MatchResult> {
  let response: Response;
  try {
    response = await fetch('/api/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inquiry, catalog: catalog.items.map(toLite) }),
      signal,
    });
  } catch {
    return signal?.aborted === true ? { ok: false, message: '', aborted: true } : { ok: false, message: NETWORK_ERROR };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, message: BAD_REPLY_ERROR };
  }
  const reply = parseMatchReply(json);
  if (reply === null) return { ok: false, message: BAD_REPLY_ERROR };
  return reply.ok ? { ok: true, data: reply.data } : { ok: false, message: reply.error.message };
}
