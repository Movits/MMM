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
