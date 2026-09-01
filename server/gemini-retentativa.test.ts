import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Sobrecarga do Gemini não pode virar erro na cara da usuária.
 *
 * Caso real: um 503 "high demand... try again later" no meio do teste de
 * transcrição estourou o JSON cru num toast. O contrato daqui: status
 * passageiro (429/500/503) é retentado com espera; se o modelo de áudio seguir
 * lotado, uma última cartada no modelo reserva; só então um erro em português
 * claro. Erro que não é de sobrecarga (400, chave inválida) sai na hora,
 * sem retentar.
 */

const carregarGemini = async () => {
  vi.resetModules();
  vi.stubEnv("LLM_API_KEY", "chave-somente-para-testes");
  // Reserva fixada: o teste não pode depender do LLM_MODEL do ambiente (se
  // fosse igual ao modelo de áudio, a guarda pularia a reserva de propósito).
  vi.stubEnv("LLM_MODEL", "gemini-flash-lite-latest");
  return import("./gemini");
};

const resposta503 = () => ({ ok: false, status: 503, text: async () => '{"error":{"code":503,"status":"UNAVAILABLE"}}' });
const resposta400 = () => ({ ok: false, status: 400, text: async () => '{"error":{"code":400,"message":"bad request"}}' });
const respostaTranscricao = (texto: string) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: texto }] } }] }),
});

let fetchFalso: ReturnType<typeof vi.fn>;
const audio = { audio: Buffer.from("bytes-de-teste"), mimeType: "audio/wav" as const };

beforeEach(() => {
  vi.useFakeTimers();
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // unstubAllGlobals não devolve o process.env: sem isto, a chave falsa
  // vazaria para os testes vizinhos num runner sem isolamento.
  vi.unstubAllEnvs();
});

describe("Gemini — sobrecarga passageira não derruba a transcrição", () => {
  it("503 na primeira: espera e a segunda tentativa resolve", async () => {
    const { transcribeWithGemini } = await carregarGemini();
    fetchFalso.mockResolvedValueOnce(resposta503()).mockResolvedValueOnce(respostaTranscricao("olá, reunião"));

    const promessa = transcribeWithGemini(audio);
    await vi.advanceTimersByTimeAsync(2100);

    expect((await promessa).text).toBe("olá, reunião");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("modelo de áudio lotado após as retentativas: a reserva assume", async () => {
    const { transcribeWithGemini } = await carregarGemini();
    fetchFalso
      .mockResolvedValueOnce(resposta503())
      .mockResolvedValueOnce(resposta503())
      .mockResolvedValueOnce(resposta503())
      .mockResolvedValueOnce(respostaTranscricao("transcrito pela reserva"));

    const promessa = transcribeWithGemini(audio);
    await vi.advanceTimersByTimeAsync(8000);

    expect((await promessa).text).toBe("transcrito pela reserva");
    expect(fetchFalso).toHaveBeenCalledTimes(4);
    expect(String(fetchFalso.mock.calls[3][0])).toContain("/models/gemini-flash-lite-latest:generateContent");
  });

  it("tudo lotado: erro final em português claro, sem JSON cru", async () => {
    const { transcribeWithGemini } = await carregarGemini();
    fetchFalso.mockResolvedValue(resposta503());

    const promessa = transcribeWithGemini(audio);
    const expectativa = expect(promessa).rejects.toThrow(/alta demanda.*tente de novo/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectativa;
    expect(fetchFalso).toHaveBeenCalledTimes(4); // 3 no modelo de áudio + 1 na reserva
  });

  it("erro que não é de sobrecarga (400) sai na hora, sem retentar", async () => {
    const { transcribeWithGemini } = await carregarGemini();
    fetchFalso.mockResolvedValue(resposta400());

    await expect(transcribeWithGemini(audio)).rejects.toThrow(/Gemini indisponível \(400\)/);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("embeddings passam pela mesma retentativa", async () => {
    const { embedWithGemini } = await carregarGemini();
    fetchFalso
      .mockResolvedValueOnce(resposta503())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ embedding: { values: new Array(768).fill(0.1) } }) });

    const promessa = embedWithGemini("texto");
    await vi.advanceTimersByTimeAsync(2100);

    expect(await promessa).toHaveLength(768);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });
});
