// Carga da base de participantes — o primeiro dia da plataforma.
//
// Uso:
//   node scripts/importar-participantes.mjs base.csv --env .env.producao
//   node scripts/importar-participantes.mjs base.csv --env .env.producao --aplicar
//   node scripts/importar-participantes.mjs --modelo      (imprime um exemplo de planilha)
//
// O `--env` existe pelo mesmo motivo do checar-producao.mjs, e evita uma
// armadilha real: a URL do Aiven tem JSON no parâmetro de SSL, e passá-la pela
// linha de comando faz o shell comer as aspas — o erro que sai é "Unknown SSL
// profile", que não explica a própria causa. Sem `--env`, vale a DATABASE_URL
// que já estiver no ambiente.
//
// SEM `--aplicar` ele NÃO ESCREVE NADA: lê a planilha, valida linha por linha,
// confere quais e-mails já existem no banco e imprime o relatório. É o modo
// padrão de propósito — carga de base é irreversível na prática, e ninguém
// deveria descobrir um erro de coluna depois de criar mil contas.
//
// O que cada conta recebe, igual ao cadastro pela tela (server/auth.ts,
// `registerUser`): `openId` "email_" + 16 bytes aleatórios, papel prata,
// `loginMethod` "email", ativa, e-mail não verificado e onboarding pendente.
// A ÚNICA diferença: `passwordHash` fica nulo, porque senha não entra por
// planilha. Cada participante define a dela em "Esqueci minha senha".
//
// Idempotente pelo e-mail: rodar duas vezes com a mesma planilha não duplica
// ninguém, e o relatório diz quantas já existiam. Linha que já existe NÃO é
// atualizada — mexer no perfil que a pessoa já editou é decisão dela, não da
// planilha.
//
// Para DESFAZER: cada conta criada sai pela exclusão de conta
// (server/exclusao-de-conta.ts), que apaga o rastro nas 51 tabelas. O log em
// `--log=arquivo.json` guarda os ids criados para isso.
//
// Nunca manda e-mail. Avisar as participantes é decisão e canal do Roberto.

import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { prepararImportacao, resumo } from "./importacao/planilha.mjs";

const MODELO = `nome;email;empresa;cargo;setor;pais;cidade;possui;procura;linkedin;bio
Maria Silva;maria@exemplo.com.br;Vinícola Serra;Sócia-fundadora;Alimentação;Brasil;Bento Gonçalves;exportação de vinho; rótulo próprio;distribuidor na Europa; logística refrigerada;linkedin.com/in/exemplo;Produz vinho fino desde 2012.
Ana Costa;ana@exemplo.pt;Costa Importações;Diretora;Logística;Portugal;Lisboa;importação de bebidas; armazém alfandegado;fornecedor brasileiro;;
`;

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const soModelo = args.includes("--modelo");
const posEnv = args.indexOf("--env");
// O caminho da planilha é o primeiro argumento que não é opção — e não pode ser
// o valor de `--env`.
const caminho = args.find((a, i) => !a.startsWith("--") && i !== posEnv + 1);
const caminhoDoLog = (args.find(a => a.startsWith("--log=")) || "").slice("--log=".length)
  || `importacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;

/** `--env arquivo` ou `--env=arquivo`, como no exame de produção. */
function arquivoDeEnv() {
  const comIgual = args.find(a => a.startsWith("--env="));
  if (comIgual) return comIgual.slice("--env=".length);
  return posEnv >= 0 ? args[posEnv + 1] : null;
}

/** Lê SÓ a DATABASE_URL do arquivo, sem tocar no resto do ambiente. */
async function urlDoArquivo(arquivo) {
  const texto = await readFile(arquivo, "utf8");
  const linha = texto.split(/\r?\n/).find(l => l.trim().startsWith("DATABASE_URL="));
  if (!linha) throw new Error(`${arquivo} não tem DATABASE_URL`);
  return linha.trim().slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

if (soModelo) {
  console.log(MODELO);
  process.exit(0);
}
if (!caminho) {
  console.error("Uso: node scripts/importar-participantes.mjs base.csv --env .env.producao [--aplicar]");
  console.error("     node scripts/importar-participantes.mjs --modelo   (imprime um exemplo de planilha)");
  process.exit(2);
}

const texto = await readFile(caminho, "utf8");
const leitura = prepararImportacao(texto);

console.log(`\nPlanilha: ${caminho}`);
if (leitura.erroFatal) {
  console.error(`\nRECUSADA: ${leitura.erroFatal}`);
  process.exit(1);
}
console.log(`Separador: "${leitura.separador}" | colunas reconhecidas: ${leitura.colunasLidas.join(", ")}`);
if (leitura.desconhecidas?.length) {
  console.log(`Colunas ignoradas (não existem no cadastro): ${leitura.desconhecidas.join(", ")}`);
}

if (leitura.recusadas.length) {
  console.log(`\nLINHAS RECUSADAS (${leitura.recusadas.length}) — corrija a planilha e rode de novo:`);
  for (const r of leitura.recusadas.slice(0, 40)) console.log(`  linha ${r.numero}: ${r.erros.join("; ")}`);
  if (leitura.recusadas.length > 40) console.log(`  ... e mais ${leitura.recusadas.length - 40}`);
}
if (leitura.avisos.length) {
  console.log(`\nAVISOS (${leitura.avisos.length}) — a conta entra, mas leia:`);
  for (const a of leitura.avisos.slice(0, 40)) console.log(`  linha ${a.numero} (${a.email}): ${a.aviso}`);
  if (leitura.avisos.length > 40) console.log(`  ... e mais ${leitura.avisos.length - 40}`);
}
if (!leitura.participantes.length) {
  console.error("\nNenhuma linha válida: nada a importar.");
  process.exit(1);
}

const media = Math.round(leitura.participantes.reduce((s, p) => s + p.completude, 0) / leitura.participantes.length);
console.log(`\nCompletude média do perfil que vai entrar: ${media}%`);

const arquivoEnv = arquivoDeEnv();
let url = arquivoEnv ? await urlDoArquivo(arquivoEnv) : process.env.DATABASE_URL;
if (!url) {
  console.error("\nSem banco: passe --env .env.producao ou defina DATABASE_URL no ambiente.");
  process.exit(2);
}
if (arquivoEnv) console.log(`Banco: lido de ${arquivoEnv}`);
if (url.includes("ssl-mode=")) {
  url = url.replace(/[?&]ssl-mode=[^&]*/i, "");
  url += (url.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}';
}
const conexao = await mysql.createConnection(url);

try {
  const emails = leitura.participantes.map(p => p.email);
  const existentes = new Set();
  // Em blocos, para não montar um IN com mil placeholders.
  for (let i = 0; i < emails.length; i += 200) {
    const bloco = emails.slice(i, i + 200);
    const [linhas] = await conexao.query(
      `SELECT \`email\` FROM \`users\` WHERE \`email\` IN (${bloco.map(() => "?").join(", ")})`,
      bloco,
    );
    for (const l of linhas) existentes.add(String(l.email).toLowerCase());
  }
  const novas = leitura.participantes.filter(p => !existentes.has(p.email));

  console.log(`\n${resumo({ ...leitura, novas: novas.length, existentes: existentes.size })}`);

  if (!aplicar) {
    console.log("\nENSAIO: nada foi gravado. As 5 primeiras contas que entrariam:");
    for (const p of novas.slice(0, 5)) {
      console.log(`  ${p.email} | ${p.nome} | ${p.setor ?? "sem setor"} | ${p.pais ?? "sem país"} | possui ${p.possui.length} | procura ${p.procura.length}`);
    }
    console.log("\nPara gravar de verdade, repita com --aplicar.");
    process.exit(0);
  }

  console.log(`\nAPLICANDO: ${novas.length} conta(s) nova(s). As ${existentes.size} que já existem não são tocadas.`);
  const criadas = [];
  let falhas = 0;

  for (const p of novas) {
    const openId = "email_" + crypto.randomBytes(16).toString("hex");
    try {
      await conexao.beginTransaction();
      const [res] = await conexao.execute(
        "INSERT INTO `users` (`openId`, `name`, `email`, `passwordHash`, `emailVerified`, `loginMethod`, `role`, `country`, `company`, `position`, `isActive`, `isVerified`, `onboardingCompleted`, `lastSignedIn`) " +
        "VALUES (?, ?, ?, NULL, 0, 'email', 'silver', ?, ?, ?, 1, 0, 0, NOW())",
        [openId, p.nome, p.email, p.pais, p.empresa, p.cargo],
      );
      const id = Number(res.insertId);
      // `sector` (singular) é o que server/matching.ts lê; `sectors` (array) é o
      // que a tela mostra. Os dois são gravados até o cartão de consolidar as
      // colunas duplicadas do cadastro entrar — escrever só um deixaria metade
      // do produto cego.
      await conexao.execute(
        "INSERT INTO `user_profiles` (`userId`, `displayName`, `bio`, `city`, `country`, `sectors`, `linkedinUrl`, `profileCompleteness`, `company`, `jobTitle`, `whatIHave`, `whatINeed`, `currentRole`, `currentCompany`, `sector`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id, p.nome, p.bio, p.cidade, p.pais,
          JSON.stringify(p.setor ? [p.setor] : []),
          p.linkedin, p.completude, p.empresa, p.cargo,
          JSON.stringify(p.possui), JSON.stringify(p.procura),
          p.cargo, p.empresa, p.setor,
        ],
      );
      await conexao.commit();
      criadas.push({ id, openId, email: p.email, linha: p.numero });
    } catch (erro) {
      await conexao.rollback().catch(() => {});
      falhas++;
      console.error(`  FALHA na linha ${p.numero} (${p.email}): ${erro.code || ""} ${erro.sqlMessage || erro.message}`);
    }
  }

  await writeFile(caminhoDoLog, JSON.stringify({ planilha: caminho, quando: new Date().toISOString(), criadas }, null, 2), "utf8");

  console.log(`\n${criadas.length} conta(s) criada(s), ${falhas} falha(s). Log dos ids: ${caminhoDoLog}`);
  console.log('Nenhum e-mail foi enviado. Cada participante entra por "Esqueci minha senha" para definir a dela.');
  if (falhas) process.exit(1);
} finally {
  await conexao.end();
}
