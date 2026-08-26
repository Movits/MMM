import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  listContextTypes, listContexts, createContext, getContextById,
  updateContext, deleteContext, linkContactToContext, unlinkContactFromContext,
  addContextParticipant,
} from "../db";

// ─── Extensão: Módulo de Contextos (Onde e Como Conheceu) ─────────────────────
export const contextsRouter = router({
  // Listar tipos de contexto (catálogo fixo)
  listTypes: protectedProcedure.query(async () => {
    return listContextTypes();
  }),

  // Listar contextos da usuária
  list: protectedProcedure
    .input(z.object({
      q:        z.string().optional(),
      typeSlug: z.string().optional(),
      year:     z.number().int().optional(),
      country:  z.string().optional(),
      page:     z.number().int().min(1).default(1),
      limit:    z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      return listContexts(ctx.user.openId, input);
    }),

  // Criar contexto personalizado
  create: protectedProcedure
    .input(z.object({
      name:          z.string().min(1).max(100),
      contextTypeId: z.string().optional().nullable(),
      eventDate:     z.string().optional().nullable(),
      city:          z.string().max(100).optional().nullable(),
      country:       z.string().max(100).optional().nullable(),
      notes:         z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createContext(ctx.user.openId, {
        name: input.name,
        contextTypeId: input.contextTypeId ?? null,
        eventDate: input.eventDate ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        notes: input.notes ?? null,
        visibility: "private",
      });
      return { id };
    }),

  // Detalhar contexto
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const ctx2 = await getContextById(ctx.user.openId, input.id);
      if (!ctx2) throw new Error("NOT_FOUND");
      return ctx2;
    }),

  // Atualizar contexto
  update: protectedProcedure
    .input(z.object({
      id:            z.string(),
      name:          z.string().min(1).max(100).optional(),
      contextTypeId: z.string().optional().nullable(),
      eventDate:     z.string().optional().nullable(),
      city:          z.string().max(100).optional().nullable(),
      country:       z.string().max(100).optional().nullable(),
      notes:         z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const ok = await updateContext(ctx.user.openId, id, data);
      if (!ok) throw new Error("NOT_FOUND");
      return { success: true };
    }),

  // Excluir contexto
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await deleteContext(ctx.user.openId, input.id);
      if (!ok) throw new Error("NOT_FOUND");
      return { success: true };
    }),

  // Vincular contato ao contexto
  linkContact: protectedProcedure
    .input(z.object({
      contextId:        z.string(),
      contactId:        z.number().int(),
      eventDate:        z.string().optional().nullable(),
      city:             z.string().optional().nullable(),
      country:          z.string().optional().nullable(),
      notes:            z.string().max(1000).optional().nullable(),
      relationshipType: z.enum(["pessoal", "profissional", "ambos"]).default("profissional"),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await linkContactToContext(ctx.user.openId, {
        contactId: input.contactId,
        contextId: input.contextId,
        eventDate: input.eventDate ?? undefined,
        city: input.city ?? undefined,
        country: input.country ?? undefined,
        notes: input.notes ?? undefined,
        relationshipType: input.relationshipType,
      });
      return { id };
    }),

  // Desvincular contato do contexto
  unlinkContact: protectedProcedure
    .input(z.object({ linkId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await unlinkContactFromContext(ctx.user.openId, input.linkId);
      if (!ok) throw new Error("NOT_FOUND");
      return { success: true };
    }),

  // Adicionar participante avulso
  addParticipant: protectedProcedure
    .input(z.object({
      contextId: z.string(),
      name:      z.string().min(1).max(200),
      company:   z.string().max(200).optional().nullable(),
      role:      z.string().max(200).optional().nullable(),
      notes:     z.string().max(500).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await addContextParticipant(ctx.user.openId, {
        contextId: input.contextId,
        name: input.name,
        company: input.company ?? undefined,
        role: input.role ?? undefined,
        notes: input.notes ?? undefined,
      });
      return { id };
    }),
});
