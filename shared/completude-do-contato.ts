/**
 * Completude de um contato da rede particular — Meu Network Inteligente
 * (pedido do Nicolas, 13/09/2026, itens 6 a 10).
 *
 * QUEM SOU é só identificação: nome ou razão social, telefone e e-mail.
 * O QUE TENHO e O QUE PRECISO são os itens de contact_assets e contact_needs.
 * O contato está completo quando tem os cinco: nome, telefone, e-mail, ao menos
 * um "tenho" e ao menos um "preciso". É a régua do exemplo do pedido, em que
 * "Telefone — FALTANDO" basta para o alerta mesmo com o e-mail presente.
 *
 * WhatsApp conta como telefone: é um número da mesma pessoa, guardado em outra
 * coluna só porque a tela oferece o atalho do wa.me.
 *
 * Função pura, sem coluna nem banco: a mesma regra roda no servidor (contagem
 * do painel) e na tela (alerta no detalhe do contato), e as duas não têm como
 * divergir. Nada aqui preenche, deduz ou sugere valor — só diz o que falta.
 */

export const CAMPOS_DA_COMPLETUDE = ["nome", "telefone", "email", "tenho", "preciso"] as const;

export type CampoDaCompletude = (typeof CAMPOS_DA_COMPLETUDE)[number];

export type DadosParaCompletude = {
  fullName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  /** Quantos itens "O que tenho" (contact_assets) o contato tem. */
  totalTenho: number;
  /** Quantos itens "O que preciso" (contact_needs) o contato tem. */
  totalPreciso: number;
};

// Espaço em branco não é dado: "  " no telefone continua faltando.
function preenchido(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor.trim().length > 0;
}

/** Os campos que faltam, sempre na ordem de CAMPOS_DA_COMPLETUDE. */
export function camposFaltantes(dados: DadosParaCompletude): CampoDaCompletude[] {
  const faltando: CampoDaCompletude[] = [];
  if (!preenchido(dados.fullName)) faltando.push("nome");
  if (!preenchido(dados.phone) && !preenchido(dados.whatsapp)) faltando.push("telefone");
  if (!preenchido(dados.email)) faltando.push("email");
  if (!(dados.totalTenho > 0)) faltando.push("tenho");
  if (!(dados.totalPreciso > 0)) faltando.push("preciso");
  return faltando;
}

export function contatoCompleto(dados: DadosParaCompletude): boolean {
  return camposFaltantes(dados).length === 0;
}
