import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

// Pool size is configurable via DB_POOL_MAX so the test runner can bound total
// connections under parallel forks (each worker opens several pools — tenant-tx,
// auth, session, plus the test rawSql handle — so unbounded pools × forks can
// exceed Postgres `max_connections` and surface as connect failures / supertest
// "Parse Error" sockets / skipped files). Production leaves it unset → max 10.
function poolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (raw === undefined) return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

export function makeSql(url = process.env.DATABASE_URL!) {
  return postgres(url, { max: poolMax() });
}
export function makeDb(sql = makeSql()) {
  return drizzle(sql, { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
