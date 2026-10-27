// Regenerates the encoded CSV fixtures from catalog-utf8.csv.
// Run: node packages/core/test/fixtures/make-win874.ts   (Node 24 strips types natively)
// iconv-lite is a devDependency used only here, never at runtime.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';

const dir = dirname(fileURLToPath(import.meta.url));
const utf8Text = readFileSync(join(dir, 'catalog-utf8.csv'), 'utf8');

writeFileSync(join(dir, 'catalog-win874.csv'), iconv.encode(utf8Text, 'win874'));
writeFileSync(join(dir, 'catalog-utf8-bom.csv'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(utf8Text, 'utf8')]));
console.log('wrote catalog-win874.csv and catalog-utf8-bom.csv');
