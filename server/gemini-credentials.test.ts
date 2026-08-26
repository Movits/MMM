import { describe, expect, it } from "vitest";

describe("Credencial Google Gemini", () => {
  it("autentica na listagem de modelos via HTTPS", async () => {
    const key = process.env.GOOGLE_API_KEY;
    expect(key).toBeTruthy();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key!)}`);
    expect(response.ok).toBe(true);
    const payload = await response.json() as { models?: unknown[] };
    expect(Array.isArray(payload.models)).toBe(true);
  }, 20_000);
});
