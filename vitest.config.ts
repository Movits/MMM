import { defineConfig } from "vitest/config";
import path from "path";
import "dotenv/config";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    // Troca DATABASE_URL por DATABASE_URL_TESTES antes de qualquer import:
    // teste nunca fala com o banco do .env de trabalho (pode ser produção).
    setupFiles: ["server/test/setup-banco.ts"],
  },
});
