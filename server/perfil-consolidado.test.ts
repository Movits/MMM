import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Colunas duplicadas de user_profiles — etapa 1 da consolidação.
 *
 * Ficam jobTitle e company; currentRole e currentCompany continuam no banco,
 * não recebem mais valor (o Perfil só as anula) e só tapam buraco na leitura.
 * As metas de curto e longo prazo, que o Onboarding coletava e o servidor
 * descartava, passam a ser gravadas.
 */

const upsertUserProfile = vi.fn(async (_userId: number, _dados: Record<string, unknown>) => {});
const escritas: { tabela: unknown; dados: Record<string, unknown> }[] = [];
const dbFalso = {
  update: (tabela: unknown) => ({
    set: (dados: Record<string, unknown>) => {
      escritas.push({ tabela, dados });
      return { where: async () => {} };
    },
  }),
};

vi.mock("./db", () => ({
  exigirDb: async () => dbFalso,
  getUserProfile: vi.fn(async () => null),
  upsertUserProfile: (userId: number, dados: Record<string, unknown>) => upsertUserProfile(userId, dados),
}));
// O onboarding dispara o cálculo de matches por import dinâmico; aqui ele não interessa.
vi.mock("./matching", () => ({ generateMatchesForUser: vi.fn(async () => {}) }));
// O aceite do Termo Geral de Uso tem teste próprio (termo-geral-de-uso.test.ts);
// aqui a conta já aceitou.
vi.mock("./termo-geral-de-uso", () => ({ exigirAceiteDoTermoGeral: vi.fn(async () => ({ id: "termo-v1", version: 1 })) }));
// A declaração de maioridade tem teste próprio (maioridade.test.ts); aqui a
// checagem é a real e só a linha de auditoria não é gravada.
vi.mock("./maioridade", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarDeclaracaoDeMaioridade: vi.fn(async () => {}),
}));

const { consolidarPerfil, cargoEEmpresaParaGravar } = await import("./perfil-consolidado");
const { profileRouter } = await import("./routers/profile");
const { userProfiles, users } = await import("../drizzle/schema");

const ctx = {
  user: { id: 7, openId: "u-7", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;
const caller = profileRouter.createCaller(ctx);

const ONBOARDING_MINIMO = { displayName: "Ana Souza", city: "Lisboa", country: "PT", declaraMaioridade: true };

const escritaEm = (tabela: unknown) => escritas.find(e => e.tabela === tabela)?.dados;

beforeEach(() => {
  upsertUserProfile.mockClear();
  escritas.length = 0;
});

describe("leitura: a coluna que fica vence, a antiga só tapa buraco", () => {
  it("jobTitle/company preenchidos: os antigos são ignorados", () => {
    const perfil = consolidarPerfil({ jobTitle: "Diretora", currentRole: "Analista", company: "Andina", currentCompany: "Velha Ltda" });
    expect(perfil).toMatchObject({ jobTitle: "Diretora", company: "Andina" });
  });

  it("jobTitle/company vazios (null ou só espaço): vêm de currentRole/currentCompany", () => {
    expect(consolidarPerfil({ jobTitle: null, currentRole: "CEO", company: "  ", currentCompany: "Vinícola" }))
      .toMatchObject({ jobTitle: "CEO", company: "Vinícola" });
  });

  it("os dois vazios: fica o que estava, sem inventar valor", () => {
    expect(consolidarPerfil({ jobTitle: null, currentRole: "", company: undefined, currentCompany: null }))
      .toMatchObject({ jobTitle: null, company: undefined });
  });

  it("não apaga as colunas antigas do objeto (etapa 1 não remove nada)", () => {
    const perfil = consolidarPerfil({ jobTitle: null, currentRole: "CEO", company: null, currentCompany: "X", city: "Lisboa" });
    expect(perfil).toMatchObject({ currentRole: "CEO", currentCompany: "X", city: "Lisboa" });
  });
});

describe("escrita: o que chega do formulário vai para jobTitle/company", () => {
  it("nome novo vence o antigo", () => {
    expect(cargoEEmpresaParaGravar({ jobTitle: "Diretora", currentRole: "Analista", company: "Andina", currentCompany: "Velha" }))
      .toEqual({ jobTitle: "Diretora", company: "Andina" });
  });

  it("só o nome antigo (Onboarding em cache): o valor vai para a coluna nova", () => {
    expect(cargoEEmpresaParaGravar({ currentRole: "CEO", currentCompany: "Vinícola" }))
      .toEqual({ jobTitle: "CEO", company: "Vinícola" });
  });

  it("nada preenchido: undefined, para não sobrescrever com vazio", () => {
    expect(cargoEEmpresaParaGravar({ jobTitle: "", currentRole: "   " })).toEqual({ jobTitle: undefined, company: undefined });
  });
});

describe("profile.completeOnboarding", () => {
  it("grava cargo e empresa em jobTitle/company e nunca em currentRole/currentCompany", async () => {
    await caller.completeOnboarding({ ...ONBOARDING_MINIMO, jobTitle: "Diretora", company: "Andina" });

    const [, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(dadosDoUpsert).not.toHaveProperty("currentRole");
    expect(dadosDoUpsert).not.toHaveProperty("currentCompany");
    expect(escritaEm(userProfiles)).toMatchObject({ jobTitle: "Diretora", company: "Andina" });
  });

  it("cliente antigo mandando currentRole/currentCompany: o valor chega em jobTitle/company", async () => {
    await caller.completeOnboarding({ ...ONBOARDING_MINIMO, currentRole: "CEO", currentCompany: "Vinícola" });

    const [, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(dadosDoUpsert).not.toHaveProperty("currentRole");
    expect(dadosDoUpsert).not.toHaveProperty("currentCompany");
    expect(escritaEm(userProfiles)).toMatchObject({ jobTitle: "CEO", company: "Vinícola" });
  });

  it("as metas de curto e longo prazo são gravadas no perfil", async () => {
    await caller.completeOnboarding({
      ...ONBOARDING_MINIMO,
      shortTermGoal: "Abrir o primeiro distribuidor na Europa",
      longTermGoal: "Exportar para cinco países",
    });

    const [userId, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(userId).toBe(7);
    expect(dadosDoUpsert).toMatchObject({
      shortTermGoal: "Abrir o primeiro distribuidor na Europa",
      longTermGoal: "Exportar para cinco países",
    });
  });

  it("a empresa da conta (users.company) segue recebendo só o campo company, como antes", async () => {
    await caller.completeOnboarding({ ...ONBOARDING_MINIMO, currentCompany: "Vinícola" });

    expect(escritaEm(users)).toMatchObject({ onboardingCompleted: true });
    expect(escritaEm(users)?.company).toBeUndefined();
  });

  it("meta acima de 2000 caracteres é recusada na entrada", async () => {
    await expect(caller.completeOnboarding({ ...ONBOARDING_MINIMO, shortTermGoal: "x".repeat(2001) })).rejects.toThrow();
    expect(upsertUserProfile).not.toHaveBeenCalled();
  });
});

describe("profile.update", () => {
  it("aceita e grava as metas", async () => {
    await caller.update({ shortTermGoal: "Curto", longTermGoal: "Longo" });

    const [, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(dadosDoUpsert).toMatchObject({ shortTermGoal: "Curto", longTermGoal: "Longo" });
  });
});

describe("profile.update: apagar cargo ou empresa no Perfil apaga de verdade", () => {
  // Quem fez o Onboarding antes da consolidação e as contas da carga (o
  // importador grava cargo e empresa nas duas colunas do par).
  const LINHA_COM_COLUNAS_ANTIGAS = { jobTitle: "Diretora", currentRole: "Diretora", company: "Andina", currentCompany: "Andina" };
  // Ida e volta: o UPDATE aplicado sobre a linha e lido pela mesma consolidação do getUserProfile.
  const lerDepoisDoUpdate = (dados: Record<string, unknown>) =>
    consolidarPerfil({ ...LINHA_COM_COLUNAS_ANTIGAS, ...dados } as typeof LINHA_COM_COLUNAS_ANTIGAS);

  it.each([
    ["sem tipo de pessoa", {}],
    ["pessoa física", { personType: "individual" as const }],
  ])("update({ jobTitle: '', company: '' }) anula currentRole/currentCompany e a leitura volta vazia (%s)", async (_ramo, extra) => {
    await caller.update({ jobTitle: "", company: "", ...extra });

    const [, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(dadosDoUpsert).toMatchObject({ jobTitle: "", currentRole: null, company: "", currentCompany: null });
    expect(lerDepoisDoUpdate(dadosDoUpsert)).toMatchObject({ jobTitle: "", company: "" });
  });

  it("update({ jobTitle: 'CEO' }) anula só currentRole: currentCompany fica como estava", async () => {
    await caller.update({ jobTitle: "CEO" });

    const [, dadosDoUpsert] = upsertUserProfile.mock.calls[0];
    expect(dadosDoUpsert).toMatchObject({ jobTitle: "CEO", currentRole: null });
    expect(dadosDoUpsert).not.toHaveProperty("company");
    expect(dadosDoUpsert).not.toHaveProperty("currentCompany");
    expect(lerDepoisDoUpdate(dadosDoUpsert)).toMatchObject({ jobTitle: "CEO", company: "Andina", currentCompany: "Andina" });
  });
});
