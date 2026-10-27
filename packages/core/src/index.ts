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
