// Vitest `setupFiles` — runs ONCE PER WORKER, BEFORE any test module is imported.
//
// This is load-bearing: src/db/tenant-tx.ts, src/auth/session.util.ts and
// src/auth/auth.service.ts all call makeDb()/makeSql() at MODULE-LOAD time, which
// reads process.env.DATABASE_URL immediately. make-app.ts imports AppModule
// LAZILY (after env is set), so as long as we set DATABASE_URL here — before any
// test module is imported — every pool the app opens binds to the worker's DB.
//
// Per-worker DB isolation (decoupled from vitest pooling): the @erp/api
// integration tests share one database and each calls truncateAll() in beforeAll.
// On the Linux CI runner, vitest ran test FILES concurrently in multiple worker
// forks despite `singleFork`/`fileParallelism:false`, racing on the shared DB
// (TRUNCATE wiping another file's seeded periods, MAX(entry_no)+1 colliding on a
// duplicate key). Rather than rely on vitest serialization, we give each WORKER
// its OWN database. Concurrent forks then can't interfere; within a worker files
// still run serially and may safely share that worker's DB.
import postgres from 'postgres';

// VITEST_POOL_ID is stable within a fork (e.g. "1", "2"); fall back to "1".
const poolId = process.env.VITEST_POOL_ID ?? '1';
const dbName = `erp_test_p${poolId}`;

// Defence-in-depth: dbName is interpolated into CREATE DATABASE (which cannot be
// parameterized). It is always `erp_test_p<digits>`, but validate strictly before
// interpolating, to rule out any identifier injection.
if (!/^erp_test_p[0-9]+$/.test(dbName)) {
  throw new Error(`Refusing to use unsafe per-worker DB name: ${dbName}`);
}

/** Parse host/port/creds from a postgres connection URL. */
function parseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

// Derive everything from the ORIGINAL DATABASE_URL / TEST_DATABASE_URL. A
// developer who only set TEST_DATABASE_URL still gets a sensible base.
const baseUrl =
  process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/erp_test';
const base = parseUrl(baseUrl);

// The `erp` app role is NOSUPERUSER NOCREATEDB and cannot CREATE DATABASE. Use a
// superuser connection ONLY to create the worker DB. Default to the standard
// CI/throwaway-container superuser (postgres/postgres on the same host/port,
// db `postgres`); allow an explicit override via TEST_SUPERUSER_URL.
const superuserUrl =
  process.env.TEST_SUPERUSER_URL ?? `postgres://postgres:postgres@${base.host}:${base.port}/postgres`;

// Create the per-worker DB idempotently. The `erp` app role is NOSUPERUSER
// NOCREATEDB and cannot CREATE DATABASE, so use the superuser connection. This
// runs at module top-level (via top-level await below): vitest awaits each
// setupFile's module evaluation before importing any test module, so the worker
// DB exists and DATABASE_URL is set before make-app.ts imports AppModule.
async function prepareWorkerDatabase(): Promise<void> {
  // Short-lived superuser connection, closed promptly so it does not count
  // against `max_connections` while the worker's app pools are open. `max: 1`
  // plus an awaited end() (below) keeps the superuser footprint to one transient
  // connection per worker.
  const su = postgres(superuserUrl, { max: 1, onnotice: () => {} });
  try {
    const existing = await su`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (existing.length === 0) {
      try {
        // CREATE DATABASE cannot be parameterized; dbName is validated above.
        await su.unsafe(`CREATE DATABASE "${dbName}" OWNER erp`);
      } catch (err: unknown) {
        // 42P04 = duplicate_database: another worker won the race. Benign —
        // the DB exists, which is all we need. Anything else is fatal.
        const code = (err as { code?: string })?.code;
        if (code !== '42P04') throw err;
      }
    }
  } finally {
    // Close the superuser connection PROMPTLY — before the worker's app opens its
    // own pools — so it never contends for a connection slot under heavy forking.
    await su.end({ timeout: 5 });
  }
}

// The per-worker DB the app must use, with `erp` (NOBYPASSRLS) creds so RLS is
// actually enforced. Set this on process.env UNCONDITIONALLY and EARLY — even if
// DB preparation below throws — so a worker never silently falls back to the
// shared base DB or leaves DATABASE_URL unset (which would make a whole test file
// skip). If the DB turns out to be unreachable we fail loudly instead.
const workerUrl = `postgres://erp:erp@${base.host}:${base.port}/${dbName}`;
process.env.DATABASE_URL = workerUrl;
process.env.TEST_DATABASE_URL = workerUrl;

// Bound per-worker pool sizes so total connections (forks × pools-per-worker ×
// max) stay under Postgres `max_connections`. The app opens several pools per
// worker (tenant-tx, auth, session) plus the test rawSql handle; with the small
// default here and maxForks capped in vitest.config.ts the suite stays well
// under the 100-connection default. Allow an explicit override.
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX ?? '5';

await prepareWorkerDatabase();

// Defence-in-depth: confirm the per-worker DB is actually reachable as the `erp`
// role before any test module loads. If the superuser CREATE DATABASE silently
// failed (or the race-handling masked a real error), this surfaces it as a clear,
// immediate failure for THIS worker instead of a confusing downstream skip.
{
  const probe = postgres(workerUrl, { max: 1, onnotice: () => {} });
  try {
    await probe`SELECT 1`;
  } catch (err) {
    throw new Error(
      `setup-env: per-worker database "${dbName}" is not reachable as the erp role ` +
        `at ${base.host}:${base.port}. Original error: ${(err as Error).message}`,
    );
  } finally {
    await probe.end({ timeout: 5 });
  }
}
