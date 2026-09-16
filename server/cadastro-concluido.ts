import { TRPCError } from "@trpc/server";

/**
 * Cadastro concluído é condição para usar a plataforma, e a regra mora na camada
 * de procedimentos, não na tela.
 *
 * O Termo Geral de Uso (cláusula 3.1: "o cadastro e a utilização da PLATAFORMA
 * pressupõem a leitura e a aceitação integral deste Termo") é exigido por
 * `profile.completeOnboarding` (server/termo-geral-de-uso.ts), que é quem marca
 * `users.onboardingCompleted`. Só que nada olhava esse campo: uma conta recém-
 * criada digitava /dashboard na barra de endereço, ou chamava a API direto, e
 * usava reuniões, rede, oportunidades e conexões sem nunca aceitar o termo; um
 * `profile.update` ainda criava o perfil e a promovia a Prata.
 *
 * Por isso o `protectedProcedure` (server/_core/trpc.ts) passa por
 * `exigirCadastroConcluido` em TODO procedimento protegido, inclusive os de
 * admin, Ouro e distribuidor, que são construídos em cima dele. Só escapa o que o
 * próprio cadastro precisa para chegar ao fim, e o que a conta precisa para sair
 * dele: procedimento novo usado na tela de Onboarding entra nas listas abaixo.
 *
 * O critério é `onboardingCompleted === false`, não `!== true`: a conta real vem
 * inteira de `users` (coluna NOT NULL), e o usuário sintético das tarefas
 * agendadas (`buildCronUser` em _core/sdk.ts) não tem linha nem cadastro.
 */
export const MENSAGEM_CADASTRO_INCOMPLETO =
  "Conclua o cadastro, com o aceite do Termo Geral de Uso, para usar a plataforma.";

/** Áreas inteiras liberadas antes de o cadastro terminar. */
export const AREAS_LIBERADAS = [
  // Sessão (hoje só procedimentos públicos, que nem passam por aqui).
  "auth",
  // Ler e aceitar o Termo Geral de Uso, a última etapa do cadastro.
  "consent",
  // Excluir a própria conta não pode depender de concluir o cadastro.
  "conta",
  // "Gravar áudio" e "Revisar texto" dos campos livres do Onboarding.
  "assistenteTexto",
  "system",
] as const;

/** Procedimentos avulsos liberados (o resto da área continua exigindo). */
export const PROCEDIMENTOS_LIBERADOS: ReadonlySet<string> = new Set<string>([
  // O Onboarding pré-preenche o formulário com o que já existe.
  "profile.get",
  // O próprio fim do cadastro; ele exige o Termo Geral aceito.
  "profile.completeOnboarding",
]);

export function liberadoSemCadastroConcluido(path: string): boolean {
  if (PROCEDIMENTOS_LIBERADOS.has(path)) return true;
  const area = path.split(".")[0];
  return (AREAS_LIBERADAS as readonly string[]).includes(area);
}

export function exigirCadastroConcluido(user: { onboardingCompleted?: boolean | null }, path: string): void {
  if (user.onboardingCompleted !== false) return;
  if (liberadoSemCadastroConcluido(path)) return;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_CADASTRO_INCOMPLETO });
}
