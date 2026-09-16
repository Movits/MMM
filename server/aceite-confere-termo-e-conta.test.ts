import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * O ACEITE RECONFERE O TERMO DAS DUAS PARTES E A CONTA DE QUEM PEDIU.
 *
 * A trava é do Nicolas (#136, validação das #108 e #110) e ficou de fora quando
 * a entrega incorporou o resto daquela PR. O buraco: entre o encaminhamento do
 * pedido e o aceite, quem pediu pode ter revogado o termo do Smart Match
 * (`consent.revoke` só grava `revokedAt`, não mexe no pedido) ou ter tido a
 * conta desativada — e a linha `pending` continua aparecendo na aba Conexões,
 * porque `connections.list` não olha o termo. Aceitar ali revelava os dois
 * nomes de quem já tinha tirado o consentimento, e ainda mandava um aviso.
 *
 * São as mesmas travas que `distribuicao.decidir` já fazia no encaminhamento.
 *
 * O que fica travado aqui:
 *   1. termo revogado por quem PEDIU → erro, nada revelado, nada avisado;
 *   2. conta de quem pediu desativada → o mesmo erro, com a mesma mensagem, que
 *      não conta a quem aceita quem saiu (o pedido pendente é anônimo);
 *   3. termo revogado por quem ACEITA → erro dizendo o que ela precisa fazer;
 *   4. tudo em ordem → o aceite acontece como sempre;
 *   5. a RECUSA não passa pela trava: recusar não revela nada;
 *   6. pedido que não é dela, ou fora de `pending`, segue para o banco sem a
 *      trava — senão a resposta viraria um oráculo sobre pedidos alheios.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as string[],
  /** Forma de `respondToConnection` em server/db.ts. */
  resposta: { revelou: true, contraparte: 2 },
  /** A linha de `lerPedidoDeMatch`: pedido da conta 2 para a conta 1, encaminhado. */
  pedido: { id: 7, requesterId: 2, recipientId: 1, status: "pending" } as
    { id: number; requesterId: number; recipientId: number; status: string } | null,
  comTermo: [1, 2] as number[],
  ativas: [1, 2] as number[],
}));

vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    if (typeof prop === "symbol" || prop === "then" || prop === "default") return undefined;
    return async (...args: unknown[]) => {
      estado.chamadas.push(String(prop));
      if (prop === "respondToConnection") return estado.resposta;
      if (prop === "lerPedidoDeMatch") return estado.pedido;
      if (prop === "idsDeContasAtivas") return new Set((args[0] as number[]).filter(id => estado.ativas.includes(id)));
      if (prop === "idsDosDistribuidoresAtivos" || prop === "idsDaPresidenciaAtiva") return [];
      return undefined;
    };
  },
}));

vi.mock("./routers/consent", () => ({
  usersComConsentimento: async (ids: number[]) => new Set(ids.filter(id => estado.comTermo.includes(id))),
  getCurrentDocument: async () => null,
  hasValidConsent: async () => true,
}));

vi.mock("./audit", () => ({ createAuditLog: async () => {} }));

import { connectionsRouter } from "./routers/connections";

const ctx = (id: number) => ({
  user: { id, openId: `u-${id}`, email: "t@local", role: "silver" },
  req: { headers: { "user-agent": "Vitest/1.0" }, socket: { remoteAddress: "127.0.0.1" } },
  res: { cookie: () => {} },
}) as never;

const aceitar = (quem = 1) => connectionsRouter.createCaller(ctx(quem)).respond({ connectionId: 7, accept: true });

beforeEach(() => {
  estado.chamadas = [];
  estado.resposta = { revelou: true, contraparte: 2 };
  estado.pedido = { id: 7, requesterId: 2, recipientId: 1, status: "pending" };
  estado.comTermo = [1, 2];
  estado.ativas = [1, 2];
});

describe("aceitar um pedido de interesse", () => {
  it("com tudo em ordem, aceita e revela", async () => {
    await expect(aceitar()).resolves.toEqual({ success: true });
    expect(estado.chamadas).toContain("respondToConnection");
  });

  it("quem pediu revogou o termo: erro, sem revelar e sem avisar", async () => {
    estado.comTermo = [1];

    await expect(aceitar()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(estado.chamadas).not.toContain("respondToConnection");
    expect(estado.chamadas).not.toContain("createNotification");
  });

  it("a conta de quem pediu foi desativada: o mesmo erro, sem dizer quem saiu", async () => {
    estado.ativas = [1];

    await expect(aceitar()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Este pedido não está mais disponível.",
    });
    expect(estado.chamadas).not.toContain("respondToConnection");
  });

  it("quem aceita revogou o próprio termo: erro que diz o que ela precisa fazer", async () => {
    estado.comTermo = [2];

    await expect(aceitar()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(estado.chamadas).not.toContain("respondToConnection");
  });

  it("recusar não passa pela trava: recusar não revela nada", async () => {
    estado.comTermo = [];
    estado.ativas = [];
    estado.resposta = { revelou: false, contraparte: null as unknown as number };

    await expect(connectionsRouter.createCaller(ctx(1)).respond({ connectionId: 7, accept: false }))
      .resolves.toEqual({ success: true });
    expect(estado.chamadas).toContain("respondToConnection");
  });

  it("pedido de outra pessoa não vira oráculo: segue para o banco como sempre", async () => {
    estado.pedido = { id: 7, requesterId: 2, recipientId: 99, status: "pending" };
    estado.comTermo = [];

    await expect(aceitar()).resolves.toEqual({ success: true });
    expect(estado.chamadas).toContain("respondToConnection");
  });

  it("pedido fora de 'pending' também segue para o banco", async () => {
    estado.pedido = { id: 7, requesterId: 2, recipientId: 1, status: "in_review" };
    estado.comTermo = [];

    await expect(aceitar()).resolves.toEqual({ success: true });
    expect(estado.chamadas).toContain("respondToConnection");
  });
});
