import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, inArray, or } from "drizzle-orm";
import { getDb, getMatchesForUser, sendConnectionRequest, lerPedidoDeMatch } from "./db";
import { users, userProfiles, matches, connections } from "../drizzle/schema";

/**
 * O pedido de interesse que passa pelo distribuidor, contra um banco real DE TESTE.
 *
 * match-em-analise.test.ts confere o TEXTO do SQL num driver falso; aqui se confere
 * que o banco aceita esse SQL e responde o que o texto promete. O ponto de maior
 * risco é a subconsulta correlacionada de getMatchesForUser (`MAX(id)` da mesma
 * tabela, apelidada, dentro do LEFT JOIN): se o motor a recusar, a lista do Smart
 * Match quebra para todo mundo no deploy, e nenhum dublê pega isso.
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
type Linha = {
  de: number;
  para: number;
  status: "in_review" | "pending" | "accepted" | "declined" | "not_forwarded";
  reciprocado?: boolean;
};

describe.skipIf(!temBanco)("Pedido de interesse em análise (integração)", () => {
  beforeAll(async () => {
    const db = (await getDb())!;
    await limpar(db);
    for (const id of CONTAS) {
      await db.insert(users).values({ id, openId: `teste-analise-${id}`, isActive: true } as never);
      await db.insert(userProfiles).values({ userId: id, city: `cidade-${id}`, primarySpecialty: `esp-${id}` } as never);
    }
    // A vê B, C e D no Smart Match; B vê A.
    await db.insert(matches).values([
      { userId: A, matchedUserId: B, overallScore: 90 },
      { userId: A, matchedUserId: C, overallScore: 80 },
      { userId: A, matchedUserId: D, overallScore: 70 },
      { userId: B, matchedUserId: A, overallScore: 90 },
    ]);
  });

  beforeEach(async () => {
    const db = (await getDb())!;
    await db.delete(connections).where(or(inArray(connections.requesterId, CONTAS), inArray(connections.recipientId, CONTAS)));
  });

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
    return new Map(lista.map(m => [m.matchedUserId, m]));
  };

  it("getMatchesForUser roda no banco e dá UM cartão por par, com a linha mais recente que quem consulta pode ver", async () => {
    const [aParaB, bParaA, , , aParaD] = await semear([
      { de: A, para: B, status: "not_forwarded" }, // de A: visível para A
      { de: B, para: A, status: "in_review" },     // mais nova, mas oculta para A
      { de: C, para: A, status: "not_forwarded" }, // oculta para A: o par fica sem linha
      { de: D, para: A, status: "not_forwarded" }, // oculta para A...
      { de: A, para: D, status: "in_review" },     // ...e o pedido novo de A, visível
    ]);

    const deA = await getMatchesForUser(A, 50);
    expect(deA.map(m => m.matchedUserId).sort()).toEqual([B, C, D]); // nenhum cartão duplicado
    const cartoes = await cartoesDe(A);
    expect(cartoes.get(B)).toMatchObject({ connectionId: aParaB, connectionStatus: "not_forwarded" });
    expect(cartoes.get(C)).toMatchObject({ connectionId: null, connectionStatus: null });
    expect(cartoes.get(D)).toMatchObject({ connectionId: aParaD, connectionStatus: "in_review", displayName: null });

    // O mesmo par visto por B escolhe outra linha: para B, a de A é que é oculta.
    const cartaoDeB = (await cartoesDe(B)).get(A)!;
    expect(cartaoDeB).toMatchObject({ connectionId: bParaA, connectionStatus: "in_review" });
    expect(Number(cartaoDeB.souDestinataria)).toBe(0);
  });

  it("com duas linhas visíveis no par, o cartão é a mais nova: o pedido de B encaminhado aparece para A no lugar do dela", async () => {
    const [, bParaA] = await semear([
      { de: A, para: B, status: "not_forwarded" },
      { de: B, para: A, status: "pending" },
    ]);
    const cartao = (await cartoesDe(A)).get(B)!;
    expect(cartao).toMatchObject({ connectionId: bParaA, connectionStatus: "pending", displayName: null });
    expect(Number(cartao.souDestinataria)).toBe(1);
  });

  it("pedido em análise com o clique recíproco aparece para a destinatária, sem dizer quem clicou primeiro", async () => {
    const [aParaB] = await semear([{ de: A, para: B, status: "in_review", reciprocado: true }]);
    const cartao = (await cartoesDe(B)).get(A)!;
    expect(cartao).toMatchObject({ connectionId: aParaB, connectionStatus: "in_review", displayName: null });
    expect(Number(cartao.souDestinataria)).toBe(0);
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
    expect((await cartoesDe(A)).get(B)).toMatchObject({ connectionId: aParaB, connectionStatus: "not_forwarded" });
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
});

async function limpar(db: Db) {
  await db.delete(connections).where(or(inArray(connections.requesterId, CONTAS), inArray(connections.recipientId, CONTAS)));
  await db.delete(matches).where(or(inArray(matches.userId, CONTAS), inArray(matches.matchedUserId, CONTAS)));
  await db.delete(userProfiles).where(inArray(userProfiles.userId, CONTAS));
  await db.delete(users).where(inArray(users.id, CONTAS));
}
