import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // Required for NestJS decorator metadata in integration tests.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    // These integration tests SHARE one database and each truncates it in
    // beforeAll. They MUST run serially in a SINGLE process. Otherwise (observed
    // on the Linux CI runner, not on macOS) multiple worker forks run files
    // concurrently against the shared DB: one file's TRUNCATE wipes another
    // file's seeded periods ("period N/2026 not found"), and the env doesn't
    // reach every fork (a file skips because DB_URL is unset). `fileParallelism:
    // false` alone did not prevent this on CI — force a single fork so the whole
    // suite is one serial process sharing the env that setup-env.ts establishes.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
