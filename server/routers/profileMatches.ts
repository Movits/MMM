import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { hasValidConsent, usersComConsentimento } from "./consent";

// ============================================================
// MATCHES DE PERFIS (sistema original MMM)
// ============================================================
export const profileMatchesRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      // Etapa 11 na LEITURA, no caminho que o Dashboard chama de verdade:
      // revogar o termo esconde na hora o que já tinha sido cruzado — dos dois
      // lados. A primeira versão desta trava foi parar numa função que nenhum
      // router usava; a auditoria da etapa 8 flagrou o desvio, e a trava mora
      // agora aqui, colada no procedimento vivo.
      if (!(await hasValidConsent(ctx.user.id, "termo_smart_match"))) return [];
      const { getMatchesForUser } = await import("../db");
      const lista = await getMatchesForUser(ctx.user.id, input.limit);
      const ids = lista.map(m => m.matchedUserId).filter((id): id is number => id !== null);
      const comTermo = await usersComConsentimento(ids, "termo_smart_match");
      return lista.filter(m => m.matchedUserId !== null && comTermo.has(m.matchedUserId));
    }),

  // Etapa 13 (prontidão): quantos matches EXISTEM mas estão ocultos porque o
  // outro lado ainda não aceitou o termo vigente. É o que separa "nenhum perfil
  // compatível" de "a rede ainda está autorizando" — sem isto, a primeira
  // usuária a aceitar vê o mesmo vazio de quem não tem match nenhum, e a tela
  // atribui a causa errada. Procedure separada de propósito: o formato de
  // `list` é fixado pelo exame de produção e pelos testes do Dashboard.
  redeAguardando: protectedProcedure
    .query(async ({ ctx }) => {
      if (!(await hasValidConsent(ctx.user.id, "termo_smart_match"))) return { ocultas: 0 };
      const { getMatchesForUser } = await import("../db");
      const lista = await getMatchesForUser(ctx.user.id, 50);
      const ids = lista.map(m => m.matchedUserId).filter((id): id is number => id !== null);
      if (ids.length === 0) return { ocultas: 0 };
      const comTermo = await usersComConsentimento(ids, "termo_smart_match");
      return { ocultas: ids.filter(id => !comTermo.has(id)).length };
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
