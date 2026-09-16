import {
  avaliarQualificacaoDoPerfil,
  VERSAO_DO_CRITERIO_DE_QUALIFICACAO,
  type PendenciaDoPerfil,
} from "@shared/qualificacao-do-perfil";
import {
  createNotification,
  getUserProfile,
  listarPrataParaReavaliacao,
  promoverBronzeAPrata,
  rebaixarPrataABronze,
} from "./db";
import { createAuditLog } from "./security";
import { ehErroDeBancoIndisponivel } from "./banco-indisponivel";

/**
 * Aplica a régua de `shared/qualificacao-do-perfil.ts` depois que o perfil é
 * gravado (Onboarding concluído e Perfil salvo).
 *
 * Só SOBE, e só de Bronze para Prata:
 *  - Prata, Ouro, presidente e admin nunca são tocados aqui. Ouro é categoria
 *    premium concedida à mão (grantGoldAccess), não degrau desta régua, e um
 *    perfil que piora não rebaixa ninguém automaticamente. A Prata que o
 *    cadastro gravava para todas antes de 14/09 tem passada própria e única
 *    (reavaliarPrataAutomaticaAntiga, abaixo), rodada à mão por script.
 *  - Quem decide é o papel LIDO NO BANCO na hora do UPDATE (WHERE role =
 *    'bronze'), não o `ctx.user` da requisição: se um admin mudou o nível no
 *    meio, a promoção não passa por cima.
 *
 * A mudança de nível deixa auditoria, como toda mudança de papel do projeto
 * (PRESIDENT_GRANT_GOLD, ADMIN_UPDATE_USER_ROLE), e um aviso no sino.
 */
export async function reavaliarNivelPeloPerfil(usuaria: { id: number; role: string }): Promise<{ promovidaAPrata: boolean }> {
  if (usuaria.role !== "bronze") return { promovidaAPrata: false };

  const perfil = await getUserProfile(usuaria.id);
  const { qualificado } = avaliarQualificacaoDoPerfil(perfil);
  if (!qualificado) return { promovidaAPrata: false };

  const promovida = await promoverBronzeAPrata(usuaria.id);
  if (!promovida) return { promovidaAPrata: false };

  await createAuditLog({
    userId: usuaria.id,
    action: "LEVEL_PROMOTED_BY_PROFILE_QUALITY",
    resource: "users",
    resourceId: String(usuaria.id),
    details: { previousRole: "bronze", newRole: "silver", criterio: VERSAO_DO_CRITERIO_DE_QUALIFICACAO },
    status: "success",
    riskLevel: "low",
  });

  try {
    await createNotification({
      userId: usuaria.id,
      type: "system",
      title: "Seu perfil agora é Membro Prata",
      body: "Quem Sou, O Que Tenho e O Que Preciso estão qualificados. Com isso, nossa inteligência identifica conexões mais precisas para você. O nível Prata não tem mensalidade.",
      actionUrl: "/profile",
    });
  } catch (erro) {
    // O aviso não desfaz a promoção, que já foi gravada; banco fora do ar,
    // porém, é erro e sobe (regra do projeto: nunca engolir a queda).
    if (ehErroDeBancoIndisponivel(erro)) throw erro;
    console.warn("[Nível] Promoção gravada, mas o aviso no sino falhou:", erro instanceof Error ? erro.message : erro);
  }

  return { promovidaAPrata: true };
}

/**
 * Ações de auditoria que registram mudança de nível de UMA conta (resource
 * "users", resourceId = a conta). Prata com qualquer uma delas não é a Prata
 * automática do cadastro antigo: veio de decisão de alguém ou da própria régua.
 */
export const ACOES_QUE_MUDAM_NIVEL = [
  "PRESIDENT_GRANT_GOLD",
  "PRESIDENT_REVOKE_GOLD",
  "ADMIN_UPDATE_USER_ROLE",
  "LEVEL_PROMOTED_BY_PROFILE_QUALITY",
] as const;

export type RelatorioDaPrataAntiga = {
  modo: "simular" | "aplicar";
  /** Contas Prata encontradas. */
  avaliadas: number;
  /** Continuam Prata: o nível tem origem registrada (Ouro concedido ou mudança auditada). */
  origemRegistrada: number[];
  /** Continuam Prata: o perfil atende à régua. */
  qualificadas: number[];
  /** Não atendem à régua, com o que falta. No modo aplicar, as que o UPDATE pegou estão em `rebaixadas`. */
  naoQualificadas: Array<{ userId: number; pendencias: PendenciaDoPerfil[] }>;
  /** Só no modo aplicar: rebaixadas a Bronze, com auditoria. */
  rebaixadas: number[];
  /** Só no modo aplicar: o UPDATE condicional não pegou linha (o nível mudou no meio). */
  nivelMudouNoMeio: number[];
};

/**
 * Reavaliação ÚNICA da Prata automática, para a transição da governança de
 * 14/09/2026. Até ali o cadastro gravava 'silver' para todas, e a régua acima
 * só olha Bronze: sem esta passada, conta sem apresentação e sem O que preciso
 * seguiria Prata para sempre, enquanto a conta nova com perfil melhor nasce
 * Bronze.
 *
 * NÃO é rebaixamento automático (a regra de `reavaliarNivelPeloPerfil` segue:
 * perfil que piora não rebaixa ninguém). Roda só pelo script
 * `scripts/reavaliar-prata-antiga.ts`, que por padrão SIMULA; aplicar em
 * produção exige autorização explícita do Roberto (CLAUDE.md).
 *
 * Quem fica Prata sem ser lida: conta com linha em gold_access_grants ou com
 * auditoria de ACOES_QUE_MUDAM_NIVEL (a Prata foi decisão de alguém, ou já
 * passou pela régua). Das outras, quem atende à régua fica; quem não atende,
 * no modo aplicar, vira Bronze por UPDATE condicional a `role = 'silver'`,
 * com auditoria. O perfil é lido imediatamente antes do UPDATE de cada conta.
 * Sem aviso no sino: o texto de um rebaixamento é decisão de produto, e a tela
 * de Perfil já mostra à Bronze o que falta.
 */
export async function reavaliarPrataAutomaticaAntiga(modo: "simular" | "aplicar"): Promise<RelatorioDaPrataAntiga> {
  const relatorio: RelatorioDaPrataAntiga = {
    modo, avaliadas: 0, origemRegistrada: [], qualificadas: [], naoQualificadas: [], rebaixadas: [], nivelMudouNoMeio: [],
  };

  const contas = await listarPrataParaReavaliacao(ACOES_QUE_MUDAM_NIVEL);
  relatorio.avaliadas = contas.length;

  for (const conta of contas) {
    if (conta.origemRegistrada) {
      relatorio.origemRegistrada.push(conta.id);
      continue;
    }

    const { qualificado, pendencias } = avaliarQualificacaoDoPerfil(await getUserProfile(conta.id));
    if (qualificado) {
      relatorio.qualificadas.push(conta.id);
      continue;
    }
    relatorio.naoQualificadas.push({ userId: conta.id, pendencias });
    if (modo !== "aplicar") continue;

    if (!(await rebaixarPrataABronze(conta.id))) {
      relatorio.nivelMudouNoMeio.push(conta.id);
      continue;
    }
    await createAuditLog({
      userId: conta.id,
      action: "LEVEL_DEMOTED_BY_GOVERNANCE_REVIEW",
      resource: "users",
      resourceId: String(conta.id),
      details: {
        previousRole: "silver",
        newRole: "bronze",
        criterio: VERSAO_DO_CRITERIO_DE_QUALIFICACAO,
        pendencias,
        motivo: "Prata automática do cadastro anterior à governança de 14/09/2026",
      },
      status: "success",
      riskLevel: "medium",
    });
    relatorio.rebaixadas.push(conta.id);
  }

  return relatorio;
}
