import {
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
/** Retries the SDK itself performs for API/network errors (rate limits, 5xx). */
const SDK_MAX_RETRIES = 3;

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
}

interface CallContext {
  model: LanguageModel;
  providerOptions: ProviderOptions | undefined;
  abortSignal: AbortSignal;
  usage: { inputTokens: number; outputTokens: number };
}

function addUsage(ctx: CallContext, usage: LanguageModelUsage | undefined): void {
  ctx.usage.inputTokens += usage?.inputTokens ?? 0;
  ctx.usage.outputTokens += usage?.outputTokens ?? 0;
}

/** True when the error (or what it wraps) is an HTTP 429 from the provider. */
function isRateLimited(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const e = error as { statusCode?: unknown; lastError?: unknown; cause?: unknown };
  if (e.statusCode === 429) return true;
  return isRateLimited(e.lastError, depth + 1) || isRateLimited(e.cause, depth + 1);
}

/**
 * One structured-output call. A reply that fails the schema is retried once, then becomes
 * AI_INVALID_OUTPUT. API errors are retried by the SDK (maxRetries); whatever survives is mapped by
 * the caller.
 */
async function callStructured<S extends z.ZodType>(
  ctx: CallContext,
  call: { instructions: string; prompt: string; schema: S },
): Promise<z.infer<S>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await generateText({
        model: ctx.model,
        instructions: call.instructions,
        prompt: call.prompt,
        output: Output.object({ schema: call.schema }),
        maxRetries: SDK_MAX_RETRIES,
        abortSignal: ctx.abortSignal,
        ...(ctx.providerOptions !== undefined ? { providerOptions: ctx.providerOptions } : {}),
      });
      addUsage(ctx, result.totalUsage);
      return result.output as z.infer<S>;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
        if (NoObjectGeneratedError.isInstance(error)) addUsage(ctx, error.usage);
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
  const { model, inquiry, catalog, providerOptions, signal, timeoutMs = AI_TIMEOUT_MS } = args;

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
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  try {
    const { extracted, lines } = await runPipeline(ctx, inquiry, catalog);
    return { extracted, lines, usage: ctx.usage };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (timeoutSignal.aborted) throw new QuoteError('AI_TIMEOUT');
    if (isRateLimited(error)) throw new QuoteError('AI_BUSY');
    throw error;
  } finally {
    internal.abort();
  }
}
