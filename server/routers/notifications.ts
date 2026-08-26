import { protectedProcedure, router } from "../_core/trpc";
import { getNotifications, markNotificationsRead } from "../db";

// ============================================================
// NOTIFICAÇÕES
// ============================================================
export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getNotifications(ctx.user.id, 30);
  }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markNotificationsRead(ctx.user.id);
    return { success: true };
  }),
});
