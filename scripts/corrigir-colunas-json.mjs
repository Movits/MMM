// Converte para `json` as colunas que o dump do Manus trouxe como `longtext`.
//
// Por que isto existe: o drizzle/schema.ts declara essas colunas como json, e o
// driver só devolve objeto quando a coluna É json. Num banco restaurado do dump
// elas vieram longtext, então o mesmo campo chega como texto — e qualquer tela
// que faça `.map()` nele quebra. Não aparece em banco vazio: só quando existe
// dado. Foi assim que apareceu, ao popular uma rede de teste e abrir a página
// de Matches Inteligentes.
//
// Bancos criados por scripts/criar-banco.mjs já nascem certos. Este script é
// para os que vieram do dump.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/corrigir-colunas-json.mjs           (só relata)
//   DATABASE_URL='mysql://...' node scripts/corrigir-colunas-json.mjs --aplicar

import mysql from "mysql2/promise";

const aplicar = process.argv.includes("--aplicar");

// Espelha as colunas declaradas com json() em drizzle/schema.ts.
const COLUNAS = [
  ["ai_match_suggestions", "matched_assets", "NOT NULL"],
  ["ai_match_suggestions", "matched_needs", "NOT NULL"],
  ["audit_logs", "details", "NULL"],
  ["enrichment_messages", "metadata", "NULL"],
  ["meeting_contact_suggestions", "source_entity_ids", "NULL"],
  ["meeting_transcripts", "segments", "NULL"],
  ["memory_documents", "metadata", "NULL"],
  ["memory_documents", "embedding", "NOT NULL"],
  ["opportunities", "tags", "NULL"],
  ["security_events", "details", "NULL"],
  ["user_profiles", "languages", "NULL"],
  ["user_profiles", "values", "NULL"],
  ["user_profiles", "sectors", "NULL"],
];

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

const conexao = await mysql.createConnection(process.env.DATABASE_URL);
const banco = new URL(process.env.DATABASE_URL).pathname.slice(1);

let pendentes = 0, convertidas = 0, comProblema = 0;

try {
  for (const [tabela, coluna, nulidade] of COLUNAS) {
    const [[info]] = await conexao.query(
      "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
      [banco, tabela, coluna],
    );
    if (!info) continue;
    if (info.DATA_TYPE === "json") continue;

    pendentes++;

    // Converter só é seguro se todo valor presente for JSON válido. Uma linha
    // com texto solto faria o ALTER falhar no meio.
    const [[invalidos]] = await conexao.query(
      `SELECT COUNT(*) AS total FROM \`${tabela}\` WHERE \`${coluna}\` IS NOT NULL AND JSON_VALID(\`${coluna}\`) = 0`,
    );
    if (Number(invalidos.total) > 0) {
      console.log(`  ${tabela}.${coluna}: ${invalidos.total} linha(s) com conteúdo que não é JSON — precisa de olhar humano, pulando`);
      comProblema++;
      continue;
    }

    if (!aplicar) {
      console.log(`  ${tabela}.${coluna}: ${info.DATA_TYPE} -> json (pronta para converter)`);
      continue;
    }

    await conexao.query(`ALTER TABLE \`${tabela}\` MODIFY COLUMN \`${coluna}\` json ${nulidade}`);
    console.log(`  ${tabela}.${coluna}: convertida`);
    convertidas++;
  }

  console.log();
  if (!pendentes) {
    console.log("Nenhuma coluna pendente: o banco já está de acordo com o schema.");
  } else if (aplicar) {
    console.log(`${convertidas} coluna(s) convertida(s).${comProblema ? ` ${comProblema} exigem revisão manual.` : ""}`);
  } else {
    console.log(`${pendentes} coluna(s) para converter. Rode de novo com --aplicar.`);
  }
} catch (erro) {
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
