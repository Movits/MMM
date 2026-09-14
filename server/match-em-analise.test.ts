import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * O pedido de interesse passa pelo distribuidor — o SQL de verdade.
 *
 * Drizzle real sobre um cliente mysql2 falso que captura cada comando (molde de
 * etapa10-gestao-ouro.test.ts). O que este arquivo trava:
 *
 * 1. O pedido novo nasce `in_review`, não `pending`.
 * 2. Os UPDATEs levam o estado lido NO WHERE, e com 0 linhas o par é relido e a
 *    decisão refeita: duas abas não revelam duas vezes, e o clique que cai
 *    durante a decisão do distribuidor não se perde.
 * 3. A recusa oculta (not_forwarded que a outra pessoa não vê) não engole o
 *    clique dela: vira o pedido dela.
 * 4. A destinatária não recebe a linha em análise nem a não encaminhada — em
 *    getMatchesForUser E em getConnectionsForUser, pelo mesmo predicado —, o
 *    cartão usa a linha mais recente visível do par, a projeção não diz quem
 *    clicou primeiro, e o nome continua atrás do `CASE WHEN status = 'accepted'`.
 * 5. Fila, histórico e leitura do pedido excluem quem consulta quando é parte.
 * 6. A decisão sai do banco: a reciprocidade vai no WHERE de cada tentativa.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** Uma resposta por SELECT, em ordem; acabou a fila, vale `linhas`. */
  leituras: [] as unknown[][][],
  linhas: [] as unknown[][],
  /** Um affectedRows por UPDATE, em ordem; acabou a fila, vale `affectedRows`. */
  afetadas: [] as number[],
  affectedRows: 1,
  insertId: 41,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      if (/^\s*update/i.test(config.sql)) {
        const affectedRows = estado.afetadas.length ? estado.afetadas.shift()! : estado.affectedRows;
        return [{ affectedRows, insertId: 0 }, undefined];
      }
      if (/^\s*insert/i.test(config.sql)) return [{ affectedRows: 1, insertId: estado.insertId }, undefined];
      return [estado.leituras.length ? estado.leituras.shift()! : estado.linhas, []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const db = await import("./db");

const selects = () => estado.consultas.filter(c => /^\s*select/i.test(c.sql));
const updates = () => estado.consultas.filter(c => /^\s*update/i.test(c.sql));
const inserts = () => estado.consultas.filter(c => /^\s*insert/i.test(c.sql));
const escritas = () => estado.consultas.filter(c => /^\s*(update|insert)/i.test(c.sql));
const OCULTACAO = "NOT (`connections`.`status` IN ('in_review', 'not_forwarded') AND `connections`.`recipientId` = ? AND `connections`.`reciprocatedAt` IS NULL)";
// A sessão mysql2 do drizzle entrega TIMESTAMP como texto (typeCast) e a coluna o
// converte com new Date(valor + "+0000"): as fixturas usam a forma do driver.
const QUANDO = "2026-09-13 10:00:00";

beforeEach(() => {
  estado.consultas = [];
  estado.leituras = [];
  estado.linhas = [];
  estado.afetadas = [];
  estado.affectedRows = 1;
  estado.insertId = 41;
});

// Linhas do par: [id, requesterId, status, reciprocatedAt]. Quem clica é 1; a outra parte é 2.
describe("sendConnectionRequest — o pedido nasce em análise", () => {
  it("par novo: INSERT com status in_review, e devolve emAnalise para o router avisar quem distribui", async () => {
    const r = await db.sendConnectionRequest(1, 2);
    const [select] = selects();
    expect(select.sql).toContain("order by `connections`.`id` desc");
    expect(select.params.at(-1)).toBe(10);
    const [insert] = escritas();
    expect(insert.sql).toMatch(/^insert into `connections`/);
    expect(insert.params).toEqual([1, 2, "in_review"]);
    expect(r).toEqual({ revelou: false, connectionId: 41, emAnalise: true });
  });

  it("a outra parte já pediu e o pedido está ENCAMINHADO (pending): vira accepted com o status no WHERE", async () => {
    estado.linhas = [[7, 2, "pending", null]];
    const r = await db.sendConnectionRequest(1, 2);
    const [update] = escritas();
    expect(update.sql).toMatch(/^update `connections` set `status` = \?/);
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ?)");
    expect(update.params.slice(-3)).toEqual(["accepted", 7, "pending"]);
    expect(r).toEqual({ revelou: true, connectionId: 7, emAnalise: false });
  });

  it("…outra aba aceitou antes (0 linhas): relê o par, vê accepted e NÃO revela de novo", async () => {
    estado.leituras = [[[7, 2, "pending", null]], [[7, 2, "accepted", null]]];
    estado.afetadas = [0];
    const r = await db.sendConnectionRequest(1, 2);
    expect(selects()).toHaveLength(2);
    expect(updates()).toHaveLength(1);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("a outra parte já pediu e o pedido está EM ANÁLISE: grava só reciprocatedAt, travado por status e por reciprocatedAt nulo", async () => {
    estado.linhas = [[7, 2, "in_review", null]];
    const r = await db.sendConnectionRequest(1, 2);
    const [update] = escritas();
    expect(update.sql).toMatch(/^update `connections` set `reciprocatedAt` = \?/);
    expect(update.sql).not.toContain("`status` = ?,");
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ? and `connections`.`reciprocatedAt` is null)");
    expect(update.params.slice(-2)).toEqual([7, "in_review"]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("…o distribuidor ENCAMINHOU entre a leitura e o UPDATE: o clique não se perde, vira o interesse mútuo", async () => {
    estado.leituras = [[[7, 2, "in_review", null]], [[7, 2, "pending", null]]];
    estado.afetadas = [0, 1];
    const r = await db.sendConnectionRequest(1, 2);
    expect(updates()).toHaveLength(2);
    expect(updates()[0].sql).toMatch(/^update `connections` set `reciprocatedAt` = \?/);
    expect(updates()[1].sql).toMatch(/^update `connections` set `status` = \?/);
    expect(updates()[1].params.slice(-3)).toEqual(["accepted", 7, "pending"]);
    expect(r).toEqual({ revelou: true, connectionId: 7, emAnalise: false });
  });

  it("…o distribuidor NÃO encaminhou entre a leitura e o UPDATE: o clique vira o pedido desta pessoa", async () => {
    estado.leituras = [[[7, 2, "in_review", null]], [[7, 2, "not_forwarded", null]]];
    estado.afetadas = [0];
    const r = await db.sendConnectionRequest(1, 2);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].params).toEqual([1, 2, "in_review"]);
    expect(r).toEqual({ revelou: false, connectionId: 41, emAnalise: true });
  });

  it("pedido em análise JÁ recíproco: segundo clique não escreve nada", async () => {
    estado.linhas = [[7, 2, "in_review", QUANDO]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it.each(["in_review", "pending", "not_forwarded", "declined", "accepted"])("meu próprio pedido já existe (%s): nada é escrito", async (status) => {
    estado.linhas = [[7, 1, status, null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("a outra parte pediu e o distribuidor NÃO encaminhou (oculto para quem clica): o clique vira o pedido desta pessoa", async () => {
    // Sem isto, o cartão continuaria "Demonstrar Interesse" depois do clique — o
    // único clique sem efeito visível, que denunciaria a recusa.
    estado.linhas = [[7, 2, "not_forwarded", null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(updates()).toEqual([]);
    expect(inserts().map(i => i.params)).toEqual([[1, 2, "in_review"]]);
    expect(r).toEqual({ revelou: false, connectionId: 41, emAnalise: true });
  });

  it("não encaminhado COM reciprocatedAt (quem clica também tinha clicado, e vê 'não encaminhado'): nada é escrito", async () => {
    estado.linhas = [[7, 2, "not_forwarded", QUANDO]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("meu pedido não encaminhado + o da outra parte também não encaminhado: nada é escrito (sem terceira linha)", async () => {
    estado.linhas = [[9, 2, "not_forwarded", null], [7, 1, "not_forwarded", null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("re-clique pela API: meu pedido não encaminhado + o pedido novo da outra parte em análise (oculto para mim): nada é escrito e a resposta é a de um pedido meu repetido", async () => {
    // Se o ramo in_review viesse antes do `minha`, gravaria reciprocatedAt na linha
    // da outra parte e ela passaria a aparecer para quem clica: a pessoa
    // descobriria que a outra pediu por ela sem o distribuidor encaminhar.
    estado.linhas = [[9, 2, "in_review", null], [7, 1, "not_forwarded", null]];
    const comALinhaOculta = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);

    estado.consultas = [];
    estado.linhas = [[7, 1, "not_forwarded", null]];
    const soOMeuPedido = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);

    expect(comALinhaOculta).toEqual(soOMeuPedido);
    expect(comALinhaOculta).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("meu pedido não encaminhado + o pedido da outra parte ENCAMINHADO (pending, visível para mim): o clique é o interesse mútuo", async () => {
    // A linha pending a destinatária vê (pedidoVisivelPara só esconde in_review e
    // not_forwarded): aceitar por aqui não revela nada que a tela não mostre.
    estado.linhas = [[9, 2, "pending", null], [7, 1, "not_forwarded", null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(updates().map(u => u.params.slice(-3))).toEqual([["accepted", 9, "pending"]]);
    expect(r).toEqual({ revelou: true, connectionId: 9, emAnalise: false });
  });

  it.each(["declined", "accepted", "blocked"])("a outra parte pediu e o pedido está %s: nada é escrito", async (status) => {
    estado.linhas = [[7, 2, status, null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it("duas tentativas sem linha afetada: para, sem revelar nem inserir, com a resposta neutra", async () => {
    estado.linhas = [[7, 2, "pending", null]];
    estado.afetadas = [0, 0];
    const r = await db.sendConnectionRequest(1, 2);
    expect(updates()).toHaveLength(2);
    expect(inserts()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: null, emAnalise: false });
  });
});

describe("respondToConnection — o aceite leva o status no WHERE", () => {
  it("aceitar: UPDATE travado em recipientId E status = pending; revela com 1 linha afetada", async () => {
    estado.linhas = [[7, 2, "pending"]]; // id, requesterId, status
    const r = await db.respondToConnection(7, 1, true);
    const [update] = escritas();
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`recipientId` = ? and `connections`.`status` = ?)");
    expect(update.params).toEqual(["accepted", 7, 1, "pending"]);
    expect(r).toEqual({ revelou: true, contraparte: 2 });
  });

  it("segunda aba (0 linhas afetadas): não revela e não devolve a contraparte", async () => {
    estado.linhas = [[7, 2, "pending"]];
    estado.affectedRows = 0;
    const r = await db.respondToConnection(7, 1, true);
    expect(r).toEqual({ revelou: false, contraparte: null });
  });

  it.each(["in_review", "not_forwarded", "accepted", "declined"])("linha %s: a destinatária não tem o que responder; nada é escrito", async (status) => {
    estado.linhas = [[7, 2, status]];
    const r = await db.respondToConnection(7, 1, true);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, contraparte: null });
  });
});

describe("a destinatária não vê o pedido em análise — regra de consulta", () => {
  it("getMatchesForUser: ocultação no JOIN, uma linha por par (a mais recente visível) e o nome atrás do aceite", async () => {
    await db.getMatchesForUser(1, 50);
    const [consulta] = selects();
    expect(consulta.sql).toContain("CASE WHEN `connections`.`status` = 'accepted'");
    // O predicado está NO JOIN (left join ... on (...)), não no WHERE: a linha
    // oculta não derruba o match, só some o estado da conexão.
    const trechoDoJoin = consulta.sql.slice(consulta.sql.indexOf("left join `connections`"), consulta.sql.lastIndexOf(" where `matches`"));
    expect(trechoDoJoin).toContain(OCULTACAO);
    // A subconsulta da linha mais recente visível do par, com o MESMO predicado na tabela apelidada.
    // Numa subconsulta de tabela única o drizzle não qualifica a coluna selecionada:
    // `MAX(`id`)` resolve para o escopo mais interno (conexao_do_par), pela regra de
    // escopo do SQL, e não para `connections` nem `matches` do lado de fora.
    expect(trechoDoJoin).toContain("`connections`.`id` = (select MAX(`id`) from `connections` `conexao_do_par` where");
    expect(trechoDoJoin).toContain("NOT (`conexao_do_par`.`status` IN ('in_review', 'not_forwarded') AND `conexao_do_par`.`recipientId` = ? AND `conexao_do_par`.`reciprocatedAt` IS NULL)");
    // A projeção não diz quem clicou primeiro numa linha recíproca em análise.
    expect(consulta.sql).toContain("`connections`.`recipientId` = ? AND `connections`.`status` NOT IN ('in_review', 'not_forwarded')");
  });

  it("getConnectionsForUser: o MESMO predicado no WHERE, e data e ordem pelo clique de quem consulta na linha recíproca", async () => {
    await db.getConnectionsForUser(1);
    const [consulta] = selects();
    const trechoDoWhere = consulta.sql.slice(consulta.sql.lastIndexOf(" where "));
    expect(trechoDoWhere).toContain(OCULTACAO);
    expect(consulta.sql).toContain("`connections`.`status` = 'accepted'");
    const dataVisivel = "CASE WHEN `connections`.`recipientId` = ? AND `connections`.`status` IN ('in_review', 'not_forwarded') THEN `connections`.`reciprocatedAt` ELSE `connections`.`createdAt` END";
    expect(consulta.sql).toContain(dataVisivel);
    expect(trechoDoWhere).toContain(`order by ${dataVisivel} desc`);
    expect(consulta.sql).toContain("`connections`.`recipientId` = ? AND `connections`.`status` NOT IN ('in_review', 'not_forwarded')");
  });

  it("getConnectionsForUser: a data da CASE chega como Date de verdade (decodificada como a coluna)", async () => {
    // id, status, createdAt(CASE), souDestinataria, city, primarySpecialty, outraParteId, message, displayName, avatarUrl, userName, userCompany
    estado.linhas = [[7, "in_review", QUANDO, 0, "Lisboa", "tech", null, null, null, null, null, null]];
    const [linha] = await db.getConnectionsForUser(1);
    expect(linha.createdAt).toBeInstanceOf(Date);
    expect(linha.createdAt.getTime()).toBe(Date.UTC(2026, 8, 13, 10, 0, 0));
  });
});

describe("a fila, a leitura do pedido e a decisão do distribuidor", () => {
  it("listarPedidosEmAnalise: só in_review, sem os pedidos em que o distribuidor é parte, sem e-mail/telefone/cofre/foto/links", async () => {
    await db.listarPedidosEmAnalise(9);
    const [consulta] = selects();
    expect(consulta.sql).toContain("`connections`.`status` = ?");
    expect(consulta.sql).toContain("`connections`.`requesterId` <> ?");
    expect(consulta.sql).toContain("`connections`.`recipientId` <> ?");
    expect(consulta.params).toEqual(["in_review", 9, 9, 50]);
    for (const proibido of ["email", "phone", "encryptedSensitiveData", "avatarUrl", "linkedinUrl", "websiteUrl", "passwordHash", "companyCnpj"]) {
      expect(consulta.sql, proibido).not.toContain(proibido);
    }
    expect(consulta.sql).toContain("`solicitante`.`name`");
    expect(consulta.sql).toContain("`destinataria`.`name`");
    expect(consulta.sql).toContain("`matches`.`userId` = `connections`.`requesterId`");
  });

  it("lerPedidoDeMatch: só acha in_review, e quem consulta sendo parte não acha a linha; reciprocatedAt chega como Date válido", async () => {
    estado.linhas = [[7, 2, 3, "in_review", QUANDO]];
    const pedido = await db.lerPedidoDeMatch(7, 9);
    const [consulta] = selects();
    expect(consulta.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ? and `connections`.`requesterId` <> ? and `connections`.`recipientId` <> ?)");
    expect(consulta.params).toEqual([7, "in_review", 9, 9, 1]);
    expect(pedido?.reciprocatedAt).toBeInstanceOf(Date);
    expect(pedido!.reciprocatedAt!.getTime()).toBe(Date.UTC(2026, 8, 13, 10, 0, 0));
  });

  it("decidirPedidoDeMatch (encaminhar): primeiro tenta accepted com reciprocatedAt IS NOT NULL; se casou, é recíproco", async () => {
    estado.afetadas = [1];
    const r = await db.decidirPedidoDeMatch(7, { aprovar: true, moderatedBy: 9, moderationNote: "Par forte" });
    const [update] = updates();
    for (const coluna of ["`status` = ?", "`moderatedBy` = ?", "`moderationNote` = ?", "`moderatedAt` = ?"]) expect(update.sql).toContain(coluna);
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ? and `connections`.`reciprocatedAt` is not null)");
    expect(update.params[0]).toBe("accepted");
    expect(update.params.slice(-2)).toEqual([7, "in_review"]);
    expect(r).toEqual({ status: "accepted", reciprocado: true });
  });

  it("…não recíproco: a segunda tentativa grava pending com reciprocatedAt IS NULL", async () => {
    estado.afetadas = [0, 1];
    const r = await db.decidirPedidoDeMatch(7, { aprovar: true, moderatedBy: 9, moderationNote: null });
    expect(updates()).toHaveLength(2);
    expect(updates()[1].params[0]).toBe("pending");
    expect(updates()[1].sql).toContain("`connections`.`reciprocatedAt` is null)");
    expect(r).toEqual({ status: "pending", reciprocado: false });
  });

  it("…a destinatária clicou entre as duas tentativas: a terceira grava accepted — nunca pending com reciprocatedAt", async () => {
    estado.afetadas = [0, 0, 1];
    const r = await db.decidirPedidoDeMatch(7, { aprovar: true, moderatedBy: 9, moderationNote: null });
    expect(updates().map(u => u.params[0])).toEqual(["accepted", "pending", "accepted"]);
    expect(r).toEqual({ status: "accepted", reciprocado: true });
  });

  it("…alguém decidiu antes (nenhuma tentativa casou): null", async () => {
    estado.afetadas = [0, 0, 0];
    expect(await db.decidirPedidoDeMatch(7, { aprovar: true, moderatedBy: 9, moderationNote: null })).toBeNull();
    expect(updates()).toHaveLength(3);
  });

  it("decidirPedidoDeMatch (não encaminhar): grava not_forwarded e informa se era recíproco", async () => {
    estado.afetadas = [0, 1];
    const r = await db.decidirPedidoDeMatch(7, { aprovar: false, moderatedBy: 9, moderationNote: "Setores sem relação" });
    expect(updates().map(u => u.params[0])).toEqual(["not_forwarded", "not_forwarded"]);
    expect(r).toEqual({ status: "not_forwarded", reciprocado: false });
  });

  it("listarHistoricoDeDistribuicao: só linhas decididas e sem as em que quem consulta é parte, mais recentes primeiro", async () => {
    await db.listarHistoricoDeDistribuicao(9, 30);
    const [consulta] = selects();
    expect(consulta.sql).toContain("`connections`.`moderatedAt` IS NOT NULL");
    expect(consulta.sql).toContain("`connections`.`requesterId` <> ?");
    expect(consulta.sql).toContain("`connections`.`recipientId` <> ?");
    expect(consulta.sql).toContain("order by `connections`.`moderatedAt` desc");
    expect(consulta.sql).toContain("`distribuidor`.`name`");
    expect(consulta.params).toEqual([9, 9, 30]);
  });

  it("definirPoderDeDistribuicao: o estado anterior no WHERE, e devolve se mudou", async () => {
    expect(await db.definirPoderDeDistribuicao(7, true)).toBe(true);
    const [update] = updates();
    expect(update.sql).toContain("where (`users`.`id` = ? and `users`.`isDistributor` = ?)");
    expect(update.params).toEqual([true, 7, false]);
    estado.affectedRows = 0;
    expect(await db.definirPoderDeDistribuicao(7, false)).toBe(false);
  });

  it("idsDosDistribuidoresAtivos e idsDaPresidenciaAtiva filtram isActive", async () => {
    await db.idsDosDistribuidoresAtivos();
    await db.idsDaPresidenciaAtiva();
    const [distribuidores, presidencia] = selects();
    expect(distribuidores.sql).toContain("`users`.`isDistributor` = ?");
    expect(distribuidores.sql).toContain("`users`.`isActive` = ?");
    expect(presidencia.sql).toContain("`users`.`role` in (?, ?)");
    expect(presidencia.params).toEqual(["president", "admin", true]);
  });
});

describe("pinos de fonte (db.ts)", () => {
  const fonte = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

  it("o predicado de ocultação é UM só (pedidoVisivelPara), usado nas duas consultas", () => {
    expect(fonte.match(/pedidoVisivelPara\(userId\)/g)).toHaveLength(2);
    const getMatches = fonte.slice(fonte.indexOf("export async function getMatchesForUser"), fonte.indexOf("export async function dismissMatch"));
    const getConnections = fonte.slice(fonte.indexOf("export async function getConnectionsForUser"), fonte.indexOf("function pedidoVisivelPara"));
    expect(getMatches).toContain("pedidoVisivelPara(userId)");
    expect(getMatches).toContain("pedidoVisivelPara(userId, conexaoDoPar)");
    expect(getConnections).toContain("pedidoVisivelPara(userId)");
  });

  it("o insert do pedido novo diz in_review explicitamente (não depende do default da coluna)", () => {
    expect(fonte).toContain('values({ requesterId, recipientId, status: "in_review" })');
  });
});
