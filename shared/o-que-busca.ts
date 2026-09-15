/**
 * "O que você busca?" — as 12 opções do cadastro (pedido do Lucas no grupo
 * "Projetos IA", 14/09 20:58), no lugar das 5 antigas (job, team, investor,
 * mentor e strategic_partner).
 *
 * O banco guarda a CHAVE em `user_profiles.seekingTypes` (string[]); o rótulo
 * da tela vem do i18n (`oQueBusca.opcoes.<chave>.titulo/descricao`). Os rótulos
 * em português ficam aqui também porque os prompts do servidor são em
 * português e não passam pelo i18n.
 *
 * "Outra necessidade" exige texto: ele vai para `user_profiles.seekingOtherNeed`
 * e é necessidade DECLARADA pela própria pessoa (vale para a regra "serviço só
 * casa com necessidade declarada").
 *
 * NÃO renomeie chaves: são valor gravado no banco e o motor de conexões as lê.
 */
export const OPCOES_O_QUE_BUSCA = [
  { chave: "expandir_negocio", emoji: "🌎", titulo: "Expandir meu negócio", descricao: "Novos mercados, cidades ou países" },
  { chave: "parceiro_estrategico", emoji: "🤝", titulo: "Parceiro estratégico", descricao: "Sócios, parceiros comerciais ou institucionais" },
  { chave: "investimento_capital", emoji: "💰", titulo: "Investimento / Capital", descricao: "Investidores, fundos ou acesso a capital" },
  { chave: "clientes_compradores", emoji: "📈", titulo: "Clientes / Compradores", descricao: "Quem precisa do que você oferece" },
  { chave: "fornecedores_produtos", emoji: "🏭", titulo: "Fornecedores / Produtos", descricao: "Produtos, insumos, fabricantes ou distribuidores" },
  { chave: "internacionalizacao", emoji: "🌐", titulo: "Internacionalização", descricao: "Entrar ou expandir em outros países" },
  { chave: "conexoes_institucionais", emoji: "🏛️", titulo: "Conexões Institucionais", descricao: "Entidades, associações e ambientes estratégicos" },
  { chave: "tecnologia_solucoes", emoji: "💡", titulo: "Tecnologia / Soluções", descricao: "Tecnologia, inovação ou soluções para o negócio" },
  { chave: "talentos_especialistas", emoji: "👥", titulo: "Talentos / Especialistas", descricao: "Profissionais ou competências específicas" },
  { chave: "servico_especializado", emoji: "🎯", titulo: "Serviço Especializado", descricao: "Jurídico, tributário, regulatório, marketing etc." },
  { chave: "visibilidade_posicionamento", emoji: "📣", titulo: "Visibilidade / Posicionamento", descricao: "Eventos, mídia, marca e conexões estratégicas" },
  { chave: "outra_necessidade", emoji: "✨", titulo: "Outra necessidade", descricao: "Descreva exatamente o que você procura" },
] as const;

export type ChaveOQueBusca = (typeof OPCOES_O_QUE_BUSCA)[number]["chave"];

export const CHAVES_O_QUE_BUSCA = OPCOES_O_QUE_BUSCA.map(opcao => opcao.chave) as readonly ChaveOQueBusca[];

export const CHAVE_OUTRA_NECESSIDADE = "outra_necessidade" as const satisfies ChaveOQueBusca;

/** Teto do texto de "Outra necessidade" (coluna text; o limite é de produto, não do banco). */
export const LIMITE_OUTRA_NECESSIDADE = 500;

/**
 * "Quero também mentorar" continua sendo um botão à parte na mesma etapa: é
 * OFERTA, não busca, e não fazia parte das 5 opções trocadas.
 */
export const CHAVE_QUERO_MENTORAR = "be_mentor" as const;

/**
 * Perfis gravados antes da troca têm as chaves antigas. Não se migra dado:
 * quem exibe traduz na leitura. Três antigas têm equivalente novo; `job` e
 * `mentor` não têm, e seguem com o rótulo antigo (onboarding.seeking.*).
 */
export const BUSCA_LEGADA_EQUIVALENTE: Readonly<Record<string, ChaveOQueBusca>> = {
  investor: "investimento_capital",
  strategic_partner: "parceiro_estrategico",
  team: "talentos_especialistas",
};

export const BUSCAS_LEGADAS_SEM_EQUIVALENTE = ["job", "mentor"] as const;

export function ehChaveOQueBusca(valor: string): valor is ChaveOQueBusca {
  return (CHAVES_O_QUE_BUSCA as readonly string[]).includes(valor);
}

/** A chave nova equivalente, quando houver; senão a própria chave, como veio. */
export function chaveAtualDaBusca(valor: string): string {
  return BUSCA_LEGADA_EQUIVALENTE[valor] ?? valor;
}

/** Opção (com emoji e rótulos pt-BR) da chave nova ou da antiga que tem equivalente; null para o resto. */
export function opcaoDaBusca(valor: string) {
  const chave = chaveAtualDaBusca(valor);
  return OPCOES_O_QUE_BUSCA.find(opcao => opcao.chave === chave) ?? null;
}

/** Tudo o que `seekingTypes` pode receber: as 12 novas, "Quero também mentorar" e as antigas (cliente em cache no deploy). */
export const VALORES_ACEITOS_EM_SEEKING_TYPES = [
  ...CHAVES_O_QUE_BUSCA,
  CHAVE_QUERO_MENTORAR,
  ...Object.keys(BUSCA_LEGADA_EQUIVALENTE),
  ...BUSCAS_LEGADAS_SEM_EQUIVALENTE,
] as readonly string[];

/**
 * O texto de "Outra necessidade" que deve ser gravado: aparado quando a opção
 * está marcada, e null quando não está (desmarcar apaga o texto velho, para
 * ele não seguir valendo como necessidade declarada).
 */
export function textoDaOutraNecessidade(buscas: readonly string[] | null | undefined, texto: string | null | undefined): string | null {
  if (!buscas?.includes(CHAVE_OUTRA_NECESSIDADE)) return null;
  const aparado = (texto ?? "").trim();
  return aparado || null;
}

/** Marcou "Outra necessidade"? Então o texto é obrigatório e cabe no limite. */
export function outraNecessidadeValida(buscas: readonly string[] | null | undefined, texto: string | null | undefined): boolean {
  if (!buscas?.includes(CHAVE_OUTRA_NECESSIDADE)) return true;
  const aparado = (texto ?? "").trim();
  return aparado.length >= 3 && aparado.length <= LIMITE_OUTRA_NECESSIDADE;
}
