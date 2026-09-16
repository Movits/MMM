import { TRPCError } from "@trpc/server";
import { getCurrentDocument, hasValidConsent } from "./routers/consent";

/**
 * Termo Geral de Uso, Proteção de Dados e Intermediação Digital (Dr. Ronei,
 * 14/09/2026): "para ser incluído como última etapa do processo cadastramento e
 * criação do usuário".
 *
 * A tela do cadastro só libera o botão final com o termo aceito, mas tela não
 * prova nada: quem chama `profile.completeOnboarding` direto pularia o aceite.
 * Por isso a regra mora aqui, no servidor, e o cadastro não conclui sem ela. E
 * não concluir o cadastro não é atalho: sem `onboardingCompleted`, todo
 * procedimento protegido fora do próprio cadastro recusa a conta
 * (server/cadastro-concluido.ts, aplicado no `protectedProcedure`).
 *
 * Diferença deliberada em relação a `hasValidConsent`: lá, SEM versão publicada
 * a resposta é "libera" (o Smart Match não podia desligar para todo mundo antes
 * de o texto existir). Aqui é o contrário. O termo é condição de adesão
 * (cláusula 3.1: "o cadastro e a utilização da PLATAFORMA pressupõem a leitura
 * e a aceitação integral deste Termo"), então sem texto publicado não há o que
 * aceitar e o cadastro não termina — com uma mensagem que diz exatamente isso.
 *
 * Consequência operacional: nenhuma migração nem o boot grava o termo (a 0013 só
 * abre o valor no enum). Logo depois do deploy que aplica a 0013, é preciso
 * publicá-lo com scripts/publicar-documento.mjs (passo a passo em docs/deploy.md,
 * "Termo Geral de Uso"). Até lá, nenhum cadastro novo conclui, e o
 * checar-producao.mjs sai com FALHA em "Termo Geral de Uso vigente".
 */
export const TIPO_TERMO_GERAL = "termo_geral_de_uso" as const;

export const MENSAGEM_TERMO_GERAL_NAO_PUBLICADO =
  "O Termo Geral de Uso ainda não foi publicado, e o cadastro só pode ser concluído com ele aceito. Avise o suporte.";

export const MENSAGEM_TERMO_GERAL_SEM_ACEITE =
  "Para concluir o cadastro, leia e aceite o Termo Geral de Uso, Proteção de Dados e Intermediação Digital.";

/**
 * A versão vigente que a conta aceitou. Quem conclui o cadastro a grava junto da
 * declaração de maioridade (server/maioridade.ts): é a cláusula 3.4 DESTA versão
 * que a declaração atende.
 */
export type TermoGeralAceito = { id: string; version: number };

export async function exigirAceiteDoTermoGeral(userId: number): Promise<TermoGeralAceito> {
  // Banco fora do ar lança daqui (exigirDb): nunca vira "sem termo".
  const documento = await getCurrentDocument(TIPO_TERMO_GERAL);
  if (!documento) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_TERMO_GERAL_NAO_PUBLICADO });
  }
  if (!(await hasValidConsent(userId, TIPO_TERMO_GERAL))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_TERMO_GERAL_SEM_ACEITE });
  }
  return { id: documento.id, version: documento.version };
}
