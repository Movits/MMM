// Lista canônica dos termos de negócio que o Cruzamento Inteligente conhece.
//
// As 17 primeiras chaves são os ids de WHAT_I_HAVE_OPTIONS e WHAT_I_NEED_OPTIONS
// (client/src/pages/Onboarding.tsx). Elas já estão gravadas em
// user_profiles.whatIHave/whatINeed: renomear qualquer uma invalida o perfil de
// quem já preencheu o onboarding.

export type TipoVocabulario = "ativo" | "necessidade";

export type ItemVocabulario = {
  chave: string;
  /** Um mesmo termo pode servir aos dois lados; dois registros quebrariam o cruzamento. */
  tipo: readonly TipoVocabulario[];
  /** Slug do setor, no formato que `normalizar` produz — comparável com a categoria do contato. */
  setor?: string;
  icone?: string;
  sinonimos: readonly string[];
};

// Setores em uso: commodities, investimento, logistica, comercio-exterior,
// saude, juridico, industria, energia. Termo que não cai em nenhum deles fica
// sem setor — melhor nenhum que um setor inventado, que produziria match de
// categoria falso (60 pontos) em scoreMatch.
export const ITENS_VOCABULARIO = [
  // ─── Ids do onboarding: "O que tenho" ───────────────────────────────────────
  {
    chave: "industria",
    tipo: ["ativo"],
    setor: "industria",
    icone: "🏭",
    sinonimos: ["indústria", "industrial", "fábrica", "fabril", "manufatura", "parque industrial", "unidade industrial", "planta fabril"],
  },
  {
    chave: "fazenda",
    tipo: ["ativo"],
    setor: "commodities",
    icone: "🌾",
    sinonimos: ["fazenda", "sítio", "chácara", "propriedade rural", "lavoura", "plantação", "área plantada", "terra produtiva", "granja"],
  },
  {
    chave: "laboratorio",
    tipo: ["ativo"],
    setor: "saude",
    icone: "🔬",
    sinonimos: ["laboratório", "laboratorial", "análises clínicas", "pesquisa e desenvolvimento", "p&d", "ensaios", "testes de laboratório", "laboratório de pesquisa"],
  },
  {
    chave: "tecnologia",
    tipo: ["ativo", "necessidade"],
    icone: "💻",
    sinonimos: ["tecnologia", "tech", "inovação", "transformação digital", "digitalização", "solução tecnológica", "startup de tecnologia", "deep tech"],
  },
  {
    chave: "investidores",
    tipo: ["ativo", "necessidade"],
    setor: "investimento",
    icone: "💰",
    sinonimos: ["investidores", "investidor", "investidora", "rede de investidores", "investidor anjo", "investidores anjo", "anjo", "fundo de investimento", "fundos", "family office", "private equity", "venture capital", "vc", "base de investidores"],
  },
  {
    chave: "acesso_governamental",
    tipo: ["ativo"],
    icone: "🏛️",
    sinonimos: ["acesso governamental", "governo", "poder público", "órgão público", "prefeitura", "licitação", "edital", "contrato público", "relações institucionais", "relações governamentais", "secretaria"],
  },
  {
    chave: "commodities",
    tipo: ["ativo"],
    setor: "commodities",
    icone: "📦",
    sinonimos: ["commodities", "commodity", "soja", "milho", "café", "trigo", "algodão", "açúcar", "etanol", "cana", "grãos", "gado", "boi", "carne", "minério"],
  },
  {
    chave: "licencas",
    tipo: ["ativo", "necessidade"],
    icone: "📋",
    sinonimos: ["licenças", "licença", "certificação", "certificações", "alvará", "anvisa", "registro sanitário", "homologação", "iso", "selo", "autorização", "aprovação regulatória", "outorga", "licenciamento ambiental"],
  },
  {
    chave: "imoveis",
    tipo: ["ativo"],
    icone: "🏢",
    sinonimos: ["imóveis", "imóvel", "prédio", "edifício", "sala comercial", "ponto comercial", "apartamento", "casa", "locação", "aluguel", "real estate", "imobiliário"],
  },
  {
    chave: "logistica",
    tipo: ["ativo"],
    setor: "logistica",
    icone: "🚚",
    sinonimos: ["logística", "operador logístico", "supply chain", "cadeia logística", "roteirização", "última milha", "logística reversa", "distribuição física", "porto"],
  },
  {
    chave: "canais_comerciais",
    tipo: ["ativo"],
    icone: "🤝",
    sinonimos: ["canais comerciais", "canal comercial", "canais de venda", "rede de vendas", "pontos de venda", "carteira comercial", "marketplace", "canal de vendas"],
  },

  // ─── Ids do onboarding: "O que preciso" ─────────────────────────────────────
  {
    chave: "fornecedores",
    tipo: ["necessidade"],
    icone: "🏪",
    sinonimos: ["fornecedores", "fornecedor", "fornecedora", "supplier", "insumos", "matéria prima", "cadeia de suprimentos", "sourcing", "compras", "fornecimento"],
  },
  {
    chave: "compradores",
    tipo: ["necessidade"],
    icone: "🛒",
    sinonimos: ["compradores", "comprador", "compradora", "clientes", "cliente", "buyer", "offtake", "demanda", "carteira de clientes", "quem compre"],
  },
  {
    chave: "distribuidores",
    tipo: ["necessidade"],
    icone: "📤",
    sinonimos: ["distribuidores", "distribuidor", "distribuidora", "revenda", "revendedor", "atacadista", "atacado", "dealer", "canal de distribuição"],
  },
  {
    chave: "parceiros",
    tipo: ["necessidade"],
    icone: "🤝",
    sinonimos: ["parceiros", "parceiro", "parceira", "parceria", "parceiro estratégico", "sócio", "sócia", "joint venture", "aliança", "co-investimento"],
  },
  {
    chave: "financiamento",
    tipo: ["necessidade"],
    setor: "investimento",
    icone: "🏦",
    sinonimos: ["financiamento", "crédito", "empréstimo", "linha de crédito", "banco", "financiar", "bndes", "capital de giro", "antecipação de recebíveis", "fomento", "fiança"],
  },
  {
    chave: "consultoria",
    tipo: ["necessidade"],
    icone: "💡",
    sinonimos: ["consultoria", "consultor", "consultora", "assessoria", "especialista", "diagnóstico", "consultoria empresarial", "gestão", "planejamento estratégico"],
  },

  // ─── Termos das categorias do seed e do vocabulário corrente de negócios ────
  {
    chave: "investimento",
    tipo: ["ativo", "necessidade"],
    setor: "investimento",
    icone: "💸",
    sinonimos: ["investimento", "aporte", "capital", "funding", "aporte financeiro", "capital de risco", "rodada de investimento", "aporte para expansão", "dinheiro para investir", "seed", "series a"],
  },
  {
    chave: "mentoria",
    tipo: ["ativo", "necessidade"],
    icone: "🧭",
    sinonimos: ["mentoria", "mentor", "mentora", "mentoring", "orientação", "aconselhamento", "conselheira", "conselho consultivo", "coaching", "madrinha"],
  },
  {
    chave: "armazenagem",
    tipo: ["ativo", "necessidade"],
    setor: "logistica",
    icone: "🏬",
    sinonimos: ["armazenagem", "armazém", "armazenamento", "galpão", "depósito", "estoque", "warehouse", "câmara fria", "armazenagem refrigerada", "silo"],
  },
  {
    chave: "transporte",
    tipo: ["ativo", "necessidade"],
    setor: "logistica",
    icone: "🚛",
    sinonimos: ["transporte", "frete", "transportadora", "caminhão", "frota", "carreta", "entrega", "motorista", "transporte rodoviário", "cabotagem"],
  },
  {
    chave: "exportacao",
    tipo: ["ativo", "necessidade"],
    setor: "comercio-exterior",
    icone: "🚢",
    sinonimos: ["exportação", "exportar", "exportador", "exportadora", "mercado externo", "venda para o exterior", "compradores no exterior", "clientes no exterior", "export"],
  },
  {
    chave: "importacao",
    tipo: ["ativo", "necessidade"],
    setor: "comercio-exterior",
    icone: "🛳️",
    sinonimos: ["importação", "importar", "importador", "importadora", "compra no exterior", "fornecedor internacional", "despachante aduaneiro", "aduana", "import"],
  },
  {
    chave: "comercio_exterior",
    tipo: ["ativo", "necessidade"],
    setor: "comercio-exterior",
    icone: "🌎",
    sinonimos: ["comércio exterior", "comex", "negócios internacionais", "mercado internacional", "internacionalização", "trading internacional", "câmbio"],
  },
  {
    chave: "energia",
    tipo: ["ativo", "necessidade"],
    setor: "energia",
    icone: "⚡",
    sinonimos: ["energia", "setor elétrico", "energia elétrica", "geração de energia", "usina", "energia renovável", "eólica", "biomassa", "biogás", "mercado livre de energia"],
  },
  {
    chave: "energia_solar",
    tipo: ["ativo", "necessidade"],
    setor: "energia",
    icone: "☀️",
    sinonimos: ["energia solar", "solar", "painel solar", "placas solares", "fotovoltaico", "energia fotovoltaica", "usina solar", "geração distribuída"],
  },
  {
    chave: "terrenos",
    tipo: ["ativo", "necessidade"],
    icone: "🗺️",
    sinonimos: ["terrenos", "terreno", "lote", "gleba", "área", "hectares", "terra", "área rural", "terrenos com outorga"],
  },
  {
    chave: "marca",
    tipo: ["ativo", "necessidade"],
    icone: "™️",
    sinonimos: ["marca", "brand", "marca própria", "marca registrada", "branding", "licenciamento de marca", "nome comercial", "identidade visual"],
  },
  {
    chave: "producao_industrial",
    tipo: ["ativo", "necessidade"],
    setor: "industria",
    icone: "⚙️",
    sinonimos: ["produção industrial", "produção", "linha de produção", "capacidade produtiva", "envase", "industrialização", "terceirização de produção", "produção terceirizada", "private label", "planta industrial"],
  },
  {
    chave: "saude",
    tipo: ["ativo", "necessidade"],
    setor: "saude",
    icone: "🏥",
    sinonimos: ["saúde", "clínica", "rede de clínicas", "hospital", "médico", "médica", "healthtech", "serviços de saúde", "plano de saúde", "negócios em saúde"],
  },
  {
    chave: "juridico",
    tipo: ["ativo", "necessidade"],
    setor: "juridico",
    icone: "⚖️",
    sinonimos: ["jurídico", "advogado", "advogada", "advocacia", "escritório de advocacia", "assessoria jurídica", "direito", "contratos", "compliance", "contencioso"],
  },
  {
    chave: "contabilidade",
    tipo: ["ativo", "necessidade"],
    icone: "🧾",
    sinonimos: ["contabilidade", "contador", "contadora", "contábil", "escritório contábil", "fiscal", "tributário", "planejamento tributário", "balanço", "bpo financeiro"],
  },
  {
    chave: "marketing",
    tipo: ["ativo", "necessidade"],
    icone: "📣",
    sinonimos: ["marketing", "publicidade", "propaganda", "marketing digital", "tráfego pago", "agência de publicidade", "mídias sociais", "social media", "seo", "campanhas"],
  },
  {
    chave: "tecnologia_software",
    tipo: ["ativo", "necessidade"],
    icone: "🖥️",
    sinonimos: ["software", "desenvolvimento de software", "sistema", "sistemas", "saas", "aplicativo", "app", "programação", "desenvolvimento web", "plataforma digital", "ti"],
  },
  {
    chave: "agronegocio",
    tipo: ["ativo", "necessidade"],
    setor: "commodities",
    icone: "🚜",
    sinonimos: ["agronegócio", "agro", "agricultura", "pecuária", "agropecuária", "plantio", "safra", "produtor rural", "colheita", "insumos agrícolas"],
  },
  {
    chave: "alimentos",
    tipo: ["ativo", "necessidade"],
    setor: "industria",
    icone: "🍲",
    sinonimos: ["alimentos", "alimentício", "alimentação", "indústria de alimentos", "bebidas", "alimentos naturais", "food service", "food"],
  },
  {
    chave: "cosmeticos",
    tipo: ["ativo", "necessidade"],
    setor: "industria",
    icone: "💄",
    sinonimos: ["cosméticos", "cosmético", "beleza", "perfumaria", "dermocosmético", "higiene pessoal", "skincare"],
  },
  {
    chave: "farmaceutico",
    tipo: ["ativo", "necessidade"],
    setor: "saude",
    icone: "💊",
    sinonimos: ["farmacêutico", "farmácia", "medicamento", "medicamentos", "farma", "indústria farmacêutica", "suplementos", "manipulação"],
  },
  {
    chave: "franquia",
    tipo: ["ativo", "necessidade"],
    icone: "🏷️",
    sinonimos: ["franquia", "franquias", "franchising", "franqueado", "franqueada", "franqueadora", "modelo de franquia", "expansão por franquia"],
  },
  {
    chave: "representacao_comercial",
    tipo: ["ativo", "necessidade"],
    icone: "📈",
    sinonimos: ["representação comercial", "representante comercial", "vendedor externo", "força de vendas", "equipe comercial", "prospecção", "vendas", "comercial"],
  },
  {
    chave: "treinamento",
    tipo: ["ativo", "necessidade"],
    icone: "🎓",
    sinonimos: ["treinamento", "capacitação", "curso", "workshop", "formação", "educação corporativa", "palestra", "treinamento de equipe"],
  },
  {
    chave: "recrutamento",
    tipo: ["ativo", "necessidade"],
    icone: "🧑‍💼",
    sinonimos: ["recrutamento", "seleção", "contratação", "talentos", "mão de obra", "headhunting", "rh", "recursos humanos", "equipe"],
  },
  {
    chave: "seguros",
    tipo: ["ativo", "necessidade"],
    icone: "🛡️",
    sinonimos: ["seguros", "seguro", "seguradora", "corretora de seguros", "apólice", "resseguro", "proteção patrimonial", "garantia"],
  },
  {
    chave: "construcao",
    tipo: ["ativo", "necessidade"],
    icone: "🏗️",
    sinonimos: ["construção", "obra", "construtora", "engenharia", "incorporação", "empreiteira", "reforma", "infraestrutura", "canteiro"],
  },
  {
    chave: "educacao",
    tipo: ["ativo", "necessidade"],
    icone: "📚",
    sinonimos: ["educação", "escola", "faculdade", "ensino", "edtech", "instituição de ensino", "aulas", "pós-graduação"],
  },
  {
    chave: "varejo",
    tipo: ["ativo", "necessidade"],
    icone: "🛍️",
    sinonimos: ["varejo", "varejista", "comércio varejista", "loja", "lojas", "loja física", "rede de lojas", "e-commerce", "retail"],
  },
  {
    chave: "inteligencia_artificial",
    tipo: ["ativo", "necessidade"],
    icone: "🤖",
    sinonimos: ["inteligência artificial", "ia", "ai", "machine learning", "automação", "dados", "analytics", "big data", "modelos de linguagem"],
  },
  {
    chave: "sustentabilidade",
    tipo: ["ativo", "necessidade"],
    icone: "🌱",
    sinonimos: ["sustentabilidade", "esg", "sustentável", "crédito de carbono", "ambiental", "economia circular", "impacto socioambiental", "descarbonização"],
  },
  {
    chave: "rede_de_contatos",
    tipo: ["ativo", "necessidade"],
    icone: "🔗",
    sinonimos: ["rede de contatos", "networking", "indicações", "indicação de clientes", "relacionamento", "contatos", "conexões", "apresentações"],
  },
  {
    chave: "equipamentos",
    tipo: ["ativo", "necessidade"],
    icone: "🛠️",
    sinonimos: ["equipamentos", "equipamento", "maquinário", "máquina", "máquinas", "implementos", "locação de equipamentos", "ativo imobilizado"],
  },
] as const satisfies readonly ItemVocabulario[];

export type ChaveVocabulario = (typeof ITENS_VOCABULARIO)[number]["chave"];
