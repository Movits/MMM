import type { UndoSnapshot } from "./db";

/**
 * "Criar o contexto X?" — a oferta explícita do chat de enriquecimento
 * (acompanhamento da revisão da PR #88).
 *
 * Quando a resposta de "como vocês se conheceram" não corresponde a contexto
 * nenhum (acharContextoPeloNome, em server/db.ts), ela fica só na nota do
 * contato. O nome identificado volta para o chat perguntar se a dona quer criar
 * o contexto, e nada é criado sem o sim dela: o que a IA extraiu não entra
 * sozinho. Este módulo decide SE e COM QUAL NOME oferecer, a partir do que já
 * está gravado na sugestão. Fica fora do db.ts para que os testes do router,
 * que substituem o db inteiro, não precisem conhecê-lo.
 */

/** contexts.name é varchar(100). Nome maior não é oferecido: cortar repetiria o defeito da PR #29. */
export const LIMITE_DO_NOME_DE_CONTEXTO = 100;

type SugestaoGravada = {
  fieldType: string;
  status: string;
  appliedValue?: string | null;
  undoSnapshot: unknown;
};

/** O nome a oferecer, ou null quando não há o que oferecer. */
export function contextoParaOferecer(sugestao: SugestaoGravada | null | undefined): string | null {
  if (!sugestao || sugestao.fieldType !== "how_met" || sugestao.status !== "applied") return null;
  const retrato = sugestao.undoSnapshot as UndoSnapshot | null;
  if (!retrato || typeof retrato !== "object" || retrato.kind !== "how_met") return null;
  // Só a resposta que NÃO casou. Com contextoId, o contato já está ligado a um
  // contexto existente — ou esta mesma oferta já foi aceita.
  if (retrato.contextoId !== null) return null;
  const nome = (sugestao.appliedValue ?? "").trim().replace(/\s+/g, " ");
  if (!nome || nome.length > LIMITE_DO_NOME_DE_CONTEXTO) return null;
  return nome;
}
