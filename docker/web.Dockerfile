FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/sl-bot/package.json apps/sl-bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci
FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Normalize monorepo standalone output while retaining traced root modules.
RUN cp apps/web/.next/standalone/apps/web/server.js apps/web/.next/standalone/server.js && mkdir -p apps/web/.next/standalone/.next && cp -r apps/web/.next/static apps/web/.next/standalone/.next/static
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone .next/standalone
USER node
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
