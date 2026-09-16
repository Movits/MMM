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
 *
 * Em 14/09/2026 (Rosber, 21:34) a etapa "Termos e Condições — Termos de Uso e
 * Acordo de Comissionamento" saiu do cadastro, substituída pelo Termo Geral de
 * Uso do Dr. Ronei, que trata de intermediação e remuneração nas cláusulas 12 a
 * 15 e vem do documento publicado, não do JSON de idiomas. As chaves
 * `onboarding.terms.*` foram apagadas; a guarda agora cobre os textos de tela
 * que ainda falam de comissão e o contrato provisório em docs/, que continua
 * publicável como `contrato_comissao`.
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
  it("são dez idiomas, e nenhum guarda mais a cláusula provisória do cadastro", () => {
    expect(IDIOMAS).toHaveLength(10);
    for (const arquivo of IDIOMAS) {
      const conteudo = idioma(arquivo) as { onboarding?: Record<string, unknown>; termoGeral?: Record<string, unknown> };
      const chaves = textos(conteudo).map(t => t.caminho);
      expect(conteudo.onboarding?.terms, `${arquivo} ainda tem onboarding.terms`).toBeUndefined();
      expect(chaves.some(c => /clause2_item/.test(c)), `${arquivo} ainda tem a cláusula de comissão da etapa removida`).toBe(false);
      // O que ficou no lugar: a etapa do Termo Geral de Uso.
      expect(conteudo.termoGeral?.etapaTitulo, `${arquivo} sem a etapa do Termo Geral`).toBeTypeOf("string");
    }
  });

  it("nenhum texto de tela sobre comissão promete comissão sobre o lucro", () => {
    // A palavra existe em cada língua; procuramos só nos textos de comissão, não
    // no arquivo inteiro, para não reprovar um texto legítimo sobre lucro.
    const proibido = /lucro|profit|ganancia|bénéfice|benefice|gewinn|利益|прибыл|利润|लाभ|ربح/i;
    for (const arquivo of IDIOMAS) {
      const deComissao = textos(idioma(arquivo)).filter(t => /commission|comiss|noFee/i.test(t.caminho));
      expect(deComissao.length, `${arquivo} sem nenhum texto de comissão para conferir`).toBeGreaterThan(0);
      for (const c of deComissao) {
        expect(
          proibido.test(c.valor),
          `${arquivo} → ${c.caminho} fala em lucro: "${c.valor}"`,
        ).toBe(false);
      }
    }
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
