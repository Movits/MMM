// Chave canônica → rótulo em português, LENDO A FONTE OFICIAL.
//
// Desde a PR #12 (migrar-rotulos-para-chaves) o perfil guarda a chave estável
// ("strategic_partner", "innovation", "engineering") em vez do texto traduzido,
// para que usuárias de idiomas diferentes casem entre si. A chave é boa para
// comparar e péssima para ler: no prompt do insight ela chegava crua e voltava
// citada no texto que a usuária lê.
//
// Este módulo existe para que exista UM lugar com essa correspondência, e para
// que esse lugar seja o mesmo que a tela usa: `client/src/i18n/locales/pt-BR.json`,
// sob `onboarding.*`. Havia mapas escritos à mão em `matching.ts` que já tinham
// divergido do JSON — `strategic_partner` era "Sócia estratégica" aqui e "Sócia
// ou parceira de negócios" lá. Mapa copiado envelhece; leitura da fonte, não.
//
// Só o servidor precisa disto. O client traduz com `t("onboarding.<ns>.<chave>")`
// no idioma da tela; aqui o alvo é sempre o português, porque é a língua do
// prompt e do texto que o LLM devolve.
//
// O import é do JSON, não do i18next: nada de i18n no servidor, e o esbuild
// embute o arquivo no bundle (`pnpm build`).
import ptBR from "../client/src/i18n/locales/pt-BR.json";

/**
 * Os namespaces de `onboarding` que guardam listas de opções canônicas. São os
 * mesmos cinco que a PR #12 migrou de rótulo para chave.
 *
 * `businessInterests` não tem namespace próprio: o onboarding grava nele as
 * CHAVES DE SETOR (`Onboarding.tsx`, o mesmo `SECTORS.map(s => s.key)`), então
 * quem for rotular interesses usa "sectors".
 */
export type NamespaceDeOpcao =
  | "specialties"
  | "seeking"
  | "sectors"
  | "values"
  | "languages";

/** O que entra no prompt quando não há dado nenhum — nunca "null" ou "undefined". */
export const SEM_INFORMACAO = "não informado";

const OPCOES = ((ptBR as { onboarding?: Record<string, unknown> }).onboarding ??
  {}) as Record<string, Record<string, unknown> | undefined>;

/**
 * Rótulo em português de UMA chave canônica.
 *
 * Fallback seguro, em três degraus, porque o banco tem perfis de três épocas:
 *  - chave conhecida  → o rótulo oficial do pt-BR.json;
 *  - chave desconhecida (texto livre como `customSpecialty`, ou dado anterior à
 *    migração que já está em português) → o próprio valor, como veio;
 *  - vazio, nulo ou não-texto → string vazia, que o chamador substitui por
 *    SEM_INFORMACAO. Nunca a palavra "undefined".
 */
export function rotuloEmPortugues(
  namespace: NamespaceDeOpcao,
  valor: unknown,
): string {
  if (typeof valor !== "string") return "";
  const chave = valor.trim();
  if (!chave) return "";
  const rotulo = OPCOES[namespace]?.[chave];
  return typeof rotulo === "string" && rotulo.trim() ? rotulo : chave;
}

/**
 * Rótulos de uma LISTA de chaves (seekingTypes, values, languages,
 * businessInterests, secondarySpecialties).
 *
 * As colunas são JSON e podem chegar como null, undefined, `[]` ou — em linha
 * antiga — como algo que não é lista. Qualquer um desses vira `[]`; item vazio
 * ou não-texto é descartado em vez de virar buraco na frase.
 */
export function rotulosEmPortugues(
  namespace: NamespaceDeOpcao,
  valores: unknown,
): string[] {
  if (!Array.isArray(valores)) return [];
  const rotulos: string[] = [];
  for (const valor of valores) {
    const rotulo = rotuloEmPortugues(namespace, valor);
    // Duas chaves distintas podem cair no mesmo rótulo (sinônimo fundido na
    // PR #12): repetir a palavra no prompt não acrescenta nada.
    if (rotulo && !rotulos.includes(rotulo)) rotulos.push(rotulo);
  }
  return rotulos;
}

/** Uma linha de lista para o prompt: "Inovação, Autonomia" ou SEM_INFORMACAO. */
export function listaParaPrompt(
  namespace: NamespaceDeOpcao,
  valores: unknown,
): string {
  const rotulos = rotulosEmPortugues(namespace, valores);
  return rotulos.length ? rotulos.join(", ") : SEM_INFORMACAO;
}

/** Um valor único para o prompt: o rótulo, ou SEM_INFORMACAO. */
export function valorParaPrompt(
  namespace: NamespaceDeOpcao,
  valor: unknown,
): string {
  return rotuloEmPortugues(namespace, valor) || SEM_INFORMACAO;
}

/**
 * Texto livre (cidade, país) para o prompt: junta o que existe e nunca imprime
 * "null, null". `${profile.city}, ${profile.country}` fazia exatamente isso
 * quando os dois eram nulos.
 */
export function textoParaPrompt(...partes: unknown[]): string {
  const limpas = partes
    .filter((parte): parte is string => typeof parte === "string")
    .map(parte => parte.trim())
    .filter(Boolean);
  return limpas.length ? limpas.join(", ") : SEM_INFORMACAO;
}
