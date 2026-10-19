import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O CABEÇALHO DA ÁREA LOGADA FICA GRUDADO NO TOPO.
 *
 * O `AppHeader` (client/src/components/AppHeader.tsx) é `sticky top-0 z-40`, e
 * as barras próprias das páginas (Perfil, Oportunidades...) grudam logo abaixo
 * dele, em `sticky top-16`. Ele é montado em App.tsx (TelaAutenticada) como
 * filho DIRETO da `div.abstract-bg`, e o index.css tinha, fora de qualquer
 * camada, a regra `.abstract-bg > * { position: relative; z-index: 1 }`.
 *
 * Regra fora de camada vence toda regra dentro de `@layer`, com qualquer
 * especificidade, e as classes do Tailwind moram em `@layer utilities`. O
 * cabeçalho saía `position: relative; z-index: 1`. Medido em 16/09/2026 no
 * Perfil, a 1920 × 884: com a página rolada 600 px, o cabeçalho estava em
 * top = −600 e a barra do Perfil continuava em top = 64. A faixa de cima ficava
 * vazia, com o conteúdo passando por trás. O Nicolas relatou "a barra meio que
 * desgruda conforme eu rolo". Além disso, o menu de idioma, que abre de dentro
 * do cabeçalho, ficava debaixo da página: só a primeira linha dele recebia o
 * clique.
 *
 * O teste lê o CSS e confere que a regra do fundo está dentro de uma camada.
 * Assim as classes de posição e de z-index de quem é filho direto do fundo
 * voltam a mandar.
 */

const css = readFileSync("client/src/index.css", "utf8");
const cabecalho = readFileSync("client/src/components/AppHeader.tsx", "utf8");

type Regra = { seletor: string; corpo: string; blocos: string[] };

/**
 * As regras do arquivo, cada uma com as at-rules que a envolvem (`@layer base`,
 * `@media ...`), inclusive quando aninhada em outra regra. O corpo é só o que
 * vem antes do primeiro bloco aninhado. Tira os comentários antes, porque eles
 * têm chaves.
 */
function regrasDoCss(fonte: string): Regra[] {
  const texto = fonte.replace(/\/\*[\s\S]*?\*\//g, "");
  const regras: Regra[] = [];
  const pilha: string[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === ";") {
      inicio = i + 1;
    } else if (c === "{") {
      const cabeca = texto.slice(inicio, i).trim();
      if (!cabeca.startsWith("@")) {
        const proximos = [texto.indexOf("{", i + 1), texto.indexOf("}", i + 1)].filter(p => p >= 0);
        regras.push({
          seletor: cabeca,
          corpo: texto.slice(i + 1, Math.min(...proximos)),
          blocos: pilha.filter(b => b.startsWith("@")),
        });
      }
      pilha.push(cabeca);
      inicio = i + 1;
    } else if (c === "}") {
      pilha.pop();
      inicio = i + 1;
    }
  }
  return regras;
}

const regras = regrasDoCss(css);
const dosFilhosDoFundo = regras.filter(r => /\.abstract-bg\s*>\s*\*/.test(r.seletor));

describe("cabeçalho da área logada grudado no topo", () => {
  it("o leitor de CSS acha a regra dos filhos do fundo (senão o teste abaixo não prova nada)", () => {
    expect(dosFilhosDoFundo.length).toBeGreaterThan(0);
    // Controle: uma regra que sabidamente está fora de camada é lida como tal.
    const fundo = regras.find(r => r.seletor === ".abstract-bg");
    expect(fundo?.blocos).toEqual([]);
    const dentroDaBase = regras.find(r => r.blocos.some(b => b.startsWith("@layer base")));
    expect(dentroDaBase).toBeDefined();
  });

  it("a regra que dá posição e z-index aos filhos do fundo está dentro de @layer, abaixo das classes do Tailwind", () => {
    for (const regra of dosFilhosDoFundo) {
      if (!/position|z-index/.test(regra.corpo)) continue;
      expect(regra.blocos.some(b => b.startsWith("@layer")), regra.seletor).toBe(true);
    }
  });

  it("o cabeçalho continua pedindo sticky no topo, acima das barras das páginas", () => {
    expect(cabecalho).toMatch(/<nav className="[^"]*\bsticky top-0\b[^"]*"/);
    expect(cabecalho).toMatch(/<nav className="[^"]*\bz-40\b[^"]*"/);
    expect(cabecalho).toMatch(/<nav className="[^"]*\bh-16\b[^"]*"/);
  });
});
