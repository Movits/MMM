import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * stats.presencaPorPais — o agregado que alimenta o globo da home.
 *
 * Duas regras valem mais que o resto:
 *  1. PRIVACIDADE: a resposta só carrega sigla ISO e contagem. Nenhuma coluna
 *     pessoal é selecionada — o teste pina o formato para uma coluna a mais
 *     não passar despercebida.
 *  2. DEGRADAÇÃO: é exceção deliberada ao exigirDb() (como stats.platform):
 *     home pública, banco fora do ar vira lista vazia com erro no log, nunca
 *     um lançamento que derrube a página para quem nem entrou.
 */

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));

import { statsRouter } from "./routers/stats";

const caller = statsRouter.createCaller({} as never);

/** Dublê do query builder do drizzle: a cadeia termina numa Promise de linhas. */
function dbComLinhas(linhas: Array<{ pais: string | null; total: unknown }>) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: () => Promise.resolve(linhas),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  getDb.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("stats.presencaPorPais", () => {
  it("devolve só sigla e contagem, em ordem de presença", async () => {
    getDb.mockResolvedValue(dbComLinhas([
      { pais: "PT", total: 3 },
      { pais: "BR", total: "12" }, // driver do MySQL devolve COUNT como string
    ]));
    const resposta = await caller.presencaPorPais();
    expect(resposta).toEqual([
      { pais: "BR", total: 12 },
      { pais: "PT", total: 3 },
    ]);
    for (const linha of resposta) expect(Object.keys(linha).sort()).toEqual(["pais", "total"]);
  });

  it("sigla vem em maiúscula, venha como vier do banco", async () => {
    getDb.mockResolvedValue(dbComLinhas([{ pais: "br", total: 1 }]));
    expect(await caller.presencaPorPais()).toEqual([{ pais: "BR", total: 1 }]);
  });

  it("banco não configurado degrada para vazio com erro no log, sem lançar", async () => {
    getDb.mockResolvedValue(null);
    expect(await caller.presencaPorPais()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("queda do banco na query também degrada para vazio, com aviso no log", async () => {
    getDb.mockResolvedValue({
      select: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await caller.presencaPorPais()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
