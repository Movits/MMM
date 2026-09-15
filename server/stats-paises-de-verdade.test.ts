import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O recorte de "país de verdade" nas duas estatísticas públicas.
 *
 * "XX" é a opção "outro país" do Onboarding (client/src/pages/Onboarding.tsx):
 * é a ausência de país, não um país. O globo (presencaPorPais) já o excluía
 * desde a #52; o contador da home (platform.countries) não, e inflava o número
 * em 1 assim que a primeira pessoa marcasse "outro" — na mesma dobra em que o
 * globo desenhava um país a menos.
 *
 * O teste lê o SQL de verdade que o drizzle gera para o WHERE de cada consulta,
 * em vez de conferir o texto do código: é o que discrimina o comportamento, e é
 * o que falha se alguém reescrever um dos dois predicados sem o outro.
 */

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));

import { statsRouter } from "./routers/stats";

const caller = statsRouter.createCaller({} as never);
const dialeto = new MySqlDialect();
const renderizar = (condicao: unknown) => dialeto.sqlToQuery(condicao as SQL).sql;

/**
 * Dublê do query builder que anota todo WHERE recebido. Cada etapa é uma
 * Promise de verdade com os métodos seguintes pendurados, porque as consultas
 * daqui terminam tanto em .from() quanto em .where() quanto em .groupBy().
 */
function dbEspiao(capturas: unknown[], linhas: Array<Record<string, unknown>>) {
  const comGroupBy = () =>
    Object.assign(Promise.resolve(linhas), { groupBy: () => Promise.resolve(linhas) });
  const comWhere = () =>
    Object.assign(Promise.resolve(linhas), {
      where: (condicao: unknown) => {
        capturas.push(condicao);
        return comGroupBy();
      },
    });
  return { select: () => ({ from: () => comWhere() }) };
}

/** Só os WHERE que falam de país — os outros filtram papel, status etc. */
function wheresDePais(capturas: unknown[]) {
  return capturas.map(renderizar).filter(sql => sql.includes("`country`"));
}

beforeEach(() => {
  getDb.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe('"XX" não é país em nenhuma das duas contagens públicas', () => {
  it("platform.countries descarta o pseudo-país do Onboarding", async () => {
    const capturas: unknown[] = [];
    getDb.mockResolvedValue(dbEspiao(capturas, [{ n: 7 }]));

    await caller.platform();

    const doPais = wheresDePais(capturas);
    expect(doPais).toHaveLength(1);
    expect(doPais[0]).toContain("<> 'XX'");
  });

  it("presencaPorPais continua descartando o mesmo pseudo-país", async () => {
    const capturas: unknown[] = [];
    getDb.mockResolvedValue(dbEspiao(capturas, [{ pais: "BR", total: 1 }]));

    await caller.presencaPorPais();

    expect(wheresDePais(capturas)).toEqual([expect.stringContaining("<> 'XX'")]);
  });

  it("o contador e o globo recortam exatamente o mesmo conjunto", async () => {
    const doContador: unknown[] = [];
    getDb.mockResolvedValue(dbEspiao(doContador, [{ n: 0 }]));
    await caller.platform();

    const doGlobo: unknown[] = [];
    getDb.mockResolvedValue(dbEspiao(doGlobo, []));
    await caller.presencaPorPais();

    expect(wheresDePais(doContador)).toEqual(wheresDePais(doGlobo));
  });
});
