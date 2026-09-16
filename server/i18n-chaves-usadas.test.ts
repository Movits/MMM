import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * O `conferir-locales.mjs` garante PARIDADE: os 10 idiomas têm o mesmo conjunto
 * de chaves. Ele não garante que as chaves que as TELAS pedem existam — e a
 * diferença já custou caro: a seção de Termos da PR #90 pedia
 * `onboarding.terms.clause1_title` e mais oito chaves que não existiam em
 * NENHUM idioma. A paridade estava perfeita (faltavam nos dez) e a tela
 * mostrava o nome da chave para a usuária.
 *
 * Este teste fecha esse buraco: varre os `t("...")` do client e exige que cada
 * chave literal exista no pt-BR. Como a paridade já é checada em separado,
 * existir no pt-BR basta.
 */

const RAIZ_CLIENT = join(process.cwd(), "client", "src");
const PT_BR = JSON.parse(readFileSync(join(RAIZ_CLIENT, "i18n", "locales", "pt-BR.json"), "utf8"));

function arquivosDeTela(dir: string, encontrados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === "node_modules" || nome === "locales") continue;
      arquivosDeTela(caminho, encontrados);
      continue;
    }
    if (!/\.tsx?$/.test(nome)) continue;
    if (/\.test\.tsx?$/.test(nome)) continue;
    encontrados.push(caminho);
  }
  return encontrados;
}

/**
 * Onde termina o código da linha: a posição do `//` que abre comentário, ou o
 * fim da linha. Um `//` só conta FORA de string — `"https://…"` não abre
 * comentário, e cortar ali apagaria o resto da linha (a ressalva do Nicolas ao
 * achado do Gabriel: com o corte cego, um `t("chave")` depois de uma URL saía
 * da varredura e a guarda afrouxava).
 *
 * O varredor é deliberadamente simples — aspas simples, duplas e crase, com
 * escape — porque a entrada é código TS/TSX já formatado pelo prettier. Aspas
 * desemparelhadas (o apóstrofo de um texto JSX) só fazem a linha ficar inteira,
 * que é o comportamento de antes desta correção: conservador do lado certo.
 */
function fimDoCodigo(linha: string): number {
  let aspas: string | null = null;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { aspas = c; continue; }
    if (c === "/" && linha[i + 1] === "/") return i;
  }
  return linha.length;
}

/**
 * Comentário não é código: `// t("x.y")` não desenha nada. Vale para a linha
 * inteira de comentário E para o comentário no fim da linha — este último
 * escapava e virava falso positivo (achado do Gabriel na validação da PR #92).
 */
function semComentarios(conteudo: string): string {
  return conteudo
    .split(/\r?\n/)
    .map(linha => (/^\s*(\/\/|\*|\/\*)/.test(linha) ? "" : linha.slice(0, fimDoCodigo(linha))))
    .join("\n");
}

/**
 * Só chaves LITERAIS e SEM texto padrão: `t("a.b")`.
 *
 * `t("a.b", "Salvando…")` fica de fora de propósito — o segundo argumento é o
 * texto que aparece quando a chave falta, então o pior caso ali é a tela sair
 * em português, não o nome da chave vazando. Chaves montadas em runtime
 * (`t(\`x.${y}\`)`) também ficam de fora: não dá para conferir estaticamente.
 */
function chavesLiterais(conteudo: string): string[] {
  const achadas: string[] = [];
  const re = /\bt\(\s*"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"\s*([),])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(conteudo)) !== null) {
    // `t("chave", ...)` com segundo argumento string é fallback; com objeto é
    // interpolação e continua valendo a checagem.
    if (m[2] === ",") {
      const depois = conteudo.slice(re.lastIndex, re.lastIndex + 40).trimStart();
      if (depois.startsWith('"') || depois.startsWith("'") || depois.startsWith("`")) continue;
    }
    achadas.push(m[1]);
  }
  return achadas;
}

// i18next resolve plural por sufixo CLDR: `years` vira `years_one`,
// `years_other` e companhia. A chave "crua" não existe no JSON e não deveria.
const SUFIXOS_DE_PLURAL = ["_zero", "_one", "_two", "_few", "_many", "_other"];

function valorEm(chave: string): unknown {
  let alvo: unknown = PT_BR;
  for (const parte of chave.split(".")) {
    if (typeof alvo !== "object" || alvo === null || !(parte in (alvo as Record<string, unknown>))) return undefined;
    alvo = (alvo as Record<string, unknown>)[parte];
  }
  return alvo;
}

function existe(chave: string): boolean {
  const direto = valorEm(chave);
  if (typeof direto === "string" || (typeof direto === "object" && direto !== null)) return true;
  return SUFIXOS_DE_PLURAL.some(sufixo => typeof valorEm(chave + sufixo) === "string");
}

describe("i18n — toda chave que a tela pede existe no pt-BR", () => {
  const arquivos = arquivosDeTela(RAIZ_CLIENT);

  it("varre um número plausível de arquivos de tela", () => {
    expect(arquivos.length).toBeGreaterThan(30);
  });

  it("não existe t(\"chave\") sem tradução correspondente", () => {
    const faltando: string[] = [];
    for (const arquivo of arquivos) {
      const conteudo = semComentarios(readFileSync(arquivo, "utf8"));
      for (const chave of chavesLiterais(conteudo)) {
        if (!existe(chave)) faltando.push(`${arquivo.replace(process.cwd(), "").replace(/\\/g, "/")}: ${chave}`);
      }
    }
    // Mensagem útil no lugar de um "false !== true": quem quebrar isso precisa
    // saber QUAL chave falta e em qual arquivo.
    expect(faltando, `chaves usadas na tela e ausentes no pt-BR:\n${faltando.join("\n")}`).toEqual([]);
  });
});

/**
 * Achado do Gabriel na validação da PR #92 (13/09/2026): `semComentarios` só
 * derrubava a linha INTEIRA de comentário, então `algo(); // t("x.y")` seguia
 * contando como chave usada na tela — falso positivo, e quem quebrasse o teste
 * iria caçar uma chave que ninguém pede.
 *
 * A correção vem com a ressalva do Nicolas: cortar do primeiro "//" em diante
 * apaga `https://` e tudo que venha depois na mesma linha, e aí a guarda
 * AFROUXA — um `t("chave.inexistente")` depois de uma URL deixaria de ser visto.
 * Por isso os dois lados estão nos testes abaixo.
 */
describe("semComentarios — tira o comentário inline sem cortar string", () => {
  it("apaga o comentário depois do código (o falso positivo do achado)", () => {
    const linha = 'algo(); // t("naoExiste.chave")';
    expect(semComentarios(linha)).not.toContain("naoExiste.chave");
    expect(semComentarios(linha)).toContain("algo();");
  });

  it("segue apagando a linha que é só comentário", () => {
    expect(semComentarios('  // t("naoExiste.chave")')).not.toContain("naoExiste.chave");
    expect(semComentarios('   * t("naoExiste.chave")')).not.toContain("naoExiste.chave");
  });

  it("não corta no // de dentro de uma string: a chave depois da URL continua visível", () => {
    const aspasDuplas = 'const u = "https://exemplo.com/x"; t("dashboard.title")';
    const aspasSimples = "const u = 'https://exemplo.com/x'; t('dashboard.title')";
    const crase = "const u = `https://${host}/x`; t(\"dashboard.title\")";
    expect(semComentarios(aspasDuplas)).toContain("dashboard.title");
    expect(semComentarios(aspasSimples)).toContain("dashboard.title");
    expect(semComentarios(crase)).toContain("dashboard.title");
  });

  it("corta o comentário que vem DEPOIS da string com //", () => {
    const linha = 'const u = "https://exemplo.com"; // t("naoExiste.chave")';
    expect(semComentarios(linha)).toContain("https://exemplo.com");
    expect(semComentarios(linha)).not.toContain("naoExiste.chave");
  });

  it("aspas escapadas dentro da string não abrem nem fecham nada", () => {
    const linha = 'const s = "diz \\"oi\\" // aqui"; t("dashboard.title")';
    expect(semComentarios(linha)).toContain("dashboard.title");
  });

  it("preserva a contagem de linhas (o corte é por linha, não junta código)", () => {
    const fonte = 'a(); // um\nb(); // dois';
    expect(semComentarios(fonte).split("\n")).toHaveLength(2);
  });
});
