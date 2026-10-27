/**
 * Score a real model against the labelled eval set (scripts/eval/cases.json):
 *
 *   npm run eval -- [--provider google] [--model <id>] [--only <id>[,<id>...]]
 *                   [--resume] [--max-cases N] [--pause-ms N]
 *   npm run eval:daily            (= --resume --max-cases 8, for the free tier's per-day quota)
 *
 * Runs one case at a time with a pause in between (free-tier rate limits), prints a report and writes
 * scripts/eval/results/<date>-<model>.json. Every case's good result is folded into
 * scripts/eval/results/<model>-cumulative.json right after the case finishes (temp file + rename, so a
 * crash loses nothing already paid for and never leaves partial JSON; an errored result never overwrites a
 * good one), and the report ends with accuracy over that cumulative file. --resume skips cases that
 * already have a good result for their current inquiry/catalog/expected AND the current code version (a hash
 * of the prompts, schemas, validation, pipeline, retrieval and sample catalogs; a result from other code is stale
 * and re-run, and the report says how many were ignored). The run stops at the first
 * AI_QUOTA_EXCEEDED and exits 1. The per-run file is only a log: it is written once at the end.
 * Use synthetic data only: the free tier may use prompts to improve Google products.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runMatch } from '@tqc/core';
import { loadCatalogLite, modelOrExit } from '../lib/shared.ts';
import { loadCases } from './cases.ts';
import {
  createCumulativePersister,
  cumulativeFileName,
  emptyCumulative,
  goodCaseIds,
  parseCumulative,
  writeFileAtomic,
} from './cumulative.ts';
import {
  formatCumulativeSection,
  formatReport,
  planCases,
  resultFileName,
  runCases,
  runStatus,
  selectCases,
} from './runner.ts';
import { summarize, costUsd, parsePrices } from './score.ts';

const PAUSE_MS = 4000;

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    only: { type: 'string' },
    resume: { type: 'boolean' },
    'max-cases': { type: 'string' },
    'pause-ms': { type: 'string' },
  },
});

const { config, provider, modelId } = modelOrExit({ provider: values.provider, model: values.model });

const here = new URL('.', import.meta.url);
const outDir = new URL('results/', here);
const prices = parsePrices(readFileSync(new URL('prices.json', here), 'utf8'));
const priceKey = `${provider}/${modelId}`;
const cumulativeUrl = new URL(cumulativeFileName(modelId), outDir);

let allCases;
let cases;
let catalogs;
let cumulative = emptyCumulative(provider, modelId);
try {
  allCases = loadCases(new URL('cases.json', here));
  if (existsSync(cumulativeUrl)) cumulative = parseCumulative(readFileSync(cumulativeUrl, 'utf8'));
  const maxCases = values['max-cases'] !== undefined ? Number(values['max-cases']) : undefined;
  cases = planCases(selectCases(allCases, values.only), {
    ...(values.resume === true ? { done: goodCaseIds(cumulative, allCases) } : {}),
    ...(maxCases !== undefined ? { maxCases } : {}),
  });
  const samples = new URL('../../samples/catalogs/', here);
  catalogs = {
    plumbing: loadCatalogLite(fileURLToPath(new URL('plumbing.csv', samples))),
    office: loadCatalogLite(fileURLToPath(new URL('office.csv', samples))),
  };
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (cases.length === 0) {
  console.log(`ไม่มีเคสให้รัน (ทุกเคสที่เลือกมีผลในไฟล์สะสมแล้ว) — ${priceKey}`);
  console.log('');
  console.log(formatCumulativeSection(cumulative, allCases, { prices, priceKey }));
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const persister = createCumulativePersister({ path: fileURLToPath(cumulativeUrl), file: cumulative, cases: allCases });

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
    persister.onCase(r); // saved now, not at the end: a crash or Ctrl-C keeps everything finished so far
  },
});

const now = new Date();
const merged = persister.current();

console.log('');
console.log(
  formatReport(results, {
    prices,
    priceKey,
    plannedCases: cases.length,
    cumulative: { file: merged, cases: allCases },
  }),
);

const summary = summarize(results);
const status = runStatus(results, cases.length);
const outFile = new URL(resultFileName(now, modelId), outDir);
const byId = new Map(cases.map((c) => [c.id, c]));
writeFileAtomic(
  fileURLToPath(outFile),
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
console.log(`อัปเดตไฟล์สะสมที่ ${fileURLToPath(cumulativeUrl)}`);
if (status.aborted) process.exitCode = 1;
