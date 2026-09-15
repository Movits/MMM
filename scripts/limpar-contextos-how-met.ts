// Remove os contextos que o fluxo antigo do chat de enriquecimento criava como
// efeito colateral de "como vocês se conheceram" (ver server/db.ts,
// aplicarRespostaAoContato, e server/limpeza-contextos-how-met.ts para a
// lógica). A correção (PR #88, que fechou a issue #29) já impede
// NOVOS contextos assim — este script só limpa os que já existiam.
//
// Fonte da verdade: enrichment_suggestions.undo_snapshot com
// kind = "how_met" e contextoCriado = true. Nunca o nome/texto do contexto.
//
// Em caso de dúvida sobre um registro (vínculo extra, participante, mídia,
// reunião ligada, dono divergente, contexto ou vínculo editado pela dona), ele
// NUNCA é apagado — vai para a lista de revisão manual do relatório.
//
// Uso (rode sempre o dry-run primeiro: ele mostra o banco alvo):
//   DATABASE_URL='mysql://...' npx tsx scripts/limpar-contextos-how-met.ts
//   DATABASE_URL='mysql://...' npx tsx scripts/limpar-contextos-how-met.ts --executar --confirmar-banco=host:porta/banco
//
// TRAVA: --executar só apaga se --confirmar-banco repetir o banco de
// DATABASE_URL exatamente como o dry-run o mostrou; sem isso, recusa antes de
// abrir conexão. Produção (Aiven), para ler ou apagar, só com autorização
// explícita do Roberto (CLAUDE.md).
//
// O relatório não mostra o nome dos contextos (é a frase livre da resposta e
// pode citar terceiros); ids bastam para conferir no banco.
//
// Idempotente: rodar de novo depois de uma execução não apaga nada a mais —
// os contextos já removidos entram como "já ausentes", sem erro.

import { getDb } from "../server/db";
import { decidirModo, limparContextosHowMet } from "../server/limpeza-contextos-how-met";

const decisao = decidirModo(process.argv.slice(2), process.env.DATABASE_URL);
if ("recusa" in decisao) {
  console.error(`Recusado: ${decisao.recusa}`);
  process.exit(1);
}

console.log(`Banco alvo: ${decisao.alvo}`);
console.log("Produção só com autorização explícita do Roberto (CLAUDE.md).");

const db = await getDb();
if (!db) {
  console.error("Banco indisponível — defina DATABASE_URL.");
  process.exit(1);
}

const r = await limparContextosHowMet(db, decisao.modo);

console.log(`Modo: ${r.modo === "executar" ? "EXECUÇÃO REAL" : "DRY RUN (nada foi alterado)"}`);
console.log(`Snapshots analisados (field_type = how_met): ${r.snapshotsAnalisados}`);
console.log(`Contextos candidatos (contextoCriado=true, com id): ${r.candidatosBrutos}`);
console.log(`Já ausentes (removidos antes, execução idempotente): ${r.jaAusentes}`);
console.log(`Aptos para remoção após todas as checagens: ${r.candidatos.length}`);
console.log(`Precisam de revisão manual (não foram tocados): ${r.revisaoManual.length}`);

if (r.candidatos.length) {
  console.log("\nCandidatos aptos:");
  for (const c of r.candidatos) {
    const data = new Date(c.criadoEm).toISOString();
    console.log(`  contexto ${c.contextId}  dono ${c.ownerId}  criado em ${data}`);
    console.log(`    sugestão de origem: ${c.sugestaoId}   vínculo: ${c.vinculoId ?? "(nenhum)"}`);
    console.log(`    motivo: ${c.motivo}`);
  }
}

if (r.revisaoManual.length) {
  console.log("\nRequer revisão manual (NÃO apagado):");
  for (const m of r.revisaoManual) {
    console.log(`  contexto ${m.contextId}  (sugestão ${m.sugestaoId})  —  ${m.motivo}`);
  }
}

if (r.modo === "executar") {
  console.log(`\nRemovidos nesta execução: ${r.removidos.length}`);
  for (const id of r.removidos) console.log(`  ok       contexto ${id}`);
  if (r.ignoradosNaExecucao.length) {
    console.log(`Ignorados na hora de apagar (${r.ignoradosNaExecucao.length}):`);
    for (const i of r.ignoradosNaExecucao) console.log(`  pulei    contexto ${i.contextId} — ${i.motivo}`);
  }
  if (r.erros.length) {
    console.log(`Erros (${r.erros.length}):`);
    for (const e of r.erros) console.log(`  ERRO     contexto ${e.contextId} — ${e.erro}`);
  }
} else {
  console.log(`\nPara apagar os candidatos aptos listados acima: --executar --confirmar-banco=${decisao.alvo}`);
}

process.exit(r.erros.length ? 1 : 0);
