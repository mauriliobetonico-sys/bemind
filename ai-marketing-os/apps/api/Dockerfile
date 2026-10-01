# Imagem da API e do worker (mesmo artefato, entrypoints diferentes).
# Build a partir da raiz do monorepo:  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @aimos/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @aimos/api build \
 && CI=true pnpm install --frozen-lockfile --prod --filter @aimos/api...

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# Estrutura do workspace preservada (o node_modules do pnpm usa links simbólicos).
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/migrations ./apps/api/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
