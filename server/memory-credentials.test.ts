import { describe, expect, it } from "vitest";

// A Memória Inteligente usa o mesmo provedor do resto do app: embeddings pelo
// Gemini e resposta via invokeLLM, ambos com a cadeia LLM_API_KEY >
// GOOGLE_API_KEY. As versões anteriores deste teste exigiam OPENAI_API_KEY e
// ANTHROPIC_API_KEY, dependências que foram removidas junto com o SDK da
// Anthropic.
describe("Memória Inteligente — credenciais externas", () => {
  const llmKey = process.env.LLM_API_KEY || process.env.GOOGLE_API_KEY;

  it.skipIf(!llmKey)("expõe a chave de LLM usada por embeddings e respostas", () => {
    expect(llmKey).toBeTruthy();
  });

  it.skipIf(process.env.RUN_LIVE_CREDENTIAL_TESTS !== "true")("autentica a chave no provedor", async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(llmKey!)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    expect(response.ok).toBe(true);
  }, 25_000);
});
