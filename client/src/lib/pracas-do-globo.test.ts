import { describe, expect, it } from "vitest";
import {
  MAXIMO_DE_PRACAS,
  MAXIMO_DE_ROTAS,
  montarPracasDoGlobo,
  type PresencaPorPais,
} from "./pracas-do-globo";

const VITRINE = ["Portugal", "Espanha", "França", "Alemanha", "Reino Unido", "Itália"];

describe("montarPracasDoGlobo — presença real + vitrine da Europa", () => {
  it("sem dado nenhum, a vitrine segura a cena: DF + Europa em estrela, sem malha", () => {
    for (const entrada of [undefined, [] as PresencaPorPais[]]) {
      const { pracas, ligacoes } = montarPracasDoGlobo(entrada);
      expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", ...VITRINE]);
      // todas as rotas saem do DF (índice 0) — vitrine não tece malha
      expect(ligacoes).toEqual([[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]]);
    }
  });

  it("a conexão principal parte do Distrito Federal: o ponto do Brasil é a sede, não o centroide", () => {
    const { pracas } = montarPracasDoGlobo([{ pais: "BR", total: 1 }]);
    expect(pracas[0].nome).toBe("Brasil (Distrito Federal)");
    expect(pracas[0].lat).toBeCloseTo(-15.79, 1);
    expect(pracas[0].lon).toBeCloseTo(-47.88, 1);
  });

  it("reais primeiro, vitrine depois, sem duplicar país que aparece nos dois", () => {
    const presenca: PresencaPorPais[] = [
      { pais: "BR", total: 3 },
      { pais: "ES", total: 1 },
      { pais: "CL", total: 1 },
    ];
    const { pracas, ligacoes } = montarPracasDoGlobo(presenca);
    expect(pracas.map(p => p.nome)).toEqual([
      "Brasil (Distrito Federal)", "Chile", "Espanha",
      "Portugal", "França", "Alemanha", "Reino Unido", "Itália",
    ]);
    // 7 principais do DF + a única malha real (Chile–Espanha)
    expect(ligacoes.slice(0, 7).every(([de]) => de === 0)).toBe(true);
    expect(ligacoes.slice(7)).toEqual([[1, 2]]);
  });

  it("a malha é exclusiva de quem tem presença real — a vitrine nunca se liga entre si", () => {
    const { ligacoes } = montarPracasDoGlobo([{ pais: "BR", total: 5 }]);
    for (const [de] of ligacoes) expect(de).toBe(0);
    expect(ligacoes).toHaveLength(6);
  });

  it("o hub é o DF mesmo sem cadastro brasileiro — é de lá que a vitrine irradia", () => {
    const { pracas, ligacoes } = montarPracasDoGlobo([{ pais: "CL", total: 4 }]);
    expect(pracas[0].nome).toBe("Brasil (Distrito Federal)");
    expect(pracas[1].nome).toBe("Chile");
    // Chile é o único real fora do hub: nenhuma malha além das principais
    expect(ligacoes.every(([de]) => de === 0)).toBe(true);
  });

  it("sigla desconhecida e contagem zerada não entram como presença real", () => {
    const { pracas } = montarPracasDoGlobo([
      { pais: "ZZ", total: 9 },
      { pais: "PT", total: 0 },
    ]);
    // sobra só a vitrine (PT aparece pela vitrine, não pelo dado zerado)
    expect(pracas.map(p => p.nome)).toEqual(["Brasil (Distrito Federal)", ...VITRINE]);
  });

  it("presença real tem prioridade no teto de praças; a vitrine preenche o que sobrar", () => {
    const todos: PresencaPorPais[] = [
      "BR", "US", "AR", "CL", "MX", "CO", "JP", "CN", "IN", "AE", "ZA", "NG",
    ].map((pais, i) => ({ pais, total: 100 - i }));
    const { pracas, ligacoes } = montarPracasDoGlobo(todos);
    expect(pracas).toHaveLength(MAXIMO_DE_PRACAS);
    // 12 reais ocupam tudo: nenhuma vaga para a vitrine
    expect(pracas.map(p => p.nome)).not.toContain("Portugal");
    expect(ligacoes.length).toBeLessThanOrEqual(MAXIMO_DE_ROTAS);
    // as 11 primeiras rotas são as principais (tocam o hub)
    for (const [de] of ligacoes.slice(0, MAXIMO_DE_PRACAS - 1)) expect(de).toBe(0);
    // e nenhuma rota se repete nem liga uma praça a ela mesma
    const vistas = new Set(ligacoes.map(([a, b]) => `${a}-${b}`));
    expect(vistas.size).toBe(ligacoes.length);
    for (const [de, para] of ligacoes) expect(de).not.toBe(para);
  });

  it("empate de contagem sai em ordem estável de sigla, para a cena não trocar de lugar a cada visita", () => {
    const a = montarPracasDoGlobo([{ pais: "CL", total: 2 }, { pais: "AR", total: 2 }]);
    const b = montarPracasDoGlobo([{ pais: "AR", total: 2 }, { pais: "CL", total: 2 }]);
    expect(a.pracas.map(p => p.nome)).toEqual(b.pracas.map(p => p.nome));
    expect(a.pracas[1].nome).toBe("Argentina");
  });
});
