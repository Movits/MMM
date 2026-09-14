/**
 * A base de cálculo da comissão, nos textos que a usuária lê.
 *
 * Em 12/09/2026 a Dra. Glenda respondeu à pergunta direta — "o teto de 50%
 * incide sobre o lucro ou sobre o valor do negócio?" — e a resposta não foi
 * nenhuma das duas: "Incide sobre o valor dos honorários da intermediação do
 * negócio". Quem define o percentual é a Diretoria Comercial, "por critérios que
 * serão definidos em outra ocasião".
 *
 * O acordo da Sala de Negociação é texto que as DUAS PARTES aceitam antes de
 * conversar, nos dez idiomas. Ele dizia "o limite é de 50% do lucro declarado no
 * negócio" e "o percentual é definido caso a caso, conforme o tipo e o tamanho do
 * negócio" — o primeiro contradiz a resposta dela, e o segundo inventa um
 * critério que ela não deu.
 *
 * Este teste existe porque esse tipo de texto envelhece em silêncio: ninguém
 * reclama de uma cláusula errada até o dia em que ela é cobrada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.resolve(AQUI, "..", "client", "src", "i18n", "locales");

const IDIOMAS = readdirSync(PASTA).filter(f => f.endsWith(".json"));

/** Todo valor de texto do JSON, com o caminho até ele. */
function textos(no: unknown, caminho = ""): { caminho: string; valor: string }[] {
  if (typeof no === "string") return [{ caminho, valor: no }];
  if (!no || typeof no !== "object") return [];
  return Object.entries(no as Record<string, unknown>).flatMap(([k, v]) =>
    textos(v, caminho ? `${caminho}.${k}` : k),
  );
}

function idioma(arquivo: string) {
  return JSON.parse(readFileSync(path.join(PASTA, arquivo), "utf8")) as unknown;
}

describe("o texto de tela não pode dizer que a comissão sai do lucro", () => {
  it("são dez idiomas, e todos têm a cláusula do comissionamento", () => {
    expect(IDIOMAS).toHaveLength(10);
    for (const arquivo of IDIOMAS) {
      const chaves = textos(idioma(arquivo)).map(t => t.caminho);
      expect(chaves.some(c => c.endsWith("clause2_item2")), `${arquivo} perdeu a cláusula`).toBe(true);
    }
  });

  it("nenhum idioma promete comissão sobre o lucro", () => {
    // A palavra existe em cada língua; procuramos dentro da cláusula, não no
    // arquivo inteiro, para não reprovar um texto legítimo sobre lucro.
    const proibido = /lucro|profit|ganancia|bénéfice|benefice|gewinn|利益|прибыл|利润|लाभ|ربح/i;
    for (const arquivo of IDIOMAS) {
      const clausulas = textos(idioma(arquivo)).filter(t => /clause2_item[12]/.test(t.caminho));
      for (const c of clausulas) {
        expect(
          proibido.test(c.valor),
          `${arquivo} → ${c.caminho} ainda fala em lucro: "${c.valor}"`,
        ).toBe(false);
      }
    }
  });

  it("o português diz honorários da intermediação e Diretoria Comercial", () => {
    const pt = textos(idioma("pt-BR.json"));
    const item1 = pt.find(t => t.caminho.endsWith("clause2_item1"))?.valor ?? "";
    const item2 = pt.find(t => t.caminho.endsWith("clause2_item2"))?.valor ?? "";
    expect(item2).toMatch(/honorários da intermediação/i);
    expect(item2).toMatch(/50%/);
    expect(item1).toMatch(/Diretoria Comercial/i);
    // O critério que a cláusula antiga inventava e que a cliente não deu.
    expect(item1).not.toMatch(/tipo e o tamanho/i);
  });

  it("o contrato de comissão em docs/ diz a mesma coisa que a tela", () => {
    const contrato = readFileSync(
      path.resolve(AQUI, "..", "docs", "termos", "contrato-comissao-provisorio.md"),
      "utf8",
    );
    expect(contrato).toMatch(/honorários da intermediação/i);
    expect(contrato).toMatch(/Diretoria Comercial/i);
    // Duas fontes dizendo coisas diferentes sobre dinheiro é como a divergência
    // nasce: o texto da tela e o documento precisam envelhecer juntos.
    expect(contrato).not.toMatch(/limite é de 50% do lucro/i);
  });
});
