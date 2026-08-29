// Cria todas as tabelas do MMM num banco MySQL vazio.
//
// Por que este script existe: `pnpm db:push` não funciona hoje. O histórico
// em drizzle/meta parou na migração 0002, com 15 tabelas, enquanto o
// drizzle/schema.ts tem 48. Rodar o push faz o drizzle-kit perguntar, uma a
// uma, se cada tabela nova é criação ou renomeação de `ai_analyses`,
// `messages`, `security_notifications` ou `user_vault` — que estão no
// histórico e não existem mais no código. Além de exigir terminal
// interativo, uma resposta errada gera DROP.
//
// Enquanto o histórico não for refeito, este script é o caminho para subir um
// banco novo: aplica scripts/schema-completo.sql, que é o schema inteiro
// gerado a partir do drizzle/schema.ts.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/criar-banco.mjs
//
// É seguro rodar de novo: cada CREATE TABLE já existente é reportado como
// "já existia" e o script segue adiante, sem apagar nada.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQUIVO_SQL = join(AQUI, "schema-completo.sql");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL não definida.\n\n" +
      "Exemplo:\n" +
      `  DATABASE_URL='mysql://usuario:senha@host:3306/defaultdb?ssl={"rejectUnauthorized":false}' \\\n` +
      "    node scripts/criar-banco.mjs\n"
  );
  process.exit(1);
}

// O Aiven entrega a URI terminando em ?ssl-mode=REQUIRED, que é sintaxe do
// cliente de linha de comando do MySQL. O mysql2 não entende esse parâmetro e
// abre a conexão sem TLS, que o Aiven recusa. A troca abaixo evita um erro de
// conexão que não explica a própria causa.
let urlFinal = url;
if (url.includes("ssl-mode=")) {
  urlFinal = url.replace(/[?&]ssl-mode=[^&]*/i, "");
  urlFinal += (urlFinal.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}';
  console.log("Aviso: troquei ssl-mode=REQUIRED por ssl={...}, que é o formato que o mysql2 entende.\n");
}

const sql = await readFile(ARQUIVO_SQL, "utf8");

// O drizzle-kit separa os comandos com esta marca.
const comandos = sql
  .split("--> statement-breakpoint")
  .map((c) => c.trim())
  .filter(Boolean);

console.log(`Aplicando ${comandos.length} comandos de ${ARQUIVO_SQL}\n`);

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

let criadas = 0;
let existentes = 0;
const falhas = [];

for (const comando of comandos) {
  const nome = comando.match(/CREATE TABLE `([a-z_]+)`/i)?.[1] ?? comando.slice(0, 48).replace(/\s+/g, " ");
  try {
    await conn.query(comando);
    criadas++;
    console.log(`  ok       ${nome}`);
  } catch (erro) {
    if (erro.code === "ER_TABLE_EXISTS_ERROR" || erro.code === "ER_DUP_KEYNAME") {
      existentes++;
      console.log(`  já havia ${nome}`);
    } else {
      falhas.push({ nome, mensagem: erro.message });
      console.error(`  FALHOU   ${nome}: ${erro.message}`);
    }
  }
}

await conn.end();

console.log(`\n${criadas} criadas, ${existentes} já existiam, ${falhas.length} falharam.`);

if (falhas.length > 0) {
  console.error("\nO banco não está completo. Corrija as falhas acima antes de subir o servidor.");
  process.exit(1);
}

console.log("Banco pronto. Agora aponte a DATABASE_URL do servidor para ele.");
