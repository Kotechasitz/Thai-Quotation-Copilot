# @tqc/web

Next.js (App Router) demo for Thai Quotation Copilot. Run from the repo root:

```bash
npm run dev -w @tqc/web     # http://localhost:3000
npm run build -w @tqc/web
npm run test -w @tqc/web
```

## Environment

The single `.env` at the **repo root** is used (copy `.env.example`). `next.config.ts` loads it with
`@next/env` (`forceReload`), so no `.env.local` copy or symlink is needed in `apps/web`.

## API

`POST /api/match` with `{ inquiry, catalog: CatalogLiteItem[] }` returns `MatchApiResponse`
(see `lib/api-schema.ts`). Unknown fields (e.g. prices) are stripped; only status, duration and
token counts are logged - never the inquiry or catalog.
