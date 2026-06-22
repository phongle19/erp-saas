// NOTE: source schema uses explicit `.js` extensions (NodeNext) so the emitted
// dist is runtime-valid for Node's native ESM loader. drizzle-kit 0.28's default
// esbuild-register loader uses CJS require() and does NOT remap `.js` -> `.ts`,
// so `generate` is run through tsx (see package.json) which resolves correctly.
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://erp:erp@localhost:5432/erp' },
});
