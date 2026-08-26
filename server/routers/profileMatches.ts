import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

// ============================================================
// MATCHES DE PERFIS (sistema original MMM)
// ============================================================
export const profileMatchesRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const { getMatchesForUser } = await import("../db");
      return getMatchesForUser(ctx.user.id, input.limit);
    }),

  dismiss: protectedProcedure
    .input(z.object({ matchId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const { dismissMatch } = await import("../db");
      await dismissMatch(ctx.user.id, input.matchId);
      return { success: true };
    }),

  regenerate: protectedProcedure.mutation(async ({ ctx }) => {
    const { regenerateMatches } = await import("../db");
    const count = await regenerateMatches(ctx.user.id);
    return { count };
  }),
});
