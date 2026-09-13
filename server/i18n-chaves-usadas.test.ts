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

/** Linhas de comentário não são código: `// t("x.y")` não desenha nada. Remove comentários inline também. */
function semComentarios(conteudo: string): string {
  return conteudo
    .split(/\r?\n/)
    .filter(linha => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .map(linha => linha.replace(/\/\/.*$/, "")) // Remove comentários inline
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
