export const ENRICHMENT_STEPS = [
  { fieldType: "phone", question: "Qual é o telefone dele/dela?" },
  { fieldType: "company", question: "Em qual empresa trabalha?" },
  { fieldType: "assets", question: "O que essa pessoa pode oferecer? (ex.: mina, fábrica, patente, acesso)" },
  { fieldType: "needs", question: "O que ela está procurando? (ex.: investidores, parceiros, compradores)" },
  { fieldType: "how_met", question: "Como vocês se conheceram?" },
  { fieldType: "relationship_type", question: "O relacionamento é pessoal, profissional ou ambos?" },
] as const;

export type EnrichmentField = (typeof ENRICHMENT_STEPS)[number]["fieldType"];

export function getEnrichmentStep(index: number) {
  return ENRICHMENT_STEPS[index] ?? null;
}

export function isSkipResponse(value: string) {
  return /^(n[aã]o sei|não tenho|nao tenho|desconheço|desconheco|não informado|nao informado)$/i.test(value.trim());
}

/**
 * Teto do valor confirmado, por campo, igual ao da coluna de destino em
 * drizzle/schema.ts (ver aplicarRespostaAoContato em server/db.ts). Sem isto,
 * um telefone editado com 51 caracteres passava pelo zod e morria no UPDATE de
 * private_contacts.phone varchar(50): a usuária via "Erro ao salvar" e nada
 * dizia o motivo.
 */
export const LIMITE_VALOR_POR_CAMPO: Record<string, number> = {
  phone: 50, whatsapp: 50, email: 254,
  company: 200, job_title: 200, city: 100, country: 100,
  linkedin_url: 512, instagram_handle: 100,
  // contact_assets/contact_needs.tag_label varchar(200); o slug é cortado em 160 pelo slugify.
  assets: 200, asset_tag: 200, needs: 200, need_tag: 200,
};

// how_met, relationship_type (e os apelidos context/notes) vão para colunas
// TEXT; o teto é o mesmo da mensagem digitada (sendMessage: content max 2000).
export const LIMITE_VALOR_PADRAO = 2000;

export function limiteDoValor(fieldType: string) {
  return LIMITE_VALOR_POR_CAMPO[fieldType] ?? LIMITE_VALOR_PADRAO;
}

export function isExpectedField(fieldType: string, expected: EnrichmentField) {
  const aliases: Record<EnrichmentField, string[]> = {
    phone: ["phone", "whatsapp"],
    company: ["company"],
    assets: ["assets", "asset_tag"],
    needs: ["needs", "need_tag"],
    how_met: ["how_met", "context", "notes"],
    relationship_type: ["relationship_type"],
  };
  return aliases[expected].includes(fieldType);
}
