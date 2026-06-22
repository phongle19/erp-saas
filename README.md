# ERP SaaS — Open-Source Vietnamese ERP & Accounting

A self-hosted, single-tenant ERP and accounting system designed for Vietnamese businesses. Covers multi-regime accounting (Circular 200/133/132/88), e-invoicing (Decree 123/2020), VAT, CIT, PIT, and social insurance, with a Vietnamese-first UI.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [`LICENSE`](./LICENSE) for the full text.

Any modifications deployed over a network must be released as open source under the same license.

## Data Residency

**Data residency is the deployer's responsibility (e.g. Decree 53/2022).**

This software does not enforce any particular hosting jurisdiction. Operators deploying in Vietnam must ensure compliance with the Law on Cybersecurity (24/2018/QH14) and Decree 53/2022/ND-CP regarding localisation of data for Vietnamese users.

## Self-host quickstart

```bash
cp .env.example .env
# generate a real key and put it in .env:
openssl rand -hex 32   # paste into FIELD_ENCRYPTION_KEY
docker compose up -d --build
# first run: bootstrap the admin (Owner)
curl -X POST localhost:3001/auth/bootstrap -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123","displayName":"Admin","ownerName":"My Business"}'
# optional demo data:
docker compose exec api pnpm --filter @erp/db seed
# open http://localhost:3000/vi
```

**Data residency is the deployer's responsibility (e.g. Vietnam's Decree 53/2022).**

> **Before production:** change the default credentials. Set a strong `POSTGRES_PASSWORD`
> and a matching `DATABASE_URL` password (the shipped defaults are `postgres`/`erp` for local
> dev only), set `SESSION_COOKIE_SECURE=true` behind TLS, generate a real `FIELD_ENCRYPTION_KEY`
> (`openssl rand -hex 32`), and use a strong admin bootstrap password (not `changeme123`).

The `api` container connects to Postgres as a **non-superuser, `NOBYPASSRLS`** role
(`erp`) that owns the database, so `FORCE ROW LEVEL SECURITY` is actually enforced.
On startup the `api` container applies migrations + RLS policies, then serves on
`:3001`; the `web` container proxies `/api/*` to the API over the compose network.

## Monorepo Structure

```
apps/
  api/        # NestJS backend (Task 7–9)
  web/        # Next.js frontend (Task 11)
packages/
  domain/     # Money primitives, rule engine (Tasks 2–3)
  db/         # Drizzle schema, migrations, RLS (Tasks 4–6)
docs/
  regulations/  # Vietnamese regulatory index
  glossary.md   # VI↔EN accounting glossary
  open-questions.md
```

## Development Prerequisites

- Node.js >= 22 (see `.nvmrc`)
- pnpm 11.3.0
- Docker (for PostgreSQL + services)

## Toolchain

| Tool | Version |
|------|---------|
| TypeScript | ^5.6 |
| Turbo | ^2.1 |
| ESLint | ^8.57 |
| Prettier | ^3.3 |
| Vitest | ^2.1 |

## Contributing

See `CLAUDE.md` (Task 14) for AI-assisted development guidelines. All contributions must be compatible with AGPL-3.0.
