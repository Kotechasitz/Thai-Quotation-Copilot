export type { Catalog, CatalogItem, CatalogLiteItem, Size } from './types.ts';
export { normalizeText } from './normalize/text.ts';
export { extractSize, extractAngle } from './normalize/size.ts';
export { resolveUnit, toLite, type ResolvedUnit } from './normalize/units.ts';
export { decodeCsvBytes, type CsvEncoding } from './catalog/decode.ts';
export {
  parseCatalogCsv,
  formatRowError,
  type RowError,
  type FileError,
  type CatalogParseResult,
} from './catalog/parse.ts';
export { CATALOG_TEMPLATE_CSV } from './catalog/template.ts';
export {
  FULL_CATALOG_THRESHOLD,
  MAX_CANDIDATES,
  buildIndex,
  searchCandidates,
  type Candidate,
  type CandidateQuery,
  type CatalogIndex,
} from './retrieve/index.ts';
export {
  computeQuote,
  type Discount,
  type WhtRate,
  type PricedLineInput,
  type QuoteInput,
  type LineTotals,
  type QuoteTotals,
} from './pricing/compute.ts';
export { roundHalfUpDiv, formatBaht } from './pricing/money.ts';
export { bahtText } from './pricing/bahtText.ts';
export type { CompanyProfile, CustomerInfo, QuoteLine, Quotation } from './quote/model.ts';
export { formatQuoteNumber, formatThaiDate } from './quote/number.ts';
export { toJson } from './export/json.ts';
export { toCsv } from './export/csv.ts';
export {
  extractionSchema,
  matchSchema,
  type ExtractedRequest,
  type ExtractedItem,
  type RawMatch,
} from './ai/schemas.ts';
export {
  EXTRACT_INSTRUCTIONS,
  MATCH_INSTRUCTIONS,
  buildExtractPrompt,
  buildMatchPrompt,
} from './ai/prompts.ts';
export {
  NO_RESULT_REASON,
  REJECTED_REASON,
  validateMatches,
  type MatchStatus, type ValidatedLine } from './ai/validate.ts';
export { QuoteError, QUOTE_ERROR_MESSAGES, type QuoteErrorCode } from './ai/errors.ts';
export {
  MAX_INQUIRY_CHARS,
  MAX_ITEMS,
  MATCH_BATCH_SIZE,
  AI_CONCURRENCY,
  AI_TIMEOUT_MS,
  runMatch,
  type MatchResponse,
  type RunMatchArgs,
  type ProviderOptions,
} from './ai/pipeline.ts';
export { mapLimit } from './util/mapLimit.ts';
