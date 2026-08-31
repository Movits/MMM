// Põe um banco JÁ EXISTENTE em dia com a etapa 11.
//
// Banco novo não precisa disto: scripts/criar-banco.mjs já cria tudo certo. Este
// script é para os que foram criados antes, porque `criar-banco.mjs` pula tabela
// que já existe (ER_TABLE_EXISTS_ERROR) e portanto nunca aplica mudança de
// coluna em tabela antiga.
//
// Faz duas coisas:
//
// 1. `ai_match_suggestions.match_type` ganha o valor 'mutual'. Sem isto, o
//    primeiro par com encontros nos dois sentidos derruba o recálculo inteiro
//    com erro 1265 sob STRICT_TRANS_TABLES — e como o recálculo roda no fim de
//    addAsset, addNeed e recalculate, a usuária adiciona um item e a tela
//    quebra. Quanto melhor a rede dela, mais certo o erro, porque a conexão
//    mútua é justamente o resultado mais valioso.
//
// 2. `consents` ganha a coluna gerada `activeKey` e o índice único
//    `consent_active_unique`. Sem isto, dois cliques simultâneos em Autorizar
//    gravam dois consentimentos: entre a conferência e o insert cabe outra
//    requisição, e só uma restrição do banco resolve corrida.
//
//    A restrição óbvia estaria errada: `UNIQUE (userId, documentVersionId)`
//    proibiria revogar e aceitar de novo, que é fluxo legítimo e prometido no
//    termo. A coluna gerada vira NULL quando revogado, e NULLs não colidem.
//
// Este script é anterior ao sistema de migração (baseline 0000_fundacao) e
// existe para pôr bancos daquela época em dia ANTES de o migrar.mjs adotar o
// baseline. Banco novo não precisa dele. Mudança futura de schema não passa
// por aqui: é pnpm db:generate + pnpm db:migrate. Tudo é idempotente: rodar duas vezes não
// quebra, e sem --aplicar o script só relata.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/migrar-banco-etapa-11.mjs             (só relata)
//   DATABASE_URL='mysql://...' node scripts/migrar-banco-etapa-11.mjs --aplicar

import mysql from "mysql2/promise";

const aplicar = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

const conexao = await mysql.createConnection(process.env.DATABASE_URL);
const banco = new URL(process.env.DATABASE_URL).pathname.slice(1);

const coluna = async (tabela, nome) => {
  const [[linha]] = await conexao.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
    [banco, tabela, nome],
  );
  return linha?.COLUMN_TYPE ?? null;
};

const temIndice = async (tabela, indice) => {
  const [[linha]] = await conexao.query(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?",
    [banco, tabela, indice],
  );
  return Number(linha.n) > 0;
};

const passos = [];

try {
  // ── 1. o valor 'mutual' no enum ────────────────────────────────────────────
  const tipoAtual = await coluna("ai_match_suggestions", "match_type");
  if (tipoAtual === null) {
    console.log("ai_match_suggestions: tabela não existe — rode scripts/criar-banco.mjs antes.");
  } else if (tipoAtual.includes("'mutual'")) {
    console.log("match_type: já aceita 'mutual'");
  } else {
    console.log(`match_type: ${tipoAtual} — falta 'mutual'`);
    passos.push({
      nome: "acrescentar 'mutual' ao enum de match_type",
      sql: "ALTER TABLE `ai_match_suggestions` MODIFY COLUMN `match_type` " +
           "enum('mutual','exact','category','semantic') NOT NULL DEFAULT 'exact'",
    });
  }

  // ── 2. a unicidade do consentimento ativo ──────────────────────────────────
  if ((await coluna("consents", "id")) === null) {
    console.log("consents: tabela não existe — rode scripts/criar-banco.mjs antes.");
  } else {
    const temColuna = (await coluna("consents", "activeKey")) !== null;
    const temUnico = await temIndice("consents", "consent_active_unique");
    console.log(`coluna activeKey: ${temColuna ? "já existe" : "falta criar"}`);
    console.log(`índice consent_active_unique: ${temUnico ? "já existe" : "falta criar"}`);

    // Duplicatas existentes impedem o índice único de nascer. Se houver, são as
    // linhas que a corrida produziu, e precisam de decisão humana sobre qual
    // prova de consentimento fica.
    const [duplicadas] = await conexao.query(`
      SELECT userId, documentVersionId, COUNT(*) AS quantas, GROUP_CONCAT(id ORDER BY grantedAt) AS ids
      FROM consents WHERE revokedAt IS NULL
      GROUP BY userId, documentVersionId HAVING COUNT(*) > 1`);

    if (duplicadas.length) {
      console.log(`\n${duplicadas.length} consentimento(s) ativo(s) duplicado(s). Resolva antes:`);
      for (const d of duplicadas) {
        const ids = String(d.ids).split(",").slice(1);
        console.log(`  usuária ${d.userId}: mantenha a linha mais antiga e revogue as outras`);
        console.log(`  UPDATE consents SET revokedAt = NOW() WHERE id IN (${ids.join(", ")});`);
      }
      process.exit(1);
    }

    if (!temColuna) {
      passos.push({
        nome: "criar a coluna gerada activeKey",
        sql: "ALTER TABLE `consents` ADD COLUMN `activeKey` varchar(80) " +
             "GENERATED ALWAYS AS (CASE WHEN `revokedAt` IS NULL THEN CONCAT(`userId`, ':', `documentVersionId`) ELSE NULL END) VIRTUAL",
        tolerar: ["ER_DUP_FIELDNAME"],
      });
    }
    if (!temUnico) {
      passos.push({
        nome: "criar o índice consent_active_unique",
        sql: "CREATE UNIQUE INDEX `consent_active_unique` ON `consents` (`activeKey`)",
        tolerar: ["ER_DUP_KEYNAME"],
      });
    }
  }

  // ── executar ───────────────────────────────────────────────────────────────
  if (!passos.length) {
    console.log("\nNada a fazer: o banco já está em dia com a etapa 11.");
    process.exit(0);
  }

  if (!aplicar) {
    console.log(`\n${passos.length} passo(s) pendente(s):`);
    for (const p of passos) console.log(`  - ${p.nome}`);
    console.log("\nRode de novo com --aplicar.");
    process.exit(0);
  }

  for (const passo of passos) {
    try {
      await conexao.query(passo.sql);
      console.log(`ok  ${passo.nome}`);
    } catch (erro) {
      if (passo.tolerar?.includes(erro.code)) console.log(`já estava  ${passo.nome}`);
      else throw erro;
    }
  }

  console.log("\nBanco em dia. O recálculo já pode gravar conexões mútuas, e dois");
  console.log("cliques simultâneos em Autorizar geram uma linha só.");
} catch (erro) {
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
