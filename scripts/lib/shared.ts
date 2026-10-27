import { readFileSync } from 'node:fs';
import { decodeCsvBytes, formatRowError, parseCatalogCsv, toLite, type CatalogLiteItem } from '@tqc/core';
import { getModelConfig, type ModelConfig } from '@tqc/providers';

/** Reads a catalog CSV and returns what the AI may see (no prices). Throws a Thai Error on problems. */
export function loadCatalogLite(path: string): CatalogLiteItem[] {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    throw new Error(`เปิดไฟล์ไม่ได้: ${path}`);
  }
  const { items, rowErrors, fileError } = parseCatalogCsv(decodeCsvBytes(bytes).text);
  if (fileError) throw new Error(`อ่านแคตตาล็อกไม่ได้ (${path}): ${fileError.message}`);
  if (rowErrors.length > 0) {
    console.error(`ข้าม ${rowErrors.length} แถวที่มีปัญหาใน ${path} (แสดง 3 แถวแรก):`);
    for (const e of rowErrors.slice(0, 3)) console.error(`  ${formatRowError(e)}`);
  }
  return items.map(toLite);
}

/**
 * Builds the model from the environment (optionally overridden by CLI flags). On missing config prints
 * the Thai error from getModelConfig and exits with code 1.
 */
export function modelOrExit(overrides: { provider?: string | undefined; model?: string | undefined } = {}): {
  config: ModelConfig;
  provider: string;
  modelId: string;
} {
  const env: Record<string, string | undefined> = { ...process.env };
  if (overrides.provider !== undefined) env.AI_PROVIDER = overrides.provider;
  if (overrides.model !== undefined) env.AI_MODEL = overrides.model;
  try {
    const config = getModelConfig(env);
    return {
      config,
      provider: env.AI_PROVIDER?.trim() || 'google',
      modelId: env.AI_MODEL?.trim() ?? '',
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
