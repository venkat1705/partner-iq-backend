# syntax=docker.io/docker/dockerfile:1

FROM node:22-alpine AS base

# ---- Dependencies (full, for building) ------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Production-only dependencies ------------------------------------------
FROM base AS deps-prod
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Build ------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Plain tsc, CommonJS output (package.json has no "type" field, so .js is
# CommonJS by default) — no ts-node/experimental flags needed at runtime.
RUN npm run build

# ---- Runtime ------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --from=deps-prod /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ormconfig.cjs ./

USER nestjs

EXPOSE 5000
ENV PORT=5000

# The real entrypoint is src/main.ts (compiled to dist/src/main.js) — not the
# root server.ts, which is a separate, older, unused duplicate bootstrap that
# happens to still compile alongside it. --worker (see docker-compose.yml)
# is read by main.ts itself to switch into worker mode on the same file.
CMD ["node", "dist/src/main.js"]
