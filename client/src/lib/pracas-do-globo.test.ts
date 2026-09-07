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

  it("hub no índice 0 e malha completa: principais primeiro, depois as demais entre si", () => {
    const presenca: PresencaPorPais[] = [
      { pais: "PT", total: 3 },
      { pais: "BR", total: 12 },
      { pais: "US", total: 1 },
    ];
    const { pracas, ligacoes } = montarPracasDoGlobo(presenca);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Portugal", "Estados Unidos"]);
    // as duas primeiras tocam o hub (principais); a terceira é a malha PT–US
    expect(ligacoes).toEqual([[0, 1], [0, 2], [1, 2]]);
    for (const [de, para] of ligacoes) {
      expect(pracas[de]).toBeDefined();
      expect(pracas[para]).toBeDefined();
    }
  });

  it("a conexão principal parte do Distrito Federal: o ponto do Brasil é a sede, não o centroide", () => {
    const { pracas } = montarPracasDoGlobo([{ pais: "BR", total: 1 }, { pais: "CL", total: 1 }]);
    expect(pracas[0].nome).toBe("Brasil (Distrito Federal)");
    expect(pracas[0].lat).toBeCloseTo(-15.79, 1);
    expect(pracas[0].lon).toBeCloseTo(-47.88, 1);
  });

  it("o Brasil é o hub mesmo quando outro país tem mais usuárias — a sede não muda de lugar", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "ES", total: 5 },
      { pais: "BR", total: 1 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Espanha"]);
    expect(ligacoes).toEqual([[0, 1]]);
  });

  it("sem presença no Brasil, o hub cai para o país com mais usuárias", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "CL", total: 2 },
      { pais: "ES", total: 5 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Espanha", "Chile"]);
    expect(ligacoes).toEqual([[0, 1]]);
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
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)"]);
  });

  it("respeita os tetos de praças e rotas, e as rotas do hub vêm antes do teto cortar", () => {
    const todos: PresencaPorPais[] = [
      "BR", "PT", "US", "AR", "CL", "MX", "CO", "DE", "FR",
      "GB", "ES", "IT", "JP", "CN", "IN", "AE", "ZA", "NG",
    ].map((pais, i) => ({ pais, total: 100 - i }));
    const { pracas, ligacoes } = montarPracasDoGlobo(todos);
    expect(pracas).toHaveLength(MAXIMO_DE_PRACAS);
    expect(ligacoes).toHaveLength(MAXIMO_DE_ROTAS);
    // com 12 praças, as 11 primeiras rotas são as principais (tocam o hub)
    for (const [de] of ligacoes.slice(0, MAXIMO_DE_PRACAS - 1)) expect(de).toBe(0);
    // e nenhuma rota se repete nem liga uma praça a ela mesma
    const vistas = new Set(ligacoes.map(([a, b]) => `${a}-${b}`));
    expect(vistas.size).toBe(ligacoes.length);
    for (const [de, para] of ligacoes) expect(de).not.toBe(para);
  });

  it("empate de contagem sai em ordem estável de sigla, para a cena não trocar de lugar a cada visita", () => {
    const a = montarPracasDoGlobo([{ pais: "PT", total: 2 }, { pais: "ES", total: 2 }]);
    const b = montarPracasDoGlobo([{ pais: "ES", total: 2 }, { pais: "PT", total: 2 }]);
    expect(a.pracas.map(p => p.nome)).toEqual(b.pracas.map(p => p.nome));
    expect(a.pracas[0].nome).toBe("Espanha");
  });
});
