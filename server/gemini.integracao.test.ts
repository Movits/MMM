import { describe, expect, it } from "vitest";
import { ENV } from "./_core/env";
import { embedWithGemini } from "./gemini";

/**
 * Conferência contra a API do Google DE VERDADE — a única coisa que pega o
 * modelo mudar de nome, ser descontinuado, ou mudar o formato da resposta.
 * Nenhum `fetch` trocado pega isso, e já aconteceu neste projeto: o modelo
 * 2.5 Flash foi descontinuado para chaves novas.
 *
 * Fica separada do `gemini.test.ts` porque aquele arquivo troca o módulo de
 * ambiente por inteiro para não depender de chave nenhuma. Aqui é o contrário:
 * sem chave de verdade não há o que conferir.
 *
 * Pulada quando não há chave, e de propósito em silêncio. Exigir segredo para a
 * suíte ficar verde faria o time aprender a ignorar vermelho, que é pior do que
 * não ter a conferência.
 *
 * Para rodar:  LLM_API_KEY=... pnpm test server/gemini.integracao.test.ts
 */
describe.skipIf(!ENV.llmApiKey)("Gemini — contra a API real", () => {
  it("o modelo de embedding ainda existe e devolve 768 dimensões", async () => {
    const vetor = await embedWithGemini("Rede privada de contatos estratégicos do MMM.", "RETRIEVAL_DOCUMENT");
    expect(vetor).toHaveLength(768);
    expect(vetor.every(Number.isFinite)).toBe(true);
  }, 30_000);
});
