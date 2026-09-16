import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, inArray, or } from "drizzle-orm";
import {
  getDb, getMatchesForUser, getConnectionsForUser, sendConnectionRequest, lerPedidoDeMatch,
  decidirPedidoDeMatch, listarHistoricoDeDistribuicao,
} from "./db";
import { users, userProfiles, matches, connections } from "../drizzle/schema";

/**
 * O pedido de interesse que passa pelo distribuidor, contra um banco real DE TESTE.
 *
 * match-em-analise.test.ts confere o TEXTO do SQL num driver falso; aqui se confere
 * que o banco aceita esse SQL e responde o que o texto promete. O ponto de maior
 * risco é a subconsulta correlacionada que escolhe a linha do par (a mesma tabela,
 * apelidada, com ORDER BY e LIMIT dentro do LEFT JOIN): se o motor a recusar, a
 * lista do Smart Match quebra para todo mundo no deploy, e nenhum dublê pega isso.
 *
 * Roda no CI, que tem um MariaDB de serviço em DATABASE_URL_TESTES; pulado quando
 * essa variável não existe (server/test/setup-banco.ts já trocou DATABASE_URL por
 * ela, então o .env de trabalho nunca é usado aqui). Semeia quatro contas próprias,
 * com ids longe dos de matching-duplicacao.integracao.test.ts, e limpa tudo no fim.
 */
const A = 991151;
const B = 991152;
const C = 991153;
const D = 991154;
const CONTAS = [A, B, C, D];

const temBanco = Boolean(process.env.DATABASE_URL_TESTES);

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Status = "in_review" | "pending" | "accepted" | "declined" | "not_forwarded";
type Linha = { de: number; para: number; status: Status; reciprocado?: boolean };

describe.skipIf(!temBanco)("Pedido de interesse em análise (integração)", () => {
  beforeAll(async () => {
    const db = (await getDb())!;
    await limpar(db);
    for (const id of CONTAS) {
      await db.insert(users).values({ id, openId: `teste-analise-${id}`, isActive: true } as never);
      await db.insert(userProfiles).values({ userId: id, city: `cidade-${id}`, primarySpecialty: `esp-${id}`, displayName: `Nome-${id}` } as never);
    }
    // A vê B, C e D no Smart Match; B vê A.
    await db.insert(matches).values([
      { userId: A, matchedUserId: B, overallScore: 90 },
      { userId: A, matchedUserId: C, overallScore: 80 },
      { userId: A, matchedUserId: D, overallScore: 70 },
      { userId: B, matchedUserId: A, overallScore: 90 },
    ]);
  });

  const apagarConexoes = async () => {
    const db = (await getDb())!;
    await db.delete(connections).where(or(inArray(connections.requesterId, CONTAS), inArray(connections.recipientId, CONTAS)));
  };
  beforeEach(apagarConexoes);

  afterAll(async () => {
    const db = await getDb();
    if (db) await limpar(db);
  });

  /** Insere na ordem dada (o id cresce com ela) e devolve os ids. */
  const semear = async (linhas: Linha[]) => {
    const db = (await getDb())!;
    const ids: number[] = [];
    for (const l of linhas) {
      const [resultado] = await db.insert(connections).values({
        requesterId: l.de, recipientId: l.para, status: l.status, reciprocatedAt: l.reciprocado ? new Date() : null,
      });
      ids.push((resultado as { insertId: number }).insertId);
    }
    return ids;
  };

  const cartoesDe = async (userId: number) => {
    const lista = await getMatchesForUser(userId, 50);
    // A lista CRUA tem um cartão por pessoa antes de virar Map: o Map ficaria com a
    // última linha de um par repetido e esconderia a duplicata.
    expect(new Set(lista.map(m => m.matchedUserId)).size).toBe(lista.length);
    return new Map(lista.map(m => [m.matchedUserId, m]));
  };
  const cartao = (m: Awaited<ReturnType<typeof getMatchesForUser>>[number]) => ({
    connectionId: m.connectionId, status: m.connectionStatus, souDestinataria: Number(m.souDestinataria), displayName: m.displayName,
  });
  /** A aba Conexões sem a data, na ordem da cidade (a outra parte não tem id na projeção). */
  const aba = async (userId: number) => (await getConnectionsForUser(userId))
    .map(c => ({ city: c.city, id: c.id, status: c.status, souDestinataria: Number(c.souDestinataria), displayName: c.displayName }))
    .sort((x, y) => String(x.city).localeCompare(String(y.city)));

  it("getMatchesForUser roda no banco e dá UM cartão por par, com a linha que quem consulta pode ver e sem o id fora do pedido a responder", async () => {
    await semear([
      { de: A, para: B, status: "not_forwarded" }, // de A: visível para A
      { de: B, para: A, status: "in_review" },     // mais nova, mas oculta para A
      { de: C, para: A, status: "not_forwarded" }, // oculta para A: o par fica sem linha
      { de: D, para: A, status: "not_forwarded" }, // oculta para A...
      { de: A, para: D, status: "in_review" },     // ...e o pedido novo de A, visível
    ]);

    const cartoes = await cartoesDe(A);
    expect([...cartoes.keys()].sort()).toEqual([B, C, D]);
    expect(cartao(cartoes.get(B)!)).toEqual({ connectionId: null, status: "not_forwarded", souDestinataria: 0, displayName: null });
    expect(cartao(cartoes.get(C)!)).toEqual({ connectionId: null, status: null, souDestinataria: 0, displayName: null });
    expect(cartao(cartoes.get(D)!)).toEqual({ connectionId: null, status: "in_review", souDestinataria: 0, displayName: null });

    // O mesmo par visto por B escolhe outra linha: para B, a de A é que é oculta.
    expect(cartao((await cartoesDe(B)).get(A)!)).toEqual({ connectionId: null, status: "in_review", souDestinataria: 0, displayName: null });
  });

  it("com duas linhas visíveis no par, UM cartão: o pedido de B encaminhado aparece para A no lugar do dela, com o id para responder", async () => {
    const [, bParaA] = await semear([
      { de: A, para: B, status: "not_forwarded" },
      { de: B, para: A, status: "pending" },
    ]);
    expect((await getMatchesForUser(A, 50)).filter(m => m.matchedUserId === B)).toHaveLength(1);
    const deB = (await cartoesDe(A)).get(B)!;
    expect(cartao(deB)).toEqual({ connectionId: bParaA, status: "pending", souDestinataria: 1, displayName: null });
    expect(typeof deB.connectionId).toBe("number");
  });

  it("getConnectionsForUser (aba Conexões): uma linha por par, a mesma do cartão, e o id só no pedido a responder", async () => {
    const [, bParaA] = await semear([
      { de: A, para: B, status: "not_forwarded" }, // visível para A...
      { de: B, para: A, status: "pending" },       // ...e esta também: vale a encaminhada a A
      { de: D, para: A, status: "not_forwarded" }, // oculta para A
      { de: A, para: D, status: "in_review" },
    ]);

    const abaDeA = await aba(A);
    expect(abaDeA).toEqual([
      { city: `cidade-${B}`, id: bParaA, status: "pending", souDestinataria: 1, displayName: null },
      { city: `cidade-${D}`, id: null, status: "in_review", souDestinataria: 0, displayName: null },
    ]);
    const cartoes = await cartoesDe(A);
    expect(abaDeA.map(c => c.status)).toEqual([B, D].map(outra => cartoes.get(outra)!.connectionStatus));

    // Para B, a linha de A é oculta: sobra só o pedido dela, sem id (ela espera, não responde).
    expect(await aba(B)).toEqual([{ city: `cidade-${A}`, id: null, status: "pending", souDestinataria: 0, displayName: null }]);
  });

  it("pedido em análise com o clique recíproco aparece para a destinatária, sem dizer quem clicou primeiro (nem pelo id)", async () => {
    await semear([{ de: A, para: B, status: "in_review", reciprocado: true }]);
    expect(cartao((await cartoesDe(B)).get(A)!)).toEqual({ connectionId: null, status: "in_review", souDestinataria: 0, displayName: null });
  });

  it("re-clique pela API: o pedido novo de B, oculto para A, continua oculto — nada é gravado nele", async () => {
    const [aParaB] = await semear([{ de: A, para: B, status: "not_forwarded" }]);
    const cliqueDeB = await sendConnectionRequest(B, A); // B clica depois da recusa oculta
    expect(cliqueDeB).toMatchObject({ revelou: false, emAnalise: true });

    const repeticaoDeA = await sendConnectionRequest(A, B); // A repete o clique pela API
    expect(repeticaoDeA).toEqual({ revelou: false, connectionId: aParaB, emAnalise: false });

    const db = (await getDb())!;
    const par = await db.select({ id: connections.id, status: connections.status, reciprocatedAt: connections.reciprocatedAt })
      .from(connections)
      .where(and(inArray(connections.requesterId, [A, B]), inArray(connections.recipientId, [A, B])));
    expect(par).toHaveLength(2);
    expect(par.find(l => l.id === cliqueDeB.connectionId)).toMatchObject({ status: "in_review", reciprocatedAt: null });
    expect(cartao((await cartoesDe(A)).get(B)!)).toEqual({ connectionId: null, status: "not_forwarded", souDestinataria: 0, displayName: null });
  });

  it("o clique recíproco não se distingue do pedido feito sozinha: cartão e aba iguais nos dois mundos, antes e depois do não encaminhado", async () => {
    // Revisão da #115: no mundo em que B pediu antes, a linha do par é a de B, com id
    // MENOR que o do pedido que A acabou de fazer a C. Com o id no cartão e na aba, o
    // número sozinho contava que B pediu primeiro, mesmo com status e aviso iguais.
    const db = (await getDb())!;
    const mundo = async (bPediuAntes: boolean) => {
      await apagarConexoes();
      if (bPediuAntes) await sendConnectionRequest(B, A); // oculto para A
      await sendConnectionRequest(A, C);                   // o pedido de referência de A
      await sendConnectionRequest(A, B);
      const ver = async () => ({ cartao: cartao((await cartoesDe(A)).get(B)!), aba: await aba(A) });
      const antes = await ver();
      const doPar = await db.select({ id: connections.id }).from(connections)
        .where(and(inArray(connections.requesterId, [A, B]), inArray(connections.recipientId, [A, B])));
      expect(doPar).toHaveLength(1);
      expect(await decidirPedidoDeMatch(doPar[0].id, { aprovar: false, moderatedBy: D, moderationNote: "teste" }))
        .toEqual({ status: "not_forwarded", reciprocado: bPediuAntes });
      return { antes, depois: await ver() };
    };

    const comPedidoDeB = await mundo(true);
    const semPedidoDeB = await mundo(false);
    expect(comPedidoDeB).toEqual(semPedidoDeB);
    expect(comPedidoDeB.antes.cartao).toEqual({ connectionId: null, status: "in_review", souDestinataria: 0, displayName: null });
    expect(comPedidoDeB.depois.cartao).toEqual({ connectionId: null, status: "not_forwarded", souDestinataria: 0, displayName: null });
    expect(comPedidoDeB.depois.aba.map(c => c.id)).toEqual([null, null]);
  });

  // Duas linhas no mesmo par sem ser o caso previsto: dois cliques que chegaram juntos
  // (não há índice único no par) ou dado antigo. A escolha é pelo ESTADO; com MAX(id)
  // puro, a duplicata mais nova escondia a conexão aceita ou o pedido a responder.
  type Visao = { linha: number | null; status: Status; souDestinataria: 0 | 1; revelado: boolean };
  const casosDeDuasLinhas: { nome: string; linhas: Linha[]; paraA: Visao; paraB: Visao }[] = [
    {
      nome: "duas abas de A: a duplicata em análise não esconde a conexão aceita",
      linhas: [{ de: A, para: B, status: "accepted" }, { de: A, para: B, status: "in_review" }],
      paraA: { linha: null, status: "accepted", souDestinataria: 0, revelado: true },
      paraB: { linha: null, status: "accepted", souDestinataria: 1, revelado: true },
    },
    {
      nome: "duas abas de A, uma encaminhada e aceita, a outra não encaminhada como duplicada",
      linhas: [{ de: A, para: B, status: "accepted" }, { de: A, para: B, status: "not_forwarded" }],
      paraA: { linha: null, status: "accepted", souDestinataria: 0, revelado: true },
      paraB: { linha: null, status: "accepted", souDestinataria: 1, revelado: true },
    },
    {
      nome: "cliques cruzados: o pedido encaminhado a B não some atrás do não encaminhado dela",
      linhas: [{ de: A, para: B, status: "pending" }, { de: B, para: A, status: "not_forwarded" }],
      paraA: { linha: null, status: "pending", souDestinataria: 0, revelado: false },
      paraB: { linha: 0, status: "pending", souDestinataria: 1, revelado: false },
    },
    {
      nome: "dado antigo (dois cliques pendentes antes da #108): a conexão aceita vence o pendente mais novo",
      linhas: [{ de: B, para: A, status: "accepted" }, { de: A, para: B, status: "pending" }],
      paraA: { linha: null, status: "accepted", souDestinataria: 1, revelado: true },
      paraB: { linha: null, status: "accepted", souDestinataria: 0, revelado: true },
    },
    {
      nome: "dois pedidos encaminhados, um em cada direção: cada uma vê o que responde",
      linhas: [{ de: A, para: B, status: "pending" }, { de: B, para: A, status: "pending" }],
      paraA: { linha: 1, status: "pending", souDestinataria: 1, revelado: false },
      paraB: { linha: 0, status: "pending", souDestinataria: 1, revelado: false },
    },
    {
      nome: "o caso previsto não muda: não encaminhado de A e, depois, o pedido de B que A recusou",
      linhas: [{ de: A, para: B, status: "not_forwarded" }, { de: B, para: A, status: "declined" }],
      paraA: { linha: null, status: "declined", souDestinataria: 1, revelado: false },
      paraB: { linha: null, status: "declined", souDestinataria: 0, revelado: false },
    },
  ];

  it.each(casosDeDuasLinhas)("duas linhas no par, $nome", async ({ linhas, paraA, paraB }) => {
    const ids = await semear(linhas);
    for (const [quem, outra, visao] of [[A, B, paraA], [B, A, paraB]] as const) {
      const esperado = {
        connectionId: visao.linha === null ? null : ids[visao.linha],
        status: visao.status,
        souDestinataria: visao.souDestinataria,
        displayName: visao.revelado ? `Nome-${outra}` : null,
      };
      expect(cartao((await cartoesDe(quem)).get(outra)!), `cartão de ${quem}`).toEqual(esperado);
      expect(await aba(quem), `aba de ${quem}`).toEqual([{
        city: `cidade-${outra}`, id: esperado.connectionId, status: esperado.status,
        souDestinataria: esperado.souDestinataria, displayName: esperado.displayName,
      }]);
    }
  });

  it("lerPedidoDeMatch só acha pedido em análise de terceiros: já decidido, inexistente e de que se é parte dão null", async () => {
    const [emAnalise, decidido] = await semear([
      { de: A, para: B, status: "in_review" },
      { de: A, para: C, status: "not_forwarded" },
    ]);
    expect(await lerPedidoDeMatch(emAnalise, D)).toMatchObject({ id: emAnalise, requesterId: A, recipientId: B, status: "in_review" });
    expect(await lerPedidoDeMatch(decidido, D)).toBeNull();
    expect(await lerPedidoDeMatch(emAnalise, A)).toBeNull();
    expect(await lerPedidoDeMatch(emAnalise, B)).toBeNull();
    expect(await lerPedidoDeMatch(-1, D)).toBeNull();
  });

  it("listarHistoricoDeDistribuicao não traz o id da conexão", async () => {
    const [pedido] = await semear([{ de: A, para: B, status: "in_review" }]);
    await decidirPedidoDeMatch(pedido, { aprovar: false, moderatedBy: D, moderationNote: "teste do histórico" });
    const linha = (await listarHistoricoDeDistribuicao(C, 100)).find(h => h.nota === "teste do histórico");
    expect(linha).toMatchObject({ resultado: "not_forwarded", decididoPor: { id: D } });
    expect(Object.keys(linha!)).not.toContain("connectionId");
  });
});

async function limpar(db: Db) {
  await db.delete(connections).where(or(inArray(connections.requesterId, CONTAS), inArray(connections.recipientId, CONTAS)));
  await db.delete(matches).where(or(inArray(matches.userId, CONTAS), inArray(matches.matchedUserId, CONTAS)));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, CONTAS));
  await db.delete(users).where(inArray(users.id, CONTAS));
}
