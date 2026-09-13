import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { presidentProcedure } from "./_procedures";
import { getUserById, listarDistribuidores, definirPoderDeDistribuicao, createNotification } from "../db";
import { createAuditLog } from "../security";

// ============================================================
// DISTRIBUIÇÃO DO SMART MATCH — quem tem o poder de distribuir
// ============================================================
// O distribuidor é a pessoa real que confere cada pedido de interesse (o clique
// em "Demonstrar Interesse") antes de encaminhá-lo à outra pessoa. O poder mora
// em `users.isDistributor` e acumula com qualquer nível: Ouro, presidente ou
// admin concedem e revogam por aqui (regra "Ouro = Presidente = admin"); a fila
// de análise, por sua vez, exige `distribuidorProcedure` (a flag, não o nível).
//
// Idempotência: conceder a quem já tem, ou revogar de quem não tem, responde
// sucesso sem gravar nada — sem auditoria nem notificação repetidas.

const TITULO_CONCEDIDO = "Você agora é distribuidor do Smart Match";
const CORPO_CONCEDIDO =
  "Um membro Ouro do MMM concedeu a você o poder de distribuição: a partir de agora, " +
  "os pedidos de interesse do Smart Match passam pela sua análise antes de chegar à outra pessoa. " +
  "A fila de análise fica no Painel Ouro, na aba Distribuição.";
const TITULO_REVOGADO = "Poder de distribuição revogado";

export const distribuicaoRouter = router({
  // Quem distribui hoje. Sem paginação: o poder é raro (uma ou poucas contas).
  listar: presidentProcedure.query(async () => listarDistribuidores()),

  conceder: presidentProcedure
    .input(z.object({
      userId: z.number().int(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await getUserById(input.userId);
      if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada." });
      if (alvo.isDistributor === true) return { success: true as const };

      await definirPoderDeDistribuicao(input.userId, true);
      await createAuditLog({
        userId: ctx.user.id, action: "DISTRIBUTOR_GRANTED", resource: "users", resourceId: String(input.userId),
        details: { reason: input.reason ?? null }, status: "success", riskLevel: "high",
      });
      try {
        await createNotification({
          userId: input.userId, type: "system", title: TITULO_CONCEDIDO, body: CORPO_CONCEDIDO, actionUrl: "/president",
        });
      } catch (_) { /* não bloquear se a notificação falhar; a concessão já valeu */ }
      return { success: true as const };
    }),

  revogar: presidentProcedure
    .input(z.object({
      userId: z.number().int(),
      reason: z.string().min(10).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const alvo = await getUserById(input.userId);
      if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada." });
      if (alvo.isDistributor !== true) return { success: true as const };

      await definirPoderDeDistribuicao(input.userId, false);
      await createAuditLog({
        userId: ctx.user.id, action: "DISTRIBUTOR_REVOKED", resource: "users", resourceId: String(input.userId),
        details: { reason: input.reason }, status: "success", riskLevel: "high",
      });
      try {
        await createNotification({
          userId: input.userId, type: "system", title: TITULO_REVOGADO,
          body: `Seu poder de distribuição do Smart Match foi revogado por um membro Ouro do MMM. Motivo: ${input.reason}`,
          actionUrl: "/dashboard",
        });
      } catch (_) { /* não bloquear se a notificação falhar */ }
      return { success: true as const };
    }),
});
