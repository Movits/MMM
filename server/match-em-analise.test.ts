import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * O pedido de interesse passa pelo distribuidor — o SQL de verdade.
 *
 * O que este arquivo trava, no drizzle real sobre um cliente mysql2 falso que
 * captura cada comando (molde de etapa10-gestao-ouro.test.ts):
 *
 * 1. O pedido novo nasce `in_review`, não `pending`.
 * 2. O interesse mútuo e o aceite levam o status lido NO WHERE: a segunda aba
 *    não afeta linha nenhuma e não "revela" de novo.
 * 3. O clique da destinatária sobre um pedido em análise grava só
 *    `reciprocatedAt` (uma linha por par), também com o status no WHERE.
 * 4. A destinatária não recebe a linha em análise nem a não encaminhada — em
 *    getMatchesForUser E em getConnectionsForUser, pelo mesmo predicado — e o
 *    nome continua atrás do `CASE WHEN status = 'accepted'`.
 * 5. A fila do distribuidor filtra `in_review`, exclui os pedidos em que ele é
 *    parte e não lê e-mail, telefone, cofre, foto nem links.
 * 6. A decisão é um UPDATE com `status = 'in_review'` no WHERE; 0 linhas = false.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** Linhas (como arrays, na ordem das colunas) devolvidas ao próximo SELECT. */
  linhas: [] as unknown[][],
  affectedRows: 1,
  insertId: 41,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      if (/^\s*(update|insert)/i.test(config.sql)) {
        return [{ affectedRows: estado.affectedRows, insertId: estado.insertId }, undefined];
      }
      return [estado.linhas, []];
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
const escritas = () => estado.consultas.filter(c => /^\s*(update|insert)/i.test(c.sql));
const OCULTACAO = "NOT (`connections`.`status` IN ('in_review', 'not_forwarded') AND `connections`.`recipientId` = ? AND `connections`.`reciprocatedAt` IS NULL)";

beforeEach(() => {
  estado.consultas = [];
  estado.linhas = [];
  estado.affectedRows = 1;
  estado.insertId = 41;
});

describe("sendConnectionRequest — o pedido nasce em análise", () => {
  it("par novo: INSERT com status in_review, e devolve emAnalise para o router avisar quem distribui", async () => {
    const r = await db.sendConnectionRequest(1, 2);
    const [insert] = escritas();
    expect(insert.sql).toMatch(/^insert into `connections`/);
    expect(insert.sql).toContain("`status`");
    expect(insert.params).toEqual([1, 2, "in_review"]);
    expect(r).toEqual({ revelou: false, connectionId: 41, emAnalise: true });
  });

  it("a outra parte já pediu e o pedido está ENCAMINHADO (pending): vira accepted com o status no WHERE", async () => {
    estado.linhas = [[7, 2, "pending", null]]; // id, requesterId, status, reciprocatedAt
    const r = await db.sendConnectionRequest(1, 2);
    const [update] = escritas();
    expect(update.sql).toMatch(/^update `connections` set `status` = \?/);
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ?)");
    expect(update.params.slice(-3)).toEqual(["accepted", 7, "pending"]);
    expect(r).toEqual({ revelou: true, connectionId: 7, emAnalise: false });
  });

  it("…e se a linha já não estava pending (outra aba chegou antes), NÃO revela", async () => {
    estado.linhas = [[7, 2, "pending", null]];
    estado.affectedRows = 0;
    const r = await db.sendConnectionRequest(1, 2);
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

  it("pedido em análise JÁ recíproco: segundo clique não escreve nada", async () => {
    estado.linhas = [[7, 2, "in_review", new Date()]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it.each(["in_review", "pending", "not_forwarded", "declined", "accepted"])("meu próprio pedido já existe (%s): nada é escrito", async (status) => {
    estado.linhas = [[7, 1, status, null]]; // requesterId = 1 = eu
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r).toEqual({ revelou: false, connectionId: 7, emAnalise: false });
  });

  it.each(["not_forwarded", "declined", "accepted", "blocked"])("a outra parte pediu e o pedido está %s: nada é escrito (limite conhecido, D7)", async (status) => {
    estado.linhas = [[7, 2, status, null]];
    const r = await db.sendConnectionRequest(1, 2);
    expect(escritas()).toEqual([]);
    expect(r.emAnalise).toBe(false);
    expect(r.revelou).toBe(false);
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
  it("getMatchesForUser: a ocultação está no JOIN com connections, e o nome segue atrás do aceite", async () => {
    await db.getMatchesForUser(1, 50);
    const [consulta] = selects();
    expect(consulta.sql).toContain(OCULTACAO);
    expect(consulta.sql).toContain("CASE WHEN `connections`.`status` = 'accepted'");
    // O predicado está NO JOIN (left join ... on (...)), não no WHERE: assim a
    // linha oculta não derruba o match, só some o estado da conexão.
    const trechoDoJoin = consulta.sql.slice(consulta.sql.indexOf("left join `connections`"), consulta.sql.indexOf(" where "));
    expect(trechoDoJoin).toContain(OCULTACAO);
  });

  it("getConnectionsForUser: o MESMO predicado no WHERE", async () => {
    await db.getConnectionsForUser(1);
    const [consulta] = selects();
    const trechoDoWhere = consulta.sql.slice(consulta.sql.indexOf(" where "));
    expect(trechoDoWhere).toContain(OCULTACAO);
    expect(consulta.sql).toContain("`connections`.`status` = 'accepted'");
  });
});

describe("a fila e a decisão do distribuidor", () => {
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
    // As duas partes com nome e a nota do Smart Match na direção do pedido.
    expect(consulta.sql).toContain("`solicitante`.`name`");
    expect(consulta.sql).toContain("`destinataria`.`name`");
    expect(consulta.sql).toContain("`matches`.`userId` = `connections`.`requesterId`");
  });

  it("decidirPedidoDeMatch: UPDATE único com status = in_review no WHERE; 1 linha = true, 0 = false", async () => {
    const ok = await db.decidirPedidoDeMatch(7, { statusFinal: "pending", moderatedBy: 9, moderationNote: "Par forte" });
    const [update] = escritas();
    expect(update.sql).toMatch(/^update `connections` set /);
    for (const coluna of ["`status` = ?", "`moderatedBy` = ?", "`moderationNote` = ?", "`moderatedAt` = ?"]) expect(update.sql).toContain(coluna);
    expect(update.sql).toContain("where (`connections`.`id` = ? and `connections`.`status` = ?)");
    expect(update.params.slice(-2)).toEqual([7, "in_review"]);
    expect(update.params[0]).toBe("pending");
    expect(ok).toBe(true);

    estado.affectedRows = 0;
    expect(await db.decidirPedidoDeMatch(7, { statusFinal: "not_forwarded", moderatedBy: 9, moderationNote: "x" })).toBe(false);
  });

  it("listarHistoricoDeDistribuicao: só linhas decididas, mais recentes primeiro, com quem decidiu", async () => {
    await db.listarHistoricoDeDistribuicao(30);
    const [consulta] = selects();
    expect(consulta.sql).toContain("`connections`.`moderatedAt` IS NOT NULL");
    expect(consulta.sql).toContain("order by `connections`.`moderatedAt` desc");
    expect(consulta.sql).toContain("`distribuidor`.`name`");
    expect(consulta.params).toEqual([30]);
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
    expect(getConnections).toContain("pedidoVisivelPara(userId)");
  });

  it("o insert do pedido novo diz in_review explicitamente (não depende do default da coluna)", () => {
    expect(fonte).toContain('values({ requesterId, recipientId, status: "in_review" })');
  });
});
