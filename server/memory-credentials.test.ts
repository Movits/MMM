import { describe, expect, it } from "vitest";

describe("Memória Inteligente — credenciais externas", () => {
  it("expõe as chaves necessárias para a integração", () => {
    expect(process.env.OPENAI_API_KEY).toBeTruthy();
    expect(process.env.ANTHROPIC_API_KEY).toBeTruthy();
  });

  // A validação HTTPS real foi executada ao configurar as credenciais. Ela fica
  // opt-in para não tornar a suíte de regressão dependente da disponibilidade dos provedores.
  it.skipIf(process.env.RUN_LIVE_CREDENTIAL_TESTS !== "true")("autentica as chaves nos provedores", async () => {
    const openaiResponse = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    expect(openaiResponse.ok).toBe(true);
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    });
    expect(anthropicResponse.ok).toBe(true);
  }, 25_000);
});
