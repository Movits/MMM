import crypto from "crypto";
import { and, desc, eq, inArray, lt, lte, ne } from "drizzle-orm";
import {
  meetingContactSuggestions,
  meetingEntities,
  meetingRecordings,
  meetings,
  meetingTranscripts,
  meetingTranscriptTranslations,
} from "../drizzle/schema";
import { CODIGO_ERRO_INTERROMPIDO } from "@shared/const";
import { descreverErroDeBanco, ehErroDoDriverDeBanco, MENSAGEM_ERRO_DE_CONSULTA } from "./banco-indisponivel";
import { exigirDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { storageDelete, storagePut } from "./storage";
import { GeminiIndisponivelError, transcribeWithGemini } from "./gemini";

export const MAX_MEETING_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_MEETING_DURATION_SECONDS = 10 * 60;
export const MEETING_AUDIO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Código (não frase) gravado em `processing_error` quando a varredura dá uma
 * reunião como interrompida. Vive em shared/const.ts porque a tela de
 * Reuniões compara com o MESMO valor para traduzi-lo; reexportado daqui para
 * quem trata reuniões não precisar saber onde ele mora.
 */
export { CODIGO_ERRO_INTERROMPIDO };

/**
 * Quanto tempo uma reunião pode ficar em "processing" antes de ser dada como
 * interrompida. O processamento inteiro (upload, Gemini com retentativas,
 * extração com retentativas) cabe em ~2 min; 15 min deixa folga para um pico
 * sem marcar como falha uma reunião que ainda vai terminar.
 */
export const LIMITE_PROCESSAMENTO_MS = 15 * 60 * 1000;

/**
 * Tamanho das colunas de meeting_contact_suggestions (drizzle/schema.ts). O
 * MySQL do Aiven e o MariaDB do CI rodam em modo estrito: valor maior que a
 * coluna é ERRO ("Data too long"), não corte — e como o insert das sugestões
 * é o último passo, a reunião inteira era marcada como falha depois de já ter
 * pago transcrição e extração. Mesmo padrão de LIMITE_VALOR_POR_CAMPO em
 * enrichment-flow.ts.
 */
export const LIMITE_SUGESTAO = { fullName: 200, jobTitle: 200, company: 200, phone: 50, email: 320 } as const;

/** meeting_entities.normalized_value é varchar(500); `value` é TEXT e não precisa de teto. */
export const LIMITE_VALOR_NORMALIZADO = 500;

/** Motivo gravado quando a dona exclui a reunião enquanto ela ainda processava. */
export const MENSAGEM_EXCLUIDA_DURANTE_PROCESSAMENTO = "Reunião excluída durante o processamento.";

export const ALLOWED_MEETING_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
] as const;

export type MeetingExtraction = {
  entities: Array<{
    type: "person" | "company" | "phone" | "email" | "role" | "asset" | "need" | "opportunity";
    value: string;
    normalizedValue: string | null;
    confidence: number;
  }>;
  contacts: Array<{
    fullName: string;
    jobTitle: string | null;
    company: string | null;
    phone: string | null;
    email: string | null;
    confidence: number;
  }>;
};

export const MEETING_TRANSCRIPT_LANGUAGES = ["pt-BR", "en", "es", "fr", "de", "ar", "zh", "hi", "ja", "ru"] as const;

const MEETING_LANGUAGES: Record<(typeof MEETING_TRANSCRIPT_LANGUAGES)[number], string> = {
  "pt-BR": "português do Brasil",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  de: "alemão",
  ar: "árabe",
  zh: "chinês simplificado",
  hi: "hindi",
  ja: "japonês",
  ru: "russo",
};

function now() {
  return Date.now();
}

function extensionForMime(mimeType: string) {
  if (mimeType === "audio/mp4" || mimeType === "audio/m4a") return "m4a";
  if (mimeType === "audio/mpeg") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/wav") return "wav";
  return "webm";
}

export function decodeMeetingAudio(base64: string, mimeType: string) {
  if (!(ALLOWED_MEETING_AUDIO_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Formato de áudio não suportado.");
  }
  // MediaRecorder pode gerar cabeçalhos como
  // data:audio/webm;codecs=opus;base64,... — o cabeçalho inclui parâmetros extras.
  // E o FileReader usa o tipo que o NAVEGADOR dá ao arquivo, não o mimeType
  // que a tela envia: um .mp4/.webm chega como data:video/mp4;base64,... e um
  // arquivo sem tipo como data:application/octet-stream;base64,... — só
  // aceitar "data:audio/" recusava esses como "áudio inválido" (auditoria 04/09).
  // O corte é em ";base64," (não na primeira vírgula): o Chrome grava
  // "video/webm;codecs=vp8,opus", com vírgula dentro do parâmetro.
  const normalized = base64.trim().replace(/^data:.*?;base64,/i, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) throw new Error("Arquivo de áudio inválido.");
  const audio = Buffer.from(normalized, "base64");
  if (!audio.length || audio.length > MAX_MEETING_AUDIO_BYTES) {
    throw new Error("O áudio deve ter no máximo 10 MB.");
  }
  return audio;
}

export async function extractMeetingData(transcript: string): Promise<MeetingExtraction> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "Você extrai dados de transcrições de reuniões em português. Não invente dados. Retorne somente JSON estruturado.",
      },
      {
        role: "user",
        content: `Extraia pessoas, empresas, telefones, e-mails, cargos, ativos, necessidades e oportunidades desta transcrição:\n\n${transcript.slice(0, 24000)}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_extraction",
        strict: true,
        schema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["person", "company", "phone", "email", "role", "asset", "need", "opportunity"] },
                  value: { type: "string" },
                  normalizedValue: { type: ["string", "null"], maxLength: LIMITE_VALOR_NORMALIZADO },
                  confidence: { type: "number" },
                },
                required: ["type", "value", "normalizedValue", "confidence"],
                additionalProperties: false,
              },
            },
            contacts: {
              type: "array",
              items: {
                type: "object",
                // maxLength é um pedido ao modelo; a garantia mesmo é o corte
                // de ajustarSugestaoAosLimites antes do insert.
                properties: {
                  fullName: { type: "string", maxLength: LIMITE_SUGESTAO.fullName },
                  jobTitle: { type: ["string", "null"], maxLength: LIMITE_SUGESTAO.jobTitle },
                  company: { type: ["string", "null"], maxLength: LIMITE_SUGESTAO.company },
                  phone: { type: ["string", "null"], maxLength: LIMITE_SUGESTAO.phone },
                  email: { type: ["string", "null"], maxLength: LIMITE_SUGESTAO.email },
                  confidence: { type: "number" },
                },
                required: ["fullName", "jobTitle", "company", "phone", "email", "confidence"],
                additionalProperties: false,
              },
            },
          },
          required: ["entities", "contacts"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("A IA não retornou uma extração válida.");
  const parsed = JSON.parse(content) as MeetingExtraction;
  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 80) : [],
    contacts: Array.isArray(parsed.contacts) ? parsed.contacts.slice(0, 20) : [],
  };
}

/** Texto cortado no tamanho da coluna; vazio ou ausente vira null. */
function cortar(texto: string | null | undefined, limite: number): string | null {
  if (typeof texto !== "string") return null;
  const aparado = texto.trim();
  return aparado ? aparado.slice(0, limite) : null;
}

/**
 * Telefone e e-mail não se cortam: um número truncado ou um endereço pela
 * metade é lixo com cara de dado, e a dona criaria um contato com ele. Acima
 * do teto o campo fica vazio e a sugestão sobrevive com o resto.
 */
function ouNulo(texto: string | null | undefined, limite: number): string | null {
  const aparado = cortar(texto, Number.MAX_SAFE_INTEGER);
  return aparado && aparado.length <= limite ? aparado : null;
}

/**
 * A sugestão de contato no tamanho que as colunas aceitam. Fica na fronteira
 * com o banco, não na extração: é a coluna que dita o limite, e o modelo não
 * obedece sempre ao maxLength do schema.
 */
export function ajustarSugestaoAosLimites(contato: MeetingExtraction["contacts"][number]) {
  return {
    fullName: cortar(contato.fullName, LIMITE_SUGESTAO.fullName) ?? "",
    jobTitle: cortar(contato.jobTitle, LIMITE_SUGESTAO.jobTitle),
    company: cortar(contato.company, LIMITE_SUGESTAO.company),
    phone: ouNulo(contato.phone, LIMITE_SUGESTAO.phone),
    email: ouNulo(contato.email, LIMITE_SUGESTAO.email),
  };
}

export async function translatePrivateMeetingTranscript(ownerId: string, meetingId: string, language: string) {
  const normalizedLanguage = language === "pt" ? "pt-BR" : language;
  if (!(normalizedLanguage in MEETING_LANGUAGES)) throw new Error("Idioma de tradução não suportado.");
  const targetLanguage = MEETING_LANGUAGES[normalizedLanguage as keyof typeof MEETING_LANGUAGES];
  const db = await exigirDb();
  const [transcript] = await db.select().from(meetingTranscripts)
    .where(and(eq(meetingTranscripts.ownerId, ownerId), eq(meetingTranscripts.meetingId, meetingId))).limit(1);
  if (!transcript) throw new Error("Transcrição não encontrada.");
  if (normalizedLanguage === "pt-BR" || transcript.language === normalizedLanguage) {
    return { language: normalizedLanguage, text: transcript.transcript, cached: true };
  }
  const [cached] = await db.select().from(meetingTranscriptTranslations)
    .where(and(
      eq(meetingTranscriptTranslations.ownerId, ownerId),
      eq(meetingTranscriptTranslations.meetingId, meetingId),
      eq(meetingTranscriptTranslations.language, normalizedLanguage),
    )).limit(1);
  if (cached) return { language: normalizedLanguage, text: cached.translatedText, cached: true };

  const response = await invokeLLM({
    messages: [
      { role: "system", content: `Traduza a transcrição a seguir para ${targetLanguage}. Preserve nomes próprios, empresas, números, telefones, e-mails e a estrutura dos parágrafos. Não resuma, não explique e não adicione informações.` },
      { role: "user", content: transcript.transcript.slice(0, 48_000) },
    ],
  });
  const translatedText = String(response.choices?.[0]?.message?.content ?? "").trim();
  if (!translatedText) throw new Error("Não foi possível traduzir a transcrição.");
  const timestamp = now();
  await db.insert(meetingTranscriptTranslations).values({
    id: crypto.randomUUID(),
    meetingId,
    ownerId,
    language: normalizedLanguage,
    translatedText,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { language: normalizedLanguage, text: translatedText, cached: false };
}

/**
 * Linhas afetadas por um UPDATE/DELETE do driver mysql2 (`[ResultSetHeader,
 * FieldPacket[]]`). Zero quando o resultado não tem essa forma — o que, para
 * quem decide "a linha ainda existia?", é a resposta segura.
 */
function linhasAfetadas(resultado: unknown): number {
  const cabecalho = Array.isArray(resultado) ? resultado[0] : resultado;
  const linhas = (cabecalho as { affectedRows?: unknown } | null | undefined)?.affectedRows;
  return typeof linhas === "number" ? linhas : 0;
}

/**
 * O que vai para `processing_error` — texto que a tela mostra à dona.
 *
 * Erro do driver fica FORA: a mensagem de um DrizzleQueryError é o INSERT
 * inteiro com os parâmetros, ou seja, nome, cargo, telefone e e-mail das
 * pessoas da reunião (ou a transcrição). O errorFormatter do tRPC mascara
 * isso quando viaja como erro; aqui viajava como DADO, por `meetings.get`, e
 * a caixa vermelha renderizava o SQL. O detalhe vai ao log, sem parâmetros.
 * Erros nossos e do Gemini são frases pensadas para a dona ("Arquivo de
 * áudio inválido.", "O áudio deve ter no máximo 10 MB.") e continuam inteiras.
 */
export function mensagemDaFalha(error: unknown): string {
  if (ehErroDoDriverDeBanco(error)) {
    console.error("[Reuniões] falha de banco no processamento:", descreverErroDeBanco(error));
    return MENSAGEM_ERRO_DE_CONSULTA;
  }
  return error instanceof Error ? error.message.slice(0, 1000) : "Falha no processamento";
}

/**
 * O `processing_error` que pode ir para a tela.
 *
 * mensagemDaFalha protege as gravações NOVAS; esta função protege a LEITURA
 * das antigas: antes dela, a mensagem do driver ia inteira para a coluna, e
 * há linhas em produção guardando "Failed query: insert into ... params: ..."
 * com nome, telefone e e-mail das pessoas da reunião. Limpar a coluna no
 * banco depende do Roberto; até lá, quem lê mascara. Só o prefixo do
 * DrizzleQueryError é reconhecido de propósito: as demais mensagens são
 * frases (ou o código ERRO_INTERROMPIDO) escritas para a dona.
 */
export function processingErrorSeguro(processingError: string | null): string | null {
  if (processingError?.startsWith("Failed query")) return MENSAGEM_ERRO_DE_CONSULTA;
  return processingError;
}

/** A dona excluiu a reunião no meio: não é falha a registrar, é trabalho a descartar. */
class ReuniaoExcluidaDuranteProcessamento extends Error {
  constructor() {
    super(MENSAGEM_EXCLUIDA_DURANTE_PROCESSAMENTO);
    this.name = "ReuniaoExcluidaDuranteProcessamento";
  }
}

export async function processMeetingRecording(input: {
  meetingId: string;
  ownerId: string;
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
  language: string;
}) {
  if (input.durationSeconds < 1 || input.durationSeconds > MAX_MEETING_DURATION_SECONDS) {
    throw new Error("No modo atual, cada reunião pode ter no máximo 10 minutos.");
  }
  const db = await exigirDb();
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId))).limit(1);
  if (!meeting) throw new Error("Reunião não encontrada.");
  if (!meeting.consentGranted) throw new Error("O consentimento para gravação é obrigatório.");

  // `status <> 'deleted'`: a falha não ressuscita uma reunião que a dona
  // excluiu enquanto isto rodava — deletePrivateMeeting marca 'deleted' antes
  // de apagar, justamente para este UPDATE (e o de 'ready') não a trazerem
  // de volta como linha viva sem transcrição.
  const marcarFalha = async (error: unknown) => {
    await db.update(meetings).set({
      status: "failed",
      processingError: mensagemDaFalha(error),
      updatedAt: now(),
    }).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId), ne(meetings.status, "deleted")));
  };

  // A reunião foi excluída no meio: o que este processamento gravou (ou ainda
  // gravaria) é órfão — sem FK, ficaria para sempre com a voz e os dados das
  // pessoas que a dona mandou apagar, e a Memória indexaria a transcrição.
  const descartarPorExclusao = async () => {
    await apagarDerivadosDaReuniao(db, input.ownerId, input.meetingId);
    throw new ReuniaoExcluidaDuranteProcessamento();
  };

  // A decodificação também marca a reunião como falha: fora do try, um áudio
  // recusado deixava a reunião recém-criada em "Gravação pendente" para
  // sempre, sem erro registrado e sem como a usuária tentar de novo.
  let audio: Buffer;
  try {
    audio = decodeMeetingAudio(input.audioBase64, input.mimeType);
  } catch (error) {
    await marcarFalha(error);
    throw error;
  }
  const timestamp = now();
  await db.update(meetings).set({ status: "processing", processingError: null, updatedAt: timestamp }).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId)));

  try {
    // Frases neutras para a tela: a mensagem do S3/B2 ou do provedor de IA
    // traz endpoint, bucket, JSON do provedor — nada que ajude a dona. O
    // original fica no log e em `cause`.
    let uploaded: Awaited<ReturnType<typeof storagePut>>;
    try {
      uploaded = await storagePut(
        `meetings/${input.ownerId}/${input.meetingId}/recording.${extensionForMime(input.mimeType)}`,
        audio,
        input.mimeType,
      );
    } catch (erro) {
      console.error("[Reuniões] o bucket recusou o áudio:", erro instanceof Error ? erro.message : erro);
      throw new Error("Não foi possível guardar o áudio.", { cause: erro });
    }
    const recordingId = crypto.randomUUID();
    await db.insert(meetingRecordings).values({
      id: recordingId,
      meetingId: input.meetingId,
      ownerId: input.ownerId,
      storageKey: uploaded.key,
      storageUrl: uploaded.url,
      mimeType: input.mimeType,
      sizeBytes: audio.length,
      durationSeconds: Math.round(input.durationSeconds),
      expiresAt: timestamp + MEETING_AUDIO_TTL_MS,
      createdAt: timestamp,
    });

    // Defesa em profundidade sobre gemini.ts: GeminiIndisponivelError (e as
    // subclasses de cota e de recusa) já carregam frases para a dona e passam
    // inteiras. Qualquer outro erro — chave não configurada (a mensagem cita
    // LLM_API_KEY e GOOGLE_API_KEY), resposta sem transcrição, um erro novo
    // que alguém venha a lançar lá — vira frase neutra, com o original no
    // log e em `cause`.
    let transcription: Awaited<ReturnType<typeof transcribeWithGemini>>;
    try {
      transcription = await transcribeWithGemini({
        audio,
        mimeType: input.mimeType,
        language: input.language,
      });
    } catch (erro) {
      if (erro instanceof GeminiIndisponivelError) throw erro;
      console.error("[Reuniões] a transcrição falhou:", erro instanceof Error ? erro.message : erro);
      throw new Error("Não foi possível transcrever o áudio.", { cause: erro });
    }

    let extraction: MeetingExtraction;
    try {
      extraction = await extractMeetingData(transcription.text);
    } catch (erro) {
      console.error("[Reuniões] a extração falhou:", erro instanceof Error ? erro.message : erro);
      throw new Error("O serviço de IA não conseguiu extrair os dados da transcrição.", { cause: erro });
    }

    // Entre a leitura lá em cima e aqui passaram 1–2 minutos de Gemini e LLM:
    // tempo de sobra para a dona ter clicado em Excluir. A reunião é relida
    // ANTES do bloco de escritas; ausente ou 'deleted', nada é gravado.
    // Só exclusão aborta: 'failed' aqui seria a varredura de interrompidas
    // tendo desistido cedo demais, e o resultado ainda vale.
    const [viva] = await db.select({ status: meetings.status }).from(meetings)
      .where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId))).limit(1);
    if (!viva || viva.status === "deleted") await descartarPorExclusao();

    const completedAt = now();
    await db.insert(meetingTranscripts).values({
      id: crypto.randomUUID(),
      meetingId: input.meetingId,
      ownerId: input.ownerId,
      transcript: transcription.text,
      segments: transcription.segments,
      language: transcription.language,
      durationSeconds: Math.round(input.durationSeconds),
      createdAt: completedAt,
      updatedAt: completedAt,
    });
    if (extraction.entities.length) {
      await db.insert(meetingEntities).values(extraction.entities.map(entity => ({
        id: crypto.randomUUID(), meetingId: input.meetingId, ownerId: input.ownerId,
        entityType: entity.type, value: entity.value, normalizedValue: cortar(entity.normalizedValue, LIMITE_VALOR_NORMALIZADO),
        confidence: Math.max(0, Math.min(1, entity.confidence)).toFixed(3), status: "pending" as const,
        createdAt: completedAt, updatedAt: completedAt,
      })));
    }
    // Sugestão sem nome (o modelo devolve "" ou só espaços apesar do schema)
    // não entra: full_name é NOT NULL e o "" passaria, virando um cartão
    // "Criar contato" sem ninguém para criar. O filtro é DEPOIS do ajuste,
    // que é quem apara os espaços.
    const sugestoes = extraction.contacts
      .map(contact => ({ ...ajustarSugestaoAosLimites(contact), confidence: contact.confidence }))
      .filter(contact => contact.fullName);
    if (sugestoes.length) {
      await db.insert(meetingContactSuggestions).values(sugestoes.map(contact => ({
        id: crypto.randomUUID(), meetingId: input.meetingId, ownerId: input.ownerId,
        fullName: contact.fullName, jobTitle: contact.jobTitle, company: contact.company,
        phone: contact.phone, email: contact.email, sourceEntityIds: [],
        confidence: Math.max(0, Math.min(1, contact.confidence)).toFixed(3), status: "pending" as const,
        createdAt: completedAt, updatedAt: completedAt,
      })));
    }
    // A releitura acima e este UPDATE não são atômicos: a exclusão pode ter
    // entrado entre os dois. O `status <> 'deleted'` faz o banco arbitrar — zero
    // linhas significa que a dona venceu, e o que acabou de ser gravado sai.
    // `processingError: null`: a reunião pode ter chegado aqui já marcada pela
    // varredura de interrompidas (ERRO_INTERROMPIDO) — 'ready' com motivo de
    // falha é contradição que a tela não mostra hoje, mas o dado mentiria.
    const promovida = await db.update(meetings).set({ status: "ready", processingError: null, updatedAt: completedAt })
      .where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId), ne(meetings.status, "deleted")));
    if (!linhasAfetadas(promovida)) await descartarPorExclusao();
    return { transcript: transcription.text, extraction };
  } catch (error) {
    // Excluída no meio não é falha da reunião: não há linha viva para marcar
    // (e o `status <> 'deleted'` de marcarFalha a protegeria de todo modo).
    if (!(error instanceof ReuniaoExcluidaDuranteProcessamento)) await marcarFalha(error);
    throw error;
  }
}

export async function listPrivateMeetings(ownerId: string) {
  const db = await exigirDb();
  const lista = await db.select().from(meetings).where(eq(meetings.ownerId, ownerId)).orderBy(desc(meetings.createdAt));
  return lista.map(meeting => ({ ...meeting, processingError: processingErrorSeguro(meeting.processingError) }));
}

/**
 * Apaga o arquivo de áudio do bucket. Devolve se conseguiu: quem chama decide
 * o que fazer com a falha, e a diferença importa.
 *
 * Na EXCLUSÃO da reunião, falhar não pode travar a operação — a dona mandou
 * apagar, e a reunião some (o objeto órfão vira aviso no log, mesmo padrão de
 * routers/contexts.ts). Já na RETENÇÃO, apagar a linha com o arquivo intacto
 * seria pior que não fazer nada: a linha é o único registro de onde o áudio
 * está, e sem ela o objeto fica no bucket para sempre, invisível.
 */
async function apagarArquivoDaGravacao(storageKey: string): Promise<boolean> {
  try {
    await storageDelete(storageKey);
    return true;
  } catch (erro) {
    console.warn("[Reuniões] o áudio ficou no bucket:", erro instanceof Error ? erro.message : erro);
    return false;
  }
}

/**
 * A gravação que a dona pode ouvir agora — ou nada, quando não existe ou já
 * passou dos 30 dias.
 *
 * O prazo era decorativo: `expiresAt` era gravado e nunca lido, e nada
 * apagava o áudio do bucket, então a tela prometia "expira automaticamente
 * após 30 dias" enquanto o arquivo ficava para sempre. Agora a promessa vira
 * ação no momento em que alguém tenta ouvir: vencida, a gravação é apagada do
 * bucket e do banco, e a tela recebe `expirada` para explicar por quê.
 *
 * Sai só o que a tela precisa — `storageKey` fica no servidor. A `url` é o
 * caminho do proxy autenticado (/manus-storage/...), que confere sessão e
 * posse a cada requisição; não é endereço público do bucket.
 */
async function gravacaoParaOuvir(
  db: Awaited<ReturnType<typeof exigirDb>>,
  ownerId: string,
  meetingId: string,
  criadaEm: number,
) {
  // Sem unicidade por reunião no banco: `orderBy` torna a escolha determinista
  // (a mais recente), em vez de depender da ordem que o MySQL devolver.
  const [gravacao] = await db.select().from(meetingRecordings)
    .where(and(eq(meetingRecordings.meetingId, meetingId), eq(meetingRecordings.ownerId, ownerId)))
    .orderBy(desc(meetingRecordings.createdAt))
    .limit(1);

  // Sem linha: ou nunca houve áudio, ou ele já foi descartado pelo prazo. A
  // data da reunião distingue os dois casos sem guardar nada a mais — e sem
  // isto a tela passaria a dizer "nunca houve áudio" logo depois de explicar
  // que a gravação tinha expirado.
  if (!gravacao) {
    return { recording: null, recordingExpired: criadaEm + MEETING_AUDIO_TTL_MS <= now() };
  }

  if (gravacao.expiresAt <= now()) {
    // A linha só sai se o arquivo saiu. Apagá-la com o objeto intacto deixaria
    // o áudio no bucket para sempre, sem ninguém sabendo que ele existe.
    const apagou = await apagarArquivoDaGravacao(gravacao.storageKey);
    if (apagou) await db.delete(meetingRecordings).where(eq(meetingRecordings.id, gravacao.id));
    return { recording: null, recordingExpired: true };
  }

  return {
    recording: {
      url: gravacao.storageUrl,
      mimeType: gravacao.mimeType,
      durationSeconds: gravacao.durationSeconds,
      sizeBytes: gravacao.sizeBytes,
      expiresAt: gravacao.expiresAt,
    },
    recordingExpired: false,
  };
}

/**
 * A varredura que faz os 30 dias valerem para TODA gravação — não só para as
 * que alguém reabre. Sem ela, o áudio de uma reunião que ninguém visita mais
 * (o caso comum) ficaria no bucket para sempre, e a promessa da tela seria
 * verdadeira apenas por acaso. A voz das outras participantes não depende de
 * a dona voltar na página.
 *
 * Roda pelo endpoint de tarefa agendada, ao lado da limpeza de sessões.
 */
export async function limparGravacoesVencidas(limite = 200) {
  const db = await exigirDb();
  const vencidas = await db.select({ id: meetingRecordings.id, storageKey: meetingRecordings.storageKey })
    .from(meetingRecordings)
    .where(lte(meetingRecordings.expiresAt, now()))
    .limit(limite);

  let apagadas = 0;
  for (const gravacao of vencidas) {
    if (!(await apagarArquivoDaGravacao(gravacao.storageKey))) continue;
    await db.delete(meetingRecordings).where(eq(meetingRecordings.id, gravacao.id));
    apagadas += 1;
  }
  return { encontradas: vencidas.length, apagadas };
}

export async function getPrivateMeeting(ownerId: string, meetingId: string) {
  const db = await exigirDb();
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId))).limit(1);
  if (!meeting) return null;
  const [transcript] = await db.select().from(meetingTranscripts).where(and(eq(meetingTranscripts.meetingId, meetingId), eq(meetingTranscripts.ownerId, ownerId))).limit(1);
  const entities = await db.select().from(meetingEntities).where(and(eq(meetingEntities.meetingId, meetingId), eq(meetingEntities.ownerId, ownerId))).orderBy(desc(meetingEntities.createdAt));
  const suggestions = await db.select().from(meetingContactSuggestions).where(and(eq(meetingContactSuggestions.meetingId, meetingId), eq(meetingContactSuggestions.ownerId, ownerId))).orderBy(desc(meetingContactSuggestions.createdAt));
  const { recording, recordingExpired } = await gravacaoParaOuvir(db, ownerId, meetingId, meeting.createdAt);
  return {
    meeting: { ...meeting, processingError: processingErrorSeguro(meeting.processingError) },
    transcript: transcript ?? null, entities, suggestions, recording, recordingExpired,
  };
}

/**
 * Tudo que uma reunião gera fora da própria linha: sugestões, entidades,
 * transcrição, traduções e gravações (linha E objeto no bucket). Serve à
 * exclusão pela dona e à COMPENSAÇÃO de processMeetingRecording, que usa a
 * mesma lista quando descobre que a reunião foi excluída no meio — duas
 * listas divergiriam na primeira tabela nova.
 *
 * O ÁUDIO sai do bucket, não só a linha do banco: é a voz das pessoas que
 * participaram da reunião, o dado mais sensível daqui. Antes, apagar a
 * reunião deixava o arquivo lá — e sem a linha ninguém sabia que existia.
 * A leitura vem primeiro porque é a linha que diz onde o arquivo está:
 * apagá-la antes tornaria o objeto inalcançável para sempre.
 */
async function apagarDerivadosDaReuniao(db: Awaited<ReturnType<typeof exigirDb>>, ownerId: string, meetingId: string) {
  const gravacoes = await db.select({ id: meetingRecordings.id, storageKey: meetingRecordings.storageKey })
    .from(meetingRecordings)
    .where(and(eq(meetingRecordings.meetingId, meetingId), eq(meetingRecordings.ownerId, ownerId)));
  for (const gravacao of gravacoes) await apagarArquivoDaGravacao(gravacao.storageKey);

  await db.delete(meetingContactSuggestions).where(and(eq(meetingContactSuggestions.meetingId, meetingId), eq(meetingContactSuggestions.ownerId, ownerId)));
  await db.delete(meetingEntities).where(and(eq(meetingEntities.meetingId, meetingId), eq(meetingEntities.ownerId, ownerId)));
  await db.delete(meetingTranscripts).where(and(eq(meetingTranscripts.meetingId, meetingId), eq(meetingTranscripts.ownerId, ownerId)));
  // As TRADUÇÕES são cópias da transcrição em outros idiomas: apagar só o
  // original deixaria o mesmo conteúdo vivo em até nove línguas.
  await db.delete(meetingTranscriptTranslations).where(and(eq(meetingTranscriptTranslations.meetingId, meetingId), eq(meetingTranscriptTranslations.ownerId, ownerId)));
  await db.delete(meetingRecordings).where(and(eq(meetingRecordings.meetingId, meetingId), eq(meetingRecordings.ownerId, ownerId)));
}

export async function deletePrivateMeeting(ownerId: string, meetingId: string) {
  const db = await exigirDb();
  // 'deleted' ANTES de apagar, e não um SELECT de existência: é o sinal que
  // um processMeetingRecording em curso (1–2 min de Gemini e LLM) lê antes de
  // gravar, e que barra o UPDATE final dele para 'ready' — sem isto, a
  // transcrição e os contatos entravam depois da exclusão e ficavam órfãos,
  // com a voz e os dados das pessoas que a dona mandou apagar. Zero linhas:
  // não existe ou não é dela.
  const marcada = await db.update(meetings).set({ status: "deleted", updatedAt: now() })
    .where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId)));
  if (!linhasAfetadas(marcada)) return false;
  await apagarDerivadosDaReuniao(db, ownerId, meetingId);
  await db.delete(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId)));
  return true;
}

/**
 * Reuniões presas em "processing": o status só era revertido pela própria
 * requisição, e todo merge na main é deploy no Render — SIGTERM no meio do
 * Gemini deixava a reunião "Processando" para sempre, sem erro e sem saída
 * além de excluir e gravar de novo. Roda no boot (o momento em que se sabe
 * que nenhuma requisição anterior sobreviveu) e pelo endpoint de cron.
 *
 * Varredura de SISTEMA, sem owner_id de propósito, como limparGravacoesVencidas:
 * ela não lê nem devolve dado de reunião, só troca o status de linhas que
 * nenhuma requisição viva pode estar tratando. Grava o CÓDIGO
 * ERRO_INTERROMPIDO, que a tela traduz.
 */
export async function marcarReunioesInterrompidas(limiteMs = LIMITE_PROCESSAMENTO_MS, limite = 200) {
  const db = await exigirDb();
  const agora = now();
  const corte = agora - limiteMs;
  const presas = await db.select({ id: meetings.id }).from(meetings)
    .where(and(eq(meetings.status, "processing"), lt(meetings.updatedAt, corte)))
    .limit(limite);
  if (!presas.length) return { encontradas: 0, marcadas: 0 };

  // O predicado se repete no UPDATE: uma reunião que terminou entre o SELECT
  // e aqui (updatedAt novo, status 'ready') não pode ser marcada como falha.
  const resultado = await db.update(meetings).set({
    status: "failed",
    processingError: CODIGO_ERRO_INTERROMPIDO,
    updatedAt: agora,
  }).where(and(
    inArray(meetings.id, presas.map(reuniao => reuniao.id)),
    eq(meetings.status, "processing"),
    lt(meetings.updatedAt, corte),
  ));
  return { encontradas: presas.length, marcadas: linhasAfetadas(resultado) };
}
