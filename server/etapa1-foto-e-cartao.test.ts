import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 1 — os dois campos de imagem que a auditoria de 03/09 achou quebrados:
 *
 * 1. Foto e Cartão de Visita eram o MESMO campo na tela, mal rotulado — o
 *    valor digitado gravava em photoUrl mesmo com o rótulo "Cartão de
 *    Visita", e cardImageUrl nunca era enviado nem aceito no create.
 * 2. Não existia upload de arquivo — só colar uma URL.
 *
 * Estes testes cobrem: o schema do create aceita cardImageUrl e o repassa
 * intacto (não colide com photoUrl); os dois endpoints de upload validam
 * tipo/tamanho e gravam sob o prefixo correto; o storageProxy só libera a
 * imagem para a própria dona.
 */

const createPrivateContact = vi.fn(async () => 7);
const updatePrivateContact = vi.fn(async () => true);
vi.mock("./db", async () => ({
  getDb: async () => null,
  exigirDb: async () => { throw new (await import("./banco-indisponivel")).BancoIndisponivel(); },
  createPrivateContact: (...args: unknown[]) => createPrivateContact(...(args as [])),
  updatePrivateContact: (...args: unknown[]) => updatePrivateContact(...(args as [])),
  deletePrivateContact: async () => true,
  listPrivateContacts: async () => ({ data: [], total: 0 }),
  getPrivateContactById: async () => null,
  listVitrineColetiva: async () => [],
  getMatchesForUser: async () => [],
  dismissMatch: async () => {},
  regenerateMatches: async () => 0,
}));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
vi.mock("./match-service", () => ({
  recalculatePrivateMatches: async () => ({ created: 0, updated: 0, removed: 0, total: 0 }),
}));

const storagePut = vi.fn(async (chave: string) => ({ key: chave + "_ab12cd34", url: `/manus-storage/${chave}_ab12cd34` }));
vi.mock("./storage", () => ({
  storagePut: (...args: unknown[]) => storagePut(...(args as [string, Buffer, string])),
}));

const { networkRouter } = await import("./routers/network");
const { podeBaixarChave } = await import("./_core/storageProxy");

const ctx = {
  user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

beforeEach(() => {
  createPrivateContact.mockClear();
  updatePrivateContact.mockClear();
  storagePut.mockClear();
});

describe("Etapa 1 — Foto e Cartão de Visita são campos distintos", () => {
  const rede = networkRouter.createCaller(ctx);

  it("create aceita cardImageUrl e o repassa junto com photoUrl, sem colidir", async () => {
    await rede.create({
      fullName: "Ana",
      photoUrl: "/manus-storage/contacts/dona-1/foto_x.jpg",
      cardImageUrl: "/manus-storage/contacts/dona-1/cartao_y.jpg",
    });
    const recebido = createPrivateContact.mock.calls[0][1] as Record<string, unknown>;
    expect(recebido.photoUrl).toBe("/manus-storage/contacts/dona-1/foto_x.jpg");
    expect(recebido.cardImageUrl).toBe("/manus-storage/contacts/dona-1/cartao_y.jpg");
    expect(recebido.photoUrl).not.toBe(recebido.cardImageUrl);
  });

  it("create funciona sem nenhuma imagem (nenhum dos dois é obrigatório)", async () => {
    await rede.create({ fullName: "Bia" });
    const recebido = createPrivateContact.mock.calls[0][1] as Record<string, unknown>;
    expect(recebido.photoUrl).toBeUndefined();
    expect(recebido.cardImageUrl).toBeUndefined();
  });

  it("um caminho de proxy (não é URL http) passa no schema — a validação antiga (.url()) o teria rejeitado", async () => {
    // Antes do conserto, photoUrl usava z.string().url(); um caminho de proxy
    // como "/manus-storage/..." falha nessa validação (não é URL absoluta).
    await expect(rede.create({
      fullName: "Carla",
      photoUrl: "/manus-storage/contacts/dona-1/foto_z.jpg",
    })).resolves.toEqual({ id: 7 });
  });

  it("update aceita os dois campos independentemente", async () => {
    await rede.update({ id: 7, cardImageUrl: "/manus-storage/contacts/dona-1/cartao_novo.jpg" });
    const recebido = updatePrivateContact.mock.calls[0][2] as Record<string, unknown>;
    expect(recebido.cardImageUrl).toBe("/manus-storage/contacts/dona-1/cartao_novo.jpg");
    expect(recebido.photoUrl).toBeUndefined();
  });
});

describe("Etapa 1 — upload real (uploadPhoto / uploadCard)", () => {
  const rede = networkRouter.createCaller(ctx);
  const pngMinimo = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  it("uploadPhoto grava sob contacts/{openId}/foto.* e devolve a URL do proxy", async () => {
    const res = await rede.uploadPhoto({ fileName: "eu.png", mimeType: "image/png", dataBase64: `data:image/png;base64,${pngMinimo}` });
    expect(storagePut).toHaveBeenCalledTimes(1);
    const [chave] = storagePut.mock.calls[0];
    expect(chave).toBe("contacts/dona-1/foto.png");
    expect(res.url).toContain("/manus-storage/contacts/dona-1/foto.png");
  });

  it("uploadCard grava sob contacts/{openId}/cartao.* — chave diferente da foto", async () => {
    await rede.uploadCard({ fileName: "cartao.png", mimeType: "image/png", dataBase64: `data:image/png;base64,${pngMinimo}` });
    const [chave] = storagePut.mock.calls[0];
    expect(chave).toBe("contacts/dona-1/cartao.png");
  });

  it("rejeita PDF — o requisito pede imagem, diferente da mídia de contexto que aceita documento", async () => {
    await expect(rede.uploadPhoto({
      fileName: "doc.pdf", mimeType: "application/pdf" as never, dataBase64: `data:application/pdf;base64,${pngMinimo}`,
    })).rejects.toThrow();
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("rejeita arquivo acima de 10 MB antes de chamar o storage", async () => {
    const onzeMB = "A".repeat(Math.ceil((11 * 1024 * 1024 * 4) / 3));
    await expect(rede.uploadPhoto({
      fileName: "grande.png", mimeType: "image/png", dataBase64: `data:image/png;base64,${onzeMB}`,
    })).rejects.toThrow(/10 ?MB/);
    expect(storagePut).not.toHaveBeenCalled();
  });
});

describe("Etapa 1 — storageProxy: foto e cartão de visita só para a própria dona", () => {
  const buscarSalaFake = async () => null;

  it("dona baixa a própria foto", async () => {
    const ok = await podeBaixarChave(
      { id: 1, openId: "dona-1", role: "silver" },
      "contacts/dona-1/foto.png",
      buscarSalaFake,
    );
    expect(ok).toBe(true);
  });

  it("outra usuária é barrada", async () => {
    const ok = await podeBaixarChave(
      { id: 2, openId: "dona-2", role: "silver" },
      "contacts/dona-1/foto.png",
      buscarSalaFake,
    );
    expect(ok).toBe(false);
  });

  it("Ouro/admin/president NÃO ganham acesso automático — diferente da Deal Room, foto de contato é sempre privada", async () => {
    const ok = await podeBaixarChave(
      { id: 99, openId: "gold-1", role: "admin" },
      "contacts/dona-1/cartao.png",
      buscarSalaFake,
    );
    expect(ok).toBe(false);
  });
});
