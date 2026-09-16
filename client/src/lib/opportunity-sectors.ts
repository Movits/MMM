// A lista de setores de oportunidade virou a fonte ÚNICA do app, em
// shared/setores.ts: cadastro, "Setores de interesse" e "Nova Oportunidade"
// oferecem exatamente o mesmo conjunto (reteste v4, item 7). Este arquivo
// continua existindo só como o nome que Dashboard, Opportunities e
// OpportunityDetail já importam.
//
// O que NÃO mudou: a oportunidade grava a CHAVE (`tecnologia`), nunca o rótulo
// traduzido — é o que o filtro por setor (server/db.ts, eq(opportunities.sector,
// ...)) precisa para achar oportunidade criada em qualquer idioma. Registro
// antigo, gravado com o rótulo, continua voltando como está.
import {
  CHAVES_DE_SETOR,
  rotuloDoSetor,
  type ChaveDeSetor,
  type TradutorDeSetor,
} from "@shared/setores";

export const OPPORTUNITY_SECTOR_KEYS = CHAVES_DE_SETOR;

export type OpportunitySectorKey = ChaveDeSetor;

/** Rótulo traduzido de uma chave de setor; registro antigo (rótulo gravado direto) volta como está. */
export function opportunitySectorLabel(
  t: TradutorDeSetor,
  valor: string | null | undefined,
): string {
  return rotuloDoSetor(t, valor);
}
