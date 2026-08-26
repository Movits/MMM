import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc";

// ============================================================
// PROCEDURES DE ACESSO
// ============================================================
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "president" && ctx.user.role !== "gold") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a administradoras" });
  }
  return next({ ctx });
});

// Ouro = Presidente: qualquer membra Ouro tem acesso ao painel de governança
export const presidentProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "president" && ctx.user.role !== "gold" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a membras com Status Ouro." });
  }
  return next({ ctx });
});

export const goldProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "gold" && ctx.user.role !== "admin" && ctx.user.role !== "president") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito a membras com Status Ouro." });
  }
  return next({ ctx });
});
