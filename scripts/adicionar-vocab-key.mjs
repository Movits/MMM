// Acrescenta a coluna `vocab_key` e o índice (owner_id, vocab_key) em
// contact_assets e contact_needs.
//
// Por que este script existe: bancos criados por scripts/criar-banco.mjs já
// nascem com a coluna, porque ela está em scripts/schema-completo.sql. Este
// script é para os bancos que já existem — o de produção e os restaurados do
// dump do Manus —, onde só falta a coluna.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/adicionar-vocab-key.mjs
//
// É seguro rodar de novo: o que já existe é reportado como "já havia" e o
// script segue adiante, sem apagar nada.

import mysql from "mysql2/promise";

const ALVOS = [
  { tabela: "contact_assets", indice: "contact_assets_owner_vocab_idx" },
  { tabela: "contact_needs", indice: "contact_needs_owner_vocab_idx" },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL não definida.\n\n" +
      "Exemplo:\n" +
      `  DATABASE_URL='mysql://usuario:senha@host:3306/defaultdb?ssl={"rejectUnauthorized":false}' \\\n` +
      "    node scripts/adicionar-vocab-key.mjs\n"
  );
  process.exit(1);
}

// O Aiven entrega a URI terminando em ?ssl-mode=REQUIRED, que é sintaxe do
// cliente de linha de comando do MySQL. O mysql2 não entende esse parâmetro e
// abre a conexão sem TLS, que o Aiven recusa.
let urlFinal = url;
if (url.includes("ssl-mode=")) {
  urlFinal = url.replace(/[?&]ssl-mode=[^&]*/i, "");
  urlFinal += (urlFinal.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}';
  console.log("Aviso: troquei ssl-mode=REQUIRED por ssl={...}, que é o formato que o mysql2 entende.\n");
}

let conn;
try {
  conn = await mysql.createConnection(urlFinal);
} catch (erro) {
  console.error(`\nNão consegui conectar no banco: ${erro.message}\n`);
  if (erro.code === "ENOTFOUND" || erro.code === "ETIMEDOUT") {
    console.error("O endereço não respondeu. Confira o host e a porta da URL.");
  } else if (erro.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("Usuário ou senha recusados. Copie a URI de novo do painel do Aiven.");
  } else if (/SSL|certificate|secure/i.test(erro.message)) {
    console.error(
      'O banco exige TLS. Acrescente ?ssl={"rejectUnauthorized":false} ao final da DATABASE_URL.'
    );
  }
  process.exit(1);
}

async function existe(consulta, parametros) {
  const [linhas] = await conn.query(consulta, parametros);
  return linhas.length > 0;
}

let criados = 0;
let existentes = 0;
const falhas = [];

try {
  for (const { tabela, indice } of ALVOS) {
    const temTabela = await existe(
      "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [tabela]
    );
    if (!temTabela) {
      falhas.push(`tabela ${tabela} não existe — rode scripts/criar-banco.mjs primeiro`);
      console.error(`  FALHOU   ${tabela}: tabela não existe`);
      continue;
    }

    const temColuna = await existe(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'vocab_key'",
      [tabela]
    );
    if (temColuna) {
      existentes++;
      console.log(`  já havia ${tabela}.vocab_key`);
    } else {
      try {
        // O MySQL 8 não aceita IF NOT EXISTS em ADD COLUMN; a checagem acima
        // resolve o caso normal, e o catch cobre duas execuções simultâneas.
        await conn.query(
          `ALTER TABLE \`${tabela}\` ADD COLUMN \`vocab_key\` varchar(80) NULL AFTER \`category\``
        );
        criados++;
        console.log(`  ok       ${tabela}.vocab_key`);
      } catch (erro) {
        if (erro.code === "ER_DUP_FIELDNAME") {
          existentes++;
          console.log(`  já havia ${tabela}.vocab_key`);
        } else {
          falhas.push(`${tabela}.vocab_key: ${erro.message}`);
          console.error(`  FALHOU   ${tabela}.vocab_key: ${erro.message}`);
          continue;
        }
      }
    }

    try {
      await conn.query(`CREATE INDEX \`${indice}\` ON \`${tabela}\` (\`owner_id\`,\`vocab_key\`)`);
      criados++;
      console.log(`  ok       ${indice}`);
    } catch (erro) {
      if (erro.code === "ER_DUP_KEYNAME") {
        existentes++;
        console.log(`  já havia ${indice}`);
      } else {
        falhas.push(`${indice}: ${erro.message}`);
        console.error(`  FALHOU   ${indice}: ${erro.message}`);
      }
    }
  }
} finally {
  await conn.end();
}

console.log(`\n${criados} criados, ${existentes} já existiam, ${falhas.length} falharam.`);

if (falhas.length > 0) {
  console.error("\nO banco não está completo. Corrija as falhas acima antes de subir o servidor.");
  process.exit(1);
}

console.log("Coluna vocab_key pronta nas duas tabelas.");
