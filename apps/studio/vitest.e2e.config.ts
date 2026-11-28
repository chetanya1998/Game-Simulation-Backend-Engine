import { defineConfig } from 'vitest/config';

/** Browser end-to-end tests of the built studio and CLI (`pnpm build` first). */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
