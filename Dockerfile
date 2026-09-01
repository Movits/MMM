# Imagem de produção do MMM. Vale para Railway, Render, Fly.io ou qualquer
# host que rode container. O app é um processo Node único: serve a API tRPC
# em /api/trpc e o front-end compilado na mesma origem.

FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable

# patches/ precisa existir antes do install: o package.json referencia
# patches/wouter@3.7.1.patch em pnpm.patchedDependencies.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules vem inteiro do estágio de build, sem um segundo install.
#
# Não use `pnpm install --prod` aqui. O bundle do servidor é gerado com
# esbuild --packages=external, e server/_core/index.ts importa ./vite de
# forma estática para o modo de desenvolvimento. O resultado é que
# dist/index.js carrega no topo `vite`, `@vitejs/plugin-react`,
# `@tailwindcss/vite`, `vite-plugin-manus-runtime` e
# `@builder.io/vite-plugin-jsx-loc`, todos devDependencies. Numa instalação
# só de produção o processo morre no boot com ERR_MODULE_NOT_FOUND, antes de
# atender a primeira requisição.
#
# Isso deixa a imagem maior que o necessário. A correção de verdade é separar
# serveStatic de setupVite e carregar o Vite por import dinâmico só em
# desenvolvimento. Está registrado em docs/deploy.md.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

EXPOSE 3000
CMD ["node", "dist/index.js"]
