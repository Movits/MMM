import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Cadastro só para maiores de 18 anos (Roberto, 16/09: "Corrija o sistema para
 * 18 anos"). O Termo Geral de Uso publicado diz na cláusula 3.4 que a
 * plataforma é exclusiva para maiores de idade, e o servidor aceitava idade a
 * partir de 16, sem nenhuma declaração.
 *
 * Prova que:
 *   1. `profile.completeOnboarding` sem `declaraMaioridade`, ou com `false`, é
 *      BAD_REQUEST com a mensagem em português e NADA é lido nem gravado;
 *   2. com `true` o cadastro conclui e a declaração fica na auditoria, com IP,
 *      user-agent e a versão do Termo Geral aceita, gravada ANTES do perfil e
 *      de o cadastro ser marcado como concluído; se essa linha não grava, a
 *      mutation falha e o cadastro não conclui (não há conta concluída sem a
 *      prova);
 *   3. idade 16 e 17 são recusadas (16 era o mínimo antigo) e 18 é gravada;
 *   4. conta que já concluiu o cadastro não é trancada de novo: `profile.update`
 *      segue sem declaração nenhuma.
 *
 * O banco é um dublê em memória; `registrarDeclaracaoDeMaioridade` e
 * `exigirAceiteDoTermoGeral` são os reais, para a prova passar pelo caminho que
 * produção usa.
 */

import { auditLogs, consents, documentVersions, users } from "../drizzle/schema";

type Escrita = { tipo: "insert" | "update"; tabela: unknown; dados: Record<string, unknown> };

const escritas: Escrita[] = [];
const tabelasLidas: unknown[] = [];
const leituras = new Map<unknown, unknown[]>();
const upsertUserProfile = vi.fn(async (_userId: number, _dados: Record<string, unknown>) => {
  escritas.push({ tipo: "update", tabela: "upsertUserProfile", dados: {} });
});
/** Liga a queda da gravação em `audit_logs` (o erro que o driver lançaria). */
let auditoriaFora = false;

const dbFalso = {
  select: (_campos?: unknown) => ({
    from: (tabela: unknown) => ({
      where: () => ({
        limit: async () => {
          tabelasLidas.push(tabela);
          return leituras.get(tabela) ?? [];
        },
      }),
    }),
  }),
  insert: (tabela: unknown) => ({
    values: async (dados: Record<string, unknown>) => {
      if (auditoriaFora && tabela === auditLogs) throw new Error("Connection lost: The server closed the connection.");
      escritas.push({ tipo: "insert", tabela, dados });
    },
  }),
  update: (tabela: unknown) => ({
    set: (dados: Record<string, unknown>) => ({
      where: async () => { escritas.push({ tipo: "update", tabela, dados }); },
    }),
  }),
};

vi.mock("./db", () => ({
  exigirDb: async () => dbFalso,
  getUserProfile: vi.fn(async () => null),
  upsertUserProfile: (userId: number, dados: Record<string, unknown>) => upsertUserProfile(userId, dados),
}));
vi.mock("./nivel-do-perfil", () => ({ reavaliarNivelPeloPerfil: async () => ({ promovidaAPrata: false }) }));
vi.mock("./matching", () => ({ generateMatchesForUser: async () => {} }));

const { profileRouter } = await import("./routers/profile");
const { ACAO_MAIORIDADE_DECLARADA, exigirDeclaracaoDeMaioridade } = await import("./maioridade");
const { IDADE_MINIMA, MENSAGEM_IDADE_ABAIXO_DO_MINIMO, MENSAGEM_MAIORIDADE_NAO_DECLARADA } = await import("../shared/maioridade");
const { exigirCadastroConcluido } = await import("./cadastro-concluido");

const TERMO = { id: "termo-v2", type: "termo_geral_de_uso", version: 2, text: "# TERMO GERAL\n\n3.4. Maiores de 18 anos." };

const ctx = (usuario: Record<string, unknown> = {}) => ({
  user: { id: 7, openId: "u-7", email: "t@local", role: "bronze", ...usuario },
  req: {
    headers: { "user-agent": "Vitest/1.0", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  },
  res: { cookie: () => {} },
}) as never;

const CADASTRO = { displayName: "Ana Souza", city: "Brasília", country: "BR" };

const registrosDeMaioridade = () =>
  escritas.filter(e => e.tipo === "insert" && e.tabela === auditLogs && e.dados.action === ACAO_MAIORIDADE_DECLARADA);

function nadaFoiGravado() {
  expect(upsertUserProfile).not.toHaveBeenCalled();
  expect(escritas).toEqual([]);
}

beforeEach(() => {
  escritas.length = 0;
  tabelasLidas.length = 0;
  leituras.clear();
  upsertUserProfile.mockClear();
  auditoriaFora = false;
  // A conta já aceitou a versão vigente do Termo Geral: o que se testa aqui é a declaração.
  leituras.set(documentVersions, [TERMO]);
  leituras.set(consents, [{ id: 9 }]);
});

describe("a regra é a da cláusula 3.4 do Termo Geral publicado", () => {
  it("o termo diz 18 anos, e a idade mínima do sistema é 18", () => {
    const AQUI = path.dirname(fileURLToPath(import.meta.url));
    const termo = readFileSync(path.resolve(AQUI, "..", "docs", "termos", "termo-geral-de-uso.md"), "utf8");
    // A cláusula inteira: se o jurídico mudar o texto (por exemplo, para cobrir
    // a emancipada), este teste quebra e a regra de shared/maioridade.ts é revista.
    expect(termo).toContain(
      "3.4. O USUÁRIO pessoa física deve ser maior de 18 (dezoito) anos ou, quando aplicável, plenamente capaz nos termos da legislação civil, sendo a PLATAFORMA destinada exclusivamente a maiores de idade, ressalvada indicação expressa em sentido diverso.",
    );
    expect(IDADE_MINIMA).toBe(18);
  });

  it("exigirDeclaracaoDeMaioridade só aceita true", () => {
    for (const valor of [undefined, false]) {
      expect(() => exigirDeclaracaoDeMaioridade(valor)).toThrow(MENSAGEM_MAIORIDADE_NAO_DECLARADA);
    }
    expect(() => exigirDeclaracaoDeMaioridade(true)).not.toThrow();
  });
});

describe("profile.completeOnboarding exige a declaração de maioridade", () => {
  it("sem a declaração: BAD_REQUEST em português, e nada é lido nem gravado", async () => {
    await expect(profileRouter.createCaller(ctx()).completeOnboarding(CADASTRO))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: MENSAGEM_MAIORIDADE_NAO_DECLARADA });
    nadaFoiGravado();
    // A recusa vem antes até da consulta ao Termo Geral.
    expect(tabelasLidas).toEqual([]);
  });

  it("com a declaração false: a mesma recusa, nada gravado", async () => {
    await expect(profileRouter.createCaller(ctx()).completeOnboarding({ ...CADASTRO, declaraMaioridade: false }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: MENSAGEM_MAIORIDADE_NAO_DECLARADA });
    nadaFoiGravado();
  });

  it("com a declaração true: conclui e registra a declaração na auditoria, com a versão do termo aceita", async () => {
    await expect(profileRouter.createCaller(ctx()).completeOnboarding({ ...CADASTRO, declaraMaioridade: true }))
      .resolves.toMatchObject({ success: true });

    const registros = registrosDeMaioridade();
    expect(registros).toHaveLength(1);
    expect(registros[0].dados).toMatchObject({
      userId: 7,
      action: "AGE_MAJORITY_DECLARED",
      resource: "users",
      resourceId: "7",
      details: { idadeMinima: 18, termoGeralVersaoId: "termo-v2", termoGeralVersao: 2, clausula: "3.4" },
      ipAddress: "203.0.113.7",
      userAgent: "Vitest/1.0",
      status: "success",
    });
    // Registrada ANTES de qualquer outra escrita: antes do perfil e antes de o
    // cadastro ser marcado como concluído.
    const conclusao = escritas.findIndex(e => e.tabela === users && e.dados.onboardingCompleted === true);
    expect(conclusao).toBeGreaterThanOrEqual(0);
    expect(escritas.indexOf(registros[0])).toBe(0);
    expect(escritas.findIndex(e => e.tabela === "upsertUserProfile")).toBeGreaterThan(0);
    // A declaração não vira coluna de perfil (não há migração nesta mudança).
    expect(upsertUserProfile.mock.calls[0][1]).not.toHaveProperty("declaraMaioridade");
  });

  it("se a linha da declaração não grava, a mutation falha e o cadastro NÃO conclui", async () => {
    // Antes a linha ia pelo createAuditLog, que engole o erro, e DEPOIS de
    // marcar o cadastro: a conta concluía sem prova nenhuma da declaração.
    auditoriaFora = true;
    const erro = await profileRouter.createCaller(ctx())
      .completeOnboarding({ ...CADASTRO, declaraMaioridade: true })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(registrosDeMaioridade()).toEqual([]);
    expect(escritas.some(e => e.tabela === users && e.dados.onboardingCompleted === true)).toBe(false);
    nadaFoiGravado();
  });

  it("com a declaração e sem o Termo Geral aceito: continua não concluindo", async () => {
    leituras.set(consents, []);
    await expect(profileRouter.createCaller(ctx()).completeOnboarding({ ...CADASTRO, declaraMaioridade: true }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    nadaFoiGravado();
  });
});

describe("idade, quando enviada, vale de 18 para cima", () => {
  it.each([16, 17])("idade %i é recusada e nada é gravado (16 era o mínimo antigo)", async idade => {
    const erro = await profileRouter.createCaller(ctx())
      .completeOnboarding({ ...CADASTRO, declaraMaioridade: true, age: idade })
      .catch((e: unknown) => e);
    expect(erro).toMatchObject({ code: "BAD_REQUEST" });
    expect(String((erro as Error).message)).toContain(MENSAGEM_IDADE_ABAIXO_DO_MINIMO);
    nadaFoiGravado();
  });

  it("idade 18 é aceita e gravada", async () => {
    await expect(profileRouter.createCaller(ctx()).completeOnboarding({ ...CADASTRO, declaraMaioridade: true, age: 18 }))
      .resolves.toMatchObject({ success: true });
    expect(upsertUserProfile.mock.calls[0][1]).toMatchObject({ age: 18 });
  });
});

describe("contas que já concluíram o cadastro não são trancadas de novo", () => {
  it("a trava do cadastro concluído não olha declaração nenhuma", () => {
    expect(() => exigirCadastroConcluido({ onboardingCompleted: true }, "network.list")).not.toThrow();
  });

  it("profile.update de conta concluída salva sem declaração e sem registro de maioridade", async () => {
    await expect(profileRouter.createCaller(ctx({ onboardingCompleted: true })).update({ city: "Porto Alegre" }))
      .resolves.toMatchObject({ success: true });
    expect(upsertUserProfile).toHaveBeenCalledTimes(1);
    expect(registrosDeMaioridade()).toEqual([]);
  });
});
