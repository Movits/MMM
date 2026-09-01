import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Embeddings em lote: o plano do Gemini conta REQUISIÇÕES por minuto, não
 * textos. Um lote inteiro em batchEmbedContents custa 1 requisição — indexar
 * documento a documento custava N, e era isso que estourava o ritmo na primeira
 * indexação de uma base grande. O contrato: uma chamada por lote, vetores na
 * ordem dos textos, e resposta malformada recusada em vez de gravada.
 */

const carregarGemini = async () => {
  vi.resetModules();
  vi.stubEnv("LLM_API_KEY", "chave-somente-para-testes");
  return import("./gemini");
};

let fetchFalso: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const respostaDeLote = (quantos: number) => ({
  ok: true, status: 200,
  json: async () => ({ embeddings: Array.from({ length: quantos }, () => ({ values: new Array(768).fill(0.1) })) }),
});

describe("Gemini — embeddings em lote", () => {
  it("três textos, uma requisição só, com 768 dimensões cada", async () => {
    const { embedManyWithGemini } = await carregarGemini();
    fetchFalso.mockResolvedValueOnce(respostaDeLote(3));

    const vetores = await embedManyWithGemini(["a", "b", "c"], "RETRIEVAL_DOCUMENT");

    expect(vetores).toHaveLength(3);
    expect(vetores.every(vetor => vetor.length === 768)).toBe(true);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(String(fetchFalso.mock.calls[0][0])).toContain(":batchEmbedContents");
    const corpo = JSON.parse((fetchFalso.mock.calls[0][1] as { body: string }).body);
    expect(corpo.requests).toHaveLength(3);
    expect(corpo.requests[0].content.parts[0].text).toBe("a");
    expect(corpo.requests[2].content.parts[0].text).toBe("c");
    expect(corpo.requests[0].outputDimensionality).toBe(768);
  });

  it("lote vazio nem chama a API", async () => {
    const { embedManyWithGemini } = await carregarGemini();

    expect(await embedManyWithGemini([], "RETRIEVAL_DOCUMENT")).toEqual([]);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("resposta com contagem errada de vetores é recusada", async () => {
    const { embedManyWithGemini } = await carregarGemini();
    fetchFalso.mockResolvedValueOnce(respostaDeLote(2));

    await expect(embedManyWithGemini(["a", "b", "c"])).rejects.toThrow(/cada texto do lote/);
  });
});
