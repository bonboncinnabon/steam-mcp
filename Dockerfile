FROM node:22.22.0-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY scripts/clean-dist.mjs scripts/clean-dist.mjs
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM node:22.22.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const port = process.env.PORT ?? 3000; const host = new URL(process.env.MCP_RESOURCE_URI).host; const request = require('node:http').get({ hostname: '127.0.0.1', port, path: '/livez', headers: { host } }, (response) => { response.resume(); response.on('end', () => process.exit(response.statusCode === 200 ? 0 : 1)); }); request.on('error', () => process.exit(1));"]

CMD ["node", "dist/bin/steam-mcp-hosted.js"]
