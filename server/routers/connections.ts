import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { goldProcedure } from "./_procedures";
import { exigirDb } from "../db";
import { ehErroDeBancoIndisponivel } from "../banco-indisponivel";
import { exigirTextoSemContato } from "../bloqueio-de-contato";
import { users } from "../../drizzle/schema";

// ============================================================
// CONEXÕES ENTRE USUÁRIOS
// ============================================================
export const connectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { getConnectionsForUser } = await import("../db");
    return getConnectionsForUser(ctx.user.id);
  }),

  send: protectedProcedure
    .input(z.object({
      targetUserId: z.number().int(),
      message: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // A13: o bilhete do pedido de conexão também é texto livre entre partes.
      await exigirTextoSemContato(ctx.user.id, "connections.send", input.message, input.targetUserId);
      const { sendConnectionRequest } = await import("../db");
      const result = await sendConnectionRequest(ctx.user.id, input.targetUserId, input.message);
      if (result.alreadyExists) throw new TRPCError({ code: "CONFLICT", message: "Pedido de conexão já enviado" });
      return { success: true };
    }),

  respond: protectedProcedure
    .input(z.object({
      connectionId: z.number().int(),
      accept: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { respondToConnection } = await import("../db");
      await respondToConnection(input.connectionId, ctx.user.id, input.accept);
      return { success: true };
    }),

  // Mensagens diretas (apenas Ouro)
  getMessages: goldProcedure
    .input(z.object({ recipientId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await exigirDb();
      const { directMessages } = await import("../../drizzle/schema");
      const { or } = await import("drizzle-orm");
      const rows = await db.select().from(directMessages)
        .where(
          or(
            and(eq(directMessages.senderId, ctx.user.id), eq(directMessages.recipientId, input.recipientId)),
            and(eq(directMessages.senderId, input.recipientId), eq(directMessages.recipientId, ctx.user.id))
          )
        )
        .orderBy(directMessages.createdAt)
        .limit(100);
      // Map encryptedContent -> content for frontend compatibility
      return rows.map(r => ({ ...r, content: r.encryptedContent }));
    }),

  sendMessage: goldProcedure
    .input(z.object({
      recipientId: z.number().int(),
      content: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      // A13: mensagem direta é o canal mais óbvio para trocar contato.
      await exigirTextoSemContato(ctx.user.id, "connections.sendMessage", input.content, input.recipientId);
      const db = await exigirDb();
      const { directMessages } = await import("../../drizzle/schema");
      await db.insert(directMessages).values({
        senderId: ctx.user.id,
        recipientId: input.recipientId,
        encryptedContent: input.content, // stored as plaintext for now
      });
      return { success: true };
    }),

  getConversations: goldProcedure.query(async ({ ctx }) => {
    const db = await exigirDb();
    const { directMessages } = await import("../../drizzle/schema");
    const { or, max, count } = await import("drizzle-orm");
    // Buscar todas as pessoas com quem o usuário trocou mensagens
    const sent = await db.selectDistinct({ userId: directMessages.recipientId })
      .from(directMessages).where(eq(directMessages.senderId, ctx.user.id));
    const received = await db.selectDistinct({ userId: directMessages.senderId })
      .from(directMessages).where(eq(directMessages.recipientId, ctx.user.id));
    const allIds = [...sent.map(r => r.userId), ...received.map(r => r.userId)];
    const userIds = allIds.filter((id, i) => id !== null && allIds.indexOf(id) === i) as number[];
    if (userIds.length === 0) return [];
    const otherUsers = await db.select({ id: users.id, name: users.name, role: users.role })
      .from(users).where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
    return otherUsers.map(u => ({ userId: u.id, otherUser: u, lastMessage: null, unread: 0 }));
  }),

  getGroups: goldProcedure.query(async ({ ctx }) => {
    // Retornar grupos estratégicos (tabela strategic_groups se existir).
    // O catch existe para a TABELA AUSENTE não derrubar a tela; a queda real do
    // banco chega pela mesma consulta, como erro de conexão do driver, e essa
    // não pode virar "nenhum grupo": sobe para o middleware traduzir.
    const db = await exigirDb();
    try {
      const { strategicGroups } = await import("../../drizzle/schema");
      return await db.select().from(strategicGroups).limit(50);
    } catch (erro) {
      if (ehErroDeBancoIndisponivel(erro)) throw erro;
      return [];
    }
  }),
});
