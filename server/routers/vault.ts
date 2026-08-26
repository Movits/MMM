import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getUserProfile, upsertUserProfile } from "../db";
import {
  getAuditLogs as getSecurityAuditLogs,
  getFromVault,
  getUserActiveSessions,
  getUserSecurityNotifications,
  markNotificationRead,
  saveToVault,
} from "../security";

// ============================================================
// COFRE DIGITAL (LEGACY — mantido para compatibilidade)
// ============================================================
export const vaultRouter = router({
  getMyVault: protectedProcedure.query(async ({ ctx }) => {
    const vaultData = await getFromVault(ctx.user.id);
    const profile = await getUserProfile(ctx.user.id);
    return { user: ctx.user, vaultData, profile };
  }),

  updateVault: protectedProcedure
    .input(z.object({
      bio: z.string().max(1000).optional(),
      linkedin: z.string().optional(),
      website: z.string().optional(),
      company: z.string().max(200).optional(),
      position: z.string().max(200).optional(),
      country: z.string().max(2).optional(),
      city: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await saveToVault(ctx.user.id, input);
      await upsertUserProfile(ctx.user.id, {
        bio: input.bio,
        linkedinUrl: input.linkedin,
        websiteUrl: input.website,
        city: input.city,
        country: input.country,
      });
      return { success: true };
    }),

  getMySessions: protectedProcedure.query(async ({ ctx }) => {
    return getUserActiveSessions(ctx.user.id);
  }),

  getMyNotifications: protectedProcedure.query(async ({ ctx }) => {
    return getUserSecurityNotifications(ctx.user.id);
  }),

  markNotificationRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markNotificationRead(input.notificationId, ctx.user.id);
      return { success: true };
    }),

  getMyAuditHistory: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      return getSecurityAuditLogs(input.limit, 0, ctx.user.id);
    }),
});
