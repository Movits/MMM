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
      // Lê a janela inteira (50, o teto da procedure) e só depois corta no
      // limite pedido: a linha bloqueada pelo portão fica no banco com a nota
      // velha e alta, e com LIMIT antes do filtro ela ocupava a vaga de um
      // match legítimo, que sumia da tela (revisão adversarial de 12/09).
      const JANELA = 50;
      const lista = await getMatchesForUser(ctx.user.id, JANELA);
      const ids = lista.map(m => m.matchedUserId).filter((id): id is number => id !== null);
      const comTermo = await usersComConsentimento(ids, "termo_smart_match");
      // Regra da demanda expressa (12/09/2026), também na LEITURA: a linha
      // gravada antes da regra (ou antes de o perfil mudar) não volta à tela
      // como recomendação — serviço casado por presunção some na hora, como
      // o cruzamento some quando o termo é revogado, sem esperar "Reanalisar".
      // Só os ids COM termo chegam ao portão: ele lê o perfil estratégico da
      // outra usuária para decidir, e cruzar o dado de quem revogou é o que a
      // etapa 11 proíbe — quem não tem termo já saiu da lista de qualquer modo.
      const { matchesBloqueadosPelaDemandaExpressa } = await import("../matching");
      const autorizados = ids.filter(id => comTermo.has(id));
      const bloqueados = await matchesBloqueadosPelaDemandaExpressa(ctx.user.id, autorizados);
      return lista
        .filter(m => m.matchedUserId !== null && comTermo.has(m.matchedUserId) && !bloqueados.has(m.matchedUserId))
        .slice(0, input.limit);
    }),

  // Etapa 13 (prontidão): quantos matches EXISTEM mas estão ocultos porque o
  // outro lado ainda não aceitou o termo vigente. É o que separa "nenhum perfil
  // compatível" de "a rede ainda está autorizando" — sem isto, a primeira
  // usuária a aceitar vê o mesmo vazio de quem não tem match nenhum, e a tela
  // atribui a causa errada. Procedure separada de propósito: o formato de
  // `list` é fixado pelo exame de produção e pelos testes do Dashboard.
  //
  // O portão da demanda expressa NÃO entra nesta contagem, de propósito: para
  // saber se um par sem termo estaria bloqueado seria preciso ler o perfil
  // estratégico de quem não autorizou — o cruzamento que a etapa 11 veta. A
  // conta pode incluir um par que o portão esconderia depois do aceite; é o
  // preço de não cruzar dado sem termo.
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
