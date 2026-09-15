FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/sl-bot/package.json apps/sl-bot/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @lake-tech/contracts && npm run build --workspace @lake-tech/core && npm run build --workspace @lake-tech/db && npm run build --workspace @lake-tech/sl-bot
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/apps/sl-bot/dist apps/sl-bot/dist
COPY --from=build --chown=node:node /repo/apps/sl-bot/package.json apps/sl-bot/package.json
COPY --from=build --chown=node:node /repo/packages packages
USER node
CMD ["node", "apps/sl-bot/dist/index.js"]
