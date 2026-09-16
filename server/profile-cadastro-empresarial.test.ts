import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O "Número de Cadastro Empresarial" (antes só CNPJ; Rosber, 14/09 20:44) em
 * `profile.update` e `profile.completeOnboarding`, rodados pelo `createCaller`.
 * Comportamento trazido da PR #133 do Gabriel: o servidor tira hífen, ponto,
 * barra e espaço, aceita letras, não corta em 14 dígitos nem confere dígito
 * verificador, e continua exigindo o campo de MEI, pessoa jurídica e
 * organização sem fins lucrativos. O banco é dublê; o que se confere é o valor
 * que chegaria à coluna `companyCnpj`.
 */

const upsertFalso = vi.fn(async (_userId: number, _dados: Record<string, unknown>) => {});
const atualizacoes: Array<{ tabela: unknown; dados: Record<string, unknown> }> = [];

const dbFalso = {
  update: (tabela: unknown) => ({
    set: (dados: Record<string, unknown>) => {
      atualizacoes.push({ tabela, dados });
      return { where: async () => {} };
    },
  }),
};

vi.mock("./db", () => ({
  exigirDb: async () => dbFalso,
  getUserProfile: vi.fn(async () => null),
  upsertUserProfile: (userId: number, dados: Record<string, unknown>) => upsertFalso(userId, dados),
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

const { profileRouter } = await import("./routers/profile");
const { userProfiles } = await import("../drizzle/schema");
const { CADASTRO_EMPRESARIAL_MAX } = await import("../shared/business-registration");

const ctx = {
  user: { id: 7, openId: "open-7", email: "dona@exemplo.com", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;
const chamadora = () => profileRouter.createCaller(ctx);

const onboardingBase = { displayName: "Dona", city: "Lisboa", country: "PT", declaraMaioridade: true };

function cadastroGravadoNoOnboarding() {
  const noPerfil = atualizacoes.find(a => a.tabela === userProfiles);
  return noPerfil?.dados.companyCnpj;
}

beforeEach(() => {
  upsertFalso.mockClear();
  atualizacoes.length = 0;
});

describe("profile.update: Número de Cadastro Empresarial", () => {
  it("grava sem hífen nem pontuação, com letras e mais de 14 caracteres", async () => {
    await chamadora().update({ personType: "legal_entity", companyCnpj: "B-1234.5678/90AB-CD 12345678901234" });

    expect(upsertFalso).toHaveBeenCalledTimes(1);
    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBe("B1234567890ABCD12345678901234");
  });

  it("aceita o número que o dígito verificador do CNPJ recusava", async () => {
    await chamadora().update({ personType: "mei", companyCnpj: "00.000.000/0000-00" });

    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBe("00000000000000");
  });

  it("recusa campo só com pontuação quando o tipo exige o cadastro, e não grava nada", async () => {
    await expect(chamadora().update({ personType: "nonprofit", companyCnpj: "--/--" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Informe o Número de Cadastro Empresarial") });
    expect(upsertFalso).not.toHaveBeenCalled();
  });

  it(`recusa mais de ${CADASTRO_EMPRESARIAL_MAX} letras e números, o tamanho da coluna`, async () => {
    const acimaDoTeto = "A".repeat(CADASTRO_EMPRESARIAL_MAX + 1);

    await expect(chamadora().update({ personType: "legal_entity", companyCnpj: acimaDoTeto }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(`no máximo ${CADASTRO_EMPRESARIAL_MAX}`) });
    expect(upsertFalso).not.toHaveBeenCalled();

    await chamadora().update({ personType: "legal_entity", companyCnpj: "A".repeat(CADASTRO_EMPRESARIAL_MAX) });
    expect(upsertFalso.mock.calls[0][1].companyCnpj).toHaveLength(CADASTRO_EMPRESARIAL_MAX);
  });

  it("colagem acima de 1000 caracteres também é recusada em português, sem o JSON do zod", async () => {
    const mensagem = `O Número de Cadastro Empresarial tem no máximo ${CADASTRO_EMPRESARIAL_MAX} letras e números.`;
    const colagemEnorme = "1".repeat(1001);

    const noPerfil = await chamadora().update({ personType: "legal_entity", companyCnpj: colagemEnorme }).catch(e => e);
    expect(noPerfil).toMatchObject({ code: "BAD_REQUEST", message: mensagem });

    const noCadastro = await chamadora().completeOnboarding({ ...onboardingBase, personType: "mei", companyCnpj: colagemEnorme }).catch(e => e);
    expect(noCadastro).toMatchObject({ code: "BAD_REQUEST", message: mensagem });

    expect(upsertFalso).not.toHaveBeenCalled();
    expect(atualizacoes).toHaveLength(0);
  });

  it("pessoa física continua sem cadastro empresarial", async () => {
    await chamadora().update({ personType: "individual", companyCnpj: "12345" });

    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBeNull();
  });

  it("nenhuma mensagem do servidor fala em CNPJ", async () => {
    const semCadastro = await chamadora().update({ personType: "mei", companyCnpj: "" }).catch(e => e);
    const longo = await chamadora().update({ personType: "mei", companyCnpj: "9".repeat(CADASTRO_EMPRESARIAL_MAX + 1) }).catch(e => e);
    expect(semCadastro.message).not.toMatch(/CNPJ/i);
    expect(longo.message).not.toMatch(/CNPJ/i);
  });
});

describe("profile.completeOnboarding: Número de Cadastro Empresarial", () => {
  it("grava o cadastro alfanumérico normalizado", async () => {
    await chamadora().completeOnboarding({ ...onboardingBase, personType: "mei", companyCnpj: "12.ABC.345/01DE-35" });

    expect(cadastroGravadoNoOnboarding()).toBe("12ABC34501DE35");
  });

  it("recusa MEI sem cadastro e não conclui o onboarding", async () => {
    await expect(chamadora().completeOnboarding({ ...onboardingBase, personType: "mei" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(atualizacoes).toHaveLength(0);
  });
});
