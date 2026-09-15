export const BUSINESS_PERSON_TYPES = ["individual", "legal_entity", "mei", "nonprofit"] as const;
export const BUSINESS_SIZES = ["mei", "micro", "small", "medium", "large"] as const;

export type BusinessPersonType = (typeof BUSINESS_PERSON_TYPES)[number];
export type BusinessSize = (typeof BUSINESS_SIZES)[number];

/**
 * Teto do número de cadastro empresarial já normalizado. Não é regra de formato
 * (o campo deixou de ser só CNPJ, que tinha 14 dígitos com verificador): é o
 * tamanho da coluna `user_profiles.companyCnpj`, folgado para registros de
 * outros países e para o CNPJ alfanumérico.
 */
export const CADASTRO_EMPRESARIAL_MAX = 50;

/** Tipos que têm cadastro empresarial por definição (A7): só a pessoa física fica de fora. */
export function exigeCadastroEmpresarial(personType: string | null | undefined): boolean {
  return personType === "legal_entity" || personType === "mei" || personType === "nonprofit";
}

/** Guarda só letras e números: sem hífen, ponto, barra ou espaço. */
export function normalizarCadastroEmpresarial(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "");
}

/** Na exibição, só os 4 últimos caracteres aparecem. */
export function mascararCadastroEmpresarial(value: string): string {
  const cadastro = normalizarCadastroEmpresarial(value);
  if (cadastro.length <= 4) return cadastro;
  return "*".repeat(cadastro.length - 4) + cadastro.slice(-4);
}
