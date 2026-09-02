// Preparação comum de todo teste do client (ver vitest.workspace.ts, projeto
// "client"). Roda uma vez por arquivo de teste, antes dos testes dele.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";
import i18n from "@/i18n";

// O Vitest roda sem globals, então a limpeza automática do Testing Library não
// se registra sozinha: sem isto, o DOM de um teste vazaria para o seguinte.
afterEach(() => {
  cleanup();
});

// As telas que usam useTranslation leem o idioma do navegador, e no jsdom isso
// varia com a máquina. Fixa pt-BR para o texto esperado nos testes ser sempre
// o mesmo; um teste que precise de outro idioma chama i18n.changeLanguage.
beforeAll(async () => {
  await i18n.changeLanguage("pt-BR");
});
