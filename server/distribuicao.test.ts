import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Distribuidor do Smart Match.
 *
 * Parte 1 — o PODER: mora em `users.isDistributor` e é da CONTA, não do nível.
 * Ouro, presidente e admin sem a flag levam 403 na procedure do distribuidor, e
 * uma Prata com a flag passa. Quem concede e revoga é o Painel Ouro
 * (`distribuicao.conceder/revogar`), com auditoria de risco alto e aviso no
 * sino. Conceder duas vezes não grava nada duas vezes.
 *
 * Parte 2 — a FILA: o pedido de interesse nasce `in_review`, avisa quem
 * distribui (nunca uma das partes) e só o distribuidor o encaminha
 * (`pending`/`accepted`) ou não (`not_forwarded`). A fila e o histórico mostram
 * as duas partes com nome e sem id/e-mail, cada leitura fica na auditoria, e
 * quem é parte de um pedido não o vê. A fila age por alça opaca, não pelo id
 * sequencial da conexão, e a alça legítima de pedido já decidido responde igual à
 * alça inválida.
 *
 * `./db` vira um dublê por função (molde de etapa13-trilha-de-aceite.test.ts):
 * registra cada chamada com os argumentos para o teste dizer o que NÃO pode
 * ter acontecido (banco nem consultado; nada gravado no caminho idempotente).
 * O SQL de verdade dos helpers está em match-em-analise.test.ts.
 */

type Pedido = { id: number; requesterId: number; recipientId: number; status: string; reciprocatedAt: Date | null };

const estado = vi.hoisted(() => ({
  chamadas: [] as { fn: string; args: unknown[] }[],
  usuarias: {} as Record<number, { id: number; name: string | null; isDistributor: boolean }>,
  distribuidores: [] as unknown[],
  auditorias: [] as Record<string, unknown>[],
  sinoForaDoAr: false,
  poderMudou: true,
  // parte 2
  fila: [] as unknown[],
  pedido: null as Pedido | null,
  decidiu: true,
  /** Reciprocidade vista pelo UPDATE (null = a mesma da leitura do router). */
  reciprocadoNoBanco: null as boolean | null,
  historico: [] as unknown[],
  ativas: [] as number[],
  comTermo: [] as number[],
  bloqueados: [] as number[],
  alvo: 2 as number | null,
  envio: { revelou: false, connectionId: 7, emAnalise: true } as { revelou: boolean; connectionId: number | null; emAnalise: boolean },
  resposta: { revelou: false, contraparte: null } as { revelou: boolean; contraparte: number | null },
  distribuidoresAtivos: [] as number[],
  presidencia: [] as number[],
  /** Quando preenchida, o aviso a quem distribui fica preso nela. */
  segurarAviso: null as Promise<void> | null,
}));

vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    if (typeof prop === "symbol" || prop === "then" || prop === "default") return undefined;
    return async (...args: unknown[]) => {
      estado.chamadas.push({ fn: String(prop), args });
      if (prop === "getUserById") return estado.usuarias[args[0] as number] ?? null;
      if (prop === "listarDistribuidores") return estado.distribuidores;
      if (prop === "definirPoderDeDistribuicao") return estado.poderMudou;
      if (prop === "createNotification" && estado.sinoForaDoAr) throw new Error("sino fora do ar");
      if (prop === "listarPedidosEmAnalise") return estado.fila;
      if (prop === "lerPedidoDeMatch") {
        // O recorte real mora no WHERE (match-em-analise.test.ts); o dublê o reproduz:
        // só `in_review`, e nunca o pedido de que quem decide é parte.
        const distribuidorId = args[1] as number;
        const p = estado.pedido;
        return p && p.status === "in_review" && p.requesterId !== distribuidorId && p.recipientId !== distribuidorId ? p : null;
      }
      if (prop === "decidirPedidoDeMatch") {
        if (!estado.decidiu) return null;
        const { aprovar } = args[1] as { aprovar: boolean };
        const reciprocado = estado.reciprocadoNoBanco ?? estado.pedido?.reciprocatedAt != null;
        return { status: !aprovar ? "not_forwarded" : reciprocado ? "accepted" : "pending", reciprocado };
      }
      if (prop === "listarHistoricoDeDistribuicao") return estado.historico;
      if (prop === "idsDeContasAtivas") return new Set((args[0] as number[]).filter(id => estado.ativas.includes(id)));
      if (prop === "resolverAlvoDoMatch") return estado.alvo;
      if (prop === "sendConnectionRequest") return estado.envio;
      if (prop === "respondToConnection") return estado.resposta;
      if (prop === "idsDosDistribuidoresAtivos") {
        if (estado.segurarAviso) await estado.segurarAviso;
        return estado.distribuidoresAtivos;
      }
      if (prop === "idsDaPresidenciaAtiva") return estado.presidencia;
      return undefined;
    };
  },
}));
vi.mock("./security", () => ({
  createAuditLog: async (params: Record<string, unknown>) => { estado.auditorias.push(params); },
}));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids.filter(id => estado.comTermo.includes(id))),
}));
vi.mock("./matching", () => ({
  matchesBloqueadosPelaDemandaExpressa: async (_userId: number, ids: number[]) =>
    new Set(ids.filter(id => estado.bloqueados.includes(id))),
}));
vi.mock("./bloqueio-de-contato", () => ({ exigirTextoSemContato: async () => {} }));

const { distribuicaoRouter } = await import("./routers/distribuicao");
const { connectionsRouter } = await import("./routers/connections");
const { distribuidorProcedure, presidentProcedure } = await import("./routers/_procedures");
const { router } = await import("./_core/trpc");
const { selarAlcaDoPedido, abrirAlcaDoPedido } = await import("./alca-do-pedido");

// Um consumidor mínimo da procedure, para provar a régua sem depender da fila.
const routerDeProva = router({
  fila: distribuidorProcedure.query(async () => {
    estado.chamadas.push({ fn: "consulta-da-fila", args: [] });
    return "fila";
  }),
  presidencia: presidentProcedure.query(async () => "ok"),
});

const ctx = (user: Record<string, unknown>) => ({
  user: { id: 1, openId: "conta-1", email: "t@local", name: "Conta", ...user },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const chamadas = (fn: string) => estado.chamadas.filter(c => c.fn === fn);
const avisos = () => chamadas("createNotification").map(c => c.args[0] as Record<string, unknown>);
const acoes = () => estado.auditorias.map(a => a.action);

const perfil = (name: string, extra: Record<string, unknown> = {}) => ({
  name, displayName: null, role: "silver", isActive: true, isVerified: true, onboardingCompleted: true,
  company: "Empresa", jobTitle: "Cargo", city: "Lisboa", country: "PT", sector: "tech", primarySpecialty: "tech",
  bio: null, whatIHave: ["consultoria"], whatINeed: ["capital"], seekingTypes: ["investor"], profileCompleteness: 80,
  ...extra,
});

beforeEach(() => {
  estado.chamadas = [];
  estado.auditorias = [];
  estado.distribuidores = [];
  estado.sinoForaDoAr = false;
  estado.poderMudou = true;
  estado.usuarias = {
    7: { id: 7, name: "Dora Distribuidora", isDistributor: false },
    8: { id: 8, name: "Dina Já-Distribui", isDistributor: true },
  };
  estado.fila = [];
  estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: null };
  estado.decidiu = true;
  estado.reciprocadoNoBanco = null;
  estado.historico = [];
  estado.ativas = [2, 3];
  estado.comTermo = [2, 3];
  estado.bloqueados = [];
  estado.alvo = 2;
  estado.envio = { revelou: false, connectionId: 7, emAnalise: true };
  estado.resposta = { revelou: false, contraparte: null };
  estado.distribuidoresAtivos = [];
  estado.presidencia = [];
  estado.segurarAviso = null;
});

// ═══════════════════════════ parte 1: o poder ═══════════════════════════════
describe("distribuidorProcedure — o poder é da conta, não do nível", () => {
  it.each(["gold", "president", "admin"])("%s SEM a flag leva FORBIDDEN e o banco nem é consultado", async (role) => {
    const caller = routerDeProva.createCaller(ctx({ role, isDistributor: false }));
    await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chamadas("consulta-da-fila")).toEqual([]);
    expect(estado.chamadas).toEqual([]);
  });

  it("flag ausente (linha antiga, sem a coluna) conta como sem poder", async () => {
    const caller = routerDeProva.createCaller(ctx({ role: "president" }));
    await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("só `true` de verdade passa: a string ou o número 1 não valem", async () => {
    for (const valor of ["true", 1]) {
      const caller = routerDeProva.createCaller(ctx({ role: "silver", isDistributor: valor }));
      await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it.each(["bronze", "silver", "gold"])("%s COM a flag passa", async (role) => {
    const caller = routerDeProva.createCaller(ctx({ role, isDistributor: true }));
    await expect(caller.fila()).resolves.toBe("fila");
  });

  it("a flag NÃO abre a presidência: Prata distribuidora continua fora de presidentProcedure", async () => {
    const caller = routerDeProva.createCaller(ctx({ role: "silver", isDistributor: true }));
    await expect(caller.presidencia()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sem sessão: UNAUTHORIZED antes de olhar a flag", async () => {
    const caller = routerDeProva.createCaller({ user: null, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never);
    await expect(caller.fila()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("distribuicao.listar / conceder / revogar — só Ouro, presidente ou admin", () => {
  it.each(["bronze", "silver"])("%s (mesmo distribuidora) leva FORBIDDEN nas três, sem tocar o banco", async (role) => {
    const caller = distribuicaoRouter.createCaller(ctx({ role, isDistributor: true }));
    await expect(caller.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.conceder({ userId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.revogar({ userId: 8, reason: "motivo com dez letras" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(estado.chamadas).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it.each(["gold", "president", "admin"])("%s lista quem distribui pelo helper do banco", async (role) => {
    estado.distribuidores = [{ id: 8, name: "Dina Já-Distribui", email: "dina@local", role: "silver", isActive: true }];
    const caller = distribuicaoRouter.createCaller(ctx({ role }));
    await expect(caller.listar()).resolves.toEqual(estado.distribuidores);
    expect(chamadas("listarDistribuidores")).toHaveLength(1);
  });
});

describe("distribuicao.conceder", () => {
  it("liga a flag, audita DISTRIBUTOR_GRANTED com risco alto e avisa a pessoa no sino", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ id: 1, role: "president" }));
    await expect(caller.conceder({ userId: 7, reason: "Primeira distribuidora" })).resolves.toEqual({ success: true });

    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[7, true]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 1, action: "DISTRIBUTOR_GRANTED", resource: "users", resourceId: "7",
      details: { reason: "Primeira distribuidora" }, status: "success", riskLevel: "high",
    })]);
    const [aviso] = avisos();
    expect(aviso).toMatchObject({ userId: 7, type: "system", actionUrl: "/president" });
    expect(String(aviso.title)).toMatch(/distribuidor/i);
    expect(String(aviso.body)).toMatch(/Painel Ouro/);
    expect(String(aviso.body)).toContain("Um membro Ouro da WRW concedeu");
    expect(String(aviso.body)).not.toMatch(/\bMMM\b/);
  });

  it("é idempotente: quem já tem o poder não gera gravação, auditoria nem aviso", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "gold" }));
    await expect(caller.conceder({ userId: 8 })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("concessão simultânea: se o UPDATE não mudou a linha (outra aba concedeu antes), nada de auditoria nem aviso", async () => {
    estado.poderMudou = false;
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.conceder({ userId: 7 })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao")).toHaveLength(1);
    expect(estado.auditorias).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it("conta inexistente → NOT_FOUND, nada gravado", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "admin" }));
    await expect(caller.conceder({ userId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("a falha do sino não desfaz a concessão nem a auditoria", async () => {
    estado.sinoForaDoAr = true;
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.conceder({ userId: 7 })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[7, true]]);
    expect(acoes()).toEqual(["DISTRIBUTOR_GRANTED"]);
  });
});

describe("distribuicao.revogar", () => {
  it("exige motivo com pelo menos 10 caracteres (validação antes do banco)", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.revogar({ userId: 8, reason: "curto" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(estado.chamadas).toEqual([]);
  });

  it("desliga a flag, audita DISTRIBUTOR_REVOKED com o motivo e avisa a pessoa", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ id: 3, role: "admin" }));
    await expect(caller.revogar({ userId: 8, reason: "Saiu da equipe de distribuição" })).resolves.toEqual({ success: true });

    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[8, false]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 3, action: "DISTRIBUTOR_REVOKED", resource: "users", resourceId: "8",
      details: { reason: "Saiu da equipe de distribuição" }, riskLevel: "high",
    })]);
    const [aviso] = avisos();
    expect(aviso).toMatchObject({ userId: 8, type: "system" });
    expect(String(aviso.body)).toContain("Saiu da equipe de distribuição");
    expect(String(aviso.body)).toContain("por um membro Ouro da WRW");
    expect(String(aviso.body)).not.toMatch(/\bMMM\b/);
  });

  it("é idempotente: revogar de quem não tem o poder não grava nem audita", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.revogar({ userId: 7, reason: "motivo com dez letras" })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("revogação simultânea: se o UPDATE não mudou a linha, nada de auditoria nem aviso", async () => {
    estado.poderMudou = false;
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.revogar({ userId: 8, reason: "motivo com dez letras" })).resolves.toEqual({ success: true });
    expect(estado.auditorias).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it("revogar NÃO mexe no nível: nenhuma chamada a revokeGoldAccess ou grantGoldAccess", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await caller.revogar({ userId: 8, reason: "motivo com dez letras" });
    expect(chamadas("revokeGoldAccess")).toEqual([]);
    expect(chamadas("grantGoldAccess")).toEqual([]);
  });
});

// ═══════════════════ parte 2: o pedido nasce em análise ═════════════════════
describe("connections.send — o pedido novo espera o distribuidor", () => {
  const solicitante = ctx({ id: 1, role: "silver" });

  it("avisa quem distribui MENOS as duas partes; corpo sem nome; resposta de sempre", async () => {
    estado.distribuidoresAtivos = [1, 2, 8, 9]; // 1 = quem pede, 2 = o alvo
    const r = await connectionsRouter.createCaller(solicitante).send({ matchId: 55 });
    expect(r).toEqual({ success: true, revelou: false });

    // O aviso sai sem await (a resposta não espera por ele): o teste espera o sino.
    await vi.waitFor(() => expect(avisos().map(a => a.userId)).toEqual([8, 9]));
    for (const aviso of avisos()) {
      expect(aviso).toMatchObject({ type: "system", actionUrl: "/president" });
      expect(`${aviso.title} ${aviso.body}`).not.toMatch(/Conta|conta-1|t@local/);
    }
    expect(chamadas("idsDaPresidenciaAtiva")).toEqual([]);
    expect(acoes()).toEqual([]);
  });

  it("a destinatária é a ÚNICA distribuidora: ela não recebe nada (o sino denunciaria o pedido) e a presidência é avisada", async () => {
    estado.distribuidoresAtivos = [2];
    estado.presidencia = [4];
    await connectionsRouter.createCaller(solicitante).send({ matchId: 55 });
    await vi.waitFor(() => expect(avisos().map(a => a.userId)).toEqual([4]));
    expect(String(avisos()[0].body)).toMatch(/nenhum distribuidor/i);
  });

  it("sem distribuidor ativo, a presidência é avisada — menos quem for parte do pedido", async () => {
    estado.distribuidoresAtivos = [];
    estado.presidencia = [1, 2, 4];
    await connectionsRouter.createCaller(solicitante).send({ matchId: 55 });
    await vi.waitFor(() => expect(avisos().map(a => a.userId)).toEqual([4]));
    expect(String(avisos()[0].body)).toMatch(/nenhum distribuidor/i);
    expect(String(avisos()[0].body)).toMatch(/Painel Ouro/);
  });

  it("pedido que não é novo (segundo clique, recíproco em análise, recusado): nenhum aviso e a MESMA resposta", async () => {
    estado.envio = { revelou: false, connectionId: 7, emAnalise: false };
    estado.distribuidoresAtivos = [8];
    const r = await connectionsRouter.createCaller(solicitante).send({ matchId: 55 });
    expect(r).toEqual({ success: true, revelou: false });
    expect(avisos()).toEqual([]);
    expect(chamadas("idsDosDistribuidoresAtivos")).toEqual([]);
  });

  it("interesse mútuo sobre pedido já encaminhado (pending): revela, audita duas vezes e avisa só a outra parte com \"Nova conexão!\", sem aviso à fila", async () => {
    estado.envio = { revelou: true, connectionId: 7, emAnalise: false };
    const r = await connectionsRouter.createCaller(solicitante).send({ matchId: 55 });
    expect(r).toEqual({ success: true, revelou: true });
    expect(acoes()).toEqual(["MATCH_IDENTITY_REVEALED", "MATCH_IDENTITY_REVEALED"]);
    expect(estado.auditorias.map(a => (a.details as { via: string }).via)).toEqual(["interesse_mutuo", "interesse_mutuo"]);
    expect(avisos()).toEqual([{
      userId: 2, type: "interest_received", title: "Nova conexão!",
      body: "Vocês criaram uma conexão! Os nomes já aparecem na aba Conexões.", actionUrl: "/dashboard",
    }]);
    expect(chamadas("idsDosDistribuidoresAtivos")).toEqual([]);
  });

  it("interesse mútuo com o sino fora do ar: a conexão continua valendo e a resposta é a mesma", async () => {
    estado.envio = { revelou: true, connectionId: 7, emAnalise: false };
    estado.sinoForaDoAr = true;
    await expect(connectionsRouter.createCaller(solicitante).send({ matchId: 55 })).resolves.toEqual({ success: true, revelou: true });
    expect(acoes()).toEqual(["MATCH_IDENTITY_REVEALED", "MATCH_IDENTITY_REVEALED"]);
  });

  it("sino fora do ar não desfaz o pedido: a resposta continua a mesma", async () => {
    estado.distribuidoresAtivos = [8];
    estado.sinoForaDoAr = true;
    await expect(connectionsRouter.createCaller(solicitante).send({ matchId: 55 })).resolves.toEqual({ success: true, revelou: false });
    await vi.waitFor(() => expect(chamadas("createNotification")).toHaveLength(1));
  });

  it("a resposta não espera o aviso a quem distribui", async () => {
    // Revisão da #115: com o aviso no caminho da resposta, o pedido novo (INSERT e
    // aviso) demorava bem mais que o clique sobre o pedido oculto da outra parte (só
    // o UPDATE de reciprocatedAt), e cronometrar o próprio clique contava que ela
    // pediu antes. Com o aviso preso, a resposta tem de sair mesmo assim.
    let soltar = () => {};
    estado.segurarAviso = new Promise<void>(resolve => { soltar = resolve; });
    estado.distribuidoresAtivos = [8];
    await expect(connectionsRouter.createCaller(solicitante).send({ matchId: 55 })).resolves.toEqual({ success: true, revelou: false });
    await vi.waitFor(() => expect(chamadas("idsDosDistribuidoresAtivos")).toHaveLength(1));
    expect(avisos()).toEqual([]);
    soltar();
    await vi.waitFor(() => expect(avisos().map(a => a.userId)).toEqual([8]));
  });
});

describe("connections.respond — o aceite da destinatária cria a conexão", () => {
  const destinataria = ctx({ id: 3, role: "silver" });

  it("aceite que revela: audita e avisa a solicitante com \"Nova conexão!\"", async () => {
    estado.resposta = { revelou: true, contraparte: 2 };
    await expect(connectionsRouter.createCaller(destinataria).respond({ connectionId: 7, accept: true })).resolves.toEqual({ success: true });
    expect(estado.auditorias.map(a => [a.userId, (a.details as { via: string }).via])).toEqual([[3, "aceite"], [2, "aceite"]]);
    expect(avisos()).toEqual([{
      userId: 2, type: "interest_received", title: "Nova conexão!",
      body: "Vocês criaram uma conexão! Os nomes já aparecem na aba Conexões.", actionUrl: "/dashboard",
    }]);
  });

  it("recusa, ou aceite que não pegou a linha: nenhum aviso (recusar não vira oráculo)", async () => {
    estado.resposta = { revelou: false, contraparte: null };
    await connectionsRouter.createCaller(destinataria).respond({ connectionId: 7, accept: false });
    expect(avisos()).toEqual([]);
    expect(acoes()).toEqual([]);
  });
});

// ═══════════════════════════ parte 2: a fila ════════════════════════════════
const distribuidora = ctx({ id: 9, role: "silver", isDistributor: true });
/** A alça que a fila entregaria à conta `quem` (a distribuidora 9, por padrão). */
const alca = (connectionId: number, quem = 9) => selarAlcaDoPedido(connectionId, quem);

describe("distribuicao.fila", () => {
  it("Ouro sem a flag leva FORBIDDEN sem consultar a fila", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "gold", isDistributor: false }));
    await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chamadas("listarPedidosEmAnalise")).toEqual([]);
  });

  it("mostra as duas partes com nome, sem id nem e-mail; bio mascarada; travas e nota; e audita a leitura", async () => {
    estado.fila = [{
      connectionId: 7, requesterId: 2, recipientId: 3, createdAt: new Date("2026-09-13T10:00:00Z"), reciprocatedAt: new Date(),
      solicitante: perfil("Ana Solicitante", { bio: "me chama no 11 99999-8888 ou ana@exemplo.com" }),
      destinataria: perfil("Bia Destinatária"),
      compatibilidade: { overallScore: 82, specialtyScore: 90, objectivesScore: 80, incomeScore: 70, locationScore: 60, valuesScore: 50, aiInsight: "Vinho e exportação." },
    }];
    estado.comTermo = [2];
    estado.bloqueados = [3];

    const fila = await distribuicaoRouter.createCaller(distribuidora).fila();
    expect(chamadas("listarPedidosEmAnalise").map(c => c.args[0])).toEqual([9]);
    expect(fila).toHaveLength(1);
    const [p] = fila;
    // O id sequencial do pedido não sai: a fila entrega a alça opaca, que só abre para quem leu.
    expect(p).not.toHaveProperty("connectionId");
    expect(abrirAlcaDoPedido(p.alca, 9)).toBe(7);
    expect(abrirAlcaDoPedido(p.alca, 8)).toBeNull();
    expect(p.reciprocado).toBe(true);
    expect(p.solicitante.name).toBe("Ana Solicitante");
    expect(p.destinataria.name).toBe("Bia Destinatária");
    expect(p.compatibilidade?.overallScore).toBe(82);
    expect(p.bloqueadoPeloPortao).toBe(true);
    expect(p.termoOk).toEqual({ solicitante: true, destinataria: false });
    expect(p.ativas).toEqual({ solicitante: true, destinataria: true });

    const texto = JSON.stringify(fila);
    for (const proibido of ["connectionId", "requesterId", "recipientId", "userId", "email", "99999-8888", "ana@exemplo.com"]) {
      expect(texto, proibido).not.toContain(proibido);
    }
    expect(p.solicitante.bio).not.toBe("me chama no 11 99999-8888 ou ana@exemplo.com");
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 9, action: "DISTRIBUTOR_VIEW_QUEUE", resource: "connections", details: { pedidos: 1 },
    })]);
  });

  it("sem nota do Smart Match no par, compatibilidade vem nula (não um objeto de zeros)", async () => {
    estado.fila = [{
      connectionId: 8, requesterId: 2, recipientId: 3, createdAt: new Date(), reciprocatedAt: null,
      solicitante: perfil("Ana"), destinataria: perfil("Bia"),
      compatibilidade: { overallScore: null, specialtyScore: null, objectivesScore: null, incomeScore: null, locationScore: null, valuesScore: null, aiInsight: null },
    }];
    const [p] = await distribuicaoRouter.createCaller(distribuidora).fila();
    expect(p.compatibilidade).toBeNull();
    expect(p.reciprocado).toBe(false);
  });

  it("\"Outra necessidade\" chega ao distribuidor só com a opção marcada, aparada e mascarada como a bio", async () => {
    estado.fila = [{
      connectionId: 9, requesterId: 2, recipientId: 3, createdAt: new Date(), reciprocatedAt: null,
      solicitante: perfil("Ana", {
        seekingTypes: ["outra_necessidade"],
        seekingOtherNeed: "  Consultoria para registro na Anvisa, ana@exemplo.com  ",
      }),
      // Desmarcada, o texto que sobrou no banco não é necessidade declarada.
      destinataria: perfil("Bia", { seekingTypes: ["investor"], seekingOtherNeed: "Texto antigo" }),
      compatibilidade: { overallScore: null, specialtyScore: null, objectivesScore: null, incomeScore: null, locationScore: null, valuesScore: null, aiInsight: null },
    }];
    const [p] = await distribuicaoRouter.createCaller(distribuidora).fila();
    expect(p.solicitante.seekingOtherNeed).toMatch(/^Consultoria para registro na Anvisa/);
    expect(p.solicitante.seekingOtherNeed).not.toContain("ana@exemplo.com");
    expect(p.destinataria.seekingOtherNeed).toBeNull();
  });
});

describe("distribuicao.decidir — travas antes do UPDATE", () => {
  const caller = () => distribuicaoRouter.createCaller(distribuidora);

  it("alça que a fila não entregou a esta conta (inventada, adulterada, de outra distribuidora) → NOT_FOUND sem ler o banco, e a tentativa vai para a trilha", async () => {
    const valida = alca(7);
    const adulterada = valida.slice(0, 10) + (valida[10] === "A" ? "B" : "A") + valida.slice(11);
    for (const invalida of ["7", adulterada, alca(7, 8)]) {
      await expect(caller().decidir({ alca: invalida, aprovar: true })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Pedido não encontrado ou já decidido." });
    }
    expect(chamadas("lerPedidoDeMatch")).toEqual([]);
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
    expect(estado.auditorias).toEqual(Array(3).fill(expect.objectContaining({
      userId: 9, action: "MATCH_HANDLE_INVALID", resource: "distribuicao.decidir", status: "blocked", riskLevel: "high",
    })));
  });

  it("alça legítima de pedido que não está mais em análise (e, por garantia, de que se é parte): a MESMA resposta da alça inválida, nenhuma escrita e nenhuma linha de bloqueio", async () => {
    // A fila só entrega alça de pedido de terceiros: alça que abre e não acha
    // `in_review` é clique em fila velha (outra pessoa decidiu). Nada a bloquear, e a
    // trilha deixa de encher o painel de "alto risco" num uso normal da tela. A
    // resposta é igual à da alça inválida, e nenhuma das duas carrega id.
    const inexistente = await caller().decidir({ alca: "7", aprovar: false, nota: "x" }).catch(e => e);
    expect(inexistente).toMatchObject({ code: "NOT_FOUND", message: "Pedido não encontrado ou já decidido." });
    estado.auditorias = [];

    const casos: (Pedido | null)[] = [
      null,
      { id: 7, requesterId: 9, recipientId: 3, status: "in_review", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 9, status: "in_review", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 9, status: "not_forwarded", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 9, status: "pending", reciprocatedAt: null },
      ...["pending", "accepted", "declined", "not_forwarded", "blocked"].map(status => ({
        id: 7, requesterId: 2, recipientId: 3, status, reciprocatedAt: null,
      })),
    ];
    for (const pedido of casos) {
      estado.pedido = pedido;
      for (const entrada of [{ aprovar: false, nota: "x" }, { aprovar: true }]) {
        const erro = await caller().decidir({ alca: alca(7), ...entrada }).catch(e => e);
        expect(erro.code, JSON.stringify({ pedido, entrada })).toBe(inexistente.code);
        expect(erro.message).toBe(inexistente.message);
      }
    }
    expect(chamadas("lerPedidoDeMatch").map(c => c.args)).toEqual(Array(casos.length * 2).fill([7, 9]));
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
    expect(avisos()).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("não encaminhar exige a nota (BAD_REQUEST), conferida antes da alça e do banco: a resposta não depende do pedido", async () => {
    for (const pedido of [
      null,
      { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 9, status: "in_review", reciprocatedAt: null },
      { id: 7, requesterId: 2, recipientId: 3, status: "pending", reciprocatedAt: null },
    ]) {
      estado.pedido = pedido;
      for (const a of [alca(7), "inventada"]) {
        await expect(caller().decidir({ alca: a, aprovar: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
        await expect(caller().decidir({ alca: a, aprovar: false, nota: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
    }
    expect(chamadas("lerPedidoDeMatch")).toEqual([]);
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("corrida entre duas distribuidoras: o CONFLICT só alcança quem NÃO é parte; a parte fica no NOT_FOUND mesmo com a decisão nula", async () => {
    estado.decidiu = false;
    estado.pedido = { id: 7, requesterId: 2, recipientId: 9, status: "in_review", reciprocatedAt: null };
    await expect(caller().decidir({ alca: alca(7),aprovar: false, nota: "x" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Pedido não encontrado ou já decidido." });
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);

    estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: null };
    await expect(caller().decidir({ alca: alca(7),aprovar: false, nota: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(chamadas("decidirPedidoDeMatch")).toHaveLength(1);
  });

  it("termo revogado por uma das partes → PRECONDITION_FAILED, sem UPDATE", async () => {
    estado.comTermo = [2];
    await expect(caller().decidir({ alca: alca(7),aprovar: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
  });

  it("conta inativa → PRECONDITION_FAILED, sem UPDATE", async () => {
    estado.ativas = [2];
    await expect(caller().decidir({ alca: alca(7),aprovar: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
  });

  it("portão da demanda expressa fechado → PRECONDITION_FAILED, sem UPDATE", async () => {
    estado.bloqueados = [3];
    await expect(caller().decidir({ alca: alca(7),aprovar: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(chamadas("decidirPedidoDeMatch")).toEqual([]);
  });

  it("as travas do encaminhamento não valem para NÃO encaminhar: recusa passa mesmo sem termo", async () => {
    estado.comTermo = [];
    await expect(caller().decidir({ alca: alca(7),aprovar: false, nota: "Sem termo vigente" }))
      .resolves.toEqual({ success: true, statusFinal: "not_forwarded", reciprocado: false });
  });
});

describe("distribuicao.decidir — efeitos", () => {
  const caller = () => distribuicaoRouter.createCaller(distribuidora);

  it("encaminhar: vira pending, audita, avisa a destinatária (interest_received) e a solicitante (system)", async () => {
    await expect(caller().decidir({ alca: alca(7),aprovar: true, nota: "Par forte" }))
      .resolves.toEqual({ success: true, statusFinal: "pending", reciprocado: false });

    expect(chamadas("decidirPedidoDeMatch").map(c => c.args)).toEqual([[7, { aprovar: true, moderatedBy: 9, moderationNote: "Par forte" }]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 9, action: "MATCH_REVIEW_APPROVED", resource: "connections", resourceId: "7",
      details: { requesterId: 2, recipientId: 3, reciprocado: false, statusFinal: "pending", nota: "Par forte" },
    })]);
    expect(avisos().map(a => [a.userId, a.type, a.actionUrl])).toEqual([[3, "interest_received", "/dashboard"], [2, "system", "/dashboard"]]);
    expect(`${avisos()[0].title} ${avisos()[0].body}`).not.toMatch(/Ana|Solicitante/);
  });

  it("encaminhar pedido recíproco: vira accepted, revela os dois nomes (via distribuidor) e avisa os dois", async () => {
    estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: new Date() };
    await expect(caller().decidir({ alca: alca(7),aprovar: true }))
      .resolves.toEqual({ success: true, statusFinal: "accepted", reciprocado: true });

    expect(chamadas("decidirPedidoDeMatch")[0].args[1]).toMatchObject({ aprovar: true, moderationNote: null });
    expect(acoes()).toEqual(["MATCH_REVIEW_APPROVED", "MATCH_IDENTITY_REVEALED", "MATCH_IDENTITY_REVEALED"]);
    const revelacoes = estado.auditorias.filter(a => a.action === "MATCH_IDENTITY_REVEALED");
    expect(revelacoes.map(a => [a.userId, (a.details as { contraparte: number }).contraparte, (a.details as { via: string }).via]))
      .toEqual([[2, 3, "distribuidor"], [3, 2, "distribuidor"]]);
    expect(avisos().map(a => a.userId).sort()).toEqual([2, 3]);
    for (const aviso of avisos()) {
      expect(aviso).toMatchObject({ type: "interest_received", title: "Nova conexão!", actionUrl: "/dashboard" });
      expect(String(aviso.body)).toContain("Vocês criaram uma conexão!");
      expect(`${aviso.title} ${aviso.body}`).not.toMatch(/match/i);
      // Da revisão da #115: o aviso não pode supor o gênero de quem o lê.
      expect(`${aviso.title} ${aviso.body}`).not.toMatch(/vocês dois|vocês duas/i);
    }
  });

  it("a destinatária clicou ENTRE a leitura do router e o UPDATE: vale o desfecho do banco (accepted) — revela e a trilha diz recíproco", async () => {
    estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: null };
    estado.reciprocadoNoBanco = true;
    await expect(caller().decidir({ alca: alca(7),aprovar: true }))
      .resolves.toEqual({ success: true, statusFinal: "accepted", reciprocado: true });
    expect(acoes()).toEqual(["MATCH_REVIEW_APPROVED", "MATCH_IDENTITY_REVEALED", "MATCH_IDENTITY_REVEALED"]);
    expect((estado.auditorias[0].details as { reciprocado: boolean }).reciprocado).toBe(true);
    // Nunca "decida se aceita" para quem já tinha clicado.
    expect(avisos().some(a => /decida se aceita/.test(String(a.body)))).toBe(false);
  });

  it("não encaminhar: vira not_forwarded com a nota, avisa só a solicitante e sem o motivo; a destinatária que não clicou nunca sabe", async () => {
    await expect(caller().decidir({ alca: alca(7),aprovar: false, nota: "Setores sem relação" }))
      .resolves.toEqual({ success: true, statusFinal: "not_forwarded", reciprocado: false });

    expect(chamadas("decidirPedidoDeMatch").map(c => c.args)).toEqual([[7, { aprovar: false, moderatedBy: 9, moderationNote: "Setores sem relação" }]]);
    expect(acoes()).toEqual(["MATCH_REVIEW_REJECTED"]);
    expect(avisos().map(a => a.userId)).toEqual([2]);
    expect(`${avisos()[0].title} ${avisos()[0].body}`).not.toContain("Setores sem relação");
    expect(String(avisos()[0].title)).toMatch(/não encaminhado/i);
  });

  it("não encaminhar pedido RECÍPROCO: as duas são avisadas, sem o motivo e com o MESMO aviso de um pedido feito sozinha", async () => {
    // Um texto próprio do caso recíproco ("as duas partes") contaria a cada uma que
    // a outra também clicou, sem encaminhamento nenhum. Privacidade vence: o aviso
    // é um só, e nenhuma pessoa distingue o seu caso do outro.
    await caller().decidir({ alca: alca(7),aprovar: false, nota: "Setores sem relação" });
    const { userId: _sozinha, ...avisoDeQuemPediuSozinha } = avisos()[0];

    estado.chamadas = [];
    estado.auditorias = [];
    estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: new Date() };
    await expect(caller().decidir({ alca: alca(7),aprovar: false, nota: "Setores sem relação" }))
      .resolves.toEqual({ success: true, statusFinal: "not_forwarded", reciprocado: true });

    expect(acoes()).toEqual(["MATCH_REVIEW_REJECTED"]);
    expect(avisos().map(a => a.userId).sort()).toEqual([2, 3]);
    for (const { userId: _quem, ...aviso } of avisos()) expect(aviso).toEqual(avisoDeQuemPediuSozinha);
    for (const aviso of avisos()) {
      expect(`${aviso.title} ${aviso.body}`).not.toContain("Setores sem relação");
      expect(`${aviso.title} ${aviso.body}`).not.toMatch(/duas partes|duas pessoas|também|não foi avisada/i);
    }
  });

  it("outra pessoa decidiu antes (decisão nula): CONFLICT, sem auditoria, aviso ou revelação", async () => {
    estado.decidiu = false;
    estado.pedido = { id: 7, requesterId: 2, recipientId: 3, status: "in_review", reciprocatedAt: new Date() };
    await expect(caller().decidir({ alca: alca(7),aprovar: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(chamadas("decidirPedidoDeMatch")).toHaveLength(1);
    expect(estado.auditorias).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it("sino fora do ar não desfaz a decisão nem a auditoria", async () => {
    estado.sinoForaDoAr = true;
    await expect(caller().decidir({ alca: alca(7),aprovar: true })).resolves.toEqual({ success: true, statusFinal: "pending", reciprocado: false });
    expect(acoes()).toEqual(["MATCH_REVIEW_APPROVED"]);
  });
});

describe("distribuicao.historico", () => {
  it("pede ao banco só as decisões em que quem consulta NÃO é parte, com o limite pedido, e audita a leitura", async () => {
    estado.historico = [{ resultado: "pending", solicitanteNome: "Ana", destinatariaNome: "Bia" }];
    const r = await distribuicaoRouter.createCaller(distribuidora).historico({ limit: 10 });
    expect(r).toEqual(estado.historico);
    expect(chamadas("listarHistoricoDeDistribuicao").map(c => c.args)).toEqual([[9, 10]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({ action: "DISTRIBUTOR_VIEW_QUEUE", details: { escopo: "historico", decisoes: 1 } })]);
  });

  it("Ouro sem a flag leva FORBIDDEN", async () => {
    await expect(distribuicaoRouter.createCaller(ctx({ role: "gold" })).historico({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── Pinos de fonte: a régua não pode voltar a ser "por nível" em silêncio ────
describe("pinos de fonte", () => {
  const procedures = readFileSync(new URL("./routers/_procedures.ts", import.meta.url), "utf8");
  const blocoDistribuidor = procedures.slice(procedures.indexOf("export const distribuidorProcedure"));
  const fonteDoRouter = readFileSync(new URL("./routers/distribuicao.ts", import.meta.url), "utf8");

  it("distribuidorProcedure decide por `ctx.user.isDistributor !== true` e não menciona `role`", () => {
    expect(blocoDistribuidor).toContain("ctx.user.isDistributor !== true");
    expect(blocoDistribuidor).not.toMatch(/\brole\b/);
  });

  it("o router está registrado como `distribuicao` no appRouter", () => {
    const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    expect(routers).toContain("distribuicao: distribuicaoRouter");
  });

  it("o schema tem `users.isDistributor` boolean, padrão false e obrigatório", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(schema).toContain('isDistributor: boolean("isDistributor").default(false).notNull()');
  });

  it("a migração 0010 adiciona a coluna com o mesmo padrão", () => {
    const migracao = readFileSync(new URL("../drizzle/0010_poder-de-distribuicao.sql", import.meta.url), "utf8");
    expect(migracao.trim()).toBe("ALTER TABLE `users` ADD `isDistributor` boolean DEFAULT false NOT NULL;");
  });

  it("a migração 0011 amplia o enum de status e cria a trilha do distribuidor e o índice da fila", () => {
    const migracao = readFileSync(new URL("../drizzle/0011_match-em-analise.sql", import.meta.url), "utf8");
    expect(migracao).toContain("enum('pending','accepted','declined','blocked','in_review','not_forwarded')");
    for (const coluna of ["moderatedBy", "moderationNote", "moderatedAt", "reciprocatedAt"]) expect(migracao).toContain(`ADD \`${coluna}\``);
    expect(migracao).toContain("CREATE INDEX `conn_status_idx` ON `connections` (`status`)");
  });

  it("a fila e o histórico do router só saem por distribuidorProcedure; o poder, por presidentProcedure", () => {
    for (const proc of ["fila: distribuidorProcedure", "decidir: distribuidorProcedure", "historico: distribuidorProcedure"]) expect(fonteDoRouter).toContain(proc);
    for (const proc of ["listar: presidentProcedure", "conceder: presidentProcedure", "revogar: presidentProcedure"]) expect(fonteDoRouter).toContain(proc);
    expect(fonteDoRouter).not.toContain("protectedProcedure");
  });

  it("decidir não lança FORBIDDEN e age pela alça: o recorte de quem é parte mora na consulta e responde NOT_FOUND", () => {
    const decidir = fonteDoRouter.slice(fonteDoRouter.indexOf("decidir: distribuidorProcedure"), fonteDoRouter.indexOf("historico: distribuidorProcedure"));
    expect(decidir).not.toContain('code: "FORBIDDEN"');
    expect(decidir).toContain("abrirAlcaDoPedido(input.alca, ctx.user.id)");
    expect(decidir).toContain("lerPedidoDeMatch(connectionId, ctx.user.id)");
    expect(decidir).not.toContain("connectionId: z.");
    expect(fonteDoRouter).toContain("alca: selarAlcaDoPedido(p.connectionId, ctx.user.id)");
    expect(fonteDoRouter).toContain("listarHistoricoDeDistribuicao(ctx.user.id, input.limit)");
  });
});
