import { ENV } from "./_core/env";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL = "gemini-embedding-001";
// Alias ativo listado pela API Gemini; evita o modelo 2.5 Flash descontinuado
// para novas chaves e recebe as atualizações compatíveis da família Flash.
const AUDIO_MODEL = "gemini-3.5-flash";
// Reserva para quando o modelo de áudio está lotado (503) ou com a cota do dia
// esgotada (429 do plano gratuito). Duas regras aprendidas a dor:
//  1. Modelo CONCRETO, nunca alias -latest — um alias já apontou para modelo
//     com cota gratuita de 20/dia e derrubou a IA em produção (CLAUDE.md).
//  2. DIFERENTE do principal — a versão anterior lia LLM_MODEL, que em
//     produção é exatamente o gemini-3.5-flash principal, e a guarda de
//     igualdade lá embaixo pulava a reserva: ela NUNCA disparou na prática.
// gemini-3.5-flash-lite aceita áudio (entradas: texto, imagem, vídeo, áudio e
// PDF — docs oficiais do Gemini) e tem cota separada da do principal.
// LLM_AUDIO_MODEL_RESERVA permite trocar sem deploy; se o valor apontado não
// existir, o catch da reserva registra e devolve o erro original — nunca pior
// do que não ter reserva.
const AUDIO_MODEL_RESERVA = () => process.env.LLM_AUDIO_MODEL_RESERVA || "gemini-3.5-flash-lite";

// "High demand" (503), rate limit (429) e soluço interno (500) são passageiros
// por definição — o Google manda literalmente "try again later". Desistir na
// primeira resposta dessas era o que estourava o erro cru na cara da usuária.
const STATUS_PASSAGEIROS = new Set([429, 500, 503]);
const ESPERAS_MS = [2000, 5000];
// O submit da reunião é uma requisição síncrona atrás do proxy do Render
// (~100s): cada chamada tem teto próprio e as retentativas têm um orçamento
// total — retentar além disso só trocaria um erro claro por um timeout mudo,
// com o servidor ainda trabalhando e a usuária sem resposta.
const TIMEOUT_POR_CHAMADA_MS = 40_000;
const ORCAMENTO_RETENTATIVAS_MS = 50_000;
const espera = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class GeminiIndisponivelError extends Error {
  constructor(readonly status: number, mensagem?: string) {
    super(mensagem ?? `O serviço de IA está com alta demanda neste momento (${status}). Aguarde alguns instantes e tente de novo.`);
  }
}

// 429 de COTA ("exceeded your current quota... free_tier_requests, limit: 20")
// não é pico: é o limite gratuito diário do modelo, e retentar só queima tempo.
// O caminho certo é pular direto para o modelo reserva — cota separada — e,
// se as duas se esgotarem, dizer a verdade: renova em algumas horas.
export class GeminiCotaEsgotadaError extends GeminiIndisponivelError {
  constructor() {
    super(429, "O limite de uso gratuito do serviço de IA foi atingido. Ele renova sozinho (em minutos, se for o limite por minuto; em algumas horas, se for o diário). Para uso contínuo, ative o faturamento da chave do Google.");
  }
}

const pareceCotaEsgotada = (detalhe: string) =>
  /exceeded your current quota|free_tier_requests|RESOURCE_EXHAUSTED/i.test(detalhe);

function getGeminiKey() {
  // Mesma cadeia de fallback do resto do app (LLM_API_KEY > chaves legadas >
  // GOOGLE_API_KEY). Ler só GOOGLE_API_KEY quebrava embeddings e transcrição em
  // produção, onde a chave é configurada como LLM_API_KEY.
  const key = ENV.llmApiKey;
  if (!key) throw new Error("Chave do LLM não configurada. Defina LLM_API_KEY (ou GOOGLE_API_KEY) no ambiente.");
  return key;
}

async function geminiPost<T>(path: string, body: unknown, tentativas = ESPERAS_MS.length + 1): Promise<T> {
  // Falta de chave é erro de configuração, não de rede: sai antes do laço —
  // retentar não faria a chave aparecer.
  const chave = getGeminiKey();
  const inicio = Date.now();
  let ultimoStatus = 503;
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    if (tentativa > 0) {
      if (Date.now() - inicio > ORCAMENTO_RETENTATIVAS_MS) break;
      await espera(ESPERAS_MS[Math.min(tentativa - 1, ESPERAS_MS.length - 1)]);
    }
    let response: Response;
    try {
      response = await fetch(`${GEMINI_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_POR_CHAMADA_MS),
      });
    } catch (erro) {
      // Chamada que estourou o teto ou caiu na rede conta como passageira —
      // mas dentro do mesmo orçamento, para o request não morrer no proxy.
      ultimoStatus = 504;
      console.warn(`[Gemini] chamada a ${path} falhou (tentativa ${tentativa + 1}/${tentativas}):`, erro instanceof Error ? erro.message : erro);
      continue;
    }
    if (response.ok) return response.json() as Promise<T>;
    const details = await response.text();
    // Erro que não é de sobrecarga (chave inválida, payload errado...) não
    // melhora repetindo: sai na hora, com o detalhe para diagnóstico.
    if (!STATUS_PASSAGEIROS.has(response.status)) {
      throw new Error(`Gemini indisponível (${response.status}): ${details.slice(0, 400)}`);
    }
    // Cota esgotada não é pico: repetir no mesmo modelo só queima tempo. Sai
    // já — na transcrição, é o que aciona o modelo reserva de imediato.
    if (response.status === 429 && pareceCotaEsgotada(details)) {
      console.warn(`[Gemini] cota esgotada em ${path}: ${details.slice(0, 200)}`);
      throw new GeminiCotaEsgotadaError();
    }
    ultimoStatus = response.status;
    console.warn(`[Gemini] ${response.status} em ${path} (tentativa ${tentativa + 1}/${tentativas}): ${details.slice(0, 200)}`);
  }
  throw new GeminiIndisponivelError(ultimoStatus);
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

// O limite do plano do Gemini conta REQUISIÇÕES por minuto, não textos: um
// lote inteiro numa chamada de batchEmbedContents custa 1 requisição, enquanto
// indexar documento a documento custava N — era isso que estourava o ritmo na
// primeira indexação de uma base grande. O teto de textos por lote fica com
// quem chama (a indexação da memória usa lotes pequenos, com pausa entre eles).
export async function embedManyWithGemini(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" = "RETRIEVAL_DOCUMENT"): Promise<number[][]> {
  if (!texts.length) return [];
  const payload = await geminiPost<{ embeddings?: Array<{ values?: number[] }> }>(`/models/${EMBEDDING_MODEL}:batchEmbedContents`, {
    requests: texts.map(text => ({
      model: `models/${EMBEDDING_MODEL}`,
      taskType,
      outputDimensionality: 768,
      content: { parts: [{ text: text.slice(0, 20_000) }] },
    })),
  });
  const vectors = payload.embeddings?.map(item => item.values);
  if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some(vector => !Array.isArray(vector) || vector.length !== 768)) {
    throw new Error("Gemini não retornou um embedding de 768 dimensões para cada texto do lote.");
  }
  return vectors as number[][];
}

type RespostaGeracao = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

export async function transcribeWithGemini(input: { audio: Buffer; mimeType: string; language?: string }) {
  const languageInstruction = input.language ? ` O idioma predominante esperado é ${input.language}.` : "";
  const geminiMimeType = input.mimeType === "audio/mpeg" ? "audio/mp3" : input.mimeType === "audio/m4a" ? "audio/mp4" : input.mimeType;
  const corpo = {
    contents: [{ parts: [
      { text: `Transcreva integralmente a fala deste áudio de reunião. Preserve nomes próprios, empresas, números, telefones e e-mails. Retorne somente a transcrição em texto, sem resumo e sem comentários.${languageInstruction}` },
      { inline_data: { mime_type: geminiMimeType, data: input.audio.toString("base64") } },
    ] }],
    generationConfig: { temperature: 0 },
  };

  let payload: RespostaGeracao;
  try {
    payload = await geminiPost<RespostaGeracao>(`/models/${AUDIO_MODEL}:generateContent`, corpo);
  } catch (erro) {
    // O modelo de áudio seguiu lotado depois das retentativas: uma última
    // cartada no modelo reserva antes de devolver o erro para a usuária.
    if (!(erro instanceof GeminiIndisponivelError)) throw erro;
    const reserva = AUDIO_MODEL_RESERVA();
    // Reserva igual ao principal seria um 4º upload idêntico no mesmo modelo
    // lotado — sem valor nenhum.
    if (reserva === AUDIO_MODEL) throw erro;
    console.warn(`[Gemini] ${AUDIO_MODEL} sobrecarregado; tentando a reserva ${reserva}`);
    try {
      payload = await geminiPost<RespostaGeracao>(`/models/${reserva}:generateContent`, corpo, 1);
    } catch (erroDaReserva) {
      console.warn(`[Gemini] a reserva ${reserva} também falhou:`, erroDaReserva instanceof Error ? erroDaReserva.message : erroDaReserva);
      throw erro;
    }
  }

  const text = payload.candidates?.flatMap(candidate => candidate.content?.parts ?? []).map(part => part.text ?? "").join("\n").trim();
  if (!text) throw new Error("O Gemini não retornou uma transcrição válida.");
  return { text, language: input.language ?? "pt", segments: [] as Array<unknown> };
}
