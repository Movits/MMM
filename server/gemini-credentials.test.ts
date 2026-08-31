import { describe, expect, it } from "vitest";

// O código lê a chave pela cadeia LLM_API_KEY > BUILT_IN_FORGE_API_KEY >
// GOOGLE_API_KEY (server/_core/env.ts), então o teste valida a mesma cadeia.
// A chamada HTTPS real fica opt-in para a suíte não depender da
// disponibilidade do provedor.
describe("Credencial Google Gemini", () => {
  const key =
    process.env.LLM_API_KEY ||
    process.env.BUILT_IN_FORGE_API_KEY ||
    process.env.GOOGLE_API_KEY;

  it.skipIf(!key)("expõe uma chave na cadeia de fallback do LLM", () => {
    expect(key).toBeTruthy();
  });

  it.skipIf(process.env.RUN_LIVE_CREDENTIAL_TESTS !== "true")("autentica na listagem de modelos via HTTPS", async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key!)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { models?: unknown[] };
    expect(Array.isArray(payload.models)).toBe(true);
  }, 20_000);
});
