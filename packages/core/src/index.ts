export type { Catalog, CatalogItem, CatalogLiteItem, Size } from './types.ts';
export { normalizeText } from './normalize/text.ts';
export { extractSize, extractAngle } from './normalize/size.ts';
export { resolveUnit, toLite, type ResolvedUnit } from './normalize/units.ts';
