/**
 * Try the candidate retriever from the command line:
 *
 *   npm run search -- --catalog samples/catalogs/plumbing.csv "ท่อ PVC 4 หุน"
 *
 * Prints the top 5 candidates as `sku  score  name`.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  buildIndex,
  decodeCsvBytes,
  formatRowError,
  parseCatalogCsv,
  searchCandidates,
  toLite,
} from '../packages/core/src/index.ts';

const TOP = 5;

const { values, positionals } = parseArgs({
  options: { catalog: { type: 'string', short: 'c' } },
  allowPositionals: true,
});
const query = positionals.join(' ').trim();

if (!values.catalog || query === '') {
  console.error('วิธีใช้: npm run search -- --catalog <ไฟล์.csv> "ข้อความค้นหา"');
  process.exit(2);
}

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(readFileSync(values.catalog));
} catch {
  console.error(`เปิดไฟล์ไม่ได้: ${values.catalog}`);
  process.exit(1);
}

const { items, rowErrors, fileError } = parseCatalogCsv(decodeCsvBytes(bytes).text);
if (fileError) {
  console.error(`อ่านแคตตาล็อกไม่ได้: ${fileError.message}`);
  process.exit(1);
}
if (rowErrors.length > 0) {
  console.error(`ข้าม ${rowErrors.length} แถวที่มีปัญหา (แสดง 3 แถวแรก):`);
  for (const e of rowErrors.slice(0, 3)) console.error(`  ${formatRowError(e)}`);
}

const names = new Map(items.map((i) => [i.sku, i.nameTh ?? i.nameEn ?? '']));
const index = buildIndex(items.map(toLite));
const results = searchCandidates(index, { productQuery: query, specs: [] }, TOP).slice(0, TOP);

for (const r of results) {
  console.log(`${r.sku}  ${r.score.toFixed(3)}  ${names.get(r.sku) ?? ''}`);
}
