import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { memoryDocuments } from "../../drizzle/schema";
import { exigirDb } from "../db";
import { indexOwnerMemory, searchAndAnswer } from "../memory-service";
import { protectedProcedure, router } from "../_core/trpc";

const recentSearches = new Map<string, number[]>();
const SEARCH_WINDOW_MS = 10 * 60 * 1000;
const SEARCH_LIMIT = 20;

function enforceSearchLimit(ownerId: string) {
  const timestamp = Date.now();
  const history = (recentSearches.get(ownerId) ?? []).filter(value => value > timestamp - SEARCH_WINDOW_MS);
  if (history.length >= SEARCH_LIMIT) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite de buscas atingido. Tente novamente em alguns minutos." });
  }
  history.push(timestamp);
  recentSearches.set(ownerId, history);
}

export const memoryRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = await exigirDb();
    const documents = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ctx.user.openId));
    return { documents: documents.length, lastIndexedAt: documents.reduce((latest, doc) => Math.max(latest, doc.indexedAt), 0) || null };
  }),

  reindex: protectedProcedure.mutation(async ({ ctx }) => {
    enforceSearchLimit(ctx.user.openId);
    // O clique é a ordem explícita de conferir a base inteira: `forcar` ignora
    // a assinatura lembrada (um duplicado em memory_documents nascido depois
    // dela não a muda, e o botão devolvia "0 removidos" com o duplicado ainda
    // pesquisável) e não se contenta com uma rodada em voo que uma busca
    // começou ANTES da mudança que motivou o clique — espera-a e abre a sua.
    // Antes eram duas chamadas seguidas, que cobriam só o segundo caso.
    return indexOwnerMemory(ctx.user.openId, { forcar: true });
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      enforceSearchLimit(ctx.user.openId);
      return searchAndAnswer(ctx.user.openId, input.query);
    }),
});
