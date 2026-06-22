# Web image (Next.js 16 production). Build context = repo root.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV CI=true
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile
# Builds workspace packages (@erp/i18n) then the Next app.
RUN pnpm build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

# Full built workspace keeps next + workspace symlinks intact.
COPY --from=builder /app /app

WORKDIR /app/apps/web
EXPOSE 3000
# API_URL is supplied at runtime (compose) and read by next.config rewrites.
CMD ["pnpm", "start", "-p", "3000"]
