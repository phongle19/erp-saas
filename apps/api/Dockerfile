# API image. Build context = repo root (see docker-compose.yml).
# glibc base: argon2 (native) prebuilds install cleanly here.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Copy the whole workspace so pnpm can resolve workspace:* deps and build all packages.
COPY . .

# Installs + compiles native deps (argon2) for linux/glibc inside the container.
RUN pnpm install --frozen-lockfile
# turbo builds packages (@erp/db, @erp/domain, @erp/i18n) then apps/api dist.
RUN pnpm build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Bring the entire built workspace (incl. node_modules + pnpm symlinks, compiled
# dist/ for every package, db/drizzle migrations, db/src for the tsx migrate runner).
COPY --from=builder /app /app

EXPOSE 3001
# Apply migrations + RLS (safe: runs as the owner role), then start the API.
CMD ["sh", "-c", "pnpm --filter @erp/db migrate && node apps/api/dist/main.js"]
