import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Este arquivo existe por causa de uma falha que já aconteceu.
 *
 * A trava do cruzamento era uma linha escrita à mão na primeira linha de cada
 * procedimento. Dois ficaram sem ela: `contacts`, que devolvia nome e empresa
 * de toda a rede particular, e `updateStatus`, que deixava aceitar e dispensar
 * matches a quem havia revogado o termo. Ninguém percebeu porque o teste
 * existente conferia procedimento por procedimento, e ninguém escreve teste
 * para o procedimento de que esqueceu.
 *
 * A correção foi trocar a linha repetida por um middleware. Este teste é o que
 * impede a regressão, e o jeito como ele é escrito é o ponto: ele NÃO tem uma
 * lista de procedimentos. Ele pergunta ao router quais existem e cobra de todos.
 * Um procedimento acrescentado amanhã já nasce coberto, e se nascer sem trava
 * este teste fica vermelho sem ninguém ter de lembrar de nada.
 */

let consentimentoValido = false;

vi.mock("./routers/consent", async importarOriginal => ({
  ...(await importarOriginal<typeof import("./routers/consent")>()),
  hasValidConsent: vi.fn(async () => consentimentoValido),
}));

vi.mock("./db", async () => {
  const { BancoIndisponivel } = await import("./banco-indisponivel");
  return {
    getDb: vi.fn(async () => null),
    // Banco fora do ar de propósito: o que se testa é a trava, e depois dela o
    // procedimento deve cair com BancoIndisponivel, nunca com lista vazia.
    exigirDb: vi.fn(async () => { throw new BancoIndisponivel(); }),
    upsertUser: vi.fn(),
    getUserByOpenId: vi.fn(),
  };
});

const { intelligentMatchesRouter } = await import("./routers/matches");
const { MENSAGEM_BANCO_INDISPONIVEL } = await import("./banco-indisponivel");

const contextoDeUsuariaLogada = {
  user: { id: 1, openId: "email_teste", email: "teste@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

/** Os nomes vêm do próprio router, não de uma lista escrita à mão. */
const procedimentos = Object.keys(intelligentMatchesRouter._def.procedures);

describe("Etapa 11 — nenhum procedimento do cruzamento escapa da trava", () => {
  beforeEach(() => { consentimentoValido = false; });

  it("o router tem procedimentos para conferir", () => {
    // Se o router mudar de forma e a introspecção devolver vazio, todos os
    // testes abaixo passariam sem exercitar nada. Esta é a guarda contra isso.
    expect(procedimentos.length).toBeGreaterThanOrEqual(6);
  });

  it.each(procedimentos)("%s recusa quem não aceitou o termo", async nome => {
    const caller = intelligentMatchesRouter.createCaller(contextoDeUsuariaLogada);

    // Entrada de propósito inválida: a trava roda antes da validação, então o
    // erro esperado é FORBIDDEN. Se vier BAD_REQUEST, o procedimento validou a
    // entrada primeiro — ou seja, chegou a olhar o pedido de quem não podia.
    await expect(
      (caller as Record<string, (entrada?: unknown) => Promise<unknown>>)[nome](undefined),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "SMART_MATCH_CONSENT_REQUIRED" });
  });

  it("com o termo aceito, a trava sai da frente", async () => {
    // Sem isto, um middleware que recusasse SEMPRE passaria em todos os testes
    // acima e desligaria o recurso para todo mundo.
    consentimentoValido = true;
    const caller = intelligentMatchesRouter.createCaller(contextoDeUsuariaLogada);

    // O banco está fora do ar neste arquivo, então o procedimento falha logo
    // depois da trava, e falha do jeito certo: BancoIndisponivel traduzida pelo
    // middleware do tRPC, não FORBIDDEN e não lista vazia.
    await expect(caller.list()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: MENSAGEM_BANCO_INDISPONIVEL,
    });
  });
});
