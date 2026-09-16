// Normaliza "O que você busca?" dos perfis gravados ANTES de 14/09/2026.
//
// Naquele dia as 5 opções antigas (job, mentor, investor, strategic_partner e
// team) deram lugar às 12 do Lucas, e nenhum dado foi migrado: quem exibe
// traduz na leitura (chaveAtualDaBusca, em shared/o-que-busca.ts) e o servidor
// segue ACEITANDO as antigas, senão um perfil antigo deixaria de salvar.
//
// Este script converte o dado de verdade, para a aceitação das chaves antigas
// poder sair do zod um dia. As equivalências são as MESMAS de
// BUSCA_LEGADA_EQUIVALENTE (shared/o-que-busca.ts) — repetidas aqui porque
// script .mjs não importa TypeScript; mudou lá, mude aqui:
//
//     investor           -> investimento_capital
//     strategic_partner  -> parceiro_estrategico
//     team               -> talentos_especialistas
//
// `job` e `mentor` NÃO têm equivalente entre as 12: o script os conta e os
// deixa exatamente onde estão. Escolher uma das novas por elas seria inventar
// necessidade que ninguém declarou. `be_mentor` ("Quero também mentorar") é
// oferta, não busca, e também fica.
//
// SIMULA por padrão: lê, relata e não escreve nada. Só grava com --aplicar.
// Rodar de novo depois de aplicar não muda mais nada.
//
// Uso:
//   DATABASE_URL='mysql://...' node scripts/normalizar-buscas-antigas.mjs             (só relata)
//   DATABASE_URL='mysql://...' node scripts/normalizar-buscas-antigas.mjs --aplicar
//
// NUNCA rode contra o banco de produção (Aiven) sem autorização do Roberto.

import mysql from "mysql2/promise";

const EQUIVALENTES = {
  investor: "investimento_capital",
  strategic_partner: "parceiro_estrategico",
  team: "talentos_especialistas",
};

const SEM_EQUIVALENTE = ["job", "mentor"];

const aplicar = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}

// Aiven entrega a URL com ssl-mode=REQUIRED, que o mysql2 não entende (mesmo
// tratamento de scripts/migrar-rotulos-para-chaves.mjs).
const url = process.env.DATABASE_URL;
const semSslMode = url.replace(/[?&]ssl-mode=[^&]*/i, "");
const urlFinal = url.includes("ssl-mode=")
  ? semSslMode + (semSslMode.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}'
  : url;

/** A coluna é JSON no MySQL e texto no MariaDB: o driver devolve array ou string. */
function lerLista(valor) {
  if (Array.isArray(valor)) return valor.filter(item => typeof item === "string");
  if (typeof valor !== "string" || valor.trim() === "") return [];
  try {
    const lido = JSON.parse(valor);
    return Array.isArray(lido) ? lido.filter(item => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** A lista convertida, sem repetir chave que já estava lá. */
function converter(buscas) {
  const saida = [];
  for (const busca of buscas) {
    const nova = EQUIVALENTES[busca] ?? busca;
    if (!saida.includes(nova)) saida.push(nova);
  }
  return saida;
}

const conexao = await mysql.createConnection(urlFinal);

try {
  const [perfis] = await conexao.query("SELECT userId, seekingTypes FROM user_profiles");

  const porChaveAntiga = new Map(Object.keys(EQUIVALENTES).map(chave => [chave, 0]));
  const porChaveSemEquivalente = new Map(SEM_EQUIVALENTE.map(chave => [chave, 0]));
  const aConverter = [];

  for (const perfil of perfis) {
    const buscas = lerLista(perfil.seekingTypes);
    if (buscas.length === 0) continue;
    for (const chave of SEM_EQUIVALENTE) {
      if (buscas.includes(chave)) porChaveSemEquivalente.set(chave, porChaveSemEquivalente.get(chave) + 1);
    }
    const antigas = buscas.filter(busca => busca in EQUIVALENTES);
    if (antigas.length === 0) continue;
    for (const chave of antigas) porChaveAntiga.set(chave, porChaveAntiga.get(chave) + 1);
    aConverter.push({ userId: perfil.userId, antes: buscas, depois: converter(buscas) });
  }

  console.log(`${perfis.length} perfis lidos.`);

  if (aConverter.length === 0) {
    console.log("Nada a normalizar: nenhum perfil tem chave antiga com equivalente.");
  } else {
    console.log(`\n${aConverter.length} perfis com chave antiga que TEM equivalente:`);
    for (const [antiga, quantos] of porChaveAntiga) {
      if (quantos > 0) console.log(`  ${antiga} -> ${EQUIVALENTES[antiga]}: ${quantos} perfis`);
    }
    // Uma amostra basta para conferir no banco antes de aplicar.
    console.log("\nAmostra (até 10):");
    for (const item of aConverter.slice(0, 10)) {
      console.log(`  userId ${item.userId}: [${item.antes.join(", ")}] -> [${item.depois.join(", ")}]`);
    }
  }

  const semEquivalente = [...porChaveSemEquivalente].filter(([, quantos]) => quantos > 0);
  if (semEquivalente.length > 0) {
    console.log("\nSem equivalente entre as 12 (ficam como estão, decisão de produto):");
    for (const [chave, quantos] of semEquivalente) console.log(`  ${chave}: ${quantos} perfis`);
  }

  if (aConverter.length === 0) process.exit(0);

  if (!aplicar) {
    console.log("\nSimulação: nada foi gravado. Rode de novo com --aplicar.");
    process.exit(0);
  }

  let gravados = 0;
  for (const item of aConverter) {
    const [resultado] = await conexao.execute(
      "UPDATE user_profiles SET seekingTypes = ? WHERE userId = ?",
      [JSON.stringify(item.depois), item.userId],
    );
    gravados += resultado.affectedRows;
  }
  console.log(`\n${gravados} perfis gravados.`);
} finally {
  await conexao.end();
}
