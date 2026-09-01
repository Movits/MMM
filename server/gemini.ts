import { ENV } from "./_core/env";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL = "gemini-embedding-001";
// Alias ativo listado pela API Gemini; evita o modelo 2.5 Flash descontinuado
// para novas chaves e recebe as atualizações compatíveis da família Flash.
const AUDIO_MODEL = "gemini-3.5-flash";
// Reserva para quando o modelo de áudio está em pico de demanda (503): o mesmo
// modelo que o resto do app usa via LLM_MODEL — se ele também estiver fora,
// não há o que fazer além de pedir para tentar de novo.
const AUDIO_MODEL_RESERVA = () => process.env.LLM_MODEL || "gemini-flash-lite-latest";

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
  constructor(readonly status: number) {
    super(`O serviço de IA está com alta demanda neste momento (${status}). Aguarde alguns instantes e tente de novo.`);
  }
}

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
