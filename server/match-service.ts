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
type Candidate = {
  contactAId: number; contactBId: number; score: number;
  type: "exact" | "category" | "semantic";
  assets: MatchReason[]; needs: MatchReason[]; reason: string;
};

export function slugifyMatchTag(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

export function scoreMatch(asset: MatchReason, need: MatchReason, semanticScore = 0) {
  if (asset.slug && asset.slug === need.slug) return { score: 100, type: "exact" as const };
  if (asset.category && need.category && asset.category === need.category) return { score: 60, type: "category" as const };
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
  const bestByPair = new Map<string, Candidate>();
  for (const asset of assets) {
    for (const need of needs) {
      if (asset.contactId === need.contactId) continue;
      const baseAsset: MatchReason = { slug: asset.tagSlug, label: asset.tagLabel, category: asset.category };
      const baseNeed: MatchReason = { slug: need.tagSlug, label: need.tagLabel, category: need.category };
      let result = scoreMatch(baseAsset, baseNeed);
      if (!result.score) result = scoreMatch(baseAsset, baseNeed, await semanticScore(asset, need, semantico));
      if (result.score < SAVE_THRESHOLD) continue;
      const aName = contactName.get(asset.contactId) ?? "Este contato";
      const bName = contactName.get(need.contactId) ?? "outro contato";
      const candidate: Candidate = {
        contactAId: asset.contactId, contactBId: need.contactId, score: result.score, type: result.type,
        assets: [baseAsset], needs: [baseNeed],
        reason: `${aName} possui ${asset.tagLabel} e ${bName} procura ${need.tagLabel}.`,
      };
      const pair = [asset.contactId, need.contactId].sort((a, b) => a - b).join(":");
      const previous = bestByPair.get(pair);
      if (!previous || candidate.score > previous.score) bestByPair.set(pair, candidate);
    }
  }

  const existingByPair = new Map(existing.map(match => [`${match.pairLowContactId}:${match.pairHighContactId}`, match]));
  const timestamp = Date.now(); let created = 0; let updated = 0; let newHighScore = 0;
  for (const candidate of Array.from(bestByPair.values())) {
    const low = Math.min(candidate.contactAId, candidate.contactBId); const high = Math.max(candidate.contactAId, candidate.contactBId);
    const key = `${low}:${high}`; const previous = existingByPair.get(key);
    const values = { contactAId: candidate.contactAId, contactBId: candidate.contactBId, matchScore: candidate.score, matchType: candidate.type, matchedAssets: candidate.assets, matchedNeeds: candidate.needs, reasonText: candidate.reason, updatedAt: timestamp };
    if (previous) {
      await db.update(aiMatchSuggestions).set(values).where(and(eq(aiMatchSuggestions.id, previous.id), eq(aiMatchSuggestions.ownerId, ownerId)));
      updated += 1;
      if (candidate.score >= EMAIL_THRESHOLD && previous.matchScore < EMAIL_THRESHOLD) newHighScore += 1;
    } else {
      await db.insert(aiMatchSuggestions).values({ id: crypto.randomUUID(), ownerId, pairLowContactId: low, pairHighContactId: high, status: "pending", notifiedAt: null, viewedAt: null, acceptedAt: null, dismissedAt: null, createdAt: timestamp, ...values });
      created += 1;
      if (candidate.score >= EMAIL_THRESHOLD) newHighScore += 1;
    }
  }
  if (newHighScore && ownerEmail) {
    const sent = await sendEmail({ to: ownerEmail, subject: `${newHighScore} nova(s) oportunidade(s) de conexão no MMM`, text: `Encontramos ${newHighScore} oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede. Abra o painel de Matches Inteligentes para revisar.`, html: `<p>Encontramos <strong>${newHighScore}</strong> oportunidade(s) de conexão privada(s) com score de 70 ou mais na sua rede MMM.</p><p>Abra o painel de Matches Inteligentes para revisar.</p>` });
    if (sent) await db.update(aiMatchSuggestions).set({ notifiedAt: timestamp }).where(and(eq(aiMatchSuggestions.ownerId, ownerId), gte(aiMatchSuggestions.matchScore, EMAIL_THRESHOLD)));
  }
  return { created, updated, total: bestByPair.size };
}
