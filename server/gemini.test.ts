import { describe, expect, it } from "vitest";
import { embedWithGemini, transcribeWithGemini } from "./gemini";

describe("Gemini provider", () => {
  it("gera embedding privado de 768 dimensões", async () => {
    const vector = await embedWithGemini("Rede privada de contatos estratégicos do MMM.", "RETRIEVAL_DOCUMENT");
    expect(vector).toHaveLength(768);
    expect(vector.every(value => Number.isFinite(value))).toBe(true);
  }, 30_000);

  it("interpreta a resposta de transcrição retornada pelo Gemini", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Transcrição de teste" }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    try {
      const result = await transcribeWithGemini({ audio: Buffer.from("audio"), mimeType: "audio/mpeg", language: "pt-BR" });
      expect(result.text).toBe("Transcrição de teste");
      expect(requestedUrl).toContain("models/gemini-3.5-flash:generateContent");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
