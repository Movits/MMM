import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createPrivateContact, exigirDb } from "../db";
import { meetingContactSuggestions, meetingEntities, meetings } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  ALLOWED_MEETING_AUDIO_TYPES,
  deletePrivateMeeting,
  getPrivateMeeting,
  listPrivateMeetings,
  MAX_MEETING_DURATION_SECONDS,
  processMeetingRecording,
  translatePrivateMeetingTranscript,
} from "../meeting-service";

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
      const result = await processMeetingRecording({ ...input, ownerId: ctx.user.openId });
      return { success: true, transcriptLength: result.transcript.length, entities: result.extraction.entities.length, contacts: result.extraction.contacts.length };
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
