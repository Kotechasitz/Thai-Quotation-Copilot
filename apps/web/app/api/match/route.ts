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
/** Longer than the 60 s AI deadline (AI_TIMEOUT_MS) so the pipeline answers AI_TIMEOUT before the platform kills the function. */
export const maxDuration = 90;

interface LogFields {
  status: number;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  code?: ApiErrorCode;
  /** Class name of the error (a constant like 'QuoteError' or 'AI_APICallError'), never its message. */
  errorName?: string;
  /** HTTP status the AI provider answered with, when the error (or its cause chain) carries one. */
  statusCode?: number;
}

/** Privacy: the only things ever logged are status, duration, token counts, an error code/name and a provider status number - never the inquiry, catalog or an error message. */
function logOutcome(fields: LogFields) {
  console.log(JSON.stringify(fields));
}

/** Name and provider status of an error, looking through `.lastError` / `.cause` wrappers. Numbers and names only. */
function describeError(error: unknown): Pick<LogFields, 'errorName' | 'statusCode'> {
  const out: Pick<LogFields, 'errorName' | 'statusCode'> = {};
  if (error instanceof Error) out.errorName = error.name;
  let level: unknown[] = [error];
  for (let depth = 0; depth < 5 && level.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const e of level) {
      if (typeof e !== 'object' || e === null) continue;
      const x = e as { statusCode?: unknown; lastError?: unknown; cause?: unknown };
      if (typeof x.statusCode === 'number') {
        out.statusCode = x.statusCode;
        return out;
      }
      next.push(x.lastError, x.cause);
    }
    level = next;
  }
  return out;
}

function respond(body: MatchApiResponse, status: number): Response {
  return Response.json(body, { status });
}

function errorResponse(code: ApiErrorCode, message: string, startedAt: number, error?: unknown): Response {
  const status = ERROR_STATUS[code];
  logOutcome({ status, ms: Date.now() - startedAt, code, ...(error !== undefined ? describeError(error) : {}) });
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
      return errorResponse(error.code, QUOTE_ERROR_MESSAGES[error.code], startedAt, error);
    }
    // Unexpected error: its message may echo user content, so neither log nor return it - only its name and status.
    return errorResponse('INTERNAL', API_ERROR_MESSAGES.INTERNAL, startedAt, error);
  }
}
