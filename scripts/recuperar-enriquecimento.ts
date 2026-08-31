// Reaplica as respostas do chat de enriquecimento que foram confirmadas e
// jogadas fora.
//
// O defeito: applyEnrichmentSuggestion marcava a sugestão como "applied" mas só
// gravava campos simples de perfil. As respostas de "o que possui", "o que
// procura", "como se conheceram" e "tipo de relacionamento" nunca chegavam ao
// contato — e são justamente as duas primeiras que alimentam o Cruzamento
// Inteligente. A sorte: o valor confirmado ficou guardado em `applied_value`
// na própria tabela de sugestões, então dá para reaplicar tudo.
//
// Passa pelo MESMO caminho do código consertado (aplicarRespostaAoContato),
// com a mesma de-duplicação: "fabrica" confirmada cinco vezes vira UM item.
//
// Uso:
//   DATABASE_URL='mysql://...' npx tsx scripts/recuperar-enriquecimento.ts             (só relata)
//   DATABASE_URL='mysql://...' npx tsx scripts/recuperar-enriquecimento.ts --aplicar

import { and, eq, inArray } from "drizzle-orm";
import { getDb, aplicarRespostaAoContato } from "../server/db";
import { enrichmentSuggestions, privateContacts } from "../drizzle/schema";

const aplicar = process.argv.includes("--aplicar");

const db = await getDb();
if (!db) {
  console.error("Banco indisponível — defina DATABASE_URL.");
  process.exit(1);
}

const TIPOS_DESCARTADOS = ["assets", "needs", "how_met", "relationship_type"] as const;

const perdidas = await db
  .select()
  .from(enrichmentSuggestions)
  .where(and(
    eq(enrichmentSuggestions.status, "applied"),
    inArray(enrichmentSuggestions.fieldType, [...TIPOS_DESCARTADOS]),
  ));

if (!perdidas.length) {
  console.log("Nenhuma resposta perdida: nada marcado como aplicado nos tipos que eram descartados.");
  process.exit(0);
}

console.log(`${perdidas.length} resposta(s) confirmadas que nunca chegaram ao contato:\n`);
for (const s of perdidas) {
  console.log(`  contato ${s.contactId}  ${String(s.fieldType).padEnd(18)} "${s.appliedValue ?? s.suggestedValue}"`);
}

if (!aplicar) {
  console.log("\nRode de novo com --aplicar. Duplicatas são reconhecidas e viram um item só.");
  process.exit(0);
}

console.log();
let gravadas = 0;
let puladas = 0;

for (const s of perdidas) {
  const valor = (s.appliedValue ?? s.suggestedValue ?? "").trim();
  if (!valor) { puladas++; continue; }

  // Contato apagado depois da conversa: não há onde gravar, e criar contato
  // fantasma seria pior do que perder a resposta.
  const [contato] = await db.select({ id: privateContacts.id }).from(privateContacts)
    .where(and(eq(privateContacts.id, s.contactId), eq(privateContacts.ownerId, s.ownerId)))
    .limit(1);
  if (!contato) {
    console.log(`  pulei: contato ${s.contactId} não existe mais ("${valor}")`);
    puladas++;
    continue;
  }

  const gravou = await aplicarRespostaAoContato(db, s.ownerId, s.contactId, String(s.fieldType), valor, Date.now());
  if (gravou) { gravadas++; console.log(`  ok       contato ${s.contactId}  ${s.fieldType}  "${valor}"`); }
  else { puladas++; console.log(`  já havia contato ${s.contactId}  ${s.fieldType}  "${valor}"`); }
}

console.log(`\n${gravadas} gravada(s), ${puladas} já existiam ou sem destino.`);
console.log("Abra Matches Inteligentes e clique em Atualizar matches para o cruzamento ler o que chegou.");
process.exit(0);
