import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import {
  contexts,
  meetingTranscripts,
  memoryDocuments,
  privateContacts,
} from "../drizzle/schema";
import { getDb } from "./db";
import { embedWithGemini } from "./gemini";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ANSWER_MODEL = "claude-3-5-sonnet-latest";
const MAX_DOCUMENTS_PER_OWNER = 800;
const MAX_QUERY_LENGTH = 1000;

export type MemorySourceType = "contact" | "context" | "meeting";
export type SearchHit = {
  id: string;
  sourceType: MemorySourceType;
  sourceId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
};

type MemorySource = Omit<SearchHit, "id" | "score">;

function now() {
  return Date.now();
}

export function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (!magnitude) return vector;
  return vector.map(value => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function buildMemoryHash(content: string) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  return normalizeVector(await embedWithGemini(text, taskType));
}

async function collectOwnerSources(ownerId: string): Promise<MemorySource[]> {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [contacts, privateContexts, transcripts] = await Promise.all([
    db.select().from(privateContacts).where(eq(privateContacts.ownerId, ownerId)),
    db.select().from(contexts).where(and(eq(contexts.ownerId, ownerId), eq(contexts.visibility, "private"))),
    db.select().from(meetingTranscripts).where(eq(meetingTranscripts.ownerId, ownerId)),
  ]);

  const contactSources: MemorySource[] = contacts.map(contact => ({
    sourceType: "contact",
    sourceId: String(contact.id),
    title: contact.fullName,
    content: [
      `Contato: ${contact.fullName}`,
      contact.jobTitle && `Cargo: ${contact.jobTitle}`,
      contact.company && `Empresa: ${contact.company}`,
      [contact.city, contact.state, contact.country].filter(Boolean).join(" · "),
      Array.isArray(contact.profileTags) && contact.profileTags.length ? `Tags: ${contact.profileTags.join(", ")}` : "",
      contact.notes && `Notas: ${contact.notes}`,
    ].filter(Boolean).join("\n"),
    metadata: { href: "/network", contactId: contact.id, kind: "Contato" },
  }));

  const contextSources: MemorySource[] = privateContexts.map(context => ({
    sourceType: "context",
    sourceId: context.id,
    title: context.name,
    content: [
      `Contexto: ${context.name}`,
      context.description && `Descrição: ${context.description}`,
      context.eventDate && `Data: ${context.eventDate}`,
      [context.city, context.country].filter(Boolean).join(" · "),
      context.notes && `Notas: ${context.notes}`,
    ].filter(Boolean).join("\n"),
    metadata: { href: "/contexts", contextId: context.id, kind: "Contexto" },
  }));

  const transcriptSources: MemorySource[] = transcripts.map(transcript => ({
    sourceType: "meeting",
    sourceId: transcript.meetingId,
    title: "Transcrição de reunião",
    content: transcript.transcript,
    metadata: { href: "/meetings", meetingId: transcript.meetingId, kind: "Reunião", language: transcript.language },
  }));

  return [...contactSources, ...contextSources, ...transcriptSources].filter(source => source.content.trim().length > 2);
}

export async function indexOwnerMemory(ownerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const sources = (await collectOwnerSources(ownerId)).slice(0, MAX_DOCUMENTS_PER_OWNER);
  const existing = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ownerId));
  const byCompositeKey = new Map(existing.map(document => [`${document.sourceType}:${document.sourceId}`, document]));
  let indexed = 0;
  let skipped = 0;

  for (const source of sources) {
    const key = `${source.sourceType}:${source.sourceId}`;
    const contentHash = buildMemoryHash(source.content);
    const previous = byCompositeKey.get(key);
    // Vetores anteriores da OpenAI tinham 1536 dimensões. Só reutilizamos vetores
    // já compatíveis com o Gemini (768), preservando os documentos e reindexando
    // os demais de forma incremental e não destrutiva.
    if (previous?.contentHash === contentHash && Array.isArray(previous.embedding) && previous.embedding.length === 768) {
      skipped += 1;
      continue;
    }
    const embedding = await embed(source.content, "RETRIEVAL_DOCUMENT");
    const timestamp = now();
    if (previous) {
      await db.update(memoryDocuments).set({
        title: source.title,
        content: source.content,
        metadata: source.metadata,
        embedding,
        contentHash,
        indexedAt: timestamp,
        updatedAt: timestamp,
      }).where(and(eq(memoryDocuments.id, previous.id), eq(memoryDocuments.ownerId, ownerId)));
    } else {
      await db.insert(memoryDocuments).values({
        id: crypto.randomUUID(),
        ownerId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        title: source.title,
        content: source.content,
        metadata: source.metadata,
        embedding,
        contentHash,
        indexedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    indexed += 1;
  }
  return { indexed, skipped, total: sources.length };
}

export async function semanticSearch(ownerId: string, query: string, limit = 6): Promise<SearchHit[]> {
  const cleanQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!cleanQuery) return [];
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  // A reindexação é incremental: documentos sem alteração reutilizam o vetor já salvo.
  // Assim, uma busca sempre enxerga contatos, contextos e reuniões adicionados recentemente.
  await indexOwnerMemory(ownerId);
  const documents = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ownerId));
  const queryEmbedding = await embed(cleanQuery, "RETRIEVAL_QUERY");
  return documents
    .filter(document => Array.isArray(document.embedding) && document.embedding.length === queryEmbedding.length)
    .map(document => ({
      id: document.id,
      sourceType: document.sourceType as MemorySourceType,
      sourceId: document.sourceId,
      title: document.title,
      content: document.content,
      metadata: (document.metadata ?? {}) as Record<string, unknown>,
      score: cosineSimilarity(queryEmbedding, document.embedding as number[]),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(limit, 12)));
}

export async function answerFromMemory(query: string, hits: SearchHit[]) {
  if (!hits.length) {
    return "Não encontrei informações privadas suficientes na sua memória para responder a isso.";
  }
  const context = hits.map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.content.slice(0, 2500)}`).join("\n\n");
  const response = await anthropic.messages.create({
    model: ANSWER_MODEL,
    max_tokens: 700,
    system: "Você é a Memória Inteligente do MMM. Responda em português somente com base no contexto privado fornecido. Nunca invente fatos. Se a evidência não for suficiente, diga isso claramente. Cite as fontes pelo número entre colchetes ao final de cada afirmação relevante.",
    messages: [{ role: "user", content: `Pergunta: ${query}\n\nContexto privado:\n${context}` }],
  });
  return response.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
}

export async function searchAndAnswer(ownerId: string, query: string) {
  const hits = await semanticSearch(ownerId, query);
  const answer = await answerFromMemory(query, hits);
  return { answer, hits };
}
