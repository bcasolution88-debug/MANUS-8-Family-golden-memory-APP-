# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app \
  && corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile \
  && pnpm store prune
COPY --from=build /app/dist ./dist

RUN chown -R app:app /app
USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "dist/index.js"]
