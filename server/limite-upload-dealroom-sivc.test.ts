import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Limite de upload na Deal Room e no SIVC (quadro Notion, prazo 08/09).
 *
 * Os dois últimos uploads do app fora da regra: fileBase64 era z.string() sem
 * teto e o corpo caía no parser global de 5 MB — arquivo acima de ~3,7 MB
 * voltava como 413 cru, antes de o tRPC rodar. Agora: 15 MB de corpo só
 * nesses dois caminhos (server/_core/index.ts) e 10 MB por documento
 * validados em documento-base64.ts, com mensagem, antes de tocar o storage.
 */

const storagePut = vi.fn(async (chave: string) => ({ key: `${chave}_ab12cd34`, url: `/manus-storage/${chave}_ab12cd34` }));
vi.mock("./storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("./storage")>();
  return { ...real, storagePut: (...args: unknown[]) => storagePut(...(args as [string, Buffer, string])) };
});
vi.mock("./security", () => ({ createAuditLog: async () => {}, createNotification: async () => {} }));
vi.mock("./_core/llm", () => ({ invokeLLM: async () => ({ choices: [{ message: { content: "{}" } }] }) }));

const inserido = vi.fn(async () => {});
const executado = vi.fn(async () => [[{ id: 5 }]]);
const salaAtiva = { id: 7, ownerId: 1, interestedId: 2, opportunityId: 3, status: "active" };
vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    if (prop === "exigirDb") return async () => ({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [salaAtiva] }) }) }),
      insert: () => ({ values: inserido }),
      execute: executado,
    });
    if (prop === "then" || prop === Symbol.toStringTag) return undefined;
    return async () => undefined;
  },
}));

const { decodeDocumentoBase64, nomeSeguroParaChave, MAX_DOCUMENTO_BYTES, MAX_DOCUMENTO_BASE64_CHARS } = await import("./documento-base64");
const { dealRoomRouter } = await import("./routers/dealRoom");
const { sivcRouter } = await import("./routers/sivc");

const ctx = (id: number, role = "silver") => ({
  user: { id, openId: `u-${id}`, email: "t@local", role },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const base64DeBytes = (n: number) => Buffer.alloc(n, 0x41).toString("base64");

beforeEach(() => {
  storagePut.mockClear();
  inserido.mockClear();
  executado.mockClear();
});

describe("documento-base64 — a regra de 10 MB, antes do storage", () => {
  it("aceita arquivo pequeno, com ou sem o cabeçalho data: do FileReader", () => {
    const cru = base64DeBytes(1024);
    expect(decodeDocumentoBase64(cru).length).toBe(1024);
    expect(decodeDocumentoBase64(`data:application/pdf;base64,${cru}`).length).toBe(1024);
  });

  it("aceita exatamente 10 MB e recusa 10 MB + 1 byte, com a mensagem em MB", () => {
    expect(decodeDocumentoBase64(base64DeBytes(MAX_DOCUMENTO_BYTES)).length).toBe(MAX_DOCUMENTO_BYTES);
    expect(() => decodeDocumentoBase64(base64DeBytes(MAX_DOCUMENTO_BYTES + 1)))
      .toThrow(expect.objectContaining({ code: "BAD_REQUEST", message: "O arquivo deve ter no máximo 10 MB." }));
  });

  it("recusa base64 inválido e vazio como BAD_REQUEST, não como erro interno", () => {
    expect(() => decodeDocumentoBase64("isto não é base64!")).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
    expect(() => decodeDocumentoBase64("   ")).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("o cabo do schema Zod cobre 10 MB em base64 com folga para o cabeçalho", () => {
    const dezMB = base64DeBytes(MAX_DOCUMENTO_BYTES).length;
    expect(dezMB).toBeLessThan(MAX_DOCUMENTO_BASE64_CHARS);
    expect(dezMB + "data:application/pdf;base64,".length).toBeLessThan(MAX_DOCUMENTO_BASE64_CHARS);
  });

  it("o nome vira chave sem caminho nem espaço, e nunca vazio", () => {
    expect(nomeSeguroParaChave("../../rg frente.png")).toBe("rg_frente.png");
    expect(nomeSeguroParaChave("C:\\Users\\ana\\comprovante (1).pdf")).toBe("comprovante__1_.pdf");
    expect(nomeSeguroParaChave("///")).toBe("documento");
  });
});

describe("dealRoom.uploadDocument — executa a regra", () => {
  it("documento acima de 10 MB é recusado ANTES do storage e do banco", async () => {
    const caller = dealRoomRouter.createCaller(ctx(1));
    await expect(caller.uploadDocument({
      roomId: 7, name: "contrato.pdf", mimeType: "application/pdf",
      fileBase64: base64DeBytes(MAX_DOCUMENTO_BYTES + 1),
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "O arquivo deve ter no máximo 10 MB." });
    expect(storagePut).not.toHaveBeenCalled();
    expect(inserido).not.toHaveBeenCalled();
  });

  it("documento dentro do limite sobe para deal-rooms/{sala}/ e é registrado", async () => {
    const caller = dealRoomRouter.createCaller(ctx(1));
    await expect(caller.uploadDocument({
      roomId: 7, name: "proposta.pdf", mimeType: "application/pdf",
      fileBase64: `data:application/pdf;base64,${base64DeBytes(2048)}`,
    })).resolves.toMatchObject({ success: true });
    expect(storagePut).toHaveBeenCalledTimes(1);
    const [chave, dados] = storagePut.mock.calls[0] as unknown as [string, Buffer, string];
    expect(chave).toMatch(/^deal-rooms\/7\/\d+-proposta\.pdf$/);
    expect(dados.length).toBe(2048);
    expect(inserido).toHaveBeenCalledTimes(1);
  });
});

describe("sivc.uploadDocument — executa a regra", () => {
  it("documento acima de 10 MB é recusado depois da posse e ANTES do storage", async () => {
    const caller = sivcRouter.createCaller(ctx(1));
    await expect(caller.uploadDocument({
      verificationId: 5, module: "identidade", docType: "rg", mimeType: "image/png", fileName: "rg.png",
      fileBase64: base64DeBytes(MAX_DOCUMENTO_BYTES + 1),
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "O arquivo deve ter no máximo 10 MB." });
    expect(storagePut).not.toHaveBeenCalled();
    // a posse foi conferida (1 SELECT), mas nenhum INSERT aconteceu
    expect(executado).toHaveBeenCalledTimes(1);
  });
});

describe("pins de fonte — o recorte de corpo e os pontos de uso", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  it("index.ts abre 15 MB só para os dois caminhos", () => {
    const fonte = readFileSync(join(__dirname, "_core", "index.ts"), "utf8");
    expect(fonte).toContain('app.use("/api/trpc/dealRoom.uploadDocument", express.json({ limit: "15mb" }));');
    expect(fonte).toContain('app.use("/api/trpc/sivc.uploadDocument", express.json({ limit: "15mb" }));');
    // e o global continua em 5 MB
    expect(fonte).toContain('app.use(express.json({ limit: "5mb" }));');
  });

  it("os dois routers decodificam pelo módulo com limite, e o SIVC usa o nome seguro na chave", () => {
    const dealRoom = readFileSync(join(__dirname, "routers", "dealRoom.ts"), "utf8");
    expect(dealRoom).toContain("decodeDocumentoBase64(input.fileBase64)");
    expect(dealRoom).not.toContain('Buffer.from(input.fileBase64, "base64")');
    const sivc = readFileSync(join(__dirname, "routers", "sivc.ts"), "utf8");
    expect(sivc).toContain("decodeDocumentoBase64(input.fileBase64)");
    expect(sivc).toContain("nomeSeguroParaChave(input.fileName)");
    expect(sivc).not.toContain('Buffer.from(input.fileBase64, "base64")');
  });

  it("as duas telas avisam o mesmo teto do servidor (10 MB)", () => {
    const raiz = join(__dirname, "..", "client", "src", "pages");
    expect(readFileSync(join(raiz, "DealRoom.tsx"), "utf8")).toContain("file.size > 10 * 1024 * 1024");
    expect(readFileSync(join(raiz, "SIVCVerification.tsx"), "utf8")).toContain("file.size > 10 * 1024 * 1024");
    expect(readFileSync(join(raiz, "DealRoom.tsx"), "utf8")).not.toContain("16 * 1024 * 1024");
  });
});
