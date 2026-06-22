import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeSql, makeDb } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = makeSql();
  const db = makeDb(sql);
  await migrate(db, { migrationsFolder: join(__dirname, '../drizzle') });
  const rls = readFileSync(join(__dirname, 'rls.sql'), 'utf8');
  await sql.unsafe(rls);
  await sql.end();
  console.log('migrations + RLS applied');
}
main().catch((e) => { console.error(e); process.exit(1); });
