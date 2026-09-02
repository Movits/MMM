import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 10 — getInterests EXECUTADA, não só lida no fonte: a guarda
 * "dona OU Ouro" virou a única porta (a procedure agora é protected), então o
 * mutante "remover o throw" precisa morrer aqui.
 */

const getOpportunityById = vi.fn();
const getInterestsByOpportunity = vi.fn(async () => [{ userId: 9, name: "Interessada" }]);
// O router de oportunidades importa dezenas de nomes de ../db; o Proxy entrega
// um stub para qualquer um e mantém reais só os dois que este teste observa.
vi.mock("./db", () => new Proxy({}, {
  has: () => true, // o vitest confere `prop in mock` antes de entregar o export
  get: (_alvo, prop) => {
    if (prop === "getOpportunityById") return (...args: unknown[]) => getOpportunityById(...(args as []));
    if (prop === "getInterestsByOpportunity") return (...args: unknown[]) => getInterestsByOpportunity(...(args as []));
    if (prop === "then" || prop === Symbol.toStringTag) return undefined; // não é uma Promise
    return async () => undefined;
  },
}));
vi.mock("./security", () => ({ createAuditLog: async () => {} }));

const { opportunitiesRouter } = await import("./routers/opportunities");

const ctxComUser = (id: number, role: string) => ({
  user: { id, openId: `u-${id}`, email: "t@local", role },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

beforeEach(() => {
  getOpportunityById.mockReset();
  getInterestsByOpportunity.mockClear();
});

describe("Etapa 10 — interessadas: dona OU Ouro, com a guarda viva", () => {
  it("a criadora COMUM vê as interessadas da própria oportunidade (destrancada)", async () => {
    getOpportunityById.mockResolvedValue({ id: 42, publishedBy: 1 });
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    const lista = await caller.getInterests({ opportunityId: 42 });
    expect(lista[0].name).toBe("Interessada");
  });

  it("comum que NÃO é a dona leva FORBIDDEN — e a lista nem é consultada", async () => {
    getOpportunityById.mockResolvedValue({ id: 42, publishedBy: 2 });
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    await expect(caller.getInterests({ opportunityId: 42 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getInterestsByOpportunity).not.toHaveBeenCalled();
  });

  it("Ouro que não é a dona continua vendo (privilégio do cartão)", async () => {
    getOpportunityById.mockResolvedValue({ id: 42, publishedBy: 2 });
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "gold"));
    await expect(caller.getInterests({ opportunityId: 42 })).resolves.toBeTruthy();
  });

  it("oportunidade inexistente é NOT_FOUND, não vazamento de existência", async () => {
    getOpportunityById.mockResolvedValue(undefined);
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "gold"));
    await expect(caller.getInterests({ opportunityId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
