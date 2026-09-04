import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { exigirDb } from "../db";
import { exigirTextoSemContato } from "../bloqueio-de-contato";
import { createNotification } from "../db";
import { storagePut } from "../storage";
import { decodeDocumentoBase64, MAX_DOCUMENTO_BASE64_CHARS } from "../documento-base64";

import {
  dealRooms,
  dealRoomMessages,
  dealRoomDocuments,
  opportunities,
  users,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// Helper: verifica se o usuário é Ouro ou superior
const isGoldOrAbove = (role?: string | null) =>
  role === "gold" || role === "president" || role === "admin";

export const dealRoomRouter = router({

  // Demonstrar interesse e abrir Deal Room
  openRoom: protectedProcedure
    .input(z.object({
      opportunityId: z.number().int(),
      message: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // A13: a mensagem de apresentação chega à dona ANTES do NDA — é o canal
      // gêmeo do expressInterest e passa pela mesma porta.
      await exigirTextoSemContato(ctx.user.id, "deal_room.openRoom", input.message, input.opportunityId);
      const db = await exigirDb();

      const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, input.opportunityId)).limit(1);
      if (!opp) throw new TRPCError({ code: "NOT_FOUND", message: "Oportunidade não encontrada" });
      if (opp.publishedBy === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Você não pode demonstrar interesse na sua própria oportunidade" });

      const [existing] = await db.select().from(dealRooms)
        .where(and(
          eq(dealRooms.opportunityId, input.opportunityId),
          eq(dealRooms.interestedId, ctx.user.id)
        )).limit(1);

      if (existing) return { roomId: existing.id, isNew: false };

      const result = await db.insert(dealRooms).values({
        opportunityId: input.opportunityId,
        ownerId: opp.publishedBy,
        interestedId: ctx.user.id,
        status: "awaiting_nda",
        ndaAcceptedByOwner: false,
        ndaAcceptedByInterested: false,
        interestMessage: input.message || null,
      });

      const roomId = Number((result as any)[0].insertId);

      await createNotification({
        userId: opp.publishedBy,
        type: "interest_received",
        title: "💼 Nova solicitação de Deal Room",
        body: `Uma membra demonstrou interesse em "${opp.title}" e aguarda seu aceite do NDA para abrir a sala de negociação.`,
        actionUrl: `/deal-room/${roomId}`,
        isRead: false,
      });

      return { roomId, isNew: true };
    }),

  // Aceitar o NDA digitalmente
  acceptNDA: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();

      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
      if (room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });

      const isOwner = room.ownerId === ctx.user.id;
      const now = new Date();

      if (isOwner) {
        await db.update(dealRooms)
          .set({ ndaAcceptedByOwner: true, ndaAcceptedByOwnerAt: now })
          .where(eq(dealRooms.id, input.roomId));
      } else {
        await db.update(dealRooms)
          .set({ ndaAcceptedByInterested: true, ndaAcceptedByInterestedAt: now })
          .where(eq(dealRooms.id, input.roomId));
      }

      const [updated] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (updated.ndaAcceptedByOwner && updated.ndaAcceptedByInterested) {
        await db.update(dealRooms).set({ status: "active" }).where(eq(dealRooms.id, input.roomId));

        // Mensagem de boas-vindas do sistema (senderId = 0)
        const welcomeMsg = [
          "🎉 **Bem-vindas à Deal Room!**",
          "",
          "Ambas as partes assinaram o NDA (Acordo de Confidencialidade). Esta sala de negociação privada está agora ativa.",
          "",
          "**📋 Regras de conduta desta sala:**",
          "• Mantenha todas as informações compartilhadas em estrita confidencialidade.",
          "• Seja objetiva e respeitosa em todas as comunicações.",
          "• Não compartilhe dados sensíveis fora desta plataforma.",
          "• Documentos enviados aqui são protegidos pelo NDA assinado.",
          "• Em caso de descumprimento, a sala poderá ser encerrada.",
          "",
          "**🔐 Lembrete NDA:** Ao assinar este acordo, ambas as partes se comprometeram a não divulgar, reproduzir ou usar as informações trocadas nesta sala para fins que não sejam a negociação em curso.",
          "",
          "Boa negociação! 🤝",
        ].join("\n");
        await db.insert(dealRoomMessages).values({
          dealRoomId: input.roomId,
          senderId: 0,
          content: welcomeMsg,
          isRead: false,
        });

        const otherUserId = isOwner ? room.interestedId : room.ownerId;
        await createNotification({
          userId: otherUserId,
          type: "new_message",
          title: "🔐 Deal Room ativado!",
          body: "Ambas as partes assinaram o NDA. A sala de negociação privada está aberta.",
          actionUrl: `/deal-room/${input.roomId}`,
          isRead: false,
        });
        await createNotification({
          userId: ctx.user.id,
          type: "new_message",
          title: "🔐 Deal Room ativado!",
          body: "Ambas as partes assinaram o NDA. A sala de negociação privada está aberta.",
          actionUrl: `/deal-room/${input.roomId}`,
          isRead: false,
        });
      } else {
        const otherUserId = isOwner ? room.interestedId : room.ownerId;
        await createNotification({
          userId: otherUserId,
          type: "new_message",
          title: "📝 NDA assinado — aguardando você",
          body: "A outra parte já assinou o Termo de Confidencialidade. Acesse o Deal Room para assinar também.",
          actionUrl: `/deal-room/${input.roomId}`,
          isRead: false,
        });
      }

      return { success: true };
    }),

  // Buscar dados da sala
  getRoom: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await exigirDb();

      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
            // Ouro pode acessar qualquer sala
      if (!isGoldOrAbove(ctx.user.role) && room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      // A13/D3 (Glenda, 31/08): os contatos das partes aparecem somente para
      // o consultor de negócios, JAMAIS entre as partes. O e-mail saía aqui no
      // payload para a contraparte (a tela só mostrava o nome, mas o dado
      // chegava ao navegador) — a coluna nem é mais selecionada.
      const [owner] = await db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.id, room.ownerId)).limit(1);
      const [interested] = await db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.id, room.interestedId)).limit(1);
      const [opp] = await db.select({ id: opportunities.id, title: opportunities.title, type: opportunities.type })
        .from(opportunities).where(eq(opportunities.id, room.opportunityId)).limit(1);

      return { ...room, owner, interested, opportunity: opp };
    }),

  // Listar Deal Rooms da usuária logada
  listRooms: protectedProcedure.query(async ({ ctx }) => {
    const db = await exigirDb();

    const rooms = await db.select().from(dealRooms)
      .where(sql`(${dealRooms.ownerId} = ${ctx.user.id} OR ${dealRooms.interestedId} = ${ctx.user.id})`)
      .orderBy(desc(dealRooms.updatedAt))
      .limit(50);

    const enriched = await Promise.all(rooms.map(async (room) => {
      const [opp] = await db.select({ id: opportunities.id, title: opportunities.title })
        .from(opportunities).where(eq(opportunities.id, room.opportunityId)).limit(1);
      const [other] = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, room.ownerId === ctx.user.id ? room.interestedId : room.ownerId))
        .limit(1);
      return { ...room, opportunityTitle: opp?.title || "Oportunidade", otherPartyName: other?.name || "Membra" };
    }));

    return enriched;
  }),

  // Enviar mensagem no chat
  sendMessage: protectedProcedure
    .input(z.object({
      roomId: z.number().int(),
      content: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();

      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
      // Ouro pode acessar qualquer sala
      if (!isGoldOrAbove(ctx.user.role) && room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (room.status !== "active")
        throw new TRPCError({ code: "BAD_REQUEST", message: "O NDA precisa ser assinado por ambas as partes antes de enviar mensagens." });

      // A13: e-mail/telefone não circulam entre as partes — recusa e registra.
      await exigirTextoSemContato(ctx.user.id, "deal_room.sendMessage", input.content, input.roomId);

      await db.insert(dealRoomMessages).values({
        dealRoomId: input.roomId,
        senderId: ctx.user.id,
        content: input.content,
      });

      const recipientId = room.ownerId === ctx.user.id ? room.interestedId : room.ownerId;
      await createNotification({
        userId: recipientId,
        type: "new_message",
        title: "💬 Nova mensagem no Deal Room",
        body: input.content.substring(0, 100) + (input.content.length > 100 ? "..." : ""),
        actionUrl: `/deal-room/${input.roomId}`,
        isRead: false,
      });

      return { success: true };
    }),

  // Listar mensagens do chat
  getMessages: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await exigirDb();

      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
            // Ouro pode acessar qualquer sala
      if (!isGoldOrAbove(ctx.user.role) && room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return db.select({
        id: dealRoomMessages.id,
        senderId: dealRoomMessages.senderId,
        content: dealRoomMessages.content,
        isRead: dealRoomMessages.isRead,
        createdAt: dealRoomMessages.createdAt,
      }).from(dealRoomMessages)
        .where(eq(dealRoomMessages.dealRoomId, input.roomId))
        .orderBy(dealRoomMessages.createdAt)
        .limit(200);
    }),

  // Upload de documento confidencial
  uploadDocument: protectedProcedure
    .input(z.object({
      roomId: z.number().int(),
      name: z.string().max(300),
      // Cabo do schema; a mensagem amigável de 10 MB sai de decodeDocumentoBase64.
      fileBase64: z.string().min(1).max(MAX_DOCUMENTO_BASE64_CHARS),
      mimeType: z.string().max(100),
      sizeBytes: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();

      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
      if (room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      if (room.status !== "active")
        throw new TRPCError({ code: "BAD_REQUEST", message: "O NDA precisa ser assinado antes de compartilhar documentos." });

      // A13: o NOME do documento também é texto livre que a contraparte lê
      // ("planilha - liga 11 99999 8888.xlsx"). O conteúdo do arquivo não é
      // varrido (fora do alcance); o nome, sim.
      await exigirTextoSemContato(ctx.user.id, "deal_room.uploadDocument", input.name, input.roomId);

      // 10 MB por documento, validado antes de tocar o storage (documento-base64.ts).
      const buffer = decodeDocumentoBase64(input.fileBase64);
      const fileKey = `deal-rooms/${input.roomId}/${Date.now()}-${input.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      await db.insert(dealRoomDocuments).values({
        dealRoomId: input.roomId,
        uploadedBy: ctx.user.id,
        name: input.name,
        fileKey,
        url,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes || buffer.length,
      });

      return { success: true, url };
    }),

    // Listar documentos da sala
  listDocuments: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await exigirDb();
      const [room] = await db.select().from(dealRooms).where(eq(dealRooms.id, input.roomId)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND" });
      // Ouro pode acessar qualquer sala
      if (!isGoldOrAbove(ctx.user.role) && room.ownerId !== ctx.user.id && room.interestedId !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return db.select().from(dealRoomDocuments)
        .where(eq(dealRoomDocuments.dealRoomId, input.roomId))
        .orderBy(desc(dealRoomDocuments.createdAt))
        .limit(100);
    }),

  // Listar TODAS as Deal Rooms — acesso exclusivo para Ouro
  listAllRooms: protectedProcedure.query(async ({ ctx }) => {
    if (!isGoldOrAbove(ctx.user.role))
      throw new TRPCError({ code: "FORBIDDEN", message: "Acesso exclusivo para membras Ouro" });
    const db = await exigirDb();
    const rooms = await db.select().from(dealRooms)
      .orderBy(desc(dealRooms.updatedAt))
      .limit(200);
    const enriched = await Promise.all(rooms.map(async (room) => {
      const [opp] = await db.select({ id: opportunities.id, title: opportunities.title })
        .from(opportunities).where(eq(opportunities.id, room.opportunityId)).limit(1);
      const [owner] = await db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.id, room.ownerId)).limit(1);
      const [interested] = await db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.id, room.interestedId)).limit(1);
      return {
        ...room,
        opportunityTitle: opp?.title || "Oportunidade",
        ownerName: owner?.name || "Membra",
        interestedName: interested?.name || "Membra",
      };
    }));
    return enriched;
  }),
});
