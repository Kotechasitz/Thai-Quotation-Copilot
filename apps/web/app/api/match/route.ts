import { QUOTE_ERROR_MESSAGES, QuoteError, runMatch } from '@tqc/core';
import { getModelConfig, type ModelConfig } from '@tqc/providers';
import {
  API_ERROR_MESSAGES,
  ERROR_STATUS,
  matchRequestSchema,
  type ApiErrorCode,
  type MatchApiResponse,
} from '@/lib/api-schema';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Privacy: the only things ever logged are status, duration, token counts and an error code - never the inquiry or catalog. */
function logOutcome(fields: { status: number; ms: number; inputTokens?: number; outputTokens?: number; code?: ApiErrorCode }) {
  console.log(JSON.stringify(fields));
}

function respond(body: MatchApiResponse, status: number): Response {
  return Response.json(body, { status });
}

function errorResponse(code: ApiErrorCode, message: string, startedAt: number): Response {
  const status = ERROR_STATUS[code];
  logOutcome({ status, ms: Date.now() - startedAt, code });
  return respond({ ok: false, error: { code, message } }, status);
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse('BAD_REQUEST', API_ERROR_MESSAGES.BAD_REQUEST, startedAt);
  }

  const parsed = matchRequestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse('BAD_REQUEST', API_ERROR_MESSAGES.BAD_REQUEST, startedAt);
  }

  let config: ModelConfig;
  try {
    config = getModelConfig(process.env);
  } catch {
    return errorResponse('CONFIG', API_ERROR_MESSAGES.CONFIG, startedAt);
  }

  try {
    const data = await runMatch({
      model: config.model,
      providerOptions: config.providerOptions,
      inquiry: parsed.data.inquiry,
      catalog: parsed.data.catalog,
      signal: req.signal,
    });
    logOutcome({ status: 200, ms: Date.now() - startedAt, ...data.usage });
    return respond({ ok: true, data }, 200);
  } catch (error) {
    if (error instanceof QuoteError) {
      return errorResponse(error.code, QUOTE_ERROR_MESSAGES[error.code], startedAt);
    }
    // Unexpected error: its message may echo user content, so neither log nor return it.
    return errorResponse('INTERNAL', API_ERROR_MESSAGES.INTERNAL, startedAt);
  }
}
