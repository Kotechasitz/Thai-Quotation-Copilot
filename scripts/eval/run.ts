/**
 * Score a real model against the labelled eval set (scripts/eval/cases.json):
 *
 *   npm run eval -- [--provider google] [--model <id>] [--only <case-id>]
 *
 * Runs one case at a time with a pause in between (free-tier rate limits), prints a report and writes
 * scripts/eval/results/<date>-<model>.json. Use synthetic data only: the free tier may use prompts to
 * improve Google products.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runMatch } from '@tqc/core';
import { loadCatalogLite, modelOrExit } from '../lib/shared.ts';
import { loadCases } from './cases.ts';
import { formatReport, resultFileName, runCases, runStatus, selectCases } from './runner.ts';
import { summarize, costUsd, parsePrices } from './score.ts';

const PAUSE_MS = 4000;

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    only: { type: 'string' },
    'pause-ms': { type: 'string' },
  },
});

const { config, provider, modelId } = modelOrExit({ provider: values.provider, model: values.model });

const here = new URL('.', import.meta.url);
const prices = parsePrices(readFileSync(new URL('prices.json', here), 'utf8'));
const priceKey = `${provider}/${modelId}`;

let cases;
let catalogs;
try {
  cases = selectCases(loadCases(new URL('cases.json', here)), values.only);
  const samples = new URL('../../samples/catalogs/', here);
  catalogs = {
    plumbing: loadCatalogLite(fileURLToPath(new URL('plumbing.csv', samples))),
    office: loadCatalogLite(fileURLToPath(new URL('office.csv', samples))),
  };
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const pauseMs = values['pause-ms'] !== undefined ? Number(values['pause-ms']) : PAUSE_MS;
console.log(`รัน ${cases.length} เคส กับ ${priceKey} (หน่วง ${pauseMs} ms ต่อเคส)`);

const results = await runCases({
  cases,
  catalogs,
  pauseMs,
  run: ({ inquiry, catalog }) =>
    runMatch({ model: config.model, providerOptions: config.providerOptions, inquiry, catalog }),
  onCase: (r, i, n) => {
    const status = r.errorCode ?? r.errorMessage ?? `${r.score.correct}/${r.score.total}${r.score.extra > 0 ? ` +${r.score.extra}` : ''}`;
    console.log(`[${i + 1}/${n}] ${r.id.padEnd(16)} ${r.fullyCorrect ? 'ถูก' : 'ผิด'}  ${status}  ${(r.ms / 1000).toFixed(1)}s`);
  },
});

console.log('');
console.log(formatReport(results, { prices, priceKey, plannedCases: cases.length }));

const summary = summarize(results);
const status = runStatus(results, cases.length);
const now = new Date();
const outDir = new URL('results/', here);
mkdirSync(outDir, { recursive: true });
const outFile = new URL(resultFileName(now, modelId), outDir);
const byId = new Map(cases.map((c) => [c.id, c]));
writeFileSync(
  outFile,
  JSON.stringify(
    {
      date: now.toISOString(),
      provider,
      model: modelId,
      aborted: status.aborted,
      notRun: status.notRun,
      planned: status.planned,
      summary,
      costUsd: costUsd(prices, priceKey, summary.usage),
      cases: results.map((r) => ({
        ...r,
        inquiry: byId.get(r.id)?.inquiry,
        expected: byId.get(r.id)?.expected,
      })),
    },
    null,
    2,
  ),
);
console.log(`\nบันทึกผลที่ ${fileURLToPath(outFile)}`);
if (status.aborted) process.exit(1);
