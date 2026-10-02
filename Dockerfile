# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json next.config.ts instrumentation.ts ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
# Server flags and credentials are supplied only at runtime. A build never starts
# the personal analysis worker or requires a Codex installation/sign-in.
RUN npm run build && rm -rf .next/cache

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json tsconfig.json next.config.ts ./
# SIWC's explicit connection CLI uses tsx and source modules. tsx is a production
# dependency; no Codex binary, desktop token store or personal documents are copied.
COPY lib ./lib
COPY scripts/connect-chatgpt.ts ./scripts/connect-chatgpt.ts
COPY scripts/host-server.mjs scripts/voice-relay.mjs ./scripts/
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs

RUN mkdir -p /app/.data/siwc \
    && chown -R node:node /app/.data /app/.next \
    && chmod 700 /app/.data /app/.data/siwc

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 \
    CMD ["node", "deploy/healthcheck.mjs"]
CMD ["node", "scripts/host-server.mjs"]
