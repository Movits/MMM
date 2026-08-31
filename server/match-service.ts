import crypto from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { aiMatchSuggestions, contactAssets, contactNeeds, privateContacts } from "../drizzle/schema";
import { cosineSimilarity, normalizeVector } from "./memory-service";
import { getDb } from "./db";
import { sendEmail } from "./_core/email";
import { embedWithGemini } from "./gemini";

const SEMANTIC_THRESHOLD = 0.7;
const SAVE_THRESHOLD = 50;
const EMAIL_THRESHOLD = 70;

export type MatchReason = { slug: string; label: string; category?: string | null };
export type MatchType = "mutual" | "exact" | "category" | "semantic";

/** Um encontro entre o que alguém possui e o que outra pessoa procura. */
type Encontro = { deId: number; paraId: number; asset: MatchReason; need: MatchReason; score: number; type: MatchType };

/**
 * Tudo que liga dois contatos. Guardar por par, e não por encontro, é o que
 * permite ver "três coisas em comum" e, principalmente, reconhecer quando cada
 * um tem o que o outro procura.
 */
type Par = { lowId: number; highId: number; encontros: Encontro[] };

export function slugifyMatchTag(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

export function scoreMatch(asset: MatchReason, need: MatchReason, semanticScore = 0) {
  if (asset.slug && asset.slug === need.slug) return { score: 100, type: "exact" as const };
  if (asset.category && need.category && asset.category === need.category) return { score: 60, type: "category" as const };
  // 45 fica DE PROPÓSITO abaixo de SAVE_THRESHOLD (50), o que mantém o critério
  // semântico desligado. Não é esquecimento: com SEMANTIC_THRESHOLD em 0.7, ele
  // casa tudo com tudo. Medido em 31/08/2026 numa rede de 10 contatos — ao subir
  // para 50, os 45 pares possíveis viraram match, incluindo "Armazenagem
  // refrigerada" com "Terrenos com outorga". Reativar exige calibrar o limiar
  // com dados reais antes, não mexer nesta linha.
  if (semanticScore > SEMANTIC_THRESHOLD) return { score: 45, type: "semantic" as const };
  return { score: 0, type: "semantic" as const };
}

async function embed(text: string) {
  return normalizeVector(await embedWithGemini(text, "SEMANTIC_SIMILARITY"));
}

/**
 * Embeddings de uma rodada. O laço compara cada ativo com cada necessidade,
 * então sem cache o mesmo texto seria enviado ao Gemini uma vez por par —
 * dezenas de chamadas idênticas por recálculo.
 */
type SemanticContext = { cache: Map<string, number[]>; disponivel: boolean };

async function embedCached(texto: string, contexto: SemanticContext) {
  const emCache = contexto.cache.get(texto);
  if (emCache) return emCache;
  const vetor = await embed(texto);
  contexto.cache.set(texto, vetor);
  return vetor;
}

/**
 * Similaridade semântica é o terceiro critério, usado só quando tag e categoria
 * não casam. Se o provedor de embeddings estiver fora do ar ou sem cota, o
 * recálculo continua sem ele: os matches por tag exata e por categoria não
 * dependem de IA e não podem ser perdidos junto. Uma falha desliga o critério
 * para o resto da rodada, em vez de repetir a chamada a cada par.
 */
async function semanticScore(
  asset: { tagLabel: string; description: string | null },
  need: { tagLabel: string; description: string | null },
  contexto: SemanticContext,
) {
  if (!contexto.disponivel) return 0;
  try {
    const [assetEmbedding, needEmbedding] = await Promise.all([
      embedCached(`${asset.tagLabel}. ${asset.description ?? ""}`, contexto),
      embedCached(`${need.tagLabel}. ${need.description ?? ""}`, contexto),
    ]);
    return cosineSimilarity(assetEmbedding, needEmbedding);
  } catch (erro) {
    contexto.disponivel = false;
    console.warn("[Match] Similaridade semântica indisponível nesta rodada:", erro instanceof Error ? erro.message : erro);
    return 0;
  }
}

export async function recalculatePrivateMatches(ownerId: string, ownerEmail?: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [assets, needs, contacts, existing] = await Promise.all([
    db.select().from(contactAssets).where(eq(contactAssets.ownerId, ownerId)),
    db.select().from(contactNeeds).where(eq(contactNeeds.ownerId, ownerId)),
    db.select().from(privateContacts).where(eq(privateContacts.ownerId, ownerId)),
    db.select().from(aiMatchSuggestions).where(eq(aiMatchSuggestions.ownerId, ownerId)),
  ]);
  if (new Set(assets.map(asset => asset.contactId)).size === 0 || new Set(needs.map(need => need.contactId)).size === 0) return { created: 0, updated: 0, total: 0 };

  const contactName = new Map(contacts.map(contact => [contact.id, contact.fullName]));
  const semantico: SemanticContext = { cache: new Map(), disponivel: true };

  // Junta por PAR de contatos, não por encontro. É o que permite acumular todas
  // as razões e enxergar quando os dois lados se completam.
  const pares = new Map<string, Par>();
  for (const asset of assets) {
    for (const need of needs) {
      if (asset.contactId === need.contactId) continue;
      const baseAsset: MatchReason = { slug: asset.tagSlug, label: asset.tagLabel, category: asset.category };
      const baseNeed: MatchReason = { slug: need.tagSlug, label: need.tagLabel, category: need.category };
      let result = scoreMatch(baseAsset, baseNeed);
      if (!result.score) result = scoreMatch(baseAsset, baseNeed, await semanticScore(asset, need, semantico));
      if (result.score < SAVE_THRESHOLD) continue;

      const lowId = Math.min(asset.contactId, need.contactId);
      const highId = Math.max(asset.contactId, need.contactId);
      const chave = `${lowId}:${highId}`;
      const par = pares.get(chave) ?? { lowId, highId, encontros: [] };
      par.encontros.push({ deId: asset.contactId, paraId: need.contactId, asset: baseAsset, need: baseNeed, score: result.score, type: result.type });
      pares.set(chave, par);
    }
  }

  const unicos = (itens: MatchReason[]) => {
    const vistos = new Map<string, MatchReason>();
    for (const item of itens) if (!vistos.has(item.slug)) vistos.set(item.slug, item);
    return Array.from(vistos.values());
  };
  const listar = (rotulos: string[]) =>
    rotulos.length === 1 ? rotulos[0] : `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;

  const existingByPair = new Map(existing.map(match => [`${match.pairLowContactId}:${match.pairHighContactId}`, match]));
  const timestamp = Date.now(); let created = 0; let updated = 0; let newHighScore = 0;

  for (const par of Array.from(pares.values())) {
    // Direção é quem possui. Havendo encontros nos dois sentidos, cada contato
    // tem o que o outro procura — a conexão mais forte que existe aqui.
    const direcoes = new Map<number, Encontro[]>();
    for (const encontro of par.encontros) {
      const lista = direcoes.get(encontro.deId) ?? [];
      lista.push(encontro);
      direcoes.set(encontro.deId, lista);
    }
    const mutuo = direcoes.size > 1;
    const melhor = par.encontros.reduce((a, b) => (b.score > a.score ? b : a));

    const reasonText = mutuo
      ? Array.from(direcoes.entries())
          .map(([deId, lista]) => {
            const quem = contactName.get(deId) ?? "Este contato";
            const outro = contactName.get(lista[0].paraId) ?? "o outro contato";
            return `${quem} possui ${listar(unicos(lista.map(e => e.asset)).map(a => a.label))}, que ${outro} procura`;
          })
          .join("; ") + "."
      : (() => {
          const quem = contactName.get(melhor.deId) ?? "Este contato";
          const outro = contactName.get(melhor.paraId) ?? "outro contato";
          const rotulos = unicos(par.encontros.map(e => e.asset)).map(a => a.label);
          return `${quem} possui ${listar(rotulos)}, que ${outro} procura.`;
        })();

    const values = {
      contactAId: melhor.deId,
      contactBId: melhor.paraId,
      matchScore: melhor.score,
      matchType: (mutuo ? "mutual" : melhor.type) as MatchType,
      matchedAssets: unicos(par.encontros.map(e => e.asset)),
      matchedNeeds: unicos(par.encontros.map(e => e.need)),
      reasonText,
      updatedAt: timestamp,
    };

    const chave = `${par.lowId}:${par.highId}`;
    const previous = existingByPair.get(chave);
    if (previous) {
      await db.update(aiMatchSuggestions).set(values).where(and(eq(aiMatchSuggestions.id, previous.id), eq(aiMatchSuggestions.ownerId, ownerId)));
      updated += 1;
      if (values.matchScore >= EMAIL_THRESHOLD && previous.matchScore < EMAIL_THRESHOLD) newHighScore += 1;
    } else {
      await db.insert(aiMatchSuggestions).values({ id: crypto.randomUUID(), ownerId, pairLowContactId: par.lowId, pairHighContactId: par.highId, status: "pending", notifiedAt: null, viewedAt: null, acceptedAt: null, dismissedAt: null, createdAt: timestamp, ...values });
      created += 1;
      if (values.matchScore >= EMAIL_THRESHOLD) newHighScore += 1;
    }
  }

  // Match órfão: o ativo ou a necessidade que o justificava foi apagado, e o
  // motivo exibido virou mentira. Só some o que ainda é sugestão — decisão da
  // usuária, aceita ou dispensada, permanece como histórico.
  let removed = 0;
  for (const antigo of existing) {
    if (pares.has(`${antigo.pairLowContactId}:${antigo.pairHighContactId}`)) continue;
    if (antigo.status !== "pending" && antigo.status !== "viewed") continue;
    await db.delete(aiMatchSuggestions).where(and(eq(aiMatchSuggestions.id, antigo.id), eq(aiMatchSuggestions.ownerId, ownerId)));
    removed += 1;
  }

  if (newHighScore && ownerEmail) {
    const sent = await sendEmail({ to: ownerEmail, subject: `${newHighScore} nova(s) oportunidade(s) de conexão no MMM`, text: `Encontramos ${newHighScore} oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede. Abra o painel de Matches Inteligentes para revisar.`, html: `<p>Encontramos <strong>${newHighScore}</strong> oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede MMM.</p><p>Abra o painel de Matches Inteligentes para revisar.</p>` });
    if (sent) await db.update(aiMatchSuggestions).set({ notifiedAt: timestamp }).where(and(eq(aiMatchSuggestions.ownerId, ownerId), gte(aiMatchSuggestions.matchScore, EMAIL_THRESHOLD)));
  }
  return { created, updated, removed, total: pares.size };
}
