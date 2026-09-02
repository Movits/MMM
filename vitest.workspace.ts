import react from "@vitejs/plugin-react";
import path from "path";
import { defineWorkspace } from "vitest/config";

// Um "pnpm test" (vitest run) roda os dois projetos abaixo. Antes só existia o
// servidor: o client passava apenas por tsc e build, sem nenhum teste de
// comportamento. Filtrar por arquivo continua funcionando, por exemplo
// "pnpm vitest run server/match-service.test.ts": o projeto que não bate com o
// filtro simplesmente não roda nada.
//
// O projeto client NÃO estende vitest.config.ts de propósito: a fusão do Vite
// concatena arrays, e o "include" de server/** viria junto, fazendo o jsdom
// rodar a suíte do servidor. Por isso os aliases são repetidos aqui.
const raiz = path.resolve(import.meta.dirname);
const aliases = {
  "@": path.resolve(raiz, "client", "src"),
  "@shared": path.resolve(raiz, "shared"),
};

export default defineWorkspace([
  {
    // Herda de vitest.config.ts os aliases e o carregamento do .env; os
    // valores abaixo repetem o que já está lá, só para o leitor não ter que
    // abrir o outro arquivo.
    extends: "./vitest.config.ts",
    test: {
      name: "server",
      environment: "node",
      include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    },
  },
  {
    root: raiz,
    // O plugin do React garante o JSX automático (sem "import React") nos
    // componentes, igual ao build do Vite.
    plugins: [react()],
    resolve: { alias: aliases },
    test: {
      name: "client",
      environment: "jsdom",
      include: ["client/src/**/*.test.tsx"],
      setupFiles: ["client/src/test/setup.ts"],
    },
  },
]);
