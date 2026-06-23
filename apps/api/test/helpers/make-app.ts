import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { makeSql, makeDb, type Db } from '@erp/db';

// Mirror TEST_DATABASE_URL -> DATABASE_URL before AppModule (and its makeDb()
// module-load side effects) are imported. setup-env.ts also does this, but we
// repeat it here so make-app is self-sufficient if used standalone.
if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/test/helpers -> packages/db/drizzle and packages/db/src/rls.sql
const DB_PKG = join(__dirname, '../../../../packages/db');

/**
 * Truncate every table (RESTART IDENTITY CASCADE) and re-seed the VND currency
 * so each test run starts from a known-empty, deterministic state. Run in an
 * admin-context tx so FORCE RLS WITH CHECK allows the currency re-insert.
 */
export async function truncateAll(rawSql: ReturnType<typeof makeSql>): Promise<void> {
  await rawSql.unsafe(`
    TRUNCATE TABLE
      einvoices, sales_invoice_lines, sales_invoices, customer_receipts, business_partners,
      journal_lines, journal_entries, accounting_periods,
      audit_log, coa_mappings, group_chart_of_accounts, chart_of_accounts,
      group_memberships, groups, ownership_links, company_access, companies,
      sessions, users, tax_rules, owner, currencies
    RESTART IDENTITY CASCADE;
  `);
  await rawSql.unsafe(
    `INSERT INTO currencies (code, name, minor_unit_scale) VALUES ('VND', 'Vietnamese Dong', 0)
     ON CONFLICT (code) DO NOTHING;`,
  );
}

/**
 * The Nest application, augmented with the raw sql / drizzle handles bound to
 * the test database so tests can make out-of-band assertions.
 */
export type TestApp = INestApplication & {
  rawSql: ReturnType<typeof makeSql>;
  db: Db;
};

/**
 * Build a fully-initialized Nest app against TEST_DATABASE_URL: run migrations +
 * RLS, truncate all tables, and return the app (with `.rawSql` / `.db` attached
 * for assertions).
 */
export async function makeApp(): Promise<TestApp> {
  if (!process.env.FIELD_ENCRYPTION_KEY) {
    process.env.FIELD_ENCRYPTION_KEY = '0'.repeat(64);
  }
  process.env.SESSION_COOKIE_SECURE = 'false';

  const rawSql = makeSql();
  const db = makeDb(rawSql);

  await migrate(db, { migrationsFolder: join(DB_PKG, 'drizzle') });
  const rls = readFileSync(join(DB_PKG, 'src/rls.sql'), 'utf8');
  await rawSql.unsafe(rls);
  await truncateAll(rawSql);

  // Import AppModule lazily, AFTER DATABASE_URL is set, so its module-load
  // makeDb() calls bind to the test database.
  const { AppModule } = await import('../../src/app.module.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication() as TestApp;
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  app.rawSql = rawSql;
  app.db = db;
  return app;
}

export async function closeApp(app: TestApp): Promise<void> {
  await app?.close();
  await app?.rawSql?.end();
}

/** Run a callback inside an admin-context tenant tx (for raw assertions). */
export { sql };
