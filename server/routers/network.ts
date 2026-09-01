import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createPrivateContact, listPrivateContacts, getPrivateContactById,
  updatePrivateContact, deletePrivateContact,
} from "../db";
import { recalculatePrivateMatches } from "../match-service";
import { hasValidConsent } from "./consent";

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
      // Etapa 8: o nível é escolha da dona; omitido, a coluna nasce 'privado'.
      nivelVisibilidade: z.enum(["privado", "ouro", "publico"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await createPrivateContact(ctx.user.openId, input);
      return { id };
    }),

  // Etapa 8 — a vitrine coletiva: o que o ecossistema vê de um contato marcado
  // 'publico' é a OPORTUNIDADE, nunca a pessoa. As colunas pessoais nem são
  // selecionadas (privacidade.md), e o filtro roda no banco a cada leitura:
  // voltar o contato para 'privado' o tira daqui na requisição seguinte, sem
  // cache nem rotina de limpeza no meio.
  vitrine: protectedProcedure.query(async () => {
    const { listVitrineColetiva } = await import("../db");
    return listVitrineColetiva();
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
      // Etapa 8: o nível muda a qualquer momento, e o efeito é imediato — a
      // vitrine filtra na leitura, então 'privado' some na requisição seguinte.
      nivelVisibilidade: z.enum(["privado", "ouro", "publico"]).optional(),
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
      // O cruzamento roda sozinho também na saída de dados, não só na entrada:
      // apagar contato muda o mapa de possui/procura, e as sugestões precisam
      // refletir isso sem ninguém clicar em atualizar. Melhor esforço e sem
      // e-mail — exclusão não é notícia de oportunidade nova.
      try {
        if (await hasValidConsent(ctx.user.id, "termo_smart_match")) {
          await recalculatePrivateMatches(ctx.user.openId);
        }
      } catch (erro) {
        console.warn("[Rede] recálculo adiado após exclusão:", erro instanceof Error ? erro.message : erro);
      }
      return { success: true };
    }),
});
