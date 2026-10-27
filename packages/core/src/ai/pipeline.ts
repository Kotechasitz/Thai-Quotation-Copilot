import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import type { z } from 'zod';
import { MAX_CANDIDATES, buildIndex, searchCandidates } from '../retrieve/index.ts';
import type { CatalogLiteItem } from '../types.ts';
import { mapLimit } from '../util/mapLimit.ts';
import { QuoteError } from './errors.ts';
import {
  EXTRACT_INSTRUCTIONS,
  MATCH_INSTRUCTIONS,
  buildExtractPrompt,
  buildMatchPrompt,
} from './prompts.ts';
import {
  extractionSchema,
  matchSchema,
  type ExtractedItem,
  type ExtractedRequest,
  type RawMatch,
} from './schemas.ts';
import { validateMatches, type ValidatedLine } from './validate.ts';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
/** Per-provider options passed through to the AI SDK, e.g. `{ google: { ... } }`. */
export type ProviderOptions = Record<string, { [key: string]: JsonValue | undefined }>;

export const MAX_INQUIRY_CHARS = 5000;
export const MAX_ITEMS = 50;
export const MATCH_BATCH_SIZE = 10;
export const AI_CONCURRENCY = 2;
export const AI_TIMEOUT_MS = 60_000;
/** API calls one step (extract, or one match batch) may make in total, schema retry included: 1 try + 3 retries. */
const MAX_CALLS_PER_STEP = 4;
/** First backoff delay; doubles each retry (1 s, 2 s, 4 s). */
const RETRY_BASE_DELAY_MS = 1000;
/** A `retry-after` hint longer than this is clamped to it. */
const RETRY_AFTER_CAP_MS = 10_000;

export interface MatchResponse {
  extracted: ExtractedRequest;
  lines: ValidatedLine[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface RunMatchArgs {
  model: LanguageModel;
  inquiry: string;
  catalog: CatalogLiteItem[];
  providerOptions?: ProviderOptions;
  /** Caller cancellation. An abort from here is rethrown as-is, not turned into AI_TIMEOUT. */
  signal?: AbortSignal;
  /** Overall deadline for the whole run; defaults to AI_TIMEOUT_MS. Mainly for tests. */
  timeoutMs?: number;
  /** Retry timing; defaults to 1 s / 2 s / 4 s backoff. Mainly for tests. */
  retry?: RetryOptions;
}

export interface RetryOptions {
  /** First backoff delay in ms (doubles each retry). */
  baseDelayMs?: number;
  /** Waits `ms`; must reject with `signal.reason` when the signal aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

interface CallContext {
  model: LanguageModel;
  providerOptions: ProviderOptions | undefined;
  abortSignal: AbortSignal;
  retryBaseDelayMs: number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  usage: { inputTokens: number; outputTokens: number };
}

function addUsage(ctx: CallContext, usage: LanguageModelUsage | undefined): void {
  ctx.usage.inputTokens += usage?.inputTokens ?? 0;
  ctx.usage.outputTokens += usage?.outputTokens ?? 0;
}

/** The error plus whatever it wraps (RetryError.lastError, .cause), outermost first. */
function errorChain(error: unknown): object[] {
  const out: object[] = [];
  let level: unknown[] = [error];
  for (let depth = 0; depth < 5 && level.length > 0; depth += 1) {
    const next: unknown[] = [];
    for (const e of level) {
      if (typeof e !== 'object' || e === null) continue;
      out.push(e);
      const wrapped = e as { lastError?: unknown; cause?: unknown };
      next.push(wrapped.lastError, wrapped.cause);
    }
    level = next;
  }
  return out;
}

const statusOf = (e: object): unknown => (e as { statusCode?: unknown }).statusCode;

function textOf(e: object): string {
  const x = e as { message?: unknown; responseBody?: unknown; data?: unknown };
  const parts: string[] = [];
  if (typeof x.message === 'string') parts.push(x.message);
  if (typeof x.responseBody === 'string') parts.push(x.responseBody);
  if (x.data !== undefined) {
    try {
      parts.push(JSON.stringify(x.data));
    } catch {
      // unserialisable provider data: the message and body above are enough
    }
  }
  return parts.join('\n');
}

/**
 * True for a 429 that says the per-day quota is spent (Google: RESOURCE_EXHAUSTED with a `...PerDay...`
 * quotaId, or "per day" in the text). Retrying cannot help until tomorrow.
 */
function isDailyQuota(error: unknown): boolean {
  return errorChain(error).some((e) => {
    if (statusOf(e) !== 429) return false;
    const text = textOf(e);
    return text.includes('RESOURCE_EXHAUSTED') && (text.includes('PerDay') || /per day/i.test(text));
  });
}

/** True when the provider answered 429 (any kind) or a retryable 5xx. */
function isBusyStatus(error: unknown): boolean {
  return errorChain(error).some((e) => {
    const s = statusOf(e);
    return s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
  });
}

/** 401 / 403 / 404 from the provider: a wrong or revoked API key, no access, or an unknown model name. */
function isConfigError(error: unknown): boolean {
  return errorChain(error).some((e) => {
    if (!APICallError.isInstance(e)) return false;
    const s = e.statusCode;
    return s === 401 || s === 403 || s === 404;
  });
}

const NETWORK_CODES = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR/;

/** A connection-level failure: no HTTP status, and either the SDK's "cannot connect" or a socket error. */
function isNetworkError(error: unknown): boolean {
  return errorChain(error).some((e) => {
    if (statusOf(e) !== undefined) return false;
    const x = e as { name?: unknown; message?: unknown; code?: unknown };
    if (x.name === 'AbortError' || x.name === 'TimeoutError') return false;
    if (APICallError.isInstance(e)) return true;
    return (
      /fetch failed|socket hang up|network/i.test(String(x.message ?? '')) ||
      NETWORK_CODES.test(String(x.code ?? ''))
    );
  });
}

/** Retry only what can succeed later: a 429 that is not a daily quota, 500/502/503/504, network errors. */
function shouldRetry(error: unknown): boolean {
  if (isDailyQuota(error)) return false;
  return isBusyStatus(error) || isNetworkError(error);
}

function header(error: unknown, name: string): string | undefined {
  for (const e of errorChain(error)) {
    const headers = (e as { responseHeaders?: unknown }).responseHeaders;
    if (typeof headers !== 'object' || headers === null) continue;
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === name && typeof v === 'string') return v;
    }
  }
  return undefined;
}

/** `retry-after-ms` / `retry-after` (seconds or HTTP date) clamped to 10 s, else the backoff delay. */
function retryDelayMs(error: unknown, backoffMs: number): number {
  let ms: number | undefined;
  const afterMs = header(error, 'retry-after-ms');
  if (afterMs !== undefined && !Number.isNaN(parseFloat(afterMs))) ms = parseFloat(afterMs);
  const after = header(error, 'retry-after');
  if (ms === undefined && after !== undefined) {
    const seconds = parseFloat(after);
    ms = Number.isNaN(seconds) ? Date.parse(after) - Date.now() : seconds * 1000;
  }
  if (ms === undefined || Number.isNaN(ms) || ms < 0) return backoffMs;
  return Math.min(ms, RETRY_AFTER_CAP_MS);
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** API calls made so far by one step; shared by the transport retries and the schema retry. */
interface CallBudget {
  calls: number;
}

/**
 * Runs `call`, retrying API/network failures with exponential backoff (see shouldRetry) while the
 * step's shared budget of MAX_CALLS_PER_STEP calls lasts.
 */
async function withRetries<T>(ctx: CallContext, budget: CallBudget, call: () => Promise<T>): Promise<T> {
  for (;;) {
    budget.calls += 1;
    try {
      return await call();
    } catch (error) {
      if (ctx.abortSignal.aborted || budget.calls >= MAX_CALLS_PER_STEP || !shouldRetry(error)) throw error;
      await ctx.sleep(retryDelayMs(error, ctx.retryBaseDelayMs * 2 ** (budget.calls - 1)), ctx.abortSignal);
    }
  }
}

/**
 * One structured-output call. A reply that fails the schema is retried once, then becomes
 * AI_INVALID_OUTPUT. API errors are retried by our own loop (withRetries); whatever survives is mapped
 * by the caller. Both kinds of retry draw on one budget of MAX_CALLS_PER_STEP API calls, which protects
 * the free tier's daily request quota.
 *
 * Why not the SDK's `maxRetries`: in ai@7 its retry decision is only `APICallError.isRetryable` (the
 * provider marks every 429 retryable) and generateText exposes no predicate, so a per-day quota 429
 * cannot be vetoed. We therefore run the SDK with maxRetries: 0.
 */
async function callStructured<S extends z.ZodType>(
  ctx: CallContext,
  call: { instructions: string; prompt: string; schema: S },
): Promise<z.infer<S>> {
  const budget: CallBudget = { calls: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await withRetries(ctx, budget, () =>
        generateText({
          model: ctx.model,
          instructions: call.instructions,
          prompt: call.prompt,
          output: Output.object({ schema: call.schema }),
          maxRetries: 0,
          abortSignal: ctx.abortSignal,
          ...(ctx.providerOptions !== undefined ? { providerOptions: ctx.providerOptions } : {}),
        }),
      );
      addUsage(ctx, result.totalUsage);
      return result.output as z.infer<S>;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
        if (NoObjectGeneratedError.isInstance(error)) addUsage(ctx, error.usage);
        if (budget.calls >= MAX_CALLS_PER_STEP) break; // no call left for a schema retry
        continue;
      }
      throw error;
    }
  }
  throw new QuoteError('AI_INVALID_OUTPUT');
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runPipeline(
  ctx: CallContext,
  inquiry: string,
  catalog: CatalogLiteItem[],
): Promise<{ extracted: ExtractedRequest; lines: ValidatedLine[] }> {
  const first = await callStructured(ctx, {
    instructions: EXTRACT_INSTRUCTIONS,
    prompt: buildExtractPrompt(inquiry),
    schema: extractionSchema,
  });

  if (first.items.length === 0) throw new QuoteError('NO_ITEMS');
  if (first.items.length > MAX_ITEMS) throw new QuoteError('TOO_MANY_ITEMS');

  // Never trust the model's ids: renumber in extraction order and remap references to them.
  const idMap = new Map<string, string>();
  const items: ExtractedItem[] = first.items.map((it, i) => {
    const lineId = `L${i + 1}`;
    if (!idMap.has(it.lineId)) idMap.set(it.lineId, lineId);
    return { ...it, lineId };
  });
  const extracted: ExtractedRequest = {
    ...first,
    items,
    missingInfo: first.missingInfo.map((m) => ({
      ...m,
      lineId: m.lineId === null ? null : (idMap.get(m.lineId) ?? null),
    })),
  };

  const bySku = new Map(catalog.map((c) => [c.sku, c]));
  const index = buildIndex(catalog);
  const candidatesByLine = new Map<string, CatalogLiteItem[]>();
  for (const item of items) {
    const hits = searchCandidates(index, { productQuery: item.productQuery, specs: item.specs }, MAX_CANDIDATES);
    candidatesByLine.set(
      item.lineId,
      hits.flatMap((h) => {
        const found = bySku.get(h.sku);
        return found === undefined ? [] : [found];
      }),
    );
  }

  let raw: RawMatch[] = [];
  if (catalog.length > 0) {
    const batches = chunk(items, MATCH_BATCH_SIZE);
    const perBatch = await mapLimit(batches, AI_CONCURRENCY, async (batch) => {
      const out = await callStructured(ctx, {
        instructions: MATCH_INSTRUCTIONS,
        prompt: buildMatchPrompt(batch, candidatesByLine),
        schema: matchSchema,
      });
      return out.results;
    });
    raw = perBatch.flat();
  }

  return { extracted, lines: validateMatches(items, raw, candidatesByLine) };
}

/**
 * validate input -> LLM call 1 (extract) -> code retrieves candidates -> LLM call 2 (pick SKUs,
 * batched) -> code validates. The model never sees prices.
 */
export async function runMatch(args: RunMatchArgs): Promise<MatchResponse> {
  const { model, inquiry, catalog, providerOptions, signal, timeoutMs = AI_TIMEOUT_MS, retry } = args;

  if (inquiry.trim() === '') throw new QuoteError('EMPTY_INPUT');
  if (inquiry.length > MAX_INQUIRY_CHARS) throw new QuoteError('INPUT_TOO_LONG');

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  // Cancels sibling in-flight calls when one fails, and everything once we are done.
  const internal = new AbortController();
  const abortSignal = AbortSignal.any([
    timeoutSignal,
    internal.signal,
    ...(signal !== undefined ? [signal] : []),
  ]);
  const ctx: CallContext = {
    model,
    providerOptions,
    abortSignal,
    retryBaseDelayMs: retry?.baseDelayMs ?? RETRY_BASE_DELAY_MS,
    sleep: retry?.sleep ?? defaultSleep,
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  try {
    const { extracted, lines } = await runPipeline(ctx, inquiry, catalog);
    return { extracted, lines, usage: ctx.usage };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (timeoutSignal.aborted) throw new QuoteError('AI_TIMEOUT');
    if (isDailyQuota(error)) throw new QuoteError('AI_QUOTA_EXCEEDED', { cause: error });
    if (isBusyStatus(error)) throw new QuoteError('AI_BUSY', { cause: error });
    if (isConfigError(error)) throw new QuoteError('AI_CONFIG', { cause: error });
    throw error;
  } finally {
    internal.abort();
  }
}
