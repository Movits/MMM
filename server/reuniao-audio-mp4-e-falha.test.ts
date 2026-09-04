import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Assistente de Reuniões (etapa 3) — dois contratos da auditoria de 04/09:
 *
 * 1. O cabeçalho do FileReader usa o tipo que o NAVEGADOR dá ao arquivo:
 *    um .mp4 chega como "data:video/mp4;base64,..." mesmo com a tela mandando
 *    mimeType audio/mp4, e um arquivo sem tipo vem como
 *    application/octet-stream. Só aceitar "data:audio/" recusava os dois
 *    como "áudio inválido" — arquivos que a tela aceita por extensão.
 * 2. Áudio recusado marca a reunião como FALHA (com o motivo): antes, a
 *    decodificação ficava fora do try e a reunião recém-criada ficava em
 *    "Gravação pendente" para sempre, sem erro e sem como tentar de novo.
 */

const atualizacoes: Array<Record<string, unknown>> = [];
const reuniao = { id: "reuniao-1", ownerId: "dona-1", consentGranted: true, status: "pending" };
vi.mock("./db", () => ({
  getDb: async () => null,
  exigirDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [reuniao] }) }) }),
    update: () => ({ set: (valores: Record<string, unknown>) => ({ where: async () => { atualizacoes.push(valores); } }) }),
    insert: () => ({ values: async () => {} }),
  }),
}));
const storagePut = vi.fn(async () => ({ key: "k", url: "/manus-storage/k" }));
vi.mock("./storage", () => ({
  storagePut: (...args: unknown[]) => storagePut(...(args as [])),
  storageDelete: async () => {},
  storageGetSignedUrl: async () => "https://assinada",
}));
vi.mock("./gemini", () => ({
  transcribeWithGemini: async () => ({ text: "transcrição", segments: [], language: "pt" }),
  embedWithGemini: async () => [], embedManyWithGemini: async () => [],
}));
vi.mock("./_core/llm", () => ({
  invokeLLM: async () => ({ choices: [{ message: { content: JSON.stringify({ entities: [], contacts: [], summary: "" }) } }] }),
}));

const { decodeMeetingAudio, processMeetingRecording } = await import("./meeting-service");

const base64 = (texto: string) => Buffer.from(texto).toString("base64");

beforeEach(() => { atualizacoes.length = 0; storagePut.mockClear(); });

describe("decodeMeetingAudio — o cabeçalho vem do navegador, não da tela", () => {
  it("aceita .mp4 que o navegador tipa como video/mp4, com a tela mandando audio/mp4", () => {
    const audio = decodeMeetingAudio(`data:video/mp4;base64,${base64("reuniao em mp4")}`, "audio/mp4");
    expect(audio.toString()).toBe("reuniao em mp4");
  });

  it("aceita .webm tipado como video/webm e arquivo sem tipo (application/octet-stream)", () => {
    expect(decodeMeetingAudio(`data:video/webm;codecs=vp8,opus;base64,${base64("webm")}`, "audio/webm").toString()).toBe("webm");
    expect(decodeMeetingAudio(`data:application/octet-stream;base64,${base64("sem tipo")}`, "audio/webm").toString()).toBe("sem tipo");
  });

  it("continua recusando o que não é base64 e o mimeType fora da lista", () => {
    expect(() => decodeMeetingAudio("data:video/mp4;base64,isto não é base64!", "audio/mp4")).toThrow("Arquivo de áudio inválido.");
    expect(() => decodeMeetingAudio(base64("x"), "video/mp4")).toThrow("Formato de áudio");
  });
});

describe("processMeetingRecording — áudio recusado vira reunião com falha, não pendente para sempre", () => {
  it("marca status=failed com o motivo e não toca o storage", async () => {
    await expect(processMeetingRecording({
      meetingId: "reuniao-1", ownerId: "dona-1", mimeType: "audio/mp4",
      audioBase64: "data:video/mp4;base64,isto não é base64!", durationSeconds: 30, language: "pt",
    })).rejects.toThrow("Arquivo de áudio inválido.");

    expect(storagePut).not.toHaveBeenCalled();
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]).toMatchObject({ status: "failed", processingError: "Arquivo de áudio inválido." });
  });

  it("formato fora da lista também marca a falha", async () => {
    await expect(processMeetingRecording({
      meetingId: "reuniao-1", ownerId: "dona-1", mimeType: "video/mp4",
      audioBase64: base64("x"), durationSeconds: 30, language: "pt",
    })).rejects.toThrow("Formato de áudio");
    expect(atualizacoes[0]).toMatchObject({ status: "failed" });
    expect(String(atualizacoes[0].processingError)).toContain("Formato de áudio");
  });

  it("áudio válido segue o caminho normal: processing → ready", async () => {
    await expect(processMeetingRecording({
      meetingId: "reuniao-1", ownerId: "dona-1", mimeType: "audio/mp4",
      audioBase64: `data:video/mp4;base64,${base64("reuniao em mp4")}`, durationSeconds: 30, language: "pt",
    })).resolves.toMatchObject({ transcript: "transcrição" });
    expect(storagePut).toHaveBeenCalledTimes(1);
    expect(atualizacoes.map(a => a.status)).toEqual(["processing", "ready"]);
  });
});
