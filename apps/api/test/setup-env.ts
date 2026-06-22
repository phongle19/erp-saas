// Runs BEFORE any test module is imported (vitest `setupFiles`). This matters
// because src/db/tenant-tx.ts calls makeDb() at module-load time, which reads
// process.env.DATABASE_URL immediately. If a developer only sets
// TEST_DATABASE_URL, mirror it into DATABASE_URL here so the connection points
// at the test database rather than the default localhost:5432.
if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
