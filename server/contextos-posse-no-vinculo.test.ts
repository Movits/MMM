import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 5 — posse no vínculo de contexto (auditoria de 04/09, achado crítico).
 *
 * linkContact e addParticipant gravavam em QUALQUER contextId: o db.ts inseria
 * em contact_contexts / context_participants sem olhar a tabela contexts, e
 * listByContact fazia innerJoin em contexts sem a regra de dona — o nome e o
 * tipo de um contexto privado de outra pessoa saíam pela linha que a própria
 * chamadora tinha inserido. uploadMedia, no mesmo router, já checava
 * contextIsVisible; estes dois não. O contactId também não era conferido.
 *
 * O que se trava aqui: posse dos DOIS lados antes de gravar (contexto visível
 * para a dona, contato da dona), NOT_FOUND sem revelar existência, e a regra
 * de dona também na CONSULTA de listagem (defesa em profundidade).
 */

const contextIsVisible = vi.fn(async () => true);
const getPrivateContactById = vi.fn(async (): Promise<{ id: number } | null> => ({ id: 7 }));
const linkContactToContext = vi.fn(async () => "vinculo-1");
const addContextParticipant = vi.fn(async () => "participante-1");

// Sem banco: exigirDb lança, como o db.ts real faz sem DATABASE_URL. Um caminho
// que fosse ao banco falha alto, e não com "export não definido no mock".
vi.mock("./db", async () => ({
  getDb: async () => null,
  exigirDb: async () => { throw new (await import("./banco-indisponivel")).BancoIndisponivel(); },
  listContextTypes: vi.fn(async () => []),
  listContexts: vi.fn(async () => ({ data: [], total: 0 })),
  createContext: vi.fn(),
  getContextById: vi.fn(async () => null),
  updateContext: vi.fn(),
  deleteContext: vi.fn(),
  linkContactToContext: (...args: unknown[]) => linkContactToContext(...(args as [])),
  unlinkContactFromContext: vi.fn(),
  addContextParticipant: (...args: unknown[]) => addContextParticipant(...(args as [])),
  listContextsByContact: vi.fn(async () => []),
  contextIsVisible: (...args: unknown[]) => contextIsVisible(...(args as [])),
  getPrivateContactById: (...args: unknown[]) => getPrivateContactById(...(args as [])),
  addContextMedia: vi.fn(),
  getContextMediaById: vi.fn(async () => null),
  deleteContextMedia: vi.fn(),
  listContextMediaByContext: vi.fn(async () => []),
}));
vi.mock("./storage", () => ({ storagePut: vi.fn(), storageDelete: vi.fn(), chaveDoStorageDaDona: () => null }));

const { contextsRouter } = await import("./routers/contexts");

const ctx = {
  user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;
const caller = contextsRouter.createCaller(ctx);

beforeEach(() => {
  contextIsVisible.mockReset(); contextIsVisible.mockResolvedValue(true);
  getPrivateContactById.mockReset(); getPrivateContactById.mockResolvedValue({ id: 7 });
  linkContactToContext.mockClear();
  addContextParticipant.mockClear();
});

describe("contexts.linkContact — posse dos dois lados antes de gravar", () => {
  it("contexto de outra dona (ou inexistente): NOT_FOUND e nada gravado", async () => {
    contextIsVisible.mockResolvedValue(false);
    await expect(caller.linkContact({ contextId: "ctx-da-outra", contactId: 7 }))
      .rejects.toThrow("NOT_FOUND");
    expect(contextIsVisible).toHaveBeenCalledWith("dona-1", "ctx-da-outra");
    expect(linkContactToContext).not.toHaveBeenCalled();
  });

  it("contato que não é da dona: NOT_FOUND e nada gravado — mesmo com o contexto visível", async () => {
    getPrivateContactById.mockResolvedValue(null);
    await expect(caller.linkContact({ contextId: "ctx-1", contactId: 999 }))
      .rejects.toThrow("NOT_FOUND");
    expect(getPrivateContactById).toHaveBeenCalledWith("dona-1", 999);
    expect(linkContactToContext).not.toHaveBeenCalled();
  });

  it("contexto visível e contato da dona: grava o vínculo em nome da dona", async () => {
    await expect(caller.linkContact({
      contextId: "ctx-1", contactId: 7, city: "Lagos", country: "Nigéria",
      notes: "conheci no jantar da embaixada", relationshipType: "profissional",
    })).resolves.toEqual({ id: "vinculo-1" });
    expect(linkContactToContext).toHaveBeenCalledTimes(1);
    const [dona, dados] = linkContactToContext.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(dona).toBe("dona-1");
    expect(dados).toMatchObject({ contactId: 7, contextId: "ctx-1", city: "Lagos", country: "Nigéria" });
  });

  it("contexto do catálogo (sem dona) continua aceito — contextIsVisible decide, não o router", async () => {
    // O fake diz "visível" para o catálogo, como o db.ts real (ownerId IS NULL).
    await expect(caller.linkContact({ contextId: "catalogo-feira", contactId: 7 }))
      .resolves.toEqual({ id: "vinculo-1" });
  });

  it("cidade ou país acima de 100 caracteres é recusado na entrada, antes de qualquer consulta", async () => {
    await expect(caller.linkContact({ contextId: "ctx-1", contactId: 7, city: "x".repeat(101) }))
      .rejects.toThrow();
    await expect(caller.linkContact({ contextId: "ctx-1", contactId: 7, country: "x".repeat(101) }))
      .rejects.toThrow();
    expect(contextIsVisible).not.toHaveBeenCalled();
    expect(linkContactToContext).not.toHaveBeenCalled();
    // e 100 exatos passam pela entrada (a coluna é varchar(100))
    await expect(caller.linkContact({ contextId: "ctx-1", contactId: 7, city: "x".repeat(100), country: "y".repeat(100) }))
      .resolves.toEqual({ id: "vinculo-1" });
  });
});

describe("contexts.addParticipant — participante avulso só em contexto visível", () => {
  it("contexto de outra dona: NOT_FOUND e nada gravado", async () => {
    contextIsVisible.mockResolvedValue(false);
    await expect(caller.addParticipant({ contextId: "ctx-da-outra", name: "Fulana" }))
      .rejects.toThrow("NOT_FOUND");
    expect(addContextParticipant).not.toHaveBeenCalled();
  });

  it("contexto visível: grava em nome da dona", async () => {
    await expect(caller.addParticipant({ contextId: "ctx-1", name: "Fulana", company: "ACME" }))
      .resolves.toEqual({ id: "participante-1" });
    const [dona, dados] = addContextParticipant.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(dona).toBe("dona-1");
    expect(dados).toMatchObject({ contextId: "ctx-1", name: "Fulana", company: "ACME" });
  });
});

describe("pin de fonte — a regra de dona também na consulta de listagem", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  it("listContextsByContact filtra o contexto por dona OU catálogo, como getContextById", () => {
    const fonte = readFileSync(join(__dirname, "db.ts"), "utf8");
    const inicio = fonte.indexOf("export async function listContextsByContact");
    const fim = fonte.indexOf("export async function addContextParticipant");
    const corpo = fonte.slice(inicio, fim);
    expect(inicio).toBeGreaterThan(0);
    expect(corpo).toContain("innerJoin(contexts, eq(contactContexts.contextId, contexts.id))");
    expect(corpo).toContain("drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId))");
  });

  it("os três procedimentos passam pela mesma porta (contextIsVisible)", () => {
    const fonte = readFileSync(join(__dirname, "routers", "contexts.ts"), "utf8");
    for (const proc of ["linkContact:", "uploadMedia:", "addParticipant:"]) {
      const inicio = fonte.indexOf(proc);
      const corpo = fonte.slice(inicio, inicio + 1500);
      expect(corpo, proc).toContain("contextIsVisible(ctx.user.openId, input.contextId)");
    }
    const link = fonte.slice(fonte.indexOf("linkContact:"), fonte.indexOf("listByContact:"));
    expect(link).toContain("getPrivateContactById(ctx.user.openId, input.contactId)");
  });
});
