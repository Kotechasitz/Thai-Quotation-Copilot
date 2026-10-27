import { defineConfig } from 'vitest/config';

/** Root config: runs the tests of the repo-level scripts (the workspaces have their own configs). */
export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
});
