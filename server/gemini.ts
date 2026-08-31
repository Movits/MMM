import { ENV } from "./_core/env";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL = "gemini-embedding-001";
// Alias ativo listado pela API Gemini; evita o modelo 2.5 Flash descontinuado
// para novas chaves e recebe as atualizações compatíveis da família Flash.
const AUDIO_MODEL = "gemini-3.5-flash";

function getGeminiKey() {
  // Mesma cadeia de fallback do resto do app (LLM_API_KEY > chaves legadas >
  // GOOGLE_API_KEY). Ler só GOOGLE_API_KEY quebrava embeddings e transcrição em
  // produção, onde a chave é configurada como LLM_API_KEY.
  const key = ENV.llmApiKey;
  if (!key) throw new Error("Chave do LLM não configurada. Defina LLM_API_KEY (ou GOOGLE_API_KEY) no ambiente.");
  return key;
}

async function geminiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GEMINI_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": getGeminiKey() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Gemini indisponível (${response.status}): ${details.slice(0, 400)}`);
  }
  return response.json() as Promise<T>;
}

export async function embedWithGemini(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT") {
  const payload = await geminiPost<{ embedding?: { values?: number[] } }>(`/models/${EMBEDDING_MODEL}:embedContent`, {
    model: `models/${EMBEDDING_MODEL}`,
    taskType,
    outputDimensionality: 768,
    content: { parts: [{ text: text.slice(0, 20_000) }] },
  });
  const vector = payload.embedding?.values;
  if (!Array.isArray(vector) || vector.length !== 768) throw new Error("Gemini não retornou um embedding de 768 dimensões.");
  return vector;
}

export async function transcribeWithGemini(input: { audio: Buffer; mimeType: string; language?: string }) {
  const languageInstruction = input.language ? ` O idioma predominante esperado é ${input.language}.` : "";
  const geminiMimeType = input.mimeType === "audio/mpeg" ? "audio/mp3" : input.mimeType === "audio/m4a" ? "audio/mp4" : input.mimeType;
  const payload = await geminiPost<{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }>(`/models/${AUDIO_MODEL}:generateContent`, {
    contents: [{ parts: [
      { text: `Transcreva integralmente a fala deste áudio de reunião. Preserve nomes próprios, empresas, números, telefones e e-mails. Retorne somente a transcrição em texto, sem resumo e sem comentários.${languageInstruction}` },
      { inline_data: { mime_type: geminiMimeType, data: input.audio.toString("base64") } },
    ] }],
    generationConfig: { temperature: 0 },
  });
  const text = payload.candidates?.flatMap(candidate => candidate.content?.parts ?? []).map(part => part.text ?? "").join("\n").trim();
  if (!text) throw new Error("O Gemini não retornou uma transcrição válida.");
  return { text, language: input.language ?? "pt", segments: [] as Array<unknown> };
}
