import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One PG container shared across files; tests isolate by org_id, so
    // file parallelism stays on.
  },
});
