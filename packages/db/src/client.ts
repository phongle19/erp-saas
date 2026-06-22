import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index';

export function makeSql(url = process.env.DATABASE_URL!) {
  return postgres(url, { max: 10 });
}
export function makeDb(sql = makeSql()) {
  return drizzle(sql, { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
