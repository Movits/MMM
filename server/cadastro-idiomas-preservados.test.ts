import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * Concluir o cadastro NÃO pode apagar os idiomas já gravados
 * (`profile.completeOnboarding`, server/routers/profile.ts).
 *
 * Os idiomas saíram da tela do cadastro (Rosber, 14/09 21:08) com o combinado
 * "o servidor continua aceitando, o dado antigo fica". Só que o zod do campo era
 * `z.array(z.string()).default([])`: campo ausente no pedido virava LISTA VAZIA
 * dentro do input, o upsert recebia `languages: []` e o UPDATE gravava vazio por
 * cima. Quem tinha idiomas — perfil importado da planilha, ou preenchido antes
 * da supressão — perdia todos ao terminar o cadastro, em silêncio, sem nenhuma
 * tela mostrando a perda. O conserto é `.optional()`: ausente é ausente, e o
 * Drizzle não toca em coluna que não recebeu.
 *
 * Nenhum teste cobria isso, e não é um detalhe de zod: é um apagamento de dado
 * da usuária disparado pelo caminho mais comum da plataforma. Estes testes leem
 * o que chega ao `upsertUserProfile`, que é onde a escrita se decide.
 */

const upsertFalso = vi.fn();
const fakeDb = {
  update: () => ({ set: () => ({ where: async () => {} }) }),
} as never;

vi.mock("./db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirDb: async () => fakeDb,
  upsertUserProfile: (...args: unknown[]) => upsertFalso(...args),
}));

// O termo, a régua de nível e a geração de matches têm teste próprio e banco
// próprio; aqui só não podem atrapalhar o caminho até a escrita.
vi.mock("./termo-geral-de-uso", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirAceiteDoTermoGeral: async () => {},
}));
vi.mock("./nivel-do-perfil", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  reavaliarNivelPeloPerfil: async () => ({ promovidaAPrata: false }),
}));
vi.mock("./matching", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  generateMatchesForUser: async () => {},
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/** O mínimo que o cadastro exige; nada aqui menciona idiomas. */
const CADASTRO_MINIMO = { displayName: "Ana Souza", city: "Porto Alegre" };

function caller() {
  const ctx = {
    user: {
      id: 7, openId: "open-7", email: "ana@exemplo.com", name: "Ana", role: "bronze",
      isActive: true, onboardingCompleted: false, country: "BR",
    },
    req: { protocol: "https", headers: {}, ip: "203.0.113.9" },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

/** O que o procedimento mandou gravar em user_profiles. */
function dadosGravados(): Record<string, unknown> {
  expect(upsertFalso).toHaveBeenCalledTimes(1);
  return upsertFalso.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  upsertFalso.mockReset();
  upsertFalso.mockResolvedValue(undefined);
});

describe("idiomas fora do envio", () => {
  it("o campo ausente NÃO vira lista vazia: a coluna não é tocada", async () => {
    await caller().profile.completeOnboarding(CADASTRO_MINIMO);
    const dados = dadosGravados();
    expect("languages" in dados).toBe(false);
    expect(dados.languages).toBeUndefined();
  });

  it("o resto do cadastro é gravado normalmente — a ausência não engole nada", async () => {
    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: "Exporto vinho." });
    expect(dadosGravados()).toMatchObject({ displayName: "Ana Souza", city: "Porto Alegre", bio: "Exporto vinho." });
  });
});

describe("idiomas dentro do envio", () => {
  it("o servidor continua aceitando o campo e grava o que veio", async () => {
    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, languages: ["pt-BR", "en"] });
    expect(dadosGravados()).toMatchObject({ languages: ["pt-BR", "en"] });
  });

  it("lista vazia EXPLÍCITA continua apagando: quem manda [] pediu para apagar", async () => {
    // A trava é contra o campo que ninguém mandou, não contra a escolha de
    // quem mandou. Se isto mudar, uma tela que queira limpar os idiomas perde
    // o único jeito de fazer isso.
    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, languages: [] });
    const dados = dadosGravados();
    expect("languages" in dados).toBe(true);
    expect(dados.languages).toEqual([]);
  });
});
