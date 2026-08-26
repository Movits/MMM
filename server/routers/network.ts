import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createPrivateContact, listPrivateContacts, getPrivateContactById,
  updatePrivateContact, deletePrivateContact,
} from "../db";

// ─── Minha Rede de Relacionamentos (Base Particular de Contatos) ──────────────
export const networkRouter = router({
  create: protectedProcedure
    .input(z.object({
      fullName:    z.string().min(1).max(200),
      photoUrl:    z.string().url().optional().nullable(),
      jobTitle:    z.string().max(200).optional().nullable(),
      company:     z.string().max(200).optional().nullable(),
      country:     z.string().max(100).optional().nullable(),
      state:       z.string().max(100).optional().nullable(),
      city:        z.string().max(100).optional().nullable(),
      phone:       z.string().max(50).optional().nullable(),
      whatsapp:    z.string().max(50).optional().nullable(),
      email:       z.string().email().optional().nullable(),
      linkedinUrl: z.string().url().optional().nullable(),
      instagram:   z.string().max(100).optional().nullable(),
      profileTags: z.array(z.string()).optional().nullable(),
      notes:       z.string().max(5000).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createPrivateContact(ctx.user.openId, input);
      return { id };
    }),

  list: protectedProcedure
    .input(z.object({
      q:       z.string().optional(),
      tag:     z.string().optional(),
      country: z.string().optional(),
      page:    z.number().int().min(1).default(1),
      limit:   z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      return listPrivateContacts(ctx.user.openId, input);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const contact = await getPrivateContactById(ctx.user.openId, input.id);
      if (!contact) throw new Error("NOT_FOUND");
      return contact;
    }),

  update: protectedProcedure
    .input(z.object({
      id:          z.number().int(),
      fullName:    z.string().min(1).max(200).optional(),
      photoUrl:    z.string().url().optional().nullable(),
      jobTitle:    z.string().max(200).optional().nullable(),
      company:     z.string().max(200).optional().nullable(),
      country:     z.string().max(100).optional().nullable(),
      state:       z.string().max(100).optional().nullable(),
      city:        z.string().max(100).optional().nullable(),
      phone:       z.string().max(50).optional().nullable(),
      whatsapp:    z.string().max(50).optional().nullable(),
      email:       z.string().email().optional().nullable(),
      linkedinUrl: z.string().url().optional().nullable(),
      instagram:   z.string().max(100).optional().nullable(),
      profileTags: z.array(z.string()).optional().nullable(),
      cardImageUrl: z.string().optional().nullable(),
      notes:       z.string().max(5000).optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updated = await updatePrivateContact(ctx.user.openId, id, data);
      if (!updated) throw new Error("NOT_FOUND");
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await deletePrivateContact(ctx.user.openId, input.id);
      if (!deleted) throw new Error("NOT_FOUND");
      return { success: true };
    }),
});
