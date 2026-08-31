// Aplica as migrações de drizzle/ a um banco — vazio ou já existente.
//
// Este script é a metade que faltava do sistema de migração. A outra metade é o
// `pnpm db:generate` (drizzle-kit generate), que compara drizzle/schema.ts com o
// último snapshot e ESCREVE a migração; este script a EXECUTA e anota na tabela
// `_migracoes` que ela rodou. O fluxo de qualquer mudança de banco passa a ser:
//
//   1. editar drizzle/schema.ts
//   2. pnpm db:generate        (nasce drizzle/00NN_*.sql)
//   3. pnpm db:migrate         (este script aplica o que estiver pendente)
//
// Nada mais de escrever ALTER à mão nem de lembrar de rodar script solto — foi
// por esse caminho que um banco novo passou a nascer sem as tabelas do
// consentimento, e que o valor 'mutual' faltou em banco antigo.
//
// TRÊS SITUAÇÕES, decididas sozinhas:
//
//   banco vazio             -> aplica tudo, começando pelo baseline
//   banco antigo, em dia    -> ADOTA o baseline (anota sem executar) e aplica só
//                              o que veio depois. Bancos criados na era dos
//                              scripts à mão já têm as tabelas; rodar o baseline
//                              neles falharia em cada CREATE. "Em dia" é conferido
//                              coluna a coluna e enum a enum, não só por tabela:
//                              o banco de desenvolvimento estava 10 colunas atrás
//                              com todas as 50 tabelas presentes.
//   banco antigo, desviado  -> PARA e lista cada desvio. Adoção às cegas
//                              esconderia exatamente o buraco que este sistema
//                              existe para impedir. Para pôr em dia:
//                              scripts/nivelar-banco.mjs --aplicar.
//
// Por que uma tabela própria (`_migracoes`) e não a do drizzle-kit: o histórico
// antigo do drizzle morreu com 15 tabelas contra 50 do schema, e a tabela dele
// pode existir com lixo daquela época. Começar limpo, com nome nosso e formato
// simples, evita herdar esse passado.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/migrar.mjs             (aplica)
//   DATABASE_URL='mysql://...' node scripts/migrar.mjs --simular   (só relata)

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { lerBaseline, compararComBanco } from "./baseline.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA = join(AQUI, "..", "drizzle");

const simular = process.argv.includes("--simular");

export async function migrar(databaseUrl, { relatarApenas = false } = {}) {
  // O Aiven entrega a URI com ?ssl-mode=REQUIRED, sintaxe do cliente de linha
  // de comando que o mysql2 não entende — e sem TLS o Aiven recusa. A troca
  // evita um erro de conexão que não explica a própria causa.
  let urlFinal = databaseUrl;
  if (databaseUrl.includes("ssl-mode=")) {
    urlFinal = databaseUrl.replace(/[?&]ssl-mode=[^&]*/i, "");
    urlFinal += (urlFinal.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}';
  }

  const journal = JSON.parse(await readFile(join(PASTA, "meta", "_journal.json"), "utf8"));
  const tags = journal.entries.map(entrada => entrada.tag);
  if (!tags.length) throw new Error("drizzle/meta/_journal.json não tem nenhuma migração.");

  const conexao = await mysql.createConnection(urlFinal);
  const banco = new URL(urlFinal).pathname.slice(1);

  try {
    await conexao.query(
      "CREATE TABLE IF NOT EXISTS `_migracoes` (" +
      "`tag` varchar(255) NOT NULL, `aplicada_em` timestamp NOT NULL DEFAULT current_timestamp(), " +
      "PRIMARY KEY (`tag`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    );
    const [linhas] = await conexao.query("SELECT tag FROM `_migracoes`");
    const aplicadas = new Set(linhas.map(l => l.tag));

    // ── adoção: banco de antes do sistema de migração ────────────────────────
    if (!aplicadas.size) {
      const baseline = await lerBaseline();
      const [algumaTabela] = await conexao.query(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)",
        [banco, [...baseline.tabelas.keys()]],
      );

      if (Number(algumaTabela[0].n) > 0) {
        // Existir tabela não basta: um banco da era dos scripts à mão pode
        // estar colunas atrás do baseline — o de desenvolvimento estava 10 —
        // e adotá-lo assim carimba como "em dia" um banco que não é. A adoção
        // exige que TODAS as tabelas, colunas e enums do baseline batam.
        const desvios = await compararComBanco(baseline, async (sql, params) => {
          const [linhas] = await conexao.query(sql, params);
          return linhas;
        }, banco);

        if (desvios.total > 0) {
          console.error(`Banco existente diverge do baseline em ${desvios.total} ponto(s):`);
          for (const t of desvios.tabelasFaltando) console.error(`  tabela faltando: ${t}`);
          for (const c of desvios.colunasFaltando) console.error(`  coluna faltando: ${c.tabela}.${c.coluna}`);
          for (const e of desvios.enumsDiferentes) console.error(`  enum diferente:  ${e.tabela}.${e.coluna} (faltam: ${e.faltam.join(", ") || "—"}${e.sobram.length ? `; sobram: ${e.sobram.join(", ")}` : ""})`);
          for (const i of desvios.indicesFaltando) console.error(`  índice faltando: ${i.nome} em ${i.tabela}`);
          for (const u of desvios.unicosFaltando) console.error(`  único faltando:  ${u.nome} em ${u.tabela}`);
          console.error(
            "\nAdotar o baseline agora esconderia esses buracos. Nivele primeiro:\n" +
            "  DATABASE_URL='...' node scripts/nivelar-banco.mjs --aplicar\n" +
            "e rode este script de novo.",
          );
          return { ok: false, aplicadas: 0 };
        }

        for (const e of desvios.enumsComSobras) {
          console.log(`aviso: ${e.tabela}.${e.coluna} tem valores além do baseline (${e.sobram.join(", ")}) — compatível, seguindo.`);
        }
        console.log(`Banco já bate com o baseline (tabelas, colunas e enums): adotando ${baseline.tag} sem executar.`);
        if (!relatarApenas) await conexao.query("INSERT INTO `_migracoes` (tag) VALUES (?)", [baseline.tag]);
        aplicadas.add(baseline.tag);
      }
      // nenhuma tabela: banco vazio, o baseline roda como migração comum
    }

    // ── aplicar o que falta, na ordem do journal ─────────────────────────────
    const pendentes = tags.filter(tag => !aplicadas.has(tag));
    if (!pendentes.length) {
      console.log("Nada a aplicar: o banco está em dia com drizzle/.");
      return { ok: true, aplicadas: 0 };
    }

    console.log(`${pendentes.length} migração(ões) pendente(s): ${pendentes.join(", ")}`);
    if (relatarApenas) {
      console.log("\n--simular: nada foi executado.");
      return { ok: true, aplicadas: 0 };
    }

    for (const tag of pendentes) {
      const sql = await readFile(join(PASTA, `${tag}.sql`), "utf8");
      const comandos = sql.split("--> statement-breakpoint").map(c => c.trim()).filter(Boolean);
      process.stdout.write(`  ${tag} (${comandos.length} comando(s))... `);
      for (const comando of comandos) {
        try {
          await conexao.query(comando);
        } catch (erro) {
          // DDL no MySQL não desfaz com rollback: parar aqui, sem anotar a
          // migração, é o que permite investigar e rodar de novo depois.
          console.error(`\n\nFALHOU em ${tag}:\n  ${erro.message}\n  comando: ${comando.slice(0, 160).replace(/\s+/g, " ")}`);
          return { ok: false, aplicadas: 0 };
        }
      }
      await conexao.query("INSERT INTO `_migracoes` (tag) VALUES (?)", [tag]);
      console.log("ok");
    }

    console.log(`\n${pendentes.length} migração(ões) aplicada(s). Banco em dia.`);
    return { ok: true, aplicadas: pendentes.length };
  } finally {
    await conexao.end();
  }
}

// Rodado direto (e não importado), executa.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.error("Defina DATABASE_URL.\n  DATABASE_URL='mysql://...' node scripts/migrar.mjs");
    process.exit(1);
  }
  const resultado = await migrar(process.env.DATABASE_URL, { relatarApenas: simular });
  process.exit(resultado.ok ? 0 : 1);
}
