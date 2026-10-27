# Thai Quotation Copilot

[English](README.md) | [ภาษาไทย](README.th.md)

**Paste a customer's order message (Thai, English or mixed) and get a draft Thai quotation in seconds. AI reads the message and picks products from your catalog; the code, not the AI, does all the pricing, VAT and withholding tax.**

> Demo project. Use synthetic data only (see [Known limitations](#known-limitations)).

## How it works

1. **CSV** - you upload your product catalog as a CSV file. It is parsed and validated in the browser and stored in the browser's `localStorage`.
2. **AI extracts** - the customer message is sent to the server together with a price-free "lite" view of the catalog. The model splits the message into line items (what, how many, which unit).
3. **Code retrieves** - for each line item, deterministic code (Thai-aware text search over names, aliases and categories) shortlists the **top 20 candidate products**.
4. **AI picks, code validates** - the model picks one SKU per line from that line's candidates (or says "no match"). Code then checks that every SKU really is one of the line's candidates and rejects anything that is not.

Prices are **never** sent to the AI and never come back from it. After the match, the browser looks each SKU up in your catalog and computes line totals, discount, VAT (default 7%, configurable) and withholding tax (0 / 1 / 2 / 3 / 5%, calculated on the pre-VAT amount). All money is handled as integer satang with half-up rounding.

## Safeguards

- **The AI never sees prices.** The catalog sent to the model has no price fields, so it cannot invent or leak a price.
- **SKUs are checked in code.** A SKU returned by the model must be in the candidate list for that line, otherwise the line becomes "unmatched".
- **Human approval before export.** The quotation must be reviewed and approved (every quantity greater than 0) before it can be printed or exported.
- **The server keeps nothing.** The server does not store or log customer messages or catalogs (only token counts, timing and status). Your data lives in your browser.
- **Hard limits.** Message up to 5,000 characters, up to 50 line items, 60 second timeout, at most 10 line items per AI call.

## Quick start

Requirements: Node.js 24 and npm.

```bash
npm install
cp .env.example .env        # (cmd.exe: copy .env.example .env) then edit .env and fill in your own key
npm run dev -w apps/web     # http://localhost:3000
```

In the app, open the **Catalog** page and load one of the sample catalogs (plumbing, or office supplies), then paste one of the sample inquiries on the home page. The samples are in the repository:

- Catalogs: `samples/catalogs/plumbing.csv`, `samples/catalogs/office.csv` (and `large-10k.csv` for performance testing)
- Inquiries: `samples/inquiries/01.txt` to `10.txt`

All sample data is synthetic and uses the fictional company "บริษัท ตัวอย่างวัสดุ จำกัด".

### AI providers

Set these in `.env` (see `.env.example`):

| `AI_PROVIDER` | `AI_MODEL` example | Credentials |
| --- | --- | --- |
| `google` (default) | `gemini-3.6-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` (from Google AI Studio) |
| `gateway` ([Vercel AI Gateway](https://vercel.com/docs/ai-gateway)) | `anthropic/claude-haiku-5.5` | `AI_GATEWAY_API_KEY` (the verified path). OIDC on Vercel is supported by the SDK but untested in this project |

With `gateway`, requests carry `disallowPromptTraining: true`, so the gateway only routes to providers that do not train on your prompts. Caveats: the request fails if no provider for the chosen model satisfies that filter, and the filter is not applied to your own provider keys (BYOK). Locally, setting `AI_GATEWAY_API_KEY` is required; a `VERCEL_OIDC_TOKEN` obtained with `vercel env pull` also works but expires after 12 hours. On Vercel the key check is skipped and the gateway SDK reports any auth problem itself. See [docs/costs.md](docs/costs.md) for what each option costs.

## Command line

Run from the repository root. `quote`, `eval` and `eval:daily` read `.env` and call a real model.

```bash
# Search a catalog with the retrieval code only (no AI, no key needed)
npm run search -- --catalog samples/catalogs/plumbing.csv "ท่อ PVC 4 หุน"

# Run the full pipeline on one inquiry and print the result as JSON
npm run quote -- --catalog samples/catalogs/plumbing.csv --inquiry samples/inquiries/01.txt

# Score a model against the labelled eval set (scripts/eval/cases.json)
npm run eval -- --provider gateway --model anthropic/claude-haiku-5.5

# Same, in daily slices for the Gemini free tier: resumes and runs at most 8 cases
npm run eval:daily
```

Eval results are written to `scripts/eval/results/`. Use synthetic data only.

Checks: `npm test`, `npm run typecheck`, `npm run lint`.

## CSV format

The first row must be a header. Column order does not matter and extra columns are ignored.

| Column | Required | Notes |
| --- | --- | --- |
| `sku` | yes | Unique product code |
| `name_th` | one of `name_th` / `name_en` | Thai product name |
| `name_en` | one of `name_th` / `name_en` | English product name |
| `unit` | yes | Unit of sale (e.g. เส้น, ชิ้น, รีม) |
| `unit_price` | yes | Price per unit. `1250`, `1,250.00` and `฿1,250.00` are all accepted |
| `aliases` | no | Alternative names customers use, separated by `\|` |
| `category` | no | Product category |
| `description` | no | Free-text description |

- A **template CSV** can be downloaded from the Catalog page.
- **Encodings:** UTF-8 (with or without BOM) and Windows-874 (the legacy Thai encoding Excel on Thai Windows uses for "CSV") are detected automatically.
- **Semicolon-delimited CSV is not supported.** The delimiter must be a comma (some Excel regional settings save `;` - re-save as comma-separated).
- A missing required column gives a single file-level error naming the column; bad rows are reported by row number.

## Known limitations

- **Safari** does not repeat the table header on every page when printing a long quotation.
- **The Gemini free tier is limited and not private.** In our testing the free quota for `gemini-3.6-flash` was 20 requests per day per model, and Google may use free-tier content to improve its products. Use **synthetic data only** with the free tier.
- **Data lives in your browser's `localStorage`.** Clearing site data, or switching browser or device, loses your catalog and drafts. If `localStorage` is unavailable (private window, quota full), the app keeps working in memory and warns you that it cannot save.
- This is a demo. PDF output uses the browser's print dialog, not a server-side renderer.

## Deploy on Vercel

This is an npm-workspaces monorepo. The Next.js app is in `apps/web` and imports the workspace packages in `packages/`.

### From a private repository (Vercel dashboard)

1. Push the repository to GitHub (private is fine).
2. In Vercel: **Add New... > Project**, then import the repository.
3. Set **Root Directory** to `apps/web` (later changeable under **Settings > Build and Deployment**).
4. Under **Settings > Build and Deployment > Root Directory**, verify that **"Include files outside of the root directory in the Build Step"** is enabled (it is on by default for new projects; it is needed because `apps/web` uses `packages/core` and `packages/providers`).
5. Add environment variables (**Settings > Environment Variables**):
   - `AI_PROVIDER` and `AI_MODEL`
   - `GOOGLE_GENERATIVE_AI_API_KEY` for `google`, or `AI_GATEWAY_API_KEY` for `gateway` (use the key; OIDC on Vercel is untested here)
6. Deploy. The build needs no AI variables; they are only read when a quotation is generated.

The matching route uses a 60 second limit (`maxDuration = 60`). With Fluid Compute (the default), Hobby allows up to 300 s and Pro up to 800 s ([Vercel duration docs](https://vercel.com/docs/functions/configuring-functions/duration), read 2026-10-27). Vercel's default Node.js version is 24.x ([Vercel docs](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions), read 2026-10-27), matching this project.

### "Deploy to Vercel" button (usable only once the repository is public)

The one-click button works only for **public** repositories. After you make the repository public, replace `<YOUR_REPO_URL>` (for example `https://github.com/<owner>/<repo>`) in this clone URL template. The `repository-url` value must be URL-encoded (for example `https%3A%2F%2Fgithub.com%2F<owner>%2F<repo>`):

```
https://vercel.com/new/clone?repository-url=<YOUR_REPO_URL>&root-directory=apps/web&env=AI_PROVIDER,AI_MODEL,GOOGLE_GENERATIVE_AI_API_KEY
```

Use it as a link, for example `[![Deploy with Vercel](https://vercel.com/button)](<the URL above>)`. After the first import, check "Include files outside of the root directory" (step 4 above) and redeploy if you change anything.

## License

[MIT](LICENSE). The bundled Sarabun font is licensed under the SIL Open Font License 1.1 (`apps/web/app/fonts/OFL.txt`).
