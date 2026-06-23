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
    // Cap the number of worker forks. Each worker's app opens several Postgres
    // pools at module load (tenant-tx, auth, session) plus the test rawSql
    // handle. Unbounded forks (vitest defaults to ~#CPUs) multiplied by those
    // pools can exceed Postgres `max_connections` (default 100), causing connect
    // failures that surface as supertest "Parse Error" sockets, skipped files, or
    // rotating ledger/receipts/payment failures. Bounding to 4 forks — combined
    // with DB_POOL_MAX=5 set in test/setup-env.ts — keeps total connections well
    // under 100 (≈ 4 forks × 4 pools × 5 = 80) while preserving per-worker DB
    // isolation and most of the parallel speedup.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
