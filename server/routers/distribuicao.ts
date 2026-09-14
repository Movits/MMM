import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router } from "../_core/trpc";
import { presidentProcedure, distribuidorProcedure } from "./_procedures";
import {
  getUserById, listarDistribuidores, definirPoderDeDistribuicao, createNotification,
  listarPedidosEmAnalise, lerPedidoDeMatch, decidirPedidoDeMatch, listarHistoricoDeDistribuicao, idsDeContasAtivas,
} from "../db";
import { createAuditLog } from "../security";
import { registrarRevelacao } from "./connections";
import { mascararContatosEmTexto } from "@shared/contato-em-texto";

// ============================================================
// DISTRIBUIÇÃO DO SMART MATCH
// ============================================================
// O distribuidor é a pessoa real que confere cada pedido de interesse (o clique
// em "Demonstrar Interesse") antes de encaminhá-lo à outra pessoa. O poder mora
// em `users.isDistributor` e acumula com qualquer nível: Ouro, presidente ou
// admin concedem e revogam por aqui (regra "Ouro = Presidente = admin"); a fila
// de análise, por sua vez, exige `distribuidorProcedure` (a flag, não o nível).
//
// Idempotência: conceder a quem já tem, ou revogar de quem não tem, responde
// sucesso sem gravar nada — sem auditoria nem notificação repetidas, nem quando
// duas requisições chegam juntas (o UPDATE só muda a linha no estado de antes).

const TITULO_CONCEDIDO = "Você agora é distribuidor do Smart Match";
const CORPO_CONCEDIDO =
  "Um membro Ouro do MMM concedeu a você o poder de distribuição: a partir de agora, " +
  "os pedidos de interesse do Smart Match passam pela sua análise antes de chegar à outra pessoa. " +
  "A fila de análise fica no Painel Ouro, na aba Distribuição.";
const TITULO_REVOGADO = "Poder de distribuição revogado";

type PerfilCru = Awaited<ReturnType<typeof listarPedidosEmAnalise>>[number]["solicitante"];

// O que o distribuidor vê de cada parte. Sem id, e-mail, telefone, cofre, foto
// ou links: o que a consulta não seleciona não precisa ser escondido aqui; a bio
// é texto livre da pessoa e sai mascarada contra telefone e e-mail (A13).
function perfilParaAnalise(perfil: PerfilCru) {
  return { ...perfil, bio: perfil.bio ? mascararContatosEmTexto(perfil.bio) : null };
}

export const distribuicaoRouter = router({
  // ─── O poder (Ouro, presidente ou admin) ───────────────────────────────────
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

      const mudou = await definirPoderDeDistribuicao(input.userId, true);
      if (!mudou) return { success: true as const }; // outra requisição concedeu antes
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

      const mudou = await definirPoderDeDistribuicao(input.userId, false);
      if (!mudou) return { success: true as const }; // outra requisição revogou antes
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

  // ─── A fila (só quem tem o poder) ──────────────────────────────────────────
  // Os pedidos `in_review`, com as DUAS partes nomeadas, a nota do Smart Match na
  // direção do pedido e as travas que a aprovação vai reconferir (termo, conta
  // ativa, portão da demanda expressa). É a leitura nominal que atravessa donas,
  // como o acervo Ouro, e por isso fica na trilha de auditoria. Os pedidos em que
  // quem consulta é parte não vêm (listarPedidosEmAnalise).
  fila: distribuidorProcedure.query(async ({ ctx }) => {
    const pedidos = await listarPedidosEmAnalise(ctx.user.id);
    const ids = Array.from(new Set(pedidos.flatMap(p => [p.requesterId, p.recipientId])));
    const { usersComConsentimento } = await import("./consent");
    const { matchesBloqueadosPelaDemandaExpressa } = await import("../matching");
    const comTermo = await usersComConsentimento(ids, "termo_smart_match");
    const bloqueados = await Promise.all(pedidos.map(async p =>
      (await matchesBloqueadosPelaDemandaExpressa(p.requesterId, [p.recipientId])).has(p.recipientId),
    ));
    await createAuditLog({
      userId: ctx.user.id, action: "DISTRIBUTOR_VIEW_QUEUE", resource: "connections",
      details: { pedidos: pedidos.length }, status: "success", riskLevel: "medium",
    });
    // Os ids das partes serviram às travas acima e PARAM aqui: a fila age pelo
    // `connectionId`. Lista-branca explícita, como em profileMatches.
    return pedidos.map((p, i) => ({
      connectionId: p.connectionId,
      createdAt: p.createdAt,
      reciprocado: p.reciprocatedAt !== null,
      solicitante: perfilParaAnalise(p.solicitante),
      destinataria: perfilParaAnalise(p.destinataria),
      compatibilidade: p.compatibilidade && p.compatibilidade.overallScore !== null ? p.compatibilidade : null,
      bloqueadoPeloPortao: bloqueados[i],
      termoOk: { solicitante: comTermo.has(p.requesterId), destinataria: comTermo.has(p.recipientId) },
      ativas: { solicitante: p.solicitante.isActive === true, destinataria: p.destinataria.isActive === true },
    }));
  }),

  // A decisão. O desfecho sai do BANCO no instante da escrita (decidirPedidoDeMatch):
  // a segunda pessoa (ou a segunda aba) que decide o mesmo pedido não produz efeito
  // nenhum — leva "não encontrado ou já decidido" se leu depois da primeira decisão,
  // ou CONFLICT se as duas leram antes —, e o clique recíproco que chega durante a
  // decisão vira `accepted`. Aprovar reconfere as travas ANTES do UPDATE: o termo
  // pode ter sido revogado e o perfil pode ter mudado desde o clique.
  decidir: distribuidorProcedure
    .input(z.object({
      connectionId: z.number().int(),
      aprovar: z.boolean(),
      nota: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // A nota é conferida ANTES de ler o banco: é validação da entrada, e a
      // resposta a um pedido sem nota não pode mudar conforme o id exista, seja de
      // quem decide ou já tenha sido decidido.
      const nota = input.nota?.trim() || null;
      if (!input.aprovar && !nota) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Diga por que não encaminhou. A nota fica só na trilha interna." });
      }

      const pedido = await lerPedidoDeMatch(input.connectionId, ctx.user.id);
      if (!pedido) {
        // Id inexistente, pedido em que quem decide é PARTE e pedido que já saiu da
        // análise recebem a MESMA resposta (a leitura só acha `in_review` de
        // terceiros). Os ids de `connections` são sequenciais e aparecem na fila, no
        // histórico e no cartão: se "já decidido" tivesse código próprio, a
        // destinatária distribuidora acharia pelos buracos da sequência o pedido
        // oculto para ela. A tentativa fica na trilha, igual nos três casos (a conta
        // Ouro lê a auditoria no painel), como a alça inválida de connections.send.
        await createAuditLog({
          userId: ctx.user.id, action: "MATCH_HANDLE_INVALID", resource: "distribuicao.decidir",
          resourceId: String(input.connectionId), status: "blocked", riskLevel: "high",
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado ou já decidido." });
      }

      if (input.aprovar) {
        const partes = [pedido.requesterId, pedido.recipientId];
        const { usersComConsentimento } = await import("./consent");
        const comTermo = await usersComConsentimento(partes, "termo_smart_match");
        if (comTermo.size !== 2) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Uma das partes não tem o termo do Smart Match vigente." });
        }
        const ativas = await idsDeContasAtivas(partes);
        if (ativas.size !== 2) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Uma das contas está inativa." });
        const { matchesBloqueadosPelaDemandaExpressa } = await import("../matching");
        const bloqueados = await matchesBloqueadosPelaDemandaExpressa(pedido.requesterId, [pedido.recipientId]);
        if (bloqueados.has(pedido.recipientId)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "O portão da demanda expressa bloqueia este par: o serviço oferecido não responde a uma necessidade declarada.",
          });
        }
      }

      const decisao = await decidirPedidoDeMatch(pedido.id, { aprovar: input.aprovar, moderatedBy: ctx.user.id, moderationNote: nota });
      // Corrida: outra distribuidora decidiu entre a leitura e o UPDATE. Só chega
      // aqui quem NÃO é parte (a leitura recortou pelas partes, que nunca mudam), e
      // o pedido estava na fila dela: este CONFLICT não denuncia pedido oculto.
      if (!decisao) throw new TRPCError({ code: "CONFLICT", message: "Outra pessoa acabou de decidir este pedido." });
      const { status: statusFinal, reciprocado } = decisao;

      await createAuditLog({
        userId: ctx.user.id,
        action: input.aprovar ? "MATCH_REVIEW_APPROVED" : "MATCH_REVIEW_REJECTED",
        resource: "connections", resourceId: String(pedido.id),
        details: { requesterId: pedido.requesterId, recipientId: pedido.recipientId, reciprocado, statusFinal, nota },
        status: "success", riskLevel: "medium",
      });
      if (statusFinal === "accepted") {
        await registrarRevelacao(pedido.id, pedido.requesterId, pedido.recipientId, "distribuidor");
      }

      // Avisos no sino. Recusa: quem pediu (e a destinatária, só se ela também
      // clicou), sempre sem o motivo — a nota é interna. A destinatária que não
      // clicou nunca soube do pedido e continua sem saber.
      try {
        if (statusFinal === "pending") {
          await createNotification({
            userId: pedido.recipientId, type: "interest_received",
            title: "Alguém demonstrou interesse em você",
            body: "Um membro da rede demonstrou interesse no seu perfil pelo Smart Match. Veja o pedido e decida se aceita revelar os nomes.",
            actionUrl: "/dashboard",
          });
          await createNotification({
            userId: pedido.requesterId, type: "system",
            title: "Seu interesse foi encaminhado",
            body: "O distribuidor conferiu a compatibilidade e encaminhou o seu pedido. Seu nome só aparece se a outra pessoa também demonstrar interesse.",
            actionUrl: "/dashboard",
          });
        } else if (statusFinal === "accepted") {
          for (const userId of [pedido.requesterId, pedido.recipientId]) {
            await createNotification({
              userId, type: "interest_received",
              title: "Interesse mútuo: nomes revelados",
              body: "As duas pessoas demonstraram interesse e o distribuidor encaminhou o match. Os nomes já aparecem na aba Conexões.",
              actionUrl: "/dashboard",
            });
          }
        } else if (reciprocado) {
          for (const userId of [pedido.requesterId, pedido.recipientId]) {
            await createNotification({
              userId, type: "system",
              title: "Interesse não encaminhado",
              body: "O distribuidor conferiu o interesse demonstrado pelas duas partes e não o encaminhou desta vez.",
              actionUrl: "/dashboard",
            });
          }
        } else {
          await createNotification({
            userId: pedido.requesterId, type: "system",
            title: "Interesse não encaminhado",
            body: "O distribuidor conferiu o seu pedido de interesse e não o encaminhou desta vez. A outra pessoa não foi avisada.",
            actionUrl: "/dashboard",
          });
        }
      } catch (_) { /* a decisão já está gravada; o sino é acessório */ }

      return { success: true as const, statusFinal, reciprocado };
    }),

  // As decisões já tomadas (de qualquer distribuidor), com os nomes das partes:
  // leitura nominal, auditada como a fila, e sem os pedidos em que quem consulta
  // é parte.
  historico: distribuidorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      const decisoes = await listarHistoricoDeDistribuicao(ctx.user.id, input.limit);
      await createAuditLog({
        userId: ctx.user.id, action: "DISTRIBUTOR_VIEW_QUEUE", resource: "connections",
        details: { escopo: "historico", decisoes: decisoes.length }, status: "success", riskLevel: "medium",
      });
      return decisoes;
    }),
});
