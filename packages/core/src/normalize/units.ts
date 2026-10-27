import type { CatalogItem, CatalogLiteItem } from '../types.ts';
import { normalizeText } from './text.ts';

/** Units that mean "one piece" and are interchangeable. */
const PIECE_UNITS = new Set(['ชิ้น', 'ตัว', 'อัน']);
const DOZEN = 'โหล';
const DOZEN_SIZE = 12;

export interface ResolvedUnit {
  quantity: number | null;
  note: string | null;
  unitMismatch: boolean;
}

export function resolveUnit(
  requested: string | null,
  catalogUnit: string,
  quantity: number | null,
): ResolvedUnit {
  const req = requested === null ? '' : normalizeText(requested);
  const cat = normalizeText(catalogUnit);

  if (req === '' || req === cat || (PIECE_UNITS.has(req) && PIECE_UNITS.has(cat))) {
    return { quantity, note: null, unitMismatch: false };
  }

  if (req === DOZEN && PIECE_UNITS.has(cat)) {
    if (quantity === null) return { quantity: null, note: null, unitMismatch: false };
    const converted = Math.round(quantity * DOZEN_SIZE * 1000) / 1000;
    return {
      quantity: converted,
      note: `แปลง ${quantity} ${requested} = ${converted} ${catalogUnit}`,
      unitMismatch: false,
    };
  }

  return { quantity, note: null, unitMismatch: true };
}

export function toLite(item: CatalogItem): CatalogLiteItem {
  return {
    sku: item.sku,
    nameTh: item.nameTh,
    nameEn: item.nameEn,
    unit: item.unit,
    aliases: [...item.aliases],
    category: item.category,
  };
}
