/**
 * "O que preciso — Demandas e necessidades": as 17 categorias e a segunda camada
 * de detalhamento (pedido do Rosber, sócio da Glenda, 14/09 21:24; complemento
 * das 21:34: nenhum texto novo da tela usa a palavra "match").
 *
 * O banco guarda:
 *   - `user_profiles.whatINeed` (string[]): as CHAVES das categorias marcadas,
 *     como sempre. Oito chaves são as antigas (compradores, distribuidores,
 *     fornecedores, parceiros, investidores, financiamento, licencas,
 *     tecnologia) e continuam valendo nos motores como antes; as nove novas
 *     (`CATEGORIAS_QUE_SO_VALEM_PELA_DEMANDA`) NÃO são necessidade sozinhas.
 *     "consultoria" saiu da tela (genérica demais), mas segue lida e exibida
 *     nos perfis antigos.
 *   - `user_profiles.whatINeedDetails` (DemandaDetalhada[]): cada demanda
 *     separada, com a categoria, os dados estruturados e a descrição. Mais de
 *     uma demanda por categoria é permitido ("Expandir operação farmacêutica
 *     para Moçambique" e "Encontrar distribuidor na Nigéria" são duas).
 *
 * A regra da demanda expressa: a DESCRIÇÃO é a necessidade declarada que chega
 * aos motores como "o que preciso". A categoria sozinha não abre o portão de
 * serviço ("Especialistas / Serviços" sem descrição é genérica, como "Serviço
 * Especializado" em shared/o-que-busca.ts), e setor, país, região e cidade só
 * qualificam a demanda: nunca viram necessidade.
 *
 * Os rótulos da tela vêm do i18n (`oQuePreciso.*`); os rótulos em português
 * ficam aqui também porque os prompts do servidor e o Painel Ouro são em
 * português fixo. NÃO renomeie chaves: são valor gravado no banco.
 */

// ─── Limites (produto, não banco): valem na tela e no zod do servidor ─────────
export const MINIMO_DA_DESCRICAO = 10;
export const LIMITE_DA_DESCRICAO = 1000;
export const LIMITE_DO_CAMPO = 200;
export const LIMITE_DE_DEMANDAS_POR_CATEGORIA = 10;
export const LIMITE_DE_DEMANDAS = 50;
export const LIMITE_DE_PALAVRAS_CHAVE = 10;

/** Os campos de texto curto de uma demanda (os nomes do pedido, §7, mais os específicos). */
export const CAMPOS_DE_TEXTO_DA_DEMANDA = [
  "subcategory", "sector", "country", "region", "city", "product", "service", "objective",
  "estimatedValue", "quantity", "deadline",
  // Específicos de uma ou outra categoria.
  "buyerType", "certifications", "stage", "company", "agency", "role", "participationType",
  "area", "origin", "destination",
] as const;
export type CampoDeTextoDaDemanda = (typeof CAMPOS_DE_TEXTO_DA_DEMANDA)[number];

export type DemandaDetalhada = {
  /** Identificador estável da demanda (editar e remover uma sem mexer nas outras). */
  id: string;
  category: ChaveOQuePreciso;
  description?: string;
  exclusivity?: "sim" | "nao";
  keywords?: string[];
} & Partial<Record<CampoDeTextoDaDemanda, string>>;

export type OpcaoDoCampo = { readonly chave: string; readonly rotulo: string };

/**
 * `rotulo` é a chave do texto em `oQuePreciso.campos.*` (e em `ROTULOS_DOS_CAMPOS`,
 * para o português fixo). Campo de opções sem rótulo responde à própria pergunta
 * da categoria.
 */
export type DefinicaoDoCampo =
  | { readonly campo: CampoDeTextoDaDemanda; readonly tipo: "texto"; readonly rotulo: RotuloDoCampo }
  | { readonly campo: "subcategory" | "service" | "objective"; readonly tipo: "opcoes"; readonly rotulo?: RotuloDoCampo; readonly opcoes: readonly OpcaoDoCampo[]; readonly obrigatorio?: boolean }
  | { readonly campo: "exclusivity"; readonly tipo: "simNao"; readonly rotulo: RotuloDoCampo }
  | { readonly campo: "description"; readonly tipo: "descricao"; readonly rotulo: RotuloDoCampo };

export const ROTULOS_DOS_CAMPOS = {
  produtoOuServico: "Produto ou serviço",
  tipoDeComprador: "Tipo de comprador/cliente",
  setor: "Setor",
  paisRegiaoDeInteresse: "País/região de interesse",
  volumeOuCapacidade: "Volume ou capacidade aproximada, quando aplicável",
  descricao: "Descrição",
  produtoServico: "Produto/serviço",
  paisRegiao: "País/região",
  exclusividade: "Exclusividade",
  descricaoDaNecessidade: "Descrição da necessidade",
  produtoInsumo: "Produto/insumo",
  quantidadeAproximada: "Quantidade aproximada",
  certificacoes: "Certificações necessárias, se houver",
  descricaoDetalhada: "Descrição detalhada",
  valorAproximado: "Valor aproximado",
  pais: "País",
  estagio: "Estágio do negócio/projeto",
  modalidade: "Modalidade pretendida",
  descricaoDoProjeto: "Descrição do projeto",
  finalidade: "Finalidade",
  empresaProjeto: "Empresa/projeto",
  prazoDesejado: "Prazo desejado",
  paisRegiaoDeDestino: "País/região de destino",
  objetivoDaExpansao: "Objetivo da expansão",
  objetivoDaConexao: "Objetivo da conexão",
  tipo: "Tipo",
  produtoEmpresa: "Produto/empresa",
  orgaoEntidade: "Órgão/entidade, se souber",
  descricaoDoServico: "Descreva exatamente o serviço de que você precisa.",
  cargoEspecialidade: "Cargo/especialidade",
  localizacao: "Localização",
  tipoDeParticipacao: "Tipo de participação",
  cidade: "Cidade",
  estadoRegiao: "Estado/região",
  areaAproximada: "Área aproximada",
  origem: "Origem",
  destino: "Destino",
  area: "Área",
  objetivo: "Objetivo",
  paisRegiaoSeRelevante: "País/região, se relevante",
  conteExatamente: "Conte-nos exatamente o que você precisa.",
} as const;
export type RotuloDoCampo = keyof typeof ROTULOS_DOS_CAMPOS;

const texto = (campo: CampoDeTextoDaDemanda, rotulo: RotuloDoCampo): DefinicaoDoCampo => ({ campo, tipo: "texto", rotulo });
const descricao = (rotulo: RotuloDoCampo): DefinicaoDoCampo => ({ campo: "description", tipo: "descricao", rotulo });
const opcoes = (lista: ReadonlyArray<readonly [string, string]>) => lista.map(([chave, rotulo]) => ({ chave, rotulo }));

export const CATEGORIAS_O_QUE_PRECISO = [
  {
    chave: "compradores", emoji: "🛒", titulo: "Compradores / Clientes",
    descricao: "Encontrar quem precisa do que eu vendo ou ofereço.",
    pergunta: "O que você deseja vender e quem precisa encontrar?",
    campos: [
      texto("product", "produtoOuServico"), texto("buyerType", "tipoDeComprador"), texto("sector", "setor"),
      texto("region", "paisRegiaoDeInteresse"), texto("quantity", "volumeOuCapacidade"), descricao("descricao"),
    ],
  },
  {
    chave: "distribuidores", emoji: "📦", titulo: "Distribuidores / Representantes",
    descricao: "Distribuição, representação comercial e canais de venda.",
    pergunta: "Que tipo de distribuidor ou representante você procura?",
    campos: [
      texto("product", "produtoServico"), texto("sector", "setor"), texto("region", "paisRegiao"),
      { campo: "exclusivity", tipo: "simNao", rotulo: "exclusividade" }, descricao("descricaoDaNecessidade"),
    ],
  },
  {
    chave: "fornecedores", emoji: "🏭", titulo: "Fornecedores / Fabricantes",
    descricao: "Produtos, insumos, indústria e produção.",
    pergunta: "O que você precisa adquirir ou produzir?",
    campos: [
      texto("product", "produtoInsumo"), texto("quantity", "quantidadeAproximada"), texto("region", "paisRegiao"),
      texto("certifications", "certificacoes"), descricao("descricao"),
    ],
  },
  {
    chave: "parceiros", emoji: "🤝", titulo: "Parceiros Estratégicos",
    descricao: "Joint ventures, alianças, sócios e parceiros comerciais.",
    pergunta: "Que tipo de parceria você procura?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["socio", "Sócio"], ["parceiro_comercial", "Parceiro comercial"], ["joint_venture", "Joint venture"],
        ["representacao", "Representação"], ["distribuicao", "Distribuição"], ["desenvolvimento_de_projeto", "Desenvolvimento de projeto"],
        ["parceiro_institucional", "Parceiro institucional"], ["outro", "Outro"],
      ]) },
      descricao("descricaoDetalhada"),
    ],
  },
  {
    chave: "investidores", emoji: "💰", titulo: "Investidores",
    descricao: "Investimento, equity, fundos e capital privado.",
    pergunta: "Que tipo de investimento você procura?",
    campos: [
      texto("estimatedValue", "valorAproximado"), texto("sector", "setor"), texto("country", "pais"), texto("stage", "estagio"),
      { campo: "subcategory", tipo: "opcoes", rotulo: "modalidade", opcoes: opcoes([
        ["equity", "Equity"], ["fundo", "Fundo"], ["investidor_estrategico", "Investidor estratégico"], ["outro", "Outro"],
      ]) },
      descricao("descricaoDoProjeto"),
    ],
  },
  {
    chave: "financiamento", emoji: "🏦", titulo: "Crédito / Financiamento",
    descricao: "Bancos, linhas de crédito e financiamento de projetos.",
    pergunta: "Que tipo de financiamento você procura?",
    campos: [
      texto("estimatedValue", "valorAproximado"), texto("objective", "finalidade"), texto("country", "pais"),
      texto("company", "empresaProjeto"), texto("deadline", "prazoDesejado"), descricao("descricao"),
    ],
  },
  {
    chave: "expansao_internacionalizacao", emoji: "🌎", titulo: "Expansão / Internacionalização",
    descricao: "Entrar em novos estados, países ou mercados.",
    pergunta: "Onde e como você deseja expandir?",
    campos: [
      texto("region", "paisRegiaoDeDestino"), texto("sector", "setor"), texto("product", "produtoServico"),
      { campo: "objective", tipo: "opcoes", rotulo: "objetivoDaExpansao", opcoes: opcoes([
        ["vender", "Vender"], ["distribuir", "Distribuir"], ["abrir_empresa", "Abrir empresa"], ["instalar_operacao", "Instalar operação"],
        ["encontrar_parceiro_local", "Encontrar parceiro local"], ["encontrar_investidores", "Encontrar investidores"],
        ["importar", "Importar"], ["exportar", "Exportar"], ["outro", "Outro"],
      ]) },
      descricao("descricao"),
    ],
  },
  {
    chave: "conexoes_institucionais", emoji: "🏛️", titulo: "Conexões Institucionais",
    descricao: "Entidades, associações, câmaras de comércio e interlocução institucional.",
    pergunta: "Que conexão institucional você precisa?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["associacao_empresarial", "Associação empresarial"], ["camara_de_comercio", "Câmara de comércio"], ["entidade_setorial", "Entidade setorial"],
        ["universidade", "Universidade"], ["instituicao_financeira", "Instituição financeira"], ["organismo_internacional", "Organismo internacional"],
        ["outra_instituicao", "Outra instituição"],
      ]) },
      texto("region", "paisRegiao"), texto("objective", "objetivoDaConexao"), descricao("descricao"),
    ],
  },
  {
    chave: "licencas", emoji: "📋", titulo: "Licenças / Regulação",
    descricao: "Licenças, registros, certificações e aprovações.",
    pergunta: "Qual licença, registro, certificação ou aprovação você precisa?",
    campos: [
      texto("subcategory", "tipo"), texto("sector", "setor"), texto("product", "produtoEmpresa"), texto("country", "pais"),
      texto("agency", "orgaoEntidade"), descricao("descricao"),
    ],
  },
  {
    chave: "tecnologia", emoji: "💡", titulo: "Tecnologia / Inovação",
    descricao: "Sistemas, IA, tecnologia, inovação e transformação digital.",
    pergunta: "Que tecnologia ou solução você procura?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["software", "Software"], ["inteligencia_artificial", "Inteligência Artificial"], ["automacao", "Automação"], ["plataforma", "Plataforma"],
        ["desenvolvimento", "Desenvolvimento"], ["integracao", "Integração"], ["equipamentos", "Equipamentos"], ["healthtech", "Healthtech"],
        ["fintech", "Fintech"], ["outro", "Outro"],
      ]) },
      descricao("descricao"),
    ],
  },
  {
    chave: "especialistas_servicos", emoji: "👩‍💼", titulo: "Especialistas / Serviços",
    descricao: "Jurídico, tributário, contábil, regulatório, marketing, comércio exterior e outros serviços especializados.",
    pergunta: "Qual serviço ou especialista você precisa contratar?",
    campos: [
      // "Perguntar obrigatoriamente": o serviço E a descrição exata.
      { campo: "service", tipo: "opcoes", obrigatorio: true, opcoes: opcoes([
        ["juridico", "Jurídico"], ["tributario", "Tributário"], ["contabil", "Contábil"], ["regulatorio", "Regulatório"],
        ["comercio_exterior", "Comércio Exterior"], ["marketing", "Marketing"], ["tecnologia", "Tecnologia"], ["estrategia", "Estratégia"],
        ["financeiro", "Financeiro"], ["recursos_humanos", "Recursos Humanos"], ["engenharia", "Engenharia"], ["arquitetura", "Arquitetura"],
        ["outro", "Outro"],
      ]) },
      descricao("descricaoDoServico"),
    ],
  },
  {
    chave: "talentos_equipe", emoji: "👥", titulo: "Talentos / Equipe",
    descricao: "Executivos, profissionais e competências específicas.",
    pergunta: "Que profissional ou competência você procura?",
    campos: [
      texto("role", "cargoEspecialidade"), texto("sector", "setor"), texto("region", "localizacao"),
      texto("participationType", "tipoDeParticipacao"), descricao("descricao"),
    ],
  },
  {
    chave: "imoveis_estrutura", emoji: "🏢", titulo: "Imóveis / Estrutura",
    descricao: "Áreas, imóveis, plantas industriais, escritórios e infraestrutura.",
    pergunta: "Que estrutura você precisa?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["terreno", "Terreno"], ["escritorio", "Escritório"], ["loja", "Loja"], ["galpao", "Galpão"], ["planta_industrial", "Planta industrial"],
        ["laboratorio", "Laboratório"], ["clinica", "Clínica"], ["centro_de_distribuicao", "Centro de distribuição"], ["outro", "Outro"],
      ]) },
      texto("city", "cidade"), texto("region", "estadoRegiao"), texto("country", "pais"), texto("area", "areaAproximada"),
      texto("objective", "finalidade"), descricao("descricao"),
    ],
  },
  {
    chave: "logistica_comercio_exterior", emoji: "🚚", titulo: "Logística / Comércio Exterior",
    descricao: "Transporte, armazenagem, importação, exportação e operações internacionais.",
    pergunta: "Que operação você precisa viabilizar?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["importacao", "Importação"], ["exportacao", "Exportação"], ["transporte_internacional", "Transporte internacional"],
        ["transporte_nacional", "Transporte nacional"], ["armazenagem", "Armazenagem"], ["desembaraco_aduaneiro", "Desembaraço aduaneiro"],
        ["freight_forwarder", "Freight Forwarder"], ["distribuicao", "Distribuição"], ["outro", "Outro"],
      ]) },
      texto("origin", "origem"), texto("destination", "destino"), descricao("descricao"),
    ],
  },
  {
    chave: "midia_visibilidade", emoji: "📣", titulo: "Mídia / Visibilidade",
    descricao: "Comunicação, eventos, imprensa, posicionamento e divulgação.",
    pergunta: "Que tipo de visibilidade você procura?",
    campos: [
      { campo: "subcategory", tipo: "opcoes", opcoes: opcoes([
        ["imprensa", "Imprensa"], ["eventos", "Eventos"], ["relacoes_publicas", "Relações públicas"], ["posicionamento_de_marca", "Posicionamento de marca"],
        ["influenciadores", "Influenciadores"], ["patrocinio", "Patrocínio"], ["divulgacao_internacional", "Divulgação internacional"], ["outro", "Outro"],
      ]) },
      descricao("descricao"),
    ],
  },
  {
    chave: "conhecimento_mentoria", emoji: "🎓", titulo: "Conhecimento / Mentoria",
    descricao: "Especialistas, capacitação, conselho e experiência.",
    pergunta: "Que conhecimento ou experiência você procura?",
    campos: [
      texto("subcategory", "area"), texto("sector", "setor"), texto("objective", "objetivo"),
      texto("region", "paisRegiaoSeRelevante"), descricao("descricao"),
    ],
  },
  {
    // A mensagem traz "Permitir que o usuário descreva livremente o que procura." — instrução
    // para quem implementa, não texto de tela; o cartão diz o mesmo falando com a membra.
    chave: "outra_necessidade", emoji: "➕", titulo: "Outra necessidade",
    descricao: "Descreva livremente o que você procura.",
    pergunta: "Conte-nos exatamente o que você precisa.",
    campos: [descricao("conteExatamente")],
  },
] as const satisfies ReadonlyArray<{
  chave: string; emoji: string; titulo: string; descricao: string; pergunta: string; campos: readonly DefinicaoDoCampo[];
}>;

export type ChaveOQuePreciso = (typeof CATEGORIAS_O_QUE_PRECISO)[number]["chave"];
export type CategoriaOQuePreciso = (typeof CATEGORIAS_O_QUE_PRECISO)[number];

export const CHAVES_O_QUE_PRECISO = CATEGORIAS_O_QUE_PRECISO.map(categoria => categoria.chave) as readonly ChaveOQuePreciso[];

/** A categoria de serviço: sem descrição é genérica e nunca declara necessidade de serviço nenhum. */
export const CATEGORIA_DE_SERVICO = "especialistas_servicos" as const satisfies ChaveOQuePreciso;

/**
 * As nove categorias que nasceram em 14/09. A chave delas em `whatINeed` NÃO é
 * necessidade: só as demandas detalhadas contam. Medido: "expansao_internacionalizacao"
 * lida como texto casava com "Consultoria em internacionalização" nos dois motores
 * determinísticos, e "especialistas_servicos" é classificada como serviço — a
 * categoria sozinha abriria o portão. As oito que reaproveitam as chaves antigas
 * seguem valendo como antes (perfis antigos sem detalhamento: a regra de hoje).
 */
export const CATEGORIAS_QUE_SO_VALEM_PELA_DEMANDA: ReadonlySet<string> = new Set<ChaveOQuePreciso>([
  "expansao_internacionalizacao", "conexoes_institucionais", "especialistas_servicos", "talentos_equipe",
  "imoveis_estrutura", "logistica_comercio_exterior", "midia_visibilidade", "conhecimento_mentoria", "outra_necessidade",
]);

/** Chaves que saíram da tela e continuam nos perfis gravados antes de 14/09. */
export const O_QUE_PRECISO_LEGADO: Readonly<Record<string, { emoji: string; titulo: string }>> = {
  consultoria: { emoji: "💡", titulo: "Consultoria" },
};

export function ehCategoriaOQuePreciso(valor: unknown): valor is ChaveOQuePreciso {
  return typeof valor === "string" && (CHAVES_O_QUE_PRECISO as readonly string[]).includes(valor);
}

export function categoriaDoQuePreciso(chave: string): CategoriaOQuePreciso | null {
  return CATEGORIAS_O_QUE_PRECISO.find(categoria => categoria.chave === chave) ?? null;
}

/** Rótulo em português de uma chave de `whatINeed`: categoria nova, legado, ou o próprio texto (dado livre antigo). */
export function rotuloDoQuePreciso(valor: string): string {
  return categoriaDoQuePreciso(valor)?.titulo ?? O_QUE_PRECISO_LEGADO[valor]?.titulo ?? valor;
}

/** O rótulo da opção escolhida num campo de opções; texto livre (ou opção desconhecida) passa como veio. */
export function rotuloDaOpcao(categoria: string, campo: string, valor: string): string {
  const definicao = categoriaDoQuePreciso(categoria)?.campos.find(item => item.campo === campo);
  if (definicao?.tipo !== "opcoes") return valor;
  return definicao.opcoes.find(opcao => opcao.chave === valor)?.rotulo ?? valor;
}

// ─── Leitura, validação e preparo para gravar ─────────────────────────────────

const aparar = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

/**
 * O que está gravado em `whatINeedDetails`, lido com desconfiança: coluna JSON
 * (pode vir null, texto de um MariaDB antigo, ou lixo). Só sai demanda com
 * categoria conhecida; campos de outro tipo são descartados.
 */
export function lerDemandas(valor: unknown): DemandaDetalhada[] {
  let bruto = valor;
  if (typeof bruto === "string") {
    try { bruto = JSON.parse(bruto); } catch { return []; }
  }
  if (!Array.isArray(bruto)) return [];
  const demandas: DemandaDetalhada[] = [];
  bruto.forEach((item, indice) => {
    if (!item || typeof item !== "object") return;
    const registro = item as Record<string, unknown>;
    if (!ehCategoriaOQuePreciso(registro.category)) return;
    const demanda: DemandaDetalhada = {
      id: aparar(registro.id) || `demanda-${indice + 1}`,
      category: registro.category,
    };
    const descricaoGravada = aparar(registro.description);
    if (descricaoGravada) demanda.description = descricaoGravada;
    for (const campo of CAMPOS_DE_TEXTO_DA_DEMANDA) {
      const valorDoCampo = aparar(registro[campo]);
      if (valorDoCampo) demanda[campo] = valorDoCampo;
    }
    if (registro.exclusivity === "sim" || registro.exclusivity === "nao") demanda.exclusivity = registro.exclusivity;
    if (Array.isArray(registro.keywords)) {
      const palavras = registro.keywords.map(aparar).filter(Boolean);
      if (palavras.length) demanda.keywords = palavras;
    }
    demandas.push(demanda);
  });
  return demandas;
}

/** Nada preenchido (a demanda recém-aberta que ninguém tocou). */
export function demandaEmBranco(demanda: DemandaDetalhada): boolean {
  if (aparar(demanda.description)) return false;
  if (demanda.exclusivity) return false;
  if (demanda.keywords?.some(palavra => aparar(palavra))) return false;
  return CAMPOS_DE_TEXTO_DA_DEMANDA.every(campo => !aparar(demanda[campo]));
}

export type ProblemaDaDemanda = "categoria-desconhecida" | "descricao-curta" | "descricao-longa" | "servico-obrigatorio" | "opcao-invalida" | "campo-longo";

/**
 * A validação mínima de uma demanda (a mesma na tela e no servidor):
 *   - a DESCRIÇÃO é obrigatória em toda categoria, com pelo menos
 *     MINIMO_DA_DESCRICAO caracteres — é ela que chega aos motores como
 *     necessidade declarada; os campos estruturados só qualificam;
 *   - em "Especialistas / Serviços" o serviço também é obrigatório ("Perguntar
 *     obrigatoriamente");
 *   - opção fora da lista da categoria e texto acima do limite são recusados.
 */
export function problemaDaDemanda(demanda: DemandaDetalhada): ProblemaDaDemanda | null {
  const categoria = categoriaDoQuePreciso(demanda.category);
  if (!categoria) return "categoria-desconhecida";
  const descricaoAparada = aparar(demanda.description);
  if (descricaoAparada.length > LIMITE_DA_DESCRICAO) return "descricao-longa";
  if (CAMPOS_DE_TEXTO_DA_DEMANDA.some(campo => aparar(demanda[campo]).length > LIMITE_DO_CAMPO)) return "campo-longo";
  for (const definicao of categoria.campos as readonly DefinicaoDoCampo[]) {
    if (definicao.tipo !== "opcoes") continue;
    const escolhida = aparar(demanda[definicao.campo]);
    if (!escolhida) {
      if (definicao.obrigatorio) return "servico-obrigatorio";
      continue;
    }
    if (!definicao.opcoes.some(opcao => opcao.chave === escolhida)) return "opcao-invalida";
  }
  if (descricaoAparada.length < MINIMO_DA_DESCRICAO) return "descricao-curta";
  return null;
}

export function demandaValida(demanda: DemandaDetalhada): boolean {
  return problemaDaDemanda(demanda) === null;
}

/**
 * As categorias marcadas que ainda impedem avançar: marcada sem nenhuma demanda
 * válida, ou com uma demanda começada e inválida. A seleção sozinha não gera
 * conexão, então não basta. `toleradas` são as categorias que o perfil já tinha
 * gravadas antes do detalhamento existir: editar a bio no Perfil não pode exigir
 * detalhar uma categoria antiga (ela segue com a regra de antes).
 */
export function categoriasPendentes(categorias: readonly string[], demandas: readonly DemandaDetalhada[], toleradas: readonly string[] = []): ChaveOQuePreciso[] {
  return categorias.filter(ehCategoriaOQuePreciso).filter(categoria => {
    const daCategoria = demandas.filter(demanda => demanda.category === categoria && !demandaEmBranco(demanda));
    if (daCategoria.some(demanda => !demandaValida(demanda))) return true;
    return daCategoria.length === 0 && !toleradas.includes(categoria);
  });
}

/** Demandas prontas para gravar: só das categorias marcadas, sem as em branco, com texto aparado e sem campo vazio. */
export function demandasParaGravar(categorias: readonly string[], demandas: readonly DemandaDetalhada[]): DemandaDetalhada[] {
  return lerDemandas(demandas).filter(demanda => categorias.includes(demanda.category) && !demandaEmBranco(demanda));
}

/**
 * Categorias cuja descrição conta o que a própria membra VENDE ("O que você
 * deseja vender e quem precisa encontrar?"), não o que ela precisa. A chave
 * continua valendo como necessidade (precisar de compradores), mas a descrição
 * não: lida como "o que preciso", ela conectava duas prestadoras do mesmo
 * serviço sem nenhuma declarar precisar dele (revisão da PR #135).
 */
export const CATEGORIAS_CUJA_DESCRICAO_E_OFERTA: ReadonlySet<string> = new Set<ChaveOQuePreciso>(["compradores"]);

/**
 * As necessidades DECLARADAS nas demandas detalhadas, para os motores: a
 * descrição de cada demanda válida cuja categoria está marcada em `whatINeed`
 * (desmarcar a categoria tira as demandas dela, como desmarcar "Outra
 * necessidade" apaga o texto). Só a descrição: o serviço escolhido ("Jurídico")
 * não entra sozinho — nomeia a família, não a necessidade, e "Palavra igual não
 * é serviço igual" —, e setor, país, região e cidade nunca são necessidade.
 * "Especialistas / Serviços" sem descrição não chega aqui (a demanda é inválida),
 * nem a descrição das categorias que descrevem a oferta. A guarda de concorrência —
 * a descrição de qualquer categoria que nomeia o serviço que o próprio perfil
 * oferece também não é necessidade — fica em server/portao-da-demanda-expressa.ts
 * (`necessidadesEscritasDoPerfil`), onde as ofertas do perfil são conhecidas.
 */
export function necessidadesDasDemandas(whatINeed: unknown, whatINeedDetails: unknown): string[] {
  const marcadas = Array.isArray(whatINeed) ? whatINeed.filter((item): item is string => typeof item === "string") : [];
  return lerDemandas(whatINeedDetails)
    .filter(demanda => marcadas.includes(demanda.category) && !CATEGORIAS_CUJA_DESCRICAO_E_OFERTA.has(demanda.category) && demandaValida(demanda))
    .map(demanda => demanda.description as string);
}

/**
 * As chaves de `whatINeed` que os motores leem como necessidade: todas, menos as
 * nove categorias que só valem pela demanda detalhada.
 */
export function chavesQueValemComoNecessidade(whatINeed: unknown): string[] {
  const lista = Array.isArray(whatINeed) ? whatINeed.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
  return lista.filter(chave => !CATEGORIAS_QUE_SO_VALEM_PELA_DEMANDA.has(chave));
}

/** Os dados estruturados de uma demanda, com rótulo em português ("Setor: Saúde"), na ordem dos campos da categoria. */
export function qualificadoresDaDemanda(demanda: DemandaDetalhada): string[] {
  const categoria = categoriaDoQuePreciso(demanda.category);
  if (!categoria) return [];
  const saida: string[] = [];
  for (const definicao of categoria.campos as readonly DefinicaoDoCampo[]) {
    if (definicao.tipo === "descricao") continue;
    if (definicao.tipo === "simNao") {
      if (demanda.exclusivity) saida.push(`${ROTULOS_DOS_CAMPOS[definicao.rotulo]}: ${demanda.exclusivity === "sim" ? "sim" : "não"}`);
      continue;
    }
    const valor = aparar(demanda[definicao.campo]);
    if (!valor) continue;
    const rotulo = definicao.rotulo ? ROTULOS_DOS_CAMPOS[definicao.rotulo] : definicao.campo === "service" ? "Serviço" : "Tipo";
    saida.push(`${rotulo}: ${definicao.tipo === "opcoes" ? rotuloDaOpcao(demanda.category, definicao.campo, valor) : valor}`);
  }
  return saida;
}

let contadorDeIds = 0;
/** Id novo de demanda (só identifica na lista; não precisa ser segredo). */
export function novoIdDeDemanda(): string {
  contadorDeIds += 1;
  return `d${Date.now().toString(36)}${contadorDeIds.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
