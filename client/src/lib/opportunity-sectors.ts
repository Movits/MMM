// Setores de oportunidade: a etiqueta é traduzida, mas a CHAVE gravada no
// banco é sempre a mesma, qualquer que seja o idioma da tela — é o que o
// filtro por setor (server/db.ts, eq(opportunities.sector, ...)) precisa para
// achar oportunidades criadas em qualquer idioma. Antes desta correção,
// NewOpportunity.tsx gravava o RÓTULO traduzido (regressão da PR #55: cada
// idioma gravava um texto diferente para o mesmo setor). Registros antigos
// continuam com o rótulo salvo — opportunitySectorLabel devolve esse valor
// como está quando ele não bate com nenhuma chave conhecida.
export const OPPORTUNITY_SECTOR_KEYS = [
  "tecnologia", "saude", "educacao", "financas", "agronegocio", "energia",
  "varejo", "imobiliario", "industria", "servicos", "moda", "alimentacao",
  "turismo", "logistica", "juridico", "commodities", "exportacao",
  "importacao", "infraestrutura", "farmaceutico", "consultoria", "marketing",
  "belezaCosmeticos",
] as const;

export type OpportunitySectorKey = typeof OPPORTUNITY_SECTOR_KEYS[number];

function capitalizada(chave: string): string {
  return chave.charAt(0).toUpperCase() + chave.slice(1);
}

function ehChaveConhecida(valor: string): valor is OpportunitySectorKey {
  return (OPPORTUNITY_SECTOR_KEYS as readonly string[]).includes(valor);
}

/** Rótulo traduzido de uma chave de setor; registro antigo (rótulo gravado direto) volta como está. */
export function opportunitySectorLabel(
  t: (chave: string, opcoes?: { defaultValue: string }) => string,
  valor: string | null | undefined,
): string {
  if (!valor) return "";
  if (!ehChaveConhecida(valor)) return valor;
  return t(`newOpportunity.sector${capitalizada(valor)}`, { defaultValue: valor });
}
