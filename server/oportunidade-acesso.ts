import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";
import { opportunities } from "../drizzle/schema";

/**
 * A régua de leitura de UMA oportunidade, num lugar só.
 *
 * Ela nasceu inline em `opportunities.get` e ficou só lá. Enquanto isso,
 * `toggleSave` gravava o favorito sem olhar a oportunidade, e `saved`
 * devolvia a linha inteira pelo JOIN — o terceiro caminho de consulta
 * (o segundo, getRecommendedOpportunities, já tinha sido fechado). Uma Prata
 * que enumerasse ids salvava a confidencial e lia título e descrição na aba
 * "Salvas", com a porta da frente (`get`) fechada com "Requer Status Ouro".
 *
 * A função é pura de propósito: recebe a linha e quem pede, e lança o mesmo
 * erro que `get` sempre lançou. Quem precisa dos papéis (Ouro? dona?) para
 * decidir o resto — documentos confidenciais, contagem de visualizações —
 * recebe-os no retorno, em vez de recalcular.
 */

export type OportunidadeParaLeitura = {
  status: string;
  isConfidential: boolean;
  publishedBy: number;
};

export type LeitoraDaOportunidade = {
  id: number;
  role: string;
};

/** Ouro = Presidente = administradora (regra da cliente, confirmada em 02/09). */
export function podeVerConfidencial(role: string) {
  return role === "gold" || role === "admin" || role === "president";
}

export function exigirLeituraDaOportunidade(opp: OportunidadeParaLeitura, user: LeitoraDaOportunidade) {
  const isGold = podeVerConfidencial(user.role);
  const isOwner = opp.publishedBy === user.id;
  const isStaff = user.role === "admin" || user.role === "president";

  // Rejeitada: para quem não é a criadora nem staff, ela não existe — NOT_FOUND
  // e não FORBIDDEN, para não confirmar que o id é de algo real.
  if (opp.status === "rejected" && !isOwner && !isStaff) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  // Pendente: só a criadora e o staff acompanham a fila de validação.
  if (opp.status === "pending" && !isOwner && !isStaff) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta oportunidade ainda está aguardando validação pelas Presidentes." });
  }

  // Confidencial: só Ouro, admin, president ou a criadora.
  if (opp.isConfidential && !isGold && !isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Esta oportunidade é de acesso restrito. Requer Status Ouro — reconhecimento institucional concedido pelas Presidentes." });
  }

  return { isGold, isOwner, isStaff };
}

/**
 * Quais STATUS aparecem nas listas (a lista geral e a aba "Salvas"): as ativas
 * e as pendentes que a própria usuária publicou — ela acompanha a sua fila de
 * validação. Draft, closed, removed e rejected ficam de fora.
 *
 * O predicado existe em duas formas, lado a lado de propósito: a de SQL vai
 * no WHERE (privacidade é regra de consulta) e a pura decide, na hora de
 * GRAVAR o favorito, se vale a pena salvar. A revisão pegou as duas réguas
 * divergindo: `toggleSave` deixava salvar a própria pendente e `saved` só
 * listava `active` — o coração não acendia, a aba não mostrava, e o clique
 * seguinte APAGAVA o favorito. Quem mudar uma forma muda a outra (o teste
 * etapa8-salvas-confidencial fixa as duas).
 */
export function apareceNasListas(opp: { status: string; publishedBy: number }, viewerUserId: number) {
  return opp.status === "active" || (opp.status === "pending" && opp.publishedBy === viewerUserId);
}

export function condicaoDeStatusNasListas(viewerUserId: number) {
  return or(
    eq(opportunities.status, "active"),
    and(eq(opportunities.status, "pending"), eq(opportunities.publishedBy, viewerUserId)),
  )!;
}

/**
 * A régua para GRAVAR um favorito: tudo o que `get` exige (rejeitada,
 * pendente de terceira, confidencial) e, por cima, só o que `saved` vai
 * mostrar depois — senão o favorito nasce invisível. Desfazer um favorito
 * NÃO passa por aqui: a linha antiga (gravada antes da guarda, ou de uma Ouro
 * rebaixada) precisa poder sair, ou fica órfã para sempre.
 */
export function exigirSalvarOportunidade(opp: OportunidadeParaLeitura, user: LeitoraDaOportunidade) {
  const papeis = exigirLeituraDaOportunidade(opp, user);
  if (!apareceNasListas(opp, user.id)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Esta oportunidade não está disponível para salvar." });
  }
  return papeis;
}
