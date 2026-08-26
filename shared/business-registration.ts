export const BUSINESS_PERSON_TYPES = ["individual", "legal_entity", "mei"] as const;
export const BUSINESS_SIZES = ["mei", "micro", "small", "medium", "large"] as const;

export type BusinessPersonType = (typeof BUSINESS_PERSON_TYPES)[number];
export type BusinessSize = (typeof BUSINESS_SIZES)[number];

export function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCnpj(value: string): string {
  const digits = normalizeCnpj(value).slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(cnpj.slice(0, 12) + firstDigit, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj === `${cnpj.slice(0, 12)}${firstDigit}${secondDigit}`;
}

export function maskCnpj(value: string): string {
  const formatted = formatCnpj(value);
  return formatted.length === 18 ? `**.***.***${formatted.slice(10)}` : formatted;
}
