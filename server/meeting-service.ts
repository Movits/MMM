import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  meetingContactSuggestions,
  meetingEntities,
  meetingRecordings,
  meetings,
  meetingTranscripts,
  meetingTranscriptTranslations,
} from "../drizzle/schema";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";
import { transcribeWithGemini } from "./gemini";

export const MAX_MEETING_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_MEETING_DURATION_SECONDS = 10 * 60;
export const MEETING_AUDIO_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  const normalized = base64.trim().replace(/^data:audio\/[^,]+;base64,/i, "").replace(/\s/g, "");
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
                  normalizedValue: { type: ["string", "null"] },
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
                properties: {
                  fullName: { type: "string" },
                  jobTitle: { type: ["string", "null"] },
                  company: { type: ["string", "null"] },
                  phone: { type: ["string", "null"] },
                  email: { type: ["string", "null"] },
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

export async function translatePrivateMeetingTranscript(ownerId: string, meetingId: string, language: string) {
  const normalizedLanguage = language === "pt" ? "pt-BR" : language;
  if (!(normalizedLanguage in MEETING_LANGUAGES)) throw new Error("Idioma de tradução não suportado.");
  const targetLanguage = MEETING_LANGUAGES[normalizedLanguage as keyof typeof MEETING_LANGUAGES];
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
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
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId))).limit(1);
  if (!meeting) throw new Error("Reunião não encontrada.");
  if (!meeting.consentGranted) throw new Error("O consentimento para gravação é obrigatório.");

  const audio = decodeMeetingAudio(input.audioBase64, input.mimeType);
  const timestamp = now();
  await db.update(meetings).set({ status: "processing", processingError: null, updatedAt: timestamp }).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId)));

  try {
    const uploaded = await storagePut(
      `meetings/${input.ownerId}/${input.meetingId}/recording.${extensionForMime(input.mimeType)}`,
      audio,
      input.mimeType,
    );
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

    const transcription = await transcribeWithGemini({
      audio,
      mimeType: input.mimeType,
      language: input.language,
    });

    const extraction = await extractMeetingData(transcription.text);
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
        entityType: entity.type, value: entity.value, normalizedValue: entity.normalizedValue,
        confidence: Math.max(0, Math.min(1, entity.confidence)).toFixed(3), status: "pending" as const,
        createdAt: completedAt, updatedAt: completedAt,
      })));
    }
    if (extraction.contacts.length) {
      await db.insert(meetingContactSuggestions).values(extraction.contacts.map(contact => ({
        id: crypto.randomUUID(), meetingId: input.meetingId, ownerId: input.ownerId,
        fullName: contact.fullName.slice(0, 200), jobTitle: contact.jobTitle, company: contact.company,
        phone: contact.phone, email: contact.email, sourceEntityIds: [],
        confidence: Math.max(0, Math.min(1, contact.confidence)).toFixed(3), status: "pending" as const,
        createdAt: completedAt, updatedAt: completedAt,
      })));
    }
    await db.update(meetings).set({ status: "ready", updatedAt: completedAt }).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId)));
    return { transcript: transcription.text, extraction };
  } catch (error) {
    await db.update(meetings).set({
      status: "failed",
      processingError: error instanceof Error ? error.message.slice(0, 1000) : "Falha no processamento",
      updatedAt: now(),
    }).where(and(eq(meetings.id, input.meetingId), eq(meetings.ownerId, input.ownerId)));
    throw error;
  }
}

export async function listPrivateMeetings(ownerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  return db.select().from(meetings).where(eq(meetings.ownerId, ownerId)).orderBy(desc(meetings.createdAt));
}

export async function getPrivateMeeting(ownerId: string, meetingId: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [meeting] = await db.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId))).limit(1);
  if (!meeting) return null;
  const [transcript] = await db.select().from(meetingTranscripts).where(and(eq(meetingTranscripts.meetingId, meetingId), eq(meetingTranscripts.ownerId, ownerId))).limit(1);
  const entities = await db.select().from(meetingEntities).where(and(eq(meetingEntities.meetingId, meetingId), eq(meetingEntities.ownerId, ownerId))).orderBy(desc(meetingEntities.createdAt));
  const suggestions = await db.select().from(meetingContactSuggestions).where(and(eq(meetingContactSuggestions.meetingId, meetingId), eq(meetingContactSuggestions.ownerId, ownerId))).orderBy(desc(meetingContactSuggestions.createdAt));
  return { meeting, transcript: transcript ?? null, entities, suggestions };
}

export async function deletePrivateMeeting(ownerId: string, meetingId: string) {
  const db = await getDb();
  if (!db) throw new Error("Banco de dados indisponível.");
  const [meeting] = await db.select({ id: meetings.id }).from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId))).limit(1);
  if (!meeting) return false;
  await db.delete(meetingContactSuggestions).where(and(eq(meetingContactSuggestions.meetingId, meetingId), eq(meetingContactSuggestions.ownerId, ownerId)));
  await db.delete(meetingEntities).where(and(eq(meetingEntities.meetingId, meetingId), eq(meetingEntities.ownerId, ownerId)));
  await db.delete(meetingTranscripts).where(and(eq(meetingTranscripts.meetingId, meetingId), eq(meetingTranscripts.ownerId, ownerId)));
  await db.delete(meetingRecordings).where(and(eq(meetingRecordings.meetingId, meetingId), eq(meetingRecordings.ownerId, ownerId)));
  await db.delete(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId)));
  return true;
}
