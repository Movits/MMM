import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createPrivateContact, exigirDb } from "../db";
import { meetingContactSuggestions, meetingEntities, meetings } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { createAuditLog } from "../security";
import {
  ALLOWED_MEETING_AUDIO_TYPES,
  deletePrivateMeeting,
  getPrivateMeeting,
  iniciarReprocessamento,
  listPrivateMeetings,
  MAX_MEETING_DURATION_SECONDS,
  processMeetingRecording,
  ReprocessamentoRecusado,
  ReuniaoForaDoEstado,
  ReuniaoTomadaPorOutraExecucao,
  translatePrivateMeetingTranscript,
} from "../meeting-service";

// Reprocessar custa IA (até 10 MB ao Gemini, mais a extração) e roda fora da
// requisição. A tomada no banco já impede dois reprocessamentos da MESMA
// reunião; este teto brando segura quem reprocessa uma reunião atrás da outra,
// ou a mesma que falha de novo, em laço. Em memória, como o do FAQ: basta à
// instância única do Render e zera a cada deploy. Só conta pedido aceito.
const REPROCESSOS_POR_JANELA = 3;
const JANELA_DE_REPROCESSO_MS = 10 * 60_000;
const reprocessosPorDona = new Map<string, number[]>();

/** Só para os testes: o teto é estado de módulo. */
export function esquecerTentativasDeReprocesso() {
  reprocessosPorDona.clear();
}

/** Devolve a vaga de um pedido que não foi aceito. */
function devolverVagaDeReprocesso(openId: string, momento: number) {
  const vagas = reprocessosPorDona.get(openId);
  const posicao = vagas?.indexOf(momento) ?? -1;
  if (vagas && posicao >= 0) vagas.splice(posicao, 1);
}

export const MENSAGEM_REUNIAO_PROCESSANDO = "Esta reunião está sendo processada de novo. Espere terminar para decidir.";

/**
 * Durante um reprocessamento, as sugestões e entidades da tentativa anterior
 * vão ser apagadas e substituídas: decidir sobre elas agora criaria um contato
 * a partir de uma sugestão que some, e a mesma pessoa voltaria como sugestão
 * nova para ser criada de novo.
 */
async function recusarSeReuniaoProcessando(db: Awaited<ReturnType<typeof exigirDb>>, ownerId: string, meetingId: string) {
  const [reuniao] = await db.select({ status: meetings.status }).from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.ownerId, ownerId))).limit(1);
  if (reuniao?.status === "processing") throw new TRPCError({ code: "CONFLICT", message: MENSAGEM_REUNIAO_PROCESSANDO });
}

const createMeetingInput = z.object({
  title: z.string().trim().min(2).max(200),
  contactId: z.number().int().positive().optional().nullable(),
  contextId: z.string().uuid().optional().nullable(),
  language: z.string().min(2).max(12).default("pt"),
  consentGranted: z.literal(true),
});

export const meetingsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listPrivateMeetings(ctx.user.openId)),

  get: protectedProcedure.input(z.object({ meetingId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const data = await getPrivateMeeting(ctx.user.openId, input.meetingId);
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Reunião não encontrada." });
    return data;
  }),

  create: protectedProcedure.input(createMeetingInput).mutation(async ({ ctx, input }) => {
    const db = await exigirDb();
    const timestamp = Date.now();
    const id = crypto.randomUUID();
    await db.insert(meetings).values({
      id,
      ownerId: ctx.user.openId,
      title: input.title,
      contactId: input.contactId ?? null,
      contextId: input.contextId ?? null,
      status: "recording",
      consentGranted: true,
      consentAt: timestamp,
      language: input.language,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { id };
  }),

  submitRecording: protectedProcedure
    .input(z.object({
      meetingId: z.string().uuid(),
      audioBase64: z.string().min(20).max(14_000_000),
      mimeType: z.enum(ALLOWED_MEETING_AUDIO_TYPES),
      durationSeconds: z.number().positive().max(MAX_MEETING_DURATION_SECONDS),
      language: z.string().min(2).max(12).default("pt"),
    }))
    .mutation(async ({ ctx, input }) => {
      let result: Awaited<ReturnType<typeof processMeetingRecording>>;
      try {
        result = await processMeetingRecording({ ...input, ownerId: ctx.user.openId });
      } catch (erro) {
        if (erro instanceof ReuniaoForaDoEstado || erro instanceof ReuniaoTomadaPorOutraExecucao) {
          throw new TRPCError({ code: "CONFLICT", message: erro.message });
        }
        throw erro;
      }
      return { success: true, transcriptLength: result.transcript.length, entities: result.extraction.entities.length, contacts: result.extraction.contacts.length };
    }),

  // Reprocessa uma reunião com falha a partir do áudio que ficou guardado.
  // Devolve assim que a reunião é tomada ('processing'); o resultado aparece em
  // meetings.get e meetings.list. Recusas saem com o código que a tela traduz:
  // NOT_FOUND, CONFLICT (não está com falha, ou alguém chegou antes),
  // PRECONDITION_FAILED (sem áudio guardado utilizável) e TOO_MANY_REQUESTS.
  reprocess: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // A vaga é reservada ANTES do await. Conferir antes e registrar depois
      // deixava uma rajada simultânea (um lote tRPC, várias abas) ler o mapa
      // sem nenhuma vaga ocupada e passar inteira. Pedido não aceito devolve a vaga.
      const agora = Date.now();
      const recentes = (reprocessosPorDona.get(ctx.user.openId) ?? []).filter(momento => agora - momento < JANELA_DE_REPROCESSO_MS);
      if (recentes.length >= REPROCESSOS_POR_JANELA) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas de reprocessar em sequência. Aguarde alguns minutos e tente de novo." });
      }
      if (reprocessosPorDona.size > 5000) reprocessosPorDona.clear();
      recentes.push(agora);
      reprocessosPorDona.set(ctx.user.openId, recentes);
      let trabalho: Promise<void>;
      try {
        ({ trabalho } = await iniciarReprocessamento(ctx.user.openId, input.meetingId));
      } catch (erro) {
        devolverVagaDeReprocesso(ctx.user.openId, agora);
        if (erro instanceof ReprocessamentoRecusado) throw new TRPCError({ code: erro.codigo, message: erro.message });
        throw erro;
      }
      // `trabalho` nunca rejeita: iniciarReprocessamento termina todo erro em log.
      void trabalho;
      await createAuditLog({
        userId: ctx.user.id, action: "MEETING_REPROCESS_REQUESTED", resource: "meetings", resourceId: input.meetingId,
        status: "success", riskLevel: "low",
      });
      return { status: "processing" as const };
    }),

  translateTranscript: protectedProcedure
    .input(z.object({ meetingId: z.string().uuid(), language: z.enum(["pt-BR", "en", "es", "fr", "de", "ar", "zh", "hi", "ja", "ru"]) }))
    .mutation(async ({ ctx, input }) => {
      return translatePrivateMeetingTranscript(ctx.user.openId, input.meetingId, input.language);
    }),

  decideEntity: protectedProcedure
    .input(z.object({ entityId: z.string().uuid(), status: z.enum(["confirmed", "ignored"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();
      const [entidade] = await db.select({ meetingId: meetingEntities.meetingId }).from(meetingEntities)
        .where(and(eq(meetingEntities.id, input.entityId), eq(meetingEntities.ownerId, ctx.user.openId))).limit(1);
      if (!entidade) throw new TRPCError({ code: "NOT_FOUND", message: "Entidade não encontrada." });
      await recusarSeReuniaoProcessando(db, ctx.user.openId, entidade.meetingId);
      const result = await db.update(meetingEntities)
        .set({ status: input.status, updatedAt: Date.now() })
        .where(and(eq(meetingEntities.id, input.entityId), eq(meetingEntities.ownerId, ctx.user.openId)));
      if (!(result as any)[0]?.affectedRows) throw new TRPCError({ code: "NOT_FOUND", message: "Entidade não encontrada." });
      return { success: true };
    }),

  decideContactSuggestion: protectedProcedure
    .input(z.object({
      suggestionId: z.string().uuid(),
      action: z.enum(["create", "link", "ignore"]),
      contactId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();
      const [suggestion] = await db.select().from(meetingContactSuggestions)
        .where(and(eq(meetingContactSuggestions.id, input.suggestionId), eq(meetingContactSuggestions.ownerId, ctx.user.openId))).limit(1);
      if (!suggestion) throw new TRPCError({ code: "NOT_FOUND", message: "Sugestão não encontrada." });
      await recusarSeReuniaoProcessando(db, ctx.user.openId, suggestion.meetingId);

      let status: "created" | "linked" | "ignored" = "ignored";
      let linkedContactId: number | null = null;
      if (input.action === "create") {
        linkedContactId = await createPrivateContact(ctx.user.openId, {
          fullName: suggestion.fullName,
          jobTitle: suggestion.jobTitle,
          company: suggestion.company,
          phone: suggestion.phone,
          email: suggestion.email,
        });
        status = "created";
      } else if (input.action === "link") {
        if (!input.contactId) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um contato para vincular." });
        linkedContactId = input.contactId;
        status = "linked";
      }
      await db.update(meetingContactSuggestions).set({
        status,
        existingContactId: linkedContactId,
        updatedAt: Date.now(),
      }).where(and(eq(meetingContactSuggestions.id, input.suggestionId), eq(meetingContactSuggestions.ownerId, ctx.user.openId)));
      return { success: true, contactId: linkedContactId };
    }),

  delete: protectedProcedure.input(z.object({ meetingId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const deleted = await deletePrivateMeeting(ctx.user.openId, input.meetingId);
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Reunião não encontrada." });
    return { success: true };
  }),
});
