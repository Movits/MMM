import { describe, expect, it } from "vitest";
import { diferencasDaRevisao } from "./diferencas-da-revisao";

/**
 * A tela do "Revisar texto" destaca o que a sugestão muda. O que importa: o
 * texto que a pessoa lê, tirando o riscado, é exatamente a sugestão; e tudo o
 * que foi acrescentado ou tirado aparece marcado, inclusive acento.
 */

const semRemovidos = (trechos: ReturnType<typeof diferencasDaRevisao>) =>
  trechos.filter(trecho => trecho.tipo !== "removido").map(trecho => trecho.texto).join("");
const doTipo = (trechos: ReturnType<typeof diferencasDaRevisao>, tipo: "removido" | "incluido") =>
  trechos.filter(trecho => trecho.tipo === tipo).map(trecho => trecho.texto.trim());

describe("diferencasDaRevisao", () => {
  it("marca a palavra acrescentada que a guarda do servidor não teria como provar inocente", () => {
    const original = "Empresa farmaceutica procurando distribuidor para a Africa.";
    const revisado = "Empresa farmacêutica procurando distribuidor e assessoria jurídica para a África.";
    const trechos = diferencasDaRevisao(original, revisado);

    expect(semRemovidos(trechos)).toBe(revisado);
    expect(doTipo(trechos, "incluido")).toEqual(["farmacêutica", "e assessoria jurídica", "África."]);
    expect(doTipo(trechos, "removido")).toEqual(["farmaceutica", "Africa."]);
  });

  it("número trocado de lugar aparece nos dois pontos", () => {
    const trechos = diferencasDaRevisao("5 milhões com 40 funcionários", "40 milhões com 5 funcionários");
    expect(doTipo(trechos, "removido")).toEqual(["5", "40"]);
    expect(doTipo(trechos, "incluido")).toEqual(["40", "5"]);
  });

  it("preserva quebras de linha e não marca nada quando o texto é igual", () => {
    const texto = "Primeira linha.\n\nSegunda linha.";
    expect(diferencasDaRevisao(texto, texto)).toEqual([{ tipo: "igual", texto }]);
    expect(semRemovidos(diferencasDaRevisao("primeira linha\n\nsegunda", texto))).toBe(texto);
  });

  it("palavra tirada no fim continua separada da anterior", () => {
    const trechos = diferencasDaRevisao("vendo vinho e azeite", "Vendo vinho e");
    expect(trechos.map(trecho => trecho.texto).join("")).toBe("vendo Vendo vinho e azeite ");
    expect(doTipo(trechos, "removido")).toEqual(["vendo", "azeite"]);
  });
});
