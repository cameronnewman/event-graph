import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    // Container startup + recursive graph queries can be slow on CI cold start.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
