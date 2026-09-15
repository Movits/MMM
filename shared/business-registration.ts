export const BUSINESS_PERSON_TYPES = ["individual", "legal_entity", "mei", "nonprofit"] as const;
export const BUSINESS_SIZES = ["mei", "micro", "small", "medium", "large"] as const;

export type BusinessPersonType = (typeof BUSINESS_PERSON_TYPES)[number];
export type BusinessSize = (typeof BUSINESS_SIZES)[number];

/**
 * Teto do número do cadastro empresarial já normalizado, conferido só no
 * servidor. Não é regra de formato: cada país tem seu número empresarial, e o
 * campo não corta o que se digita ou cola. É o tamanho da coluna
 * `user_profiles.companyCnpj`, uma proteção contra abuso; os maiores números
 * reais têm cerca de 20 caracteres.
 */
export const CADASTRO_EMPRESARIAL_MAX = 255;

/** Tipos que têm cadastro empresarial por definição (A7): só a pessoa física fica de fora. */
export function exigeCadastroEmpresarial(personType: string | null | undefined): boolean {
  return personType === "legal_entity" || personType === "mei" || personType === "nonprofit";
}

// Primeiro algarismo (zero) das escritas de teclado dos idiomas do site que o
// NFKC não converte: árabe-índico, persa e devanágari. Os de largura cheia
// (IME japonês e chinês) o NFKC já leva a 0-9.
const ZEROS_DE_OUTRAS_ESCRITAS = [0x0660, 0x06f0, 0x0966];

// Pelo construtor: o tsconfig não aceita a flag `u` em regex literal, e o
// \p{...} só existe com ela. Node 20 e os navegadores atuais suportam.
// \p{Lm} são "letras modificadoras" que se digitam como separador: o "ー" que
// a tecla "-" produz no teclado japonês e o tatweel árabe "ـ".
const FORA_DE_LETRA_OU_ALGARISMO = new RegExp("[^\\p{L}\\p{Nd}]|\\p{Lm}", "gu");

// Sinais que o NFKC transformaria em letras que a pessoa não digitou
// ("№" do teclado russo vira "No", "™" vira "TM", "º" vira "o").
const SINAIS_QUE_VIRAM_LETRA = /[№™℠ªº]/g;

/**
 * Guarda só letras e números: sem hífen, ponto, barra, espaço ou outro
 * separador. Algarismos digitados em outro teclado viram 0-9 em vez de sumir,
 * e letras acentuadas (ex.: o Ñ do RFC mexicano) ficam.
 */
export function normalizarCadastroEmpresarial(value: string): string {
  return value
    .replace(SINAIS_QUE_VIRAM_LETRA, "")
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g, algarismo => {
      const codigo = algarismo.charCodeAt(0);
      const zero = ZEROS_DE_OUTRAS_ESCRITAS.find(z => codigo >= z && codigo <= z + 9) ?? codigo;
      return String(codigo - zero);
    })
    .replace(FORA_DE_LETRA_OU_ALGARISMO, "");
}

/**
 * Na exibição, só os 4 últimos caracteres aparecem, depois de 4 asteriscos
 * fixos: um asterisco por caractere empurraria o final de um número longo para
 * fora do cartão do perfil (que corta com `truncate`), e ainda revelaria o tamanho.
 */
export function mascararCadastroEmpresarial(value: string): string {
  const cadastro = normalizarCadastroEmpresarial(value);
  if (cadastro.length <= 4) return cadastro;
  return "****" + cadastro.slice(-4);
}
