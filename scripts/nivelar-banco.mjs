// Põe um banco da era anterior ao sistema de migração em dia com o baseline.
//
// Um banco antigo pode ter todas as tabelas e ainda assim estar colunas atrás:
// o de desenvolvimento estava 10 colunas e 3 enums atrás do schema, com as 50
// tabelas no lugar. `migrar.mjs` se recusa a adotar um banco assim — este
// script é o caminho que ele indica.
//
// O que ele faz, tudo derivado do baseline (nada escrito à mão):
//
//   - cria tabela que falta, com a definição inteira do baseline
//   - acrescenta coluna que falta, com a definição do baseline
//   - alarga enum cujo conjunto de valores ficou para trás
//   - cria índice e restrição única que faltam
//
// O que ele NUNCA faz: apagar. Tabela que só existe no banco, coluna que só
// existe no banco, valor de enum que o banco tem e o baseline não — tudo isso é
// RELATADO e deixado onde está, porque pode haver dado dentro, e apagar dado é
// decisão de gente. Enum com valor sobrando nem é alterado: estreitar um enum
// com linhas gravadas naquele valor quebra a tabela.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/nivelar-banco.mjs             (só relata)
//   DATABASE_URL='mysql://...' node scripts/nivelar-banco.mjs --aplicar

import mysql from "mysql2/promise";
import { lerBaseline, compararComBanco, valoresDeEnum } from "./baseline.mjs";

const aplicar = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

const conexao = await mysql.createConnection(process.env.DATABASE_URL);
const banco = new URL(process.env.DATABASE_URL).pathname.slice(1);
const consultar = async (sql, params) => (await conexao.query(sql, params))[0];

try {
  const baseline = await lerBaseline();
  const desvios = await compararComBanco(baseline, consultar, banco);

  // ── o que só existe no banco: relatar, nunca tocar ─────────────────────────
  const tabelasNoBanco = (await consultar(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME NOT IN ('_migracoes')",
    [banco],
  )).map(l => l.TABLE_NAME);
  const sobrando = tabelasNoBanco.filter(t => !baseline.tabelas.has(t));
  if (sobrando.length) {
    console.log(`Tabelas que existem no banco e não no baseline (ficam como estão): ${sobrando.join(", ")}`);
  }

  if (desvios.total === 0) {
    console.log("Nada a nivelar: o banco já bate com o baseline.");
    process.exit(0);
  }

  // ── montar os passos, na ordem que funciona: tabela -> coluna -> índice ────
  const passos = [];

  for (const tabela of desvios.tabelasFaltando) {
    const def = baseline.tabelas.get(tabela);
    const linhas = [...def.colunas].map(([nome, definicao]) => `\`${nome}\` ${definicao}`);
    for (const [nome, colunas] of def.unicos) linhas.push(`CONSTRAINT \`${nome}\` UNIQUE(${colunas})`);
    // A chave primária mora na definição da coluna no formato do drizzle
    // (AUTO_INCREMENT ... PRIMARY KEY ou "NOT NULL" + CONSTRAINT); o formato
    // gerado já traz tudo na linha da coluna, então basta juntá-las.
    passos.push({
      nome: `criar a tabela ${tabela}`,
      sql: `CREATE TABLE \`${tabela}\` (\n  ${linhas.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    });
  }

  for (const { tabela, coluna, definicao } of desvios.colunasFaltando) {
    const [{ n }] = await consultar(
      `SELECT COUNT(*) AS n FROM \`${tabela}\``, [],
    );
    // Coluna NOT NULL sem default numa tabela com linhas: o MySQL preenche com
    // o valor implícito do tipo ('' ou 0). Não é erro, mas é bom saber que as
    // linhas antigas nascem com esse valor, então o aviso sai no relatório.
    if (Number(n) > 0 && /NOT NULL/i.test(definicao) && !/DEFAULT|AUTO_INCREMENT|GENERATED/i.test(definicao)) {
      console.log(`aviso: ${tabela}.${coluna} é NOT NULL sem default e a tabela tem ${n} linha(s) — elas ficarão com o valor vazio do tipo.`);
    }
    passos.push({ nome: `acrescentar ${tabela}.${coluna}`, sql: `ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${definicao}` });
  }

  for (const { tabela, coluna, definicao, faltam, sobram } of desvios.enumsDiferentes) {
    if (sobram.length) {
      // Estreitar enum com valor gravado quebra a tabela; alargar é seguro.
      // Com valores dos dois lados, o certo é a UNIÃO — mantém o dado antigo
      // legível e aceita o que o código novo grava. A decisão de aposentar os
      // valores antigos fica para uma migração de dados feita de propósito.
      const esperado = valoresDeEnum(definicao);
      const uniao = [...new Set([...esperado, ...sobram])];
      const definicaoUniao = definicao.replace(/^enum\(.+?\)/i, `enum(${uniao.map(v => `'${v}'`).join(",")})`);
      console.log(`aviso: ${tabela}.${coluna} tem valores fora do baseline (${sobram.join(", ")}) — o enum vira a UNIÃO dos dois; aposentar valores é migração de dados, não deste script.`);
      passos.push({ nome: `alargar o enum de ${tabela}.${coluna} (união)`, sql: `ALTER TABLE \`${tabela}\` MODIFY COLUMN \`${coluna}\` ${definicaoUniao}` });
    } else {
      passos.push({ nome: `alargar o enum de ${tabela}.${coluna} (faltavam: ${faltam.join(", ")})`, sql: `ALTER TABLE \`${tabela}\` MODIFY COLUMN \`${coluna}\` ${definicao}` });
    }
  }

  for (const { tabela, nome, colunas } of desvios.unicosFaltando) {
    passos.push({ nome: `criar a restrição única ${nome} em ${tabela}`, sql: `ALTER TABLE \`${tabela}\` ADD CONSTRAINT \`${nome}\` UNIQUE(${colunas})` });
  }

  for (const { nome, tabela, colunas } of desvios.indicesFaltando) {
    passos.push({ nome: `criar o índice ${nome} em ${tabela}`, sql: `CREATE INDEX \`${nome}\` ON \`${tabela}\` (${colunas})` });
  }

  console.log(`\n${passos.length} passo(s) para nivelar:`);
  for (const p of passos) console.log(`  - ${p.nome}`);

  if (!aplicar) {
    console.log("\nRode de novo com --aplicar.");
    process.exit(0);
  }

  console.log();
  for (const passo of passos) {
    try {
      await conexao.query(passo.sql);
      console.log(`ok  ${passo.nome}`);
    } catch (erro) {
      console.error(`FALHOU  ${passo.nome}: ${erro.message}`);
      console.error("Nada depois deste passo foi executado. Corrija e rode de novo — o que já foi feito não repete.");
      process.exit(1);
    }
  }

  console.log("\nBanco nivelado. Agora `node scripts/migrar.mjs` adota o baseline.");
} finally {
  await conexao.end();
}
