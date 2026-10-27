import { fileURLToPath } from 'node:url';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Next only reads .env* from this app's directory; the repo's single .env lives two levels up.
// Load it here so `next dev|build|start` see AI_PROVIDER / AI_MODEL / GOOGLE_GENERATIVE_AI_API_KEY.
// forceReload: Next has already cached the (empty) env of apps/web by the time this file runs.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production', undefined, true);

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source (package.json "exports" -> ./src/index.ts).
  transpilePackages: ['@tqc/core', '@tqc/providers'],
  turbopack: {
    // The workspace packages live outside apps/web, so widen the root to the repo.
    root: repoRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
