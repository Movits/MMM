import crypto from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  contexts,
  meetingTranscripts,
  memoryDocuments,
  privateContacts,
} from "../drizzle/schema";
import { getDb } from "./db";
import { embedManyWithGemini, embedWithGemini } from "./gemini";
import { invokeLLM } from "./_core/llm";

const MAX_DOCUMENTS_PER_OWNER = 800;
const MAX_QUERY_LENGTH = 1000;

// Ritmo da indexação: o limite do Gemini conta requisições por minuto, então os
// embeddings saem em lotes (1 requisição por lote) com uma pausa curta entre
// eles, e cada rodada tem um orçamento de tempo — a busca roda atrás do proxy
// do Render, que corta requisições longas. O que não couber fica pendente e sai
// na próxima busca ou reindexação, porque a indexação é incremental.
const EMBED_BATCH_SIZE = 16;
const EMBED_BATCH_PAUSE_MS = 300;
const INDEX_BUDGET_MS = 30_000;
const espera = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  // O instante do retrato: buscas concorrentes também reindexam, e um documento
  // criado por outra rodada DEPOIS deste retrato não pode ser tratado como
  // órfão — a fonte dele só não aparece aqui porque a lista é mais antiga.
  const snapshotAt = now();
  const allSources = await collectOwnerSources(ownerId);
  // O teto por dona continua, mas deixa de ser silencioso: quem passar dele
  // fica sabendo pelo log e pelo retorno, em vez de descobrir na busca que as
  // reuniões (as últimas da fila) nunca entraram no índice.
  const truncated = Math.max(0, allSources.length - MAX_DOCUMENTS_PER_OWNER);
  if (truncated > 0) {
    console.warn(`[Memória] ${ownerId} tem ${allSources.length} fontes; ${truncated} acima do teto de ${MAX_DOCUMENTS_PER_OWNER} ficaram fora do índice.`);
  }
  const sources = allSources.slice(0, MAX_DOCUMENTS_PER_OWNER);
  const existing = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ownerId));
  const byCompositeKey = new Map(existing.map(document => [`${document.sourceType}:${document.sourceId}`, document]));

  // Fonte apagada leva o documento junto: sem isto, notas de um contato
  // excluído continuavam pesquisáveis (e citáveis pela resposta) para sempre.
  // A comparação usa a lista COMPLETA de fontes, para que um documento além do
  // teto não seja confundido com órfão.
  const liveKeys = new Set(allSources.map(source => `${source.sourceType}:${source.sourceId}`));
  const orphans = existing.filter(document =>
    !liveKeys.has(`${document.sourceType}:${document.sourceId}`) && document.createdAt < snapshotAt);
  if (orphans.length) {
    await db.delete(memoryDocuments).where(and(
      eq(memoryDocuments.ownerId, ownerId),
      inArray(memoryDocuments.id, orphans.map(orphan => orphan.id)),
    ));
  }

  let skipped = 0;
  const pendingSources: Array<{ source: MemorySource; contentHash: string; previous?: typeof existing[number] }> = [];
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
    pendingSources.push({ source, contentHash, previous });
  }

  let indexed = 0;
  let pending = 0;
  const startedAt = now();
  for (let offset = 0; offset < pendingSources.length; offset += EMBED_BATCH_SIZE) {
    if (offset > 0) {
      if (now() - startedAt > INDEX_BUDGET_MS) {
        pending = pendingSources.length - offset;
        console.warn(`[Memória] orçamento de tempo da rodada esgotado; ${pending} documento(s) ficam para a próxima.`);
        break;
      }
      await espera(EMBED_BATCH_PAUSE_MS);
    }
    const batch = pendingSources.slice(offset, offset + EMBED_BATCH_SIZE);
    let vectors: number[][];
    try {
      vectors = (await embedManyWithGemini(batch.map(item => item.source.content), "RETRIEVAL_DOCUMENT")).map(normalizeVector);
    } catch (error) {
      // Indexar é melhor-esforço: pico ou cota do serviço de IA não pode
      // derrubar a rodada inteira. O que já foi indexado fica valendo e o
      // restante sai na próxima, quando o serviço respirar.
      pending = pendingSources.length - offset;
      console.warn(`[Memória] embeddings indisponíveis (${error instanceof Error ? error.message : error}); ${pending} documento(s) ficam para a próxima rodada.`);
      break;
    }
    for (let position = 0; position < batch.length; position += 1) {
      const { source, contentHash, previous } = batch[position];
      const embedding = vectors[position];
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
  }
  return { indexed, skipped, removed: orphans.length, pending, truncated, total: sources.length };
}

export async function semanticSearch(ownerId: string, query: string, limit = 6): Promise<SearchHit[]> {
  const cleanQuery = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!cleanQuery) return [];
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  // O embedding da pergunta vem ANTES da reindexação: se o serviço de
  // embeddings estiver fora, a usuária recebe o erro claro em uma rodada de
  // retentativas — reindexar primeiro somaria as duas esperas e viraria
  // timeout mudo no proxy do Render.
  const queryEmbedding = await embed(cleanQuery, "RETRIEVAL_QUERY");
  // A reindexação é incremental: documentos sem alteração reutilizam o vetor já salvo.
  // Assim, uma busca sempre enxerga contatos, contextos e reuniões adicionados recentemente.
  // E é melhor-esforço: se o índice não puder ser atualizado agora, a busca
  // segue com o que já está indexado em vez de morrer junto.
  try {
    await indexOwnerMemory(ownerId);
  } catch (error) {
    console.warn(`[Memória] reindexação adiada (${error instanceof Error ? error.message : error}); buscando no índice existente.`);
  }
  const documents = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ownerId));
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

// Sem afirmar a causa: pode ser pico ou cota, mas também configuração — e
// prometer "alta demanda" num erro permanente esconderia o problema real.
export const AI_UNAVAILABLE_ANSWER = "A busca funcionou e as fontes estão listadas abaixo, mas o serviço de IA não conseguiu redigir a resposta agora. Tente perguntar de novo em alguns minutos.";

export async function answerFromMemory(query: string, hits: SearchHit[]) {
  if (!hits.length) {
    return "Não encontrei informações privadas suficientes na sua memória para responder a isso.";
  }
  const context = hits.map((hit, index) => `[${index + 1}] ${hit.title}\n${hit.content.slice(0, 2500)}`).join("\n\n");
  // invokeLLM usa o mesmo provedor do resto do app (LLM_API_URL/LLM_API_KEY).
  // A versão anterior dependia do SDK da Anthropic com ANTHROPIC_API_KEY, que
  // não existe no ambiente: a resposta falhava mesmo com a busca funcionando.
  let response: Awaited<ReturnType<typeof invokeLLM>>;
  try {
    response = await invokeLLM({
      max_tokens: 700,
      messages: [
        { role: "system", content: "Você é a Memória Inteligente do MMM. Responda em português somente com base no contexto privado fornecido. Nunca invente fatos. Se a evidência não for suficiente, diga isso claramente. Cite as fontes pelo número entre colchetes ao final de cada afirmação relevante." },
        { role: "user", content: `Pergunta: ${query}

Contexto privado:
${context}` },
      ],
    });
  } catch (error) {
    // O LLM fora do ar não anula uma busca que já deu certo: as fontes vão
    // para a tela com um aviso honesto. Estourar aqui derrubava a mutation
    // inteira e cuspia o erro cru do provedor (com o JSON de cota dentro) no
    // toast da usuária.
    console.warn(`[Memória] resposta indisponível: ${error instanceof Error ? error.message : error}`);
    return AI_UNAVAILABLE_ANSWER;
  }
  const text = response.choices?.[0]?.message?.content;
  return (typeof text === "string" ? text : "").trim() || "Não consegui gerar uma resposta agora. Tente novamente em instantes.";
}

export async function searchAndAnswer(ownerId: string, query: string) {
  const hits = await semanticSearch(ownerId, query);
  const answer = await answerFromMemory(query, hits);
  return { answer, hits };
}
