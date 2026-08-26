import { describe, expect, it } from "vitest";

describe("credencial Resend", () => {
  it("autentica na API de domínios via HTTPS", async () => {
    const apiKey = process.env.RESEND_API_KEY;
    expect(apiKey, "RESEND_API_KEY deve estar configurada").toBeTruthy();

    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(response.status, "A Resend deve aceitar a credencial configurada").toBeGreaterThanOrEqual(200);
    expect(response.status, "A Resend deve aceitar a credencial configurada").toBeLessThan(300);
  }, 15_000);
});
