import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * O "número do cadastro empresarial" (antes só CNPJ) em `profile.update` e
 * `profile.completeOnboarding`, rodados pelo `createCaller`: o servidor tira
 * hífen, ponto, barra e espaço, aceita letras, não corta em 14 dígitos nem confere
 * dígito verificador, e continua exigindo o campo de MEI, pessoa jurídica e
 * organização sem fins lucrativos. O banco é dublê; o que se confere é o valor
 * que chegaria à coluna `companyCnpj`.
 */

const upsertFalso = vi.fn(async (_userId: number, _dados: Record<string, unknown>) => {});
const atualizacoes: Array<{ tabela: unknown; dados: Record<string, unknown> }> = [];

const fakeDb = {
  update: (tabela: unknown) => ({
    set: (dados: Record<string, unknown>) => {
      atualizacoes.push({ tabela, dados });
      return { where: async () => {} };
    },
  }),
} as never;

vi.mock("./db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirDb: async () => fakeDb,
  upsertUserProfile: (userId: number, dados: Record<string, unknown>) => upsertFalso(userId, dados),
}));

vi.mock("./matching", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  generateMatchesForUser: async () => {},
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { userProfiles } from "../drizzle/schema";
import { CADASTRO_EMPRESARIAL_MAX } from "../shared/business-registration";

type Usuaria = NonNullable<TrpcContext["user"]>;

function chamadora() {
  const user = {
    id: 7,
    openId: "open-7",
    email: "dona@exemplo.com",
    name: "Dona",
    role: "silver",
    loginMethod: "email",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } as Usuaria;
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

const onboardingBase = { displayName: "Dona", city: "Lisboa", country: "PT" };

function cadastroGravadoNoOnboarding() {
  const noPerfil = atualizacoes.find(a => a.tabela === userProfiles);
  return noPerfil?.dados.companyCnpj;
}

beforeEach(() => {
  upsertFalso.mockClear();
  atualizacoes.length = 0;
});

describe("profile.update: número do cadastro empresarial", () => {
  it("grava sem hífen nem pontuação, com letras e mais de 14 caracteres", async () => {
    await chamadora().profile.update({ personType: "legal_entity", companyCnpj: "B-1234.5678/90AB-CD 12345678901234" });

    expect(upsertFalso).toHaveBeenCalledTimes(1);
    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBe("B1234567890ABCD12345678901234");
  });

  it("aceita o número que o dígito verificador do CNPJ recusava", async () => {
    await chamadora().profile.update({ personType: "mei", companyCnpj: "00.000.000/0000-00" });

    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBe("00000000000000");
  });

  it("recusa campo só com pontuação quando o tipo exige o cadastro, e não grava nada", async () => {
    await expect(chamadora().profile.update({ personType: "nonprofit", companyCnpj: "--/--" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Informe o número do cadastro empresarial") });
    expect(upsertFalso).not.toHaveBeenCalled();
  });

  it(`recusa mais de ${CADASTRO_EMPRESARIAL_MAX} letras e números, o tamanho da coluna`, async () => {
    const acimaDoTeto = "A".repeat(CADASTRO_EMPRESARIAL_MAX + 1);

    await expect(chamadora().profile.update({ personType: "legal_entity", companyCnpj: acimaDoTeto }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(`no máximo ${CADASTRO_EMPRESARIAL_MAX}`) });
    expect(upsertFalso).not.toHaveBeenCalled();

    await chamadora().profile.update({ personType: "legal_entity", companyCnpj: "A".repeat(CADASTRO_EMPRESARIAL_MAX) });
    expect(upsertFalso.mock.calls[0][1].companyCnpj).toHaveLength(CADASTRO_EMPRESARIAL_MAX);
  });

  it("pessoa física continua sem cadastro empresarial", async () => {
    await chamadora().profile.update({ personType: "individual", companyCnpj: "12345" });

    expect(upsertFalso.mock.calls[0][1].companyCnpj).toBeNull();
  });
});

describe("profile.completeOnboarding: número do cadastro empresarial", () => {
  it("grava o cadastro alfanumérico normalizado", async () => {
    await chamadora().profile.completeOnboarding({ ...onboardingBase, personType: "mei", companyCnpj: "12.ABC.345/01DE-35" });

    expect(cadastroGravadoNoOnboarding()).toBe("12ABC34501DE35");
  });

  it("recusa MEI sem cadastro e não conclui o onboarding", async () => {
    await expect(chamadora().profile.completeOnboarding({ ...onboardingBase, personType: "mei" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(atualizacoes).toHaveLength(0);
  });
});
