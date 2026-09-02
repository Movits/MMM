import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 10 — a parte pura do filtro de autorização, EXECUTADA de verdade
 * (sem mock de módulo): é o pedaço em JS que decide quem sai do acervo.
 */
import { filtrarAcervoPorAutorizacao } from "./db";

const donaPorOpenId = new Map([
  ["dona-com-termo", { id: 1 }],
  ["dona-sem-termo", { id: 2 }],
]);

const contatos = [
  { ownerId: "dona-com-termo", nome: "Fica" },
  { ownerId: "dona-sem-termo", nome: "Sai — termo revogado" },
  { ownerId: "dona-apagada", nome: "Sai — conta órfã" },
];

describe("Etapa 10 — filtro de autorização da dona (execução real)", () => {
  it("dona sem o termo vigente some do acervo — revogação vale na leitura", () => {
    const visiveis = filtrarAcervoPorAutorizacao(contatos, donaPorOpenId, new Set([1]));
    expect(visiveis.map(c => c.nome)).toEqual(["Fica"]);
  });

  it("todas com termo (ou sem termo publicado): todas aparecem — menos a órfã", () => {
    const visiveis = filtrarAcervoPorAutorizacao(contatos, donaPorOpenId, new Set([1, 2]));
    expect(visiveis.map(c => c.nome)).toEqual(["Fica", "Sai — termo revogado"]);
  });

  it("nenhuma autorizada: acervo vazio", () => {
    expect(filtrarAcervoPorAutorizacao(contatos, donaPorOpenId, new Set())).toEqual([]);
  });
});
