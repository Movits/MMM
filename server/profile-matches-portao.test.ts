import { describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O portão da demanda expressa na LEITURA dos matches do Dashboard: a linha
 * gravada antes da regra some da lista sem esperar "Reanalisar" — o mesmo
 * lugar (routers/profileMatches.ts) em que a trava de consentimento mora.
 */
const usersComConsentimento = vi.fn(async (ids: number[]) => new Set(ids));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: (...args: unknown[]) => usersComConsentimento(...(args as [number[]])),
}));
const matchesBloqueados = vi.fn(async (_userId: number, _ids: number[]) => new Set<number>([3]));
vi.mock("./matching", () => ({
  matchesBloqueadosPelaDemandaExpressa: (...args: unknown[]) => matchesBloqueados(...(args as [number, number[]])),
}));
const getMatchesForUser = vi.fn(async (_userId: number, _limit: number) => [
  { matchId: 1, matchedUserId: 2, overallScore: 90 },
  { matchId: 2, matchedUserId: 3, overallScore: 80 },
]);
vi.mock("./db", () => ({
  getDb: async () => null,
  exigirDb: async () => { throw new Error("não deve tocar no banco aqui"); },
  getMatchesForUser: (...args: unknown[]) => getMatchesForUser(...(args as [number, number])),
}));

const { profileMatchesRouter } = await import("./routers/profileMatches");
const ctx = { user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;

describe("profileMatches.list — serviço casado por presunção não volta à tela", () => {
  it("filtra os pares que o portão bloqueia hoje, passando os ids da lista", async () => {
    const lista = await profileMatchesRouter.createCaller(ctx).list({ limit: 20 });
    expect(lista.map(m => m.matchedUserId)).toEqual([2]);
    expect(matchesBloqueados).toHaveBeenCalledWith(1, [2, 3]);
  });

  it("lê a janela inteira (50) e corta no limite DEPOIS do portão: a linha bloqueada não ocupa a vaga de um match legítimo", async () => {
    getMatchesForUser.mockResolvedValueOnce([
      { matchId: 1, matchedUserId: 3, overallScore: 95 }, // bloqueada, nota velha e alta
      { matchId: 2, matchedUserId: 2, overallScore: 90 },
      { matchId: 3, matchedUserId: 4, overallScore: 80 },
    ]);
    const lista = await profileMatchesRouter.createCaller(ctx).list({ limit: 2 });
    expect(getMatchesForUser).toHaveBeenCalledWith(1, 50);
    expect(lista.map(m => m.matchedUserId)).toEqual([2, 4]);
  });

  it("só os ids COM termo chegam ao portão: o perfil de quem revogou não é cruzado nem para decidir", async () => {
    matchesBloqueados.mockClear();
    usersComConsentimento.mockResolvedValueOnce(new Set([2]));
    const lista = await profileMatchesRouter.createCaller(ctx).list({ limit: 20 });
    expect(lista.map(m => m.matchedUserId)).toEqual([2]);
    expect(matchesBloqueados).toHaveBeenCalledWith(1, [2]);
  });
});
