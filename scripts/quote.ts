/**
 * Run the matching pipeline on one customer inquiry and print the MatchResponse as JSON:
 *
 *   npm run quote -- --catalog samples/catalogs/plumbing.csv --inquiry samples/inquiries/01.txt
 *
 * Reads AI_PROVIDER / AI_MODEL / GOOGLE_GENERATIVE_AI_API_KEY from .env (see .env.example).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { QuoteError, runMatch } from '@tqc/core';
import { loadCatalogLite, modelOrExit } from './lib/shared.ts';

const { values } = parseArgs({
  options: { catalog: { type: 'string', short: 'c' }, inquiry: { type: 'string', short: 'i' } },
});

if (!values.catalog || !values.inquiry) {
  console.error('วิธีใช้: npm run quote -- --catalog <แคตตาล็อก.csv> --inquiry <ข้อความลูกค้า.txt>');
  process.exit(2);
}

const { config } = modelOrExit();

let catalog;
let inquiry: string;
try {
  catalog = loadCatalogLite(values.catalog);
  inquiry = readFileSync(values.inquiry, 'utf8');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  const response = await runMatch({
    model: config.model,
    providerOptions: config.providerOptions,
    inquiry,
    catalog,
  });
  console.log(JSON.stringify(response, null, 2));
} catch (error) {
  console.error(error instanceof QuoteError ? `${error.code}: ${error.message}` : String(error));
  process.exit(1);
}
