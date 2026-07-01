# syntax=docker/dockerfile:1

# ---- deps: install once, reused by the build stage ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: generate the Prisma client and build the Next.js app ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime: full node_modules (Prisma CLI needs its own deps at startup,
# see Global Constraints - do not switch this to Next's standalone output) ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 wanderwallet \
  && useradd --system --uid 1001 --gid wanderwallet wanderwallet

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p /app/data /app/uploads && chown -R wanderwallet:wanderwallet /app/data /app/uploads

USER wanderwallet
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
