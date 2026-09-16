import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Reteste v4, item 6.4: "N novas conexões sugeridas esperando pela sua atenção"
 * nunca baixava. A coluna `user_seen` nasce false e a função que a viraria
 * (`markMatchSeen`, em server/matching.ts) não tinha NENHUM chamador — o aviso
 * do Dashboard era permanente.
 *
 * O teste roda o router REAL sobre o matching.ts REAL, com o drizzle falando
 * com um cliente mysql2 falso: é assim que dá para ver QUAL SQL sai da mutation
 * (a posse tem de estar no WHERE, não numa conferência antes da query) e, sobre
 * uma tabela `matches` em miniatura, que o aviso zera depois dela sem tocar na
 * linha de outra dona.
 *
 * O mesmo cliente falso serve ao segundo bloco, sobre `souDestinataria`: ele é
 * `sql<boolean>` nas duas consultas de server/db.ts e o mysql2 entrega 1/0 —
 * a raiz do "0" solto que aparecia no cartão da tela. O dublê devolve 1 e 0
 * exatamente como o driver, e o servidor tem de entregar true e false.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** A tabela `matches` em miniatura: duas linhas da dona 1, uma da dona 2. */
  linhas: [] as { id: number; userId: number; userSeen: boolean }[],
  /**
   * Quando não é null, todo SELECT devolve UMA linha com este valor em TODAS as
   * colunas. O drizzle pede `rowsAsArray` e casa valor com coluna por POSIÇÃO:
   * preencher a linha inteira com o mesmo número deixa o teste indiferente à
   * ordem e ao número de colunas do select — o que importa é o que sai em
   * `souDestinataria`.
   */
  colunaDoSelect: null as number | null,
}));

vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      const sql = config.sql;
      if (sql.startsWith("update `matches`")) {
        // Os parâmetros do SET vêm antes dos do WHERE: [user_seen, user_id, ...ids].
        const [, dono, ...ids] = params;
        const alcancadas = estado.linhas.filter(l => l.userId === dono && ids.includes(l.id));
        for (const linha of alcancadas) linha.userSeen = true;
        return [{ affectedRows: alcancadas.length }, []];
      }
      if (sql.startsWith("select") && estado.colunaDoSelect !== null) {
        return [[new Array(64).fill(estado.colunaDoSelect)], []];
      }
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { profileMatchesRouter } = await import("./routers/profileMatches");
const { getConnectionsForUser, getMatchesForUser } = await import("./db");

const ctx = {
  user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

/** O mesmo cálculo do aviso no Dashboard: quantas sugestões dela ainda não foram vistas. */
const naoVistasDaDona1 = () => estado.linhas.filter(l => l.userId === 1 && !l.userSeen).length;

// Os procedimentos carregam matching.ts e db.ts por `await import(...)` dentro
// da chamada. Aquecer os dois módulos aqui tira a primeira resolução de dentro
// do primeiro caso: o que o teste mede é a consulta, não o custo do import.
beforeAll(async () => {
  await import("./matching");
});

beforeEach(() => {
  // REATRIBUIR, não esvaziar: se alguma chamada escapar sem ser aguardada, ela
  // escreve no array VELHO e o caso seguinte lê um array limpo. Com
  // `consultas.length = 0` a sobra caía dentro do teste seguinte, e a suíte
  // falhava de forma intermitente conforme a ordem em que as promessas
  // assentavam.
  estado.consultas = [];
  estado.colunaDoSelect = null;
  estado.linhas = [
    { id: 10, userId: 1, userSeen: false },
    { id: 11, userId: 1, userSeen: false },
    { id: 12, userId: 2, userSeen: false },
  ];
});

// Deixa a fila de microtarefas e a de I/O virarem antes do caso seguinte: o que
// tiver ficado pendente assenta AQUI, sobre o estado deste caso, e não no meio
// do próximo.
afterEach(async () => {
  await new Promise(resolve => setImmediate(resolve));
});

describe("matches.marcarVistas — o aviso de novidades baixa depois de a lista ser exibida", () => {
  it("marca só as linhas da dona: o id de outra pessoa no pedido não vira linha vista", async () => {
    expect(naoVistasDaDona1()).toBe(2);

    const resposta = await profileMatchesRouter.createCaller(ctx).marcarVistas({ matchIds: [10, 11, 12] });

    expect(resposta).toEqual({ marcadas: 2 });
    expect(estado.linhas.find(l => l.id === 12)?.userSeen).toBe(false);
    // O aviso zera: é esta contagem que a saudação do Dashboard lê.
    expect(naoVistasDaDona1()).toBe(0);
  });

  it("a posse está no WHERE da consulta, não numa conferência antes dela", async () => {
    await profileMatchesRouter.createCaller(ctx).marcarVistas({ matchIds: [10, 11] });

    const update = estado.consultas.find(c => c.sql.startsWith("update `matches`"));
    // As colunas de `matches` são camelCase no próprio banco (drizzle/schema.ts).
    expect(update?.sql).toContain("`userSeen` = ?");
    expect(update?.sql).toContain("`userId` = ?");
    expect(update?.sql).toContain("`id` in (?, ?)");
    // O id de quem está logada, e nenhum outro, é o que o UPDATE recebe como dono.
    expect(update?.params.slice(1)).toEqual([1, 10, 11]);
  });

  it("lista vazia é recusada na entrada: nenhum UPDATE sem id nenhum", async () => {
    // BAD_REQUEST (e não "procedure não existe"): quem recusa é o zod da entrada.
    await expect(profileMatchesRouter.createCaller(ctx).marcarVistas({ matchIds: [] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(estado.consultas.filter(c => c.sql.startsWith("update"))).toHaveLength(0);
  });
});

/**
 * A RAIZ do "0" solto no cartão (item 6.2). `souDestinataria` é
 * `sql<boolean>` em getMatchesForUser e getConnectionsForUser, mas o mysql2
 * entrega o tinyint do MySQL como 1/0 e o drizzle não converte expressão de
 * SQL cru: o valor chegava ao navegador como número, e
 * `status === "pending" && conn.souDestinataria` valia `0` — que o React
 * desenha. A tela já foi remendada; a conversão passa a ser do SERVIDOR, para
 * quem consumir a consulta amanhã (exame de produção, outro router, um script)
 * receber booleano sem precisar saber do driver.
 */
describe("souDestinataria — o 1/0 do driver vira booleano no servidor", () => {
  it("getConnectionsForUser: 1 vira true e 0 vira false", async () => {
    estado.colunaDoSelect = 1;
    const [destinataria] = await getConnectionsForUser(1);
    expect(destinataria.souDestinataria).toBe(true);

    estado.colunaDoSelect = 0;
    const [solicitante] = await getConnectionsForUser(1);
    expect(solicitante.souDestinataria).toBe(false);
  });

  it("getMatchesForUser: 1 vira true e 0 vira false", async () => {
    estado.colunaDoSelect = 1;
    const [destinataria] = await getMatchesForUser(1);
    expect(destinataria.souDestinataria).toBe(true);

    estado.colunaDoSelect = 0;
    const [solicitante] = await getMatchesForUser(1);
    expect(solicitante.souDestinataria).toBe(false);
  });

  it("nenhum dos dois inventa linha quando a consulta não devolve nada", async () => {
    estado.colunaDoSelect = null;
    expect(await getConnectionsForUser(1)).toEqual([]);
    expect(await getMatchesForUser(1)).toEqual([]);
  });
});
