// Impede, no banco, dois consentimentos ativos da mesma usuária para a mesma
// versão de documento.
//
// Por que no banco e não no código: `accept` conferia antes de inserir, mas
// entre a conferência e o insert cabe outra requisição. Dois cliques ao mesmo
// tempo geravam duas linhas — medido, não suposto. Só uma restrição do banco
// resolve corrida; código não resolve.
//
// A coluna gerada é a forma de fazer no MySQL o que no Postgres seria um índice
// único parcial: a chave vale enquanto o consentimento está ativo e vira NULL
// quando revogado, e NULLs não colidem em índice único. Um
// `UNIQUE (userId, documentVersionId)` simples proibiria revogar e aceitar de
// novo, que é fluxo legítimo.
//
// `pnpm db:push` não funciona neste projeto (motivo em scripts/criar-banco.mjs),
// por isso o ALTER é escrito à mão e é idempotente: rodar duas vezes não quebra.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/adicionar-unicidade-consentimento.mjs           (só relata)
//   DATABASE_URL='mysql://...' node scripts/adicionar-unicidade-consentimento.mjs --aplicar

import mysql from "mysql2/promise";

const aplicar = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

const conexao = await mysql.createConnection(process.env.DATABASE_URL);
const banco = new URL(process.env.DATABASE_URL).pathname.slice(1);

const existeColuna = async (tabela, coluna) => {
  const [[linha]] = await conexao.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
    [banco, tabela, coluna],
  );
  return Number(linha.n) > 0;
};

const existeIndice = async (tabela, indice) => {
  const [[linha]] = await conexao.query(
    "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?",
    [banco, tabela, indice],
  );
  return Number(linha.n) > 0;
};

try {
  const temColuna = await existeColuna("consents", "activeKey");
  const temIndice = await existeIndice("consents", "consent_active_unique");

  // Duplicatas existentes impedem o índice único de ser criado. Se houver, elas
  // são justamente as linhas que a corrida produziu, e precisam de decisão
  // humana: qual das duas provas de consentimento fica.
  const [duplicadas] = await conexao.query(`
    SELECT userId, documentVersionId, COUNT(*) AS quantas, GROUP_CONCAT(id ORDER BY grantedAt) AS ids
    FROM consents WHERE revokedAt IS NULL
    GROUP BY userId, documentVersionId HAVING COUNT(*) > 1`);

  console.log(`coluna activeKey: ${temColuna ? "já existe" : "falta criar"}`);
  console.log(`índice consent_active_unique: ${temIndice ? "já existe" : "falta criar"}`);
  console.log(`consentimentos ativos duplicados: ${duplicadas.length}`);

  for (const d of duplicadas) {
    console.log(`  usuária ${d.userId} na versão ${d.documentVersionId}: ${d.quantas} linhas (ids ${d.ids})`);
  }

  if (duplicadas.length) {
    console.log();
    console.log("Resolva as duplicatas antes: o índice único não pode ser criado sobre elas.");
    console.log("Mantenha a linha mais antiga de cada par (a primeira prova) e revogue as demais:");
    for (const d of duplicadas) {
      const ids = String(d.ids).split(",").slice(1);
      console.log(`  UPDATE consents SET revokedAt = NOW() WHERE id IN (${ids.join(", ")});`);
    }
    process.exit(1);
  }

  if (temColuna && temIndice) {
    console.log("\nNada a fazer: o banco já garante a unicidade.");
    process.exit(0);
  }

  if (!aplicar) {
    console.log("\nRode de novo com --aplicar.");
    process.exit(0);
  }

  if (!temColuna) {
    // MySQL não aceita IF NOT EXISTS em ADD COLUMN; a conferência acima é o
    // substituto, e o catch de ER_DUP_FIELDNAME cobre a corrida entre as duas.
    await conexao.query(
      "ALTER TABLE consents ADD COLUMN activeKey VARCHAR(80) " +
      "GENERATED ALWAYS AS (CASE WHEN revokedAt IS NULL THEN CONCAT(userId, ':', documentVersionId) ELSE NULL END) VIRTUAL",
    ).catch(erro => { if (erro.code !== "ER_DUP_FIELDNAME") throw erro; });
    console.log("coluna activeKey criada");
  }

  if (!temIndice) {
    await conexao.query("CREATE UNIQUE INDEX consent_active_unique ON consents (activeKey)")
      .catch(erro => { if (erro.code !== "ER_DUP_KEYNAME") throw erro; });
    console.log("índice consent_active_unique criado");
  }

  console.log("\nPronto: dois cliques simultâneos em Autorizar agora geram uma linha só.");
} catch (erro) {
  console.error("Falhou:", erro.message);
  process.exitCode = 1;
} finally {
  await conexao.end();
}
