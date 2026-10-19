import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Governança (14/09/2026): as duas portas por onde o perfil é gravado
 * (profile.update e profile.completeOnboarding) reavaliam o nível DEPOIS de
 * gravar, com a conta da requisição, e devolvem se ela virou Prata (a tela de
 * Perfil usa isso para reler o selo).
 *
 * No Onboarding a ordem importa: O que tenho / O que preciso vão na SEGUNDA
 * escrita (user_profiles), e reavaliar antes dela avaliaria o perfil sem eles.
 */

const eventos: string[] = [];

const dbFalso = {
  update: (tabela: { [k: symbol]: unknown }) => ({
    set: () => ({
      where: async () => {
        const nome = Object.getOwnPropertySymbols(tabela)
          .map(s => (tabela as Record<symbol, unknown>)[s])
          .find(v => typeof v === "string");
        eventos.push(`update:${String(nome)}`);
      },
    }),
  }),
};

const reavaliar = vi.fn(async (_usuaria: { id: number; role: string }) => {
  eventos.push("reavaliar");
  return { promovidaAPrata: true };
});

vi.mock("./db", () => ({
  exigirDb: async () => dbFalso,
  getUserProfile: vi.fn(async () => null),
  upsertUserProfile: vi.fn(async () => { eventos.push("upsert"); }),
}));
vi.mock("./nivel-do-perfil", () => ({
  reavaliarNivelPeloPerfil: (usuaria: { id: number; role: string }) => reavaliar(usuaria),
}));
vi.mock("./matching", () => ({ generateMatchesForUser: vi.fn(async () => { eventos.push("matches"); }) }));
vi.mock("./termo-geral-de-uso", () => ({ exigirAceiteDoTermoGeral: vi.fn(async () => ({ id: "termo-v1", version: 1 })) }));
// A declaração de maioridade tem teste próprio (maioridade.test.ts); aqui a
// checagem é a real e só a linha de auditoria não é gravada.
vi.mock("./maioridade", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarDeclaracaoDeMaioridade: vi.fn(async () => {}),
}));

const { profileRouter } = await import("./routers/profile");

const usuaria = { id: 9, openId: "u-9", email: "b@local", role: "bronze" };
const caller = profileRouter.createCaller({ user: usuaria, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never);

beforeEach(() => {
  eventos.length = 0;
  reavaliar.mockClear();
});

describe("perfil gravado → nível reavaliado", () => {
  it("profile.update reavalia com a conta da requisição, depois de gravar, e devolve promovidaAPrata", async () => {
    const r = await caller.update({ bio: "Advogada tributarista", company: "Andina" });

    expect(reavaliar).toHaveBeenCalledTimes(1);
    expect(reavaliar.mock.calls[0][0]).toMatchObject({ id: 9, role: "bronze" });
    expect(eventos.indexOf("reavaliar")).toBeGreaterThan(eventos.indexOf("upsert"));
    expect(eventos.at(-1)).toBe("reavaliar");
    expect(r).toEqual({ success: true, promovidaAPrata: true });
  });

  it("profile.completeOnboarding reavalia depois das DUAS escritas (O que tenho/preciso vão na segunda)", async () => {
    const r = await caller.completeOnboarding({
      displayName: "Bia Lima", city: "Porto", country: "PT", declaraMaioridade: true,
      whatIHave: ["imoveis"], whatINeed: ["investidores"],
    });

    expect(reavaliar).toHaveBeenCalledTimes(1);
    const posicao = eventos.indexOf("reavaliar");
    const ultimaEscritaDoPerfil = eventos.lastIndexOf("update:user_profiles");
    expect(ultimaEscritaDoPerfil).toBeGreaterThanOrEqual(0);
    expect(posicao).toBeGreaterThan(ultimaEscritaDoPerfil);
    expect(posicao).toBeGreaterThan(eventos.indexOf("upsert"));
    expect(r).toEqual({ success: true, promovidaAPrata: true });
  });

  it("não promovida: a resposta diz false", async () => {
    reavaliar.mockResolvedValueOnce({ promovidaAPrata: false });
    expect(await caller.update({ city: "Porto" })).toEqual({ success: true, promovidaAPrata: false });
  });
});
