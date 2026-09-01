import { describe, expect, it } from "vitest";

// RESEND_API_KEY ainda não existe em nenhum ambiente: a conta Resend ficou
// adiada até haver domínio institucional (decisão de 30/08 — sem domínio
// verificado, a Resend só entrega para o e-mail do dono da conta). O envio de
// e-mail degrada de forma controlada sem a chave (server/_core/email.ts loga e
// retorna false), então o teste vira opt-in: passa a rodar assim que a chave
// for configurada.
describe("credencial Resend", () => {
  const apiKey = process.env.RESEND_API_KEY;

  it.skipIf(!apiKey)("autentica na API de domínios via HTTPS", async () => {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.status, "A Resend deve aceitar a credencial configurada").toBeGreaterThanOrEqual(200);
    expect(response.status, "A Resend deve aceitar a credencial configurada").toBeLessThan(300);
  }, 15_000);
});
