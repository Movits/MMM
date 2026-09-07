import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_PRACAS,
  MAXIMO_DE_ROTAS,
  montarPracasDoGlobo,
  type PresencaPorPais,
} from "./pracas-do-globo";

describe("montarPracasDoGlobo — do agregado por país para a cena", () => {
  it("sem dado, sem praça: undefined e lista vazia rendem cena limpa, não erro", () => {
    expect(montarPracasDoGlobo(undefined)).toEqual({ pracas: [], ligacoes: [] });
    expect(montarPracasDoGlobo([])).toEqual({ pracas: [], ligacoes: [] });
  });

  it("as rotas irradiam do país com mais usuárias, e toda rota aponta para praça existente", () => {
    const presenca: PresencaPorPais[] = [
      { pais: "PT", total: 3 },
      { pais: "BR", total: 12 },
      { pais: "US", total: 1 },
    ];
    const { pracas, ligacoes } = montarPracasDoGlobo(presenca);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil", "Portugal", "Estados Unidos"]);
    expect(ligacoes).toEqual([[0, 1], [0, 2]]);
    for (const [de, para] of ligacoes) {
      expect(pracas[de]).toBeDefined();
      expect(pracas[para]).toBeDefined();
    }
  });

  it("um país só rende um ponto sem rota — o planeta não pode estrear vazio nem com arco solto", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([{ pais: "BR", total: 5 }]);
    expect(pracas).toHaveLength(1);
    expect(ligacoes).toEqual([]);
  });

  it("sigla desconhecida e contagem zerada ficam de fora em vez de cair no oceano", () => {
    const { pracas } = montarPracasDoGlobo([
      { pais: "BR", total: 2 },
      { pais: "ZZ", total: 9 },
      { pais: "PT", total: 0 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil"]);
  });

  it("respeita os tetos de praças e rotas, mesmo com o mundo inteiro cadastrado", () => {
    const todos: PresencaPorPais[] = [
      "BR", "PT", "US", "AR", "CL", "MX", "CO", "DE", "FR",
      "GB", "ES", "IT", "JP", "CN", "IN", "AE", "ZA", "NG",
    ].map((pais, i) => ({ pais, total: 100 - i }));
    const { pracas, ligacoes } = montarPracasDoGlobo(todos);
    expect(pracas).toHaveLength(MAXIMO_DE_PRACAS);
    expect(ligacoes).toHaveLength(MAXIMO_DE_ROTAS);
  });

  it("empate de contagem sai em ordem estável de sigla, para a cena não trocar de lugar a cada visita", () => {
    const a = montarPracasDoGlobo([{ pais: "PT", total: 2 }, { pais: "BR", total: 2 }]);
    const b = montarPracasDoGlobo([{ pais: "BR", total: 2 }, { pais: "PT", total: 2 }]);
    expect(a.pracas.map(p => p.nome)).toEqual(b.pracas.map(p => p.nome));
    expect(a.pracas[0].nome).toBe("Brasil");
  });
});
