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
    // test/setup-env.ts now gives each vitest WORKER its OWN database
    // (`erp_test_p<VITEST_POOL_ID>`), so concurrent forks cannot interfere. Within
    // a worker, files run serially and safely share that worker's DB (truncateAll
    // between files). Because that isolation makes concurrency safe, we let vitest
    // parallelize across workers for speed — the previous singleFork /
    // fileParallelism:false serial hacks (which did NOT reliably serialize on the
    // Linux CI runner) are intentionally gone. Keep the generous timeouts.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
