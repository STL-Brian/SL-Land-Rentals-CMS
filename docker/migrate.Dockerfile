FROM node:24-bookworm-slim
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/sl-bot/package.json apps/sl-bot/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
RUN npm run build --workspace @lake-tech/contracts && npm run build --workspace @lake-tech/core
USER node
CMD ["npm", "run", "db:migrate"]
