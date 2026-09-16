import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_PRACAS,
  montarPracasDoGlobo,
  type PresencaPorPais,
} from "./pracas-do-globo";

describe("montarPracasDoGlobo — do agregado por país para a cena", () => {
  it("sem dado, sem praça: undefined e lista vazia rendem cena limpa, não erro", () => {
    expect(montarPracasDoGlobo(undefined)).toEqual({ pracas: [], ligacoes: [] });
    expect(montarPracasDoGlobo([])).toEqual({ pracas: [], ligacoes: [] });
  });

  it("hub no índice 0 e um tronco por continente: a sede não liga em todo mundo", () => {
    const presenca: PresencaPorPais[] = [
      { pais: "PT", total: 3 },
      { pais: "BR", total: 12 },
      { pais: "US", total: 1 },
    ];
    const { pracas, ligacoes } = montarPracasDoGlobo(presenca);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Portugal", "Estados Unidos"]);
    // Três continentes, um país em cada: dois troncos e nenhum ramo. A malha
    // PT–US da fiação antiga não existe mais.
    expect(ligacoes).toEqual([[0, 1, "tronco"], [0, 2, "tronco"]]);
  });

  it("o ramo sai da porta do continente, não da sede", () => {
    // Portugal entra com mais presença que Alemanha e Itália: é a porta da
    // Europa, e as outras duas penduram nela.
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "BR", total: 20 },
      { pais: "PT", total: 9 },
      { pais: "DE", total: 5 },
      { pais: "IT", total: 4 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Portugal", "Alemanha", "Itália"]);
    expect(ligacoes).toEqual([
      [0, 1, "tronco"],
      [1, 2, "ramo"],
      [1, 3, "ramo"],
    ]);
  });

  it("o continente da sede não ganha tronco: os vizinhos saem dela como ramos", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "BR", total: 20 },
      { pais: "AR", total: 7 },
      { pais: "CL", total: 3 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Argentina", "Chile"]);
    expect(ligacoes).toEqual([[0, 1, "ramo"], [0, 2, "ramo"]]);
  });

  it("a Oceania e o norte da África entram na rede: a viagem termina com a Ásia e a Oceania de frente", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "BR", total: 9 },
      { pais: "AU", total: 3 },
      { pais: "NZ", total: 1 },
      { pais: "EG", total: 2 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Austrália", "Egito", "Nova Zelândia"]);
    expect(ligacoes).toEqual([
      [0, 1, "tronco"],
      [0, 2, "tronco"],
      [1, 3, "ramo"],
    ]);
  });

  it("a África tem duas portas: a do norte (Saara) e a subsaariana, cada uma com seu tronco", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "BR", total: 30 },
      { pais: "NG", total: 9 },
      { pais: "EG", total: 6 },
      { pais: "ZA", total: 4 },
      { pais: "MA", total: 2 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", "Nigéria", "Egito", "África do Sul", "Marrocos"]);
    expect(ligacoes).toEqual([
      [0, 1, "tronco"],
      [0, 2, "tronco"],
      [1, 3, "ramo"],
      [2, 4, "ramo"],
    ]);
  });

  it("a rede parte do Distrito Federal: o ponto do Brasil é a sede, não o centroide", () => {
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
    expect(ligacoes).toEqual([[0, 1, "tronco"]]);
  });

  it("sem presença no Brasil, o hub cai para o país com mais usuárias", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([
      { pais: "CL", total: 2 },
      { pais: "ES", total: 5 },
    ]);
    expect(pracas.map(p => p.nome)).toEqual(["Espanha", "Chile"]);
    expect(ligacoes).toEqual([[0, 1, "tronco"]]);
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

  it("só passa o que o globo usa: nome e coordenadas, sem o continente da fiação", () => {
    const { pracas } = montarPracasDoGlobo([{ pais: "BR", total: 1 }]);
    expect(Object.keys(pracas[0]).sort()).toEqual(["lat", "lon", "nome"]);
  });

  it("respeita o teto de praças, e a rede é uma árvore: cada praça tem exatamente uma rota chegando", () => {
    const siglas = [
      "BR", "AR", "CL", "CO", "PE", "BO", "PY", "US", "MX", "CA", "CR", "PA", "DO",
      "PT", "FR", "DE", "IT", "GB", "ES", "BE", "FI", "NG", "ZA", "MZ", "TZ", "CD",
      "AO", "GH", "EG", "MA", "TN", "SN", "SD", "ET", "KE", "LY", "AE", "SA", "TR",
      "IN", "CN", "JP", "SG", "BD", "UZ", "AU", "NZ",
    ];
    expect(siglas.length).toBeGreaterThan(MAXIMO_DE_PRACAS);
    const todos: PresencaPorPais[] = siglas.map((pais, i) => ({ pais, total: 100 - i }));
    const { pracas, ligacoes } = montarPracasDoGlobo(todos);
    expect(pracas).toHaveLength(MAXIMO_DE_PRACAS);

    expect(ligacoes).toHaveLength(pracas.length - 1);
    const destinos = ligacoes.map(([, para]) => para);
    expect(new Set(destinos).size).toBe(destinos.length);
    expect(destinos).not.toContain(0);

    // Os troncos vêm antes dos ramos, e todo tronco sai da sede.
    const primeiroRamo = ligacoes.findIndex(([, , nivel]) => nivel === "ramo");
    const troncos = ligacoes.slice(0, primeiroRamo);
    expect(troncos.every(([de, , nivel]) => de === 0 && nivel === "tronco")).toBe(true);
    expect(ligacoes.slice(primeiroRamo).every(([, , nivel]) => nivel === "ramo")).toBe(true);
    // Com os 40 primeiros, cinco regiões além da da sede: América do Norte,
    // Europa, África Subsaariana, Norte da África e Ásia (a Oceania ficou além
    // do teto).
    expect(troncos).toHaveLength(5);

    for (const [de, para] of ligacoes) {
      expect(de).not.toBe(para);
      expect(pracas[de]).toBeDefined();
      expect(pracas[para]).toBeDefined();
    }
  });

  it("empate de contagem sai em ordem estável de sigla, para a cena não trocar de lugar a cada visita", () => {
    const a = montarPracasDoGlobo([{ pais: "PT", total: 2 }, { pais: "ES", total: 2 }]);
    const b = montarPracasDoGlobo([{ pais: "ES", total: 2 }, { pais: "PT", total: 2 }]);
    expect(a.pracas.map(p => p.nome)).toEqual(b.pracas.map(p => p.nome));
    expect(a.pracas[0].nome).toBe("Espanha");
  });
});
