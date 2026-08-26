import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { memoryDocuments } from "../../drizzle/schema";
import { getDb } from "../db";
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
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const documents = await db.select().from(memoryDocuments).where(eq(memoryDocuments.ownerId, ctx.user.openId));
    return { documents: documents.length, lastIndexedAt: documents.reduce((latest, doc) => Math.max(latest, doc.indexedAt), 0) || null };
  }),

  reindex: protectedProcedure.mutation(async ({ ctx }) => {
    enforceSearchLimit(ctx.user.openId);
    return indexOwnerMemory(ctx.user.openId);
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      enforceSearchLimit(ctx.user.openId);
      return searchAndAnswer(ctx.user.openId, input.query);
    }),
});
