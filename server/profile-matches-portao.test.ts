import { describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O portão da demanda expressa na LEITURA dos matches do Dashboard: a linha
 * gravada antes da regra some da lista sem esperar "Reanalisar" — o mesmo
 * lugar (routers/profileMatches.ts) em que a trava de consentimento mora.
 */
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
const matchesBloqueados = vi.fn(async (_userId: number, _ids: number[]) => new Set<number>([3]));
vi.mock("./matching", () => ({
  matchesBloqueadosPelaDemandaExpressa: (...args: unknown[]) => matchesBloqueados(...(args as [number, number[]])),
}));
vi.mock("./db", () => ({
  getDb: async () => null,
  exigirDb: async () => { throw new Error("não deve tocar no banco aqui"); },
  getMatchesForUser: async () => [
    { matchId: 1, matchedUserId: 2, overallScore: 90 },
    { matchId: 2, matchedUserId: 3, overallScore: 80 },
  ],
}));

const { profileMatchesRouter } = await import("./routers/profileMatches");
const ctx = { user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;

describe("profileMatches.list — serviço casado por presunção não volta à tela", () => {
  it("filtra os pares que o portão bloqueia hoje, passando os ids da lista", async () => {
    const lista = await profileMatchesRouter.createCaller(ctx).list({ limit: 20 });
    expect(lista.map(m => m.matchedUserId)).toEqual([2]);
    expect(matchesBloqueados).toHaveBeenCalledWith(1, [2, 3]);
  });
});
