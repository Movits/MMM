import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * O aceite avisa quem pediu (validação da #108 pelo Roberto, 14/09/2026).
 *
 * Antes, `connections.respond` revelava os nomes e auditava, mas só quem ACEITOU
 * via o nome na hora. Quem pediu não recebia aviso nem releitura e continuava com
 * o cartão anônimo até apertar F5. O que este arquivo trava, com `./db` num dublê
 * por função (molde de distribuicao.test.ts):
 *
 * 1. aceite de verdade → um `interest_received` para a solicitante, e só para ela;
 * 2. o aviso não carrega nome, e-mail nem id de ninguém;
 * 3. recusa, segunda aba e linha que não está `pending` → nenhum aviso: nada sai
 *    antes do aceite, e o sino não vira oráculo;
 * 4. o interesse mútuo em `connections.send` também é aceite e avisa quem tinha
 *    pedido, não quem clicou;
 * 5. sino fora do ar não desfaz o aceite;
 * 6. o aceite reconfere o termo das duas partes e a conta ativa de quem pediu
 *    (as travas do distribuicao.decidir): faltando uma, nada muda, nada é
 *    revelado nem avisado, e quem aceita recebe erro sem nome. A recusa, o id
 *    alheio e a linha fora de `pending` não passam pela trava.
 *
 * O SQL do aceite (status no WHERE) está em match-em-analise.test.ts.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as { fn: string; args: unknown[] }[],
  auditorias: [] as Record<string, unknown>[],
  // A forma de `respondToConnection` e de `sendConnectionRequest` em server/db.ts.
  resposta: { revelou: true, contraparte: 2 } as { revelou: boolean; contraparte: number | null },
  envio: { revelou: false, connectionId: 7, emAnalise: false } as { revelou: boolean; connectionId: number | null; emAnalise: boolean },
  sinoForaDoAr: false,
  // A linha que `lerPedidoDeMatch` devolve (forma de server/db.ts): pedido da
  // conta 2 para a conta 1, já encaminhado.
  pedido: { id: 7, requesterId: 2, recipientId: 1, status: "pending", reciprocatedAt: null } as
    { id: number; requesterId: number; recipientId: number; status: string; reciprocatedAt: Date | null } | null,
  // Quem tem o termo do Smart Match vigente e quem tem a conta ativa.
  comTermo: [1, 2] as number[],
  ativas: [1, 2] as number[],
}));

vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    if (typeof prop === "symbol" || prop === "then" || prop === "default") return undefined;
    return async (...args: unknown[]) => {
      estado.chamadas.push({ fn: String(prop), args });
      if (prop === "createNotification" && estado.sinoForaDoAr) throw new Error("sino fora do ar");
      if (prop === "respondToConnection") return estado.resposta;
      if (prop === "lerPedidoDeMatch") return estado.pedido;
      if (prop === "idsDeContasAtivas") return new Set((args[0] as number[]).filter(id => estado.ativas.includes(id)));
      if (prop === "resolverAlvoDoMatch") return 2;
      if (prop === "sendConnectionRequest") return estado.envio;
      if (prop === "idsDosDistribuidoresAtivos" || prop === "idsDaPresidenciaAtiva") return [];
      return undefined;
    };
  },
}));
vi.mock("./security", () => ({
  createAuditLog: async (params: Record<string, unknown>) => { estado.auditorias.push(params); },
}));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[], tipo: string) => {
    estado.chamadas.push({ fn: "usersComConsentimento", args: [ids, tipo] });
    return new Set(ids.filter(id => estado.comTermo.includes(id)));
  },
}));
vi.mock("./bloqueio-de-contato", () => ({ exigirTextoSemContato: async () => {} }));

const { connectionsRouter } = await import("./routers/connections");

// Quem age é a conta 1; a outra parte é a 2. Nome, openId e e-mail distintivos
// para a varredura do corpo do aviso.
const quemAge = {
  user: { id: 1, openId: "conta-1", email: "quem-age@local", name: "Nome Da Conta", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

const avisos = () => estado.chamadas
  .filter(c => c.fn === "createNotification")
  .map(c => c.args[0] as Record<string, unknown>);

beforeEach(() => {
  estado.chamadas = [];
  estado.auditorias = [];
  estado.resposta = { revelou: true, contraparte: 2 };
  estado.envio = { revelou: false, connectionId: 7, emAnalise: false };
  estado.sinoForaDoAr = false;
  estado.pedido = { id: 7, requesterId: 2, recipientId: 1, status: "pending", reciprocatedAt: null };
  estado.comTermo = [1, 2];
  estado.ativas = [1, 2];
});

// Entre o encaminhamento e o aceite, uma das partes saiu do Smart Match. O aceite
// não pode revelar, auditar nem avisar; quem aceita recebe um erro sem nome, e não
// o "Conexão aceita" de sempre. As travas são as do distribuicao.decidir.
describe("connections.respond — aceite com uma das partes fora do Smart Match", () => {
  const foiAoBanco = () => estado.chamadas.some(c => c.fn === "respondToConnection");

  it("quem pediu revogou o termo: erro sem nome, nada muda, nada revela, ninguém é avisado", async () => {
    estado.comTermo = [1];
    const erro = await connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }).catch(e => e);
    expect(erro).toMatchObject({ code: "NOT_FOUND" });
    expect(String(erro.message)).not.toMatch(/\d|Nome Da Conta|conta-1|quem-age@local/);
    expect(foiAoBanco()).toBe(false);
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("conta de quem pediu desativada, com termo vigente: mesmo erro, nada muda", async () => {
    estado.ativas = [1];
    await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(foiAoBanco()).toBe(false);
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("quem aceita revogou o próprio termo: erro que pede o termo, nada muda", async () => {
    estado.comTermo = [2];
    await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(foiAoBanco()).toBe(false);
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("confere as duas partes do pedido, e a conta ativa de quem pediu", async () => {
    await connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true });
    const termo = estado.chamadas.find(c => c.fn === "usersComConsentimento");
    expect(termo?.args).toEqual([[2, 1], "termo_smart_match"]);
    const contas = estado.chamadas.find(c => c.fn === "idsDeContasAtivas");
    expect(contas?.args[0]).toEqual([2]);
    expect(foiAoBanco()).toBe(true);
    expect(avisos().map(a => [a.userId, a.type])).toEqual([[2, "interest_received"]]);
  });

  it("a recusa não passa pela trava: vai ao banco mesmo com quem pediu fora, e ninguém é avisado", async () => {
    estado.comTermo = [];
    estado.ativas = [];
    estado.resposta = { revelou: false, contraparte: 2 };
    await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: false }))
      .resolves.toEqual({ success: true });
    expect(foiAoBanco()).toBe(true);
    expect(estado.chamadas.some(c => c.fn === "lerPedidoDeMatch")).toBe(false);
    expect(avisos()).toEqual([]);
  });

  it("id alheio ou linha que não está pending: sem erro, a mesma resposta de 'nada mudou' (sem oráculo)", async () => {
    estado.comTermo = [];
    estado.ativas = [];
    estado.resposta = { revelou: false, contraparte: null };
    for (const pedido of [
      { id: 7, requesterId: 2, recipientId: 3, status: "pending", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 1, status: "in_review", reciprocatedAt: null },
      null,
    ]) {
      estado.pedido = pedido;
      await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }))
        .resolves.toEqual({ success: true });
    }
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });
});

describe("connections.respond — o aceite avisa quem pediu", () => {
  it("aceite de verdade: um aviso interest_received para a solicitante, e só para ela", async () => {
    const r = await connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true });
    expect(r).toEqual({ success: true });

    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toMatchObject({ userId: 2, type: "interest_received", actionUrl: "/dashboard" });
    // Quem aceitou não é avisada do próprio clique: a tela dela já relê as listas.
    expect(avisos().some(a => a.userId === 1)).toBe(false);
    // A revelação continua auditada dos dois lados, pelo caminho do aceite.
    expect(estado.auditorias.map(a => a.action)).toEqual(["MATCH_IDENTITY_REVEALED", "MATCH_IDENTITY_REVEALED"]);
    expect(estado.auditorias.map(a => (a.details as { via: string }).via)).toEqual(["aceite", "aceite"]);
  });

  it("o aviso não carrega nome, e-mail nem id de ninguém", async () => {
    await connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true });
    const texto = `${avisos()[0].title} ${avisos()[0].body}`;
    expect(texto).not.toMatch(/Nome Da Conta|conta-1|quem-age@local/);
    expect(texto).not.toMatch(/\d/);
    // Diz onde o nome aparece, sem dizê-lo.
    expect(texto).toMatch(/aba Conexões/);
  });

  it("recusa não avisa ninguém, mesmo com a contraparte na resposta do banco", async () => {
    // respondToConnection devolve a contraparte também na recusa; o que decide é `revelou`.
    estado.resposta = { revelou: false, contraparte: 2 };
    await connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: false });
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("nada aceito agora (segunda aba, pedido em análise, id alheio): nenhum aviso e a mesma resposta", async () => {
    estado.resposta = { revelou: false, contraparte: null };
    await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }))
      .resolves.toEqual({ success: true });
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("sino fora do ar não desfaz o aceite: a resposta e a auditoria continuam", async () => {
    estado.sinoForaDoAr = true;
    await expect(connectionsRouter.createCaller(quemAge).respond({ connectionId: 7, accept: true }))
      .resolves.toEqual({ success: true });
    expect(estado.auditorias).toHaveLength(2);
  });
});

describe("connections.send — o interesse mútuo também é aceite", () => {
  it("o clique que completa um pedido já encaminhado avisa quem tinha pedido, não quem clicou", async () => {
    estado.envio = { revelou: true, connectionId: 7, emAnalise: false };
    const r = await connectionsRouter.createCaller(quemAge).send({ matchId: 55 });
    expect(r).toEqual({ success: true, revelou: true });
    expect(avisos().map(a => [a.userId, a.type])).toEqual([[2, "interest_received"]]);
  });

  it("clique que não revela nada (repetido, recíproco em análise, recusado): a outra parte não é avisada", async () => {
    estado.envio = { revelou: false, connectionId: 7, emAnalise: false };
    const r = await connectionsRouter.createCaller(quemAge).send({ matchId: 55 });
    expect(r).toEqual({ success: true, revelou: false });
    expect(avisos()).toEqual([]);
  });
});
