// Reavaliação ÚNICA da Prata automática (governança de 14/09/2026).
//
// Até 14/09 o cadastro gravava Prata para todas; desde então nasce Bronze e a
// Prata vem da qualidade do perfil (shared/qualificacao-do-perfil.ts). A régua
// só olha Bronze, então as contas antigas nunca seriam reclassificadas. Este
// script lê as contas Prata e, para as que não têm origem registrada (nenhuma
// linha em gold_access_grants e nenhuma auditoria de mudança de nível), aplica
// a mesma régua. A lógica e os critérios estão em server/nivel-do-perfil.ts
// (reavaliarPrataAutomaticaAntiga), coberta por server/nivel-do-perfil.test.ts.
//
// Uso (rode sempre a simulação primeiro: ela mostra o banco alvo):
//   DATABASE_URL='mysql://...' npx tsx scripts/reavaliar-prata-antiga.ts
//   DATABASE_URL='mysql://...' npx tsx scripts/reavaliar-prata-antiga.ts --executar --confirmar-banco=host:porta/banco
//
// SEM `--executar` NÃO ESCREVE NADA. Com ele, rebaixa a Bronze quem não atende
// à régua (UPDATE condicional a role = 'silver') e grava a auditoria
// LEVEL_DEMOTED_BY_GOVERNANCE_REVIEW. Não manda aviso no sino nem e-mail.
// Quem atende à régua e quem tem origem registrada continuam Prata.
//
// TRAVA: --executar só grava se --confirmar-banco repetir o banco de
// DATABASE_URL exatamente como a simulação o mostrou. Produção (Aiven), para
// ler ou gravar, só com autorização explícita do Roberto (CLAUDE.md).
//
// O relatório mostra só ids e o nome das pendências: nada pessoal.
//
// Idempotente: rodar de novo não rebaixa ninguém a mais (a conta rebaixada já
// não é Prata). Para DESFAZER uma conta: o nível volta pela Gestão de
// usuárias do painel, que deixa ADMIN_UPDATE_USER_ROLE na auditoria.

import { decidirModo } from "../server/limpeza-contextos-how-met";
import { reavaliarPrataAutomaticaAntiga } from "../server/nivel-do-perfil";

const decisao = decidirModo(process.argv.slice(2), process.env.DATABASE_URL);
if ("recusa" in decisao) {
  console.error(`Recusado: ${decisao.recusa}`);
  process.exit(1);
}

console.log(`Banco alvo: ${decisao.alvo}`);
console.log("Produção só com autorização explícita do Roberto (CLAUDE.md).");

const r = await reavaliarPrataAutomaticaAntiga(decisao.modo === "executar" ? "aplicar" : "simular");

console.log(`Modo: ${r.modo === "aplicar" ? "EXECUÇÃO REAL" : "SIMULAÇÃO (nada foi alterado)"}`);
console.log(`Contas Prata encontradas: ${r.avaliadas}`);
console.log(`Continuam Prata por origem registrada (Ouro concedido ou mudança auditada): ${r.origemRegistrada.length}`);
console.log(`Continuam Prata por atenderem à régua: ${r.qualificadas.length}`);
console.log(`Não atendem à régua: ${r.naoQualificadas.length}`);

if (r.origemRegistrada.length) console.log(`\nOrigem registrada: ${r.origemRegistrada.join(", ")}`);
if (r.naoQualificadas.length) {
  console.log(`\n${r.modo === "aplicar" ? "Não atendiam" : "A rebaixar"} (conta: o que falta):`);
  for (const n of r.naoQualificadas) console.log(`  conta ${n.userId}: ${n.pendencias.join(", ")}`);
}

if (r.modo === "aplicar") {
  console.log(`\nRebaixadas a Bronze nesta execução: ${r.rebaixadas.length}`);
  if (r.nivelMudouNoMeio.length) {
    console.log(`Não tocadas, o nível mudou no meio: ${r.nivelMudouNoMeio.join(", ")}`);
  }
} else if (r.naoQualificadas.length) {
  console.log(`\nPara rebaixar as listadas acima: --executar --confirmar-banco=${decisao.alvo}`);
}

process.exit(0);
