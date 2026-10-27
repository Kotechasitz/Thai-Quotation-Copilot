export interface CatalogItem {
  sku: string;
  nameTh: string | null;
  nameEn: string | null;
  unit: string;
  unitPriceSatang: number;
  aliases: string[];
  category: string | null;
  description: string | null;
}

/** What the AI is allowed to see: no price fields. */
export type CatalogLiteItem = Pick<
  CatalogItem,
  'sku' | 'nameTh' | 'nameEn' | 'unit' | 'aliases' | 'category'
>;

export interface Catalog {
  items: CatalogItem[];
  pricesIncludeVat: boolean;
}

export interface Size {
  value: number;
  unit: 'in' | 'mm';
}
