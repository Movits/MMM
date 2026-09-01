// Lê o baseline de drizzle/ e devolve o schema como dados: tabelas, colunas
// com a definição completa, e índices.
//
// É a fonte usada pelo migrar.mjs (para conferir se um banco antigo pode ser
// adotado) e pelo nivelar-banco.mjs (para gerar os ALTERs que põem um banco
// desviado em dia). Ler do SQL gerado, e não do schema.ts, é deliberado: o SQL
// é o que de fato roda num banco novo, então conferir contra ele é conferir
// contra a verdade — sem depender de importar TypeScript num script .mjs.
//
// O formato é o que o drizzle-kit emite, e é regular:
//
//   CREATE TABLE `nome` (
//   	`coluna` tipo e modificadores,
//   	CONSTRAINT `x` UNIQUE(`coluna`)
//   );
//   CREATE INDEX `idx` ON `tabela` (`coluna`);

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = join(AQUI, "..", "drizzle");

export async function lerBaseline() {
  const journal = JSON.parse(await readFile(join(PASTA, "meta", "_journal.json"), "utf8"));
  const primeiraTag = journal.entries[0]?.tag;
  if (!primeiraTag) throw new Error("drizzle/meta/_journal.json está vazio.");
  const sql = await readFile(join(PASTA, `${primeiraTag}.sql`), "utf8");

  const tabelas = new Map();

  for (const bloco of sql.matchAll(/CREATE TABLE `([a-z0-9_]+)` \(([\s\S]*?)\n\);/gi)) {
    const [, nome, corpo] = bloco;
    const colunas = new Map();
    const unicos = new Map();
    let pk = null;

    for (const linhaCrua of corpo.split("\n")) {
      const linha = linhaCrua.trim().replace(/,$/, "");
      if (!linha) continue;

      const constraint = linha.match(/^CONSTRAINT `([a-z0-9_]+)` UNIQUE\((.+)\)$/i);
      if (constraint) {
        unicos.set(constraint[1], constraint[2]);
        continue;
      }
      // O drizzle-kit emite a chave primária como linha própria (CONSTRAINT
      // `x` PRIMARY KEY(`id`)). Descartá-la fazia o nivelar-banco montar
      // CREATE sem primary key — e o Aiven, com sql_require_primary_key
      // ligado, recusa a tabela.
      const chavePrimaria = linha.match(/^(?:CONSTRAINT `[a-z0-9_]+` )?PRIMARY KEY\s*\((.+)\)$/i);
      if (chavePrimaria) {
        pk = chavePrimaria[1];
        continue;
      }
      if (/^(PRIMARY KEY|KEY|FOREIGN KEY|CONSTRAINT)/i.test(linha)) continue;

      const coluna = linha.match(/^`([a-z0-9_]+)` (.+)$/i);
      if (coluna) colunas.set(coluna[1], coluna[2]);
    }

    tabelas.set(nome, { colunas, unicos, pk });
  }

  const indices = new Map();
  for (const idx of sql.matchAll(/CREATE INDEX `([a-z0-9_]+)` ON `([a-z0-9_]+)` \((.+?)\);/gi)) {
    indices.set(idx[1], { tabela: idx[2], colunas: idx[3] });
  }

  return { tag: primeiraTag, tabelas, indices };
}

/** Os valores de um enum('a','b') como conjunto, ou null se não for enum. */
export function valoresDeEnum(tipo) {
  const m = String(tipo).match(/^enum\((.+?)\)/i);
  if (!m) return null;
  return new Set([...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x => x[1]));
}

/**
 * Compara o baseline com o que existe num banco, coluna a coluna.
 * `consultar` é uma função async (sql, params) => linhas.
 */
export async function compararComBanco(baseline, consultar, nomeDoBanco) {
  const desvios = { tabelasFaltando: [], colunasFaltando: [], enumsDiferentes: [], enumsComSobras: [], indicesFaltando: [], unicosFaltando: [] };

  const existentes = await consultar(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?",
    [nomeDoBanco],
  );
  const porTabela = new Map();
  for (const linha of existentes) {
    if (!porTabela.has(linha.TABLE_NAME)) porTabela.set(linha.TABLE_NAME, new Map());
    porTabela.get(linha.TABLE_NAME).set(linha.COLUMN_NAME, linha.COLUMN_TYPE);
  }

  const indicesExistentes = new Set(
    (await consultar(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?",
      [nomeDoBanco],
    )).map(l => l.INDEX_NAME),
  );

  for (const [tabela, def] of baseline.tabelas) {
    const noBanco = porTabela.get(tabela);
    if (!noBanco) {
      desvios.tabelasFaltando.push(tabela);
      continue;
    }
    for (const [coluna, definicao] of def.colunas) {
      if (!noBanco.has(coluna)) {
        desvios.colunasFaltando.push({ tabela, coluna, definicao });
        continue;
      }
      const esperado = valoresDeEnum(definicao);
      if (esperado) {
        const atual = valoresDeEnum(noBanco.get(coluna));
        const faltam = [...esperado].filter(v => !atual?.has(v));
        const sobram = [...(atual ?? [])].filter(v => !esperado.has(v));
        // Só FALTAR valor é desvio: o código grava os valores do baseline, e um
        // enum sem eles recusa a escrita. Valor A MAIS é superconjunto
        // compatível — é inclusive o que o nivelamento por união produz de
        // propósito quando o banco tem dado gravado em valor antigo. Tratar
        // sobra como desvio deixava a adoção recusando para sempre um banco
        // já nivelado.
        if (faltam.length) {
          desvios.enumsDiferentes.push({ tabela, coluna, definicao, faltam, sobram });
        } else if (sobram.length) {
          desvios.enumsComSobras.push({ tabela, coluna, sobram });
        }
      }
    }
    for (const [nomeUnico, colunasUnico] of def.unicos) {
      if (!indicesExistentes.has(nomeUnico)) {
        desvios.unicosFaltando.push({ tabela, nome: nomeUnico, colunas: colunasUnico });
      }
    }
  }

  for (const [nome, idx] of baseline.indices) {
    if (porTabela.has(idx.tabela) && !indicesExistentes.has(nome)) {
      // Índice sobre coluna que também falta só pode nascer depois da coluna;
      // o nivelador ordena isso. Aqui apenas se relata.
      desvios.indicesFaltando.push({ nome, ...idx });
    }
  }

  desvios.total =
    desvios.tabelasFaltando.length + desvios.colunasFaltando.length +
    desvios.enumsDiferentes.length + desvios.indicesFaltando.length +
    desvios.unicosFaltando.length;
  return desvios;
}
