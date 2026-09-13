/**
 * O TIPO do que alguém tem a oferecer — a classificação que a regra da demanda
 * expressa exige antes de qualquer cruzamento (pedido do Nicolas, 12/09/2026).
 *
 * O problema que ela resolve: quem registrava um SERVIÇO em "o que tenho"
 * ("Advocacia tributária") casava com meia rede, porque quase toda empresa
 * "poderia precisar" de um tributarista — e o motor tratava essa necessidade
 * presumida como se fosse declarada. A regra: serviço só casa com quem
 * DECLAROU precisar dele (ou de solução equivalente) em "o que preciso".
 * Setor, atividade econômica, porte, localização, cargo, problemas típicos do
 * segmento, obrigações legais e utilidade provável não são necessidade: podem
 * subir a nota de um match que já passou pelo portão, nunca criá-lo.
 *
 * Os nove tipos são os do pedido. Só "servico" muda comportamento (é o
 * portão); os outros existem para o motor e a IA falarem o mesmo vocabulário e
 * para a regra não vazar para produtos, ativos, investimento, conexões etc.,
 * que continuam casando como antes.
 *
 * DISCIPLINA — a mesma de direcao-do-termo.ts: listas curadas em pt/en/es, a
 * decisão pela CABEÇA do termo (a primeira palavra depois dos marcadores
 * fracos "oferece", "tem", "possui", dos artigos e do genitivo), e na dúvida
 * "outros", que devolve o comportamento anterior. Classificar errado como
 * serviço apaga um match legítimo por categoria; classificar errado como outra
 * coisa deixa passar um presumido. Entre os dois, a lista de serviço só tem
 * palavra que nomeia inequivocamente uma prestação profissional. Logística,
 * transporte, frete e armazenagem ficam de fora de propósito: no vocabulário
 * da plataforma são capacidades operacionais ("Armazenagem refrigerada" é o
 * exemplo de "o que possui" na própria tela; "Logística" é opção de "O que
 * tenho" no onboarding), não prestação de serviço profissional. Papéis de
 * comércio (fornecedor, distribuidor, representante) também não: são quem TEM
 * a mercadoria, e o núcleo do termo já os atravessa até ela.
 *
 * Ordem da decisão, e por quê:
 *   1. substantivo de serviço COLADO à cabeça, sem preposição no meio ("Tax
 *      consulting", "Logistics consulting", "Real estate consulting",
 *      "Logística e consultoria aduaneira"): em inglês o substantivo do
 *      serviço vem depois, e é ele a cabeça de fato;
 *   2. composto fixo de duas palavras ("real estate", "venture capital");
 *   3. a cabeça do termo, quando é palavra de um tipo ("Software de
 *      consultoria" é tecnologia: a cabeça manda);
 *   4. cabeça neutra (empresa, escritório, equipe...): um substantivo ou
 *      adjetivo de serviço em qualquer posição decide ("Escritório de
 *      advocacia", "Empresa de contabilidade", "Escritório jurídico");
 *   5. a categoria que a usuária digitou ("Jurídico", "Serviços", "Produto";
 *      uma categoria de outro tipo vence "serviços": "Serviços financeiros"
 *      é capital);
 *   6. "outros".
 * Cabeça desconhecida seguida de preposição fica com o que ela é: "Peças DE
 * manutenção" é produto, "Centro DE treinamento" é infraestrutura, "Relatório
 * DE auditoria" não é serviço — o serviço ali é modificador, e tratá-lo como
 * tipo apagava o match por categoria que esses itens tinham (revisão
 * adversarial de 12/09).
 */
import { ARTIGOS, GENITIVOS, MARCADORES_FRACOS, tokensDoTermo } from "./direcao-do-termo";

export type TipoDaOferta =
  | "servico"
  | "produto"
  | "ativo"
  | "oportunidade"
  | "investimento"
  | "conexao"
  | "tecnologia"
  | "imovel"
  | "outros";

/** Os nove tipos, na ordem do pedido, com o rótulo que a IA e a documentação usam. */
export const TIPOS_DA_OFERTA: ReadonlyArray<{ tipo: TipoDaOferta; rotulo: string }> = [
  { tipo: "servico", rotulo: "Serviço" },
  { tipo: "produto", rotulo: "Produto" },
  { tipo: "ativo", rotulo: "Ativo" },
  { tipo: "oportunidade", rotulo: "Oportunidade" },
  { tipo: "investimento", rotulo: "Investimento/Capital" },
  { tipo: "conexao", rotulo: "Conexão/Network" },
  { tipo: "tecnologia", rotulo: "Tecnologia" },
  { tipo: "imovel", rotulo: "Imóvel/Infraestrutura" },
  { tipo: "outros", rotulo: "Outros" },
];

// Tudo abaixo está normalizado (minúsculas, sem acento), como as listas de
// direcao-do-termo.ts. Cada palavra pertence a UM tipo só — o teste do módulo
// confere, porque uma repetição sobrescreveria a anterior em silêncio.

/**
 * Serviços de ASSESSORIA: consultoria, jurídico, contábil, auditoria, mentoria.
 * É o subconjunto que atende a opção "Consultoria" da lista fixa de "O que
 * preciso" do onboarding — a única opção da lista em que alguém DECLARA
 * precisar de um serviço profissional (ver `ehServicoDeAssessoria`).
 */
const ASSESSORIA = [
  // pt
  "consultoria", "consultorias", "consultor", "consultora", "consultores", "consultoras",
  "assessoria", "assessorias", "assessor", "assessora", "assessores", "assessoras",
  "advocacia", "advogado", "advogada", "advogados", "advogadas",
  "juridico", "juridica", "juridicos", "juridicas",
  "contabilidade", "contabil", "contabeis", "contador", "contadora", "contadores", "contadoras",
  "auditoria", "auditorias", "auditor", "auditora", "auditores", "auditoras",
  "mentoria", "mentorias", "mentor", "mentora", "mentores", "mentoras",
  "coaching", "coach",
  // en
  "consulting", "consultancy", "consultant", "consultants",
  "advisory", "advisor", "advisors", "adviser", "advisers",
  "lawyer", "lawyers", "attorney", "attorneys",
  "accounting", "accountant", "accountants", "bookkeeping",
  "audit", "auditing", "audits",
  "mentoring", "mentorship",
  // es
  "asesoria", "asesorias", "asesor", "asesora", "asesores", "asesoras",
  "abogacia", "abogado", "abogada", "abogados", "abogadas",
  "contabilidad", "contable", "contables",
];

/**
 * "Legal" e "law" só valem na CABEÇA ("Legal advisory", "Law firm"): no meio
 * do termo, "legal" é adjetivo de qualquer coisa ("Cannabis legal").
 */
const ASSESSORIA_SO_NA_CABECA = ["legal", "law"];

/** Os demais serviços profissionais — inequívocos como prestação. */
const OUTROS_SERVICOS = [
  // pt
  "servico", "servicos", "prestacao",
  "marketing", "publicidade", "propaganda",
  "design", "designer", "designers",
  "arquitetura", "arquiteto", "arquiteta", "arquitetos", "arquitetas",
  "engenharia",
  "treinamento", "treinamentos", "capacitacao", "capacitacoes", "curso", "cursos",
  "palestra", "palestras",
  "traducao", "traducoes", "tradutor", "tradutora", "tradutores", "tradutoras",
  "interpretacao", "interprete", "interpretes",
  "despachante", "despachantes", "desembaraco",
  "corretagem", "corretor", "corretora", "corretores", "corretoras",
  "recrutamento", "headhunting", "headhunter", "headhunters",
  "terceirizacao", "outsourcing",
  // "instalacao" fica de fora: "Instalação portuária" é a instalação física.
  "manutencao", "suporte", "assistencia", "atendimento",
  "agenciamento", "intermediacao",
  // en
  "service", "services",
  "advertising",
  "architecture", "architect", "architects",
  "engineering",
  "training", "trainings",
  "translation", "translations", "translator", "translators",
  "interpreting", "interpreter", "interpreters",
  "brokerage", "broker", "brokers",
  "recruitment", "recruiting",
  "maintenance", "support", "assistance",
  // es
  "servicio", "servicios",
  "publicidad",
  "diseno", "disenador", "disenadora", "disenadores",
  "arquitectura", "arquitecto", "arquitecta", "arquitectos",
  "ingenieria",
  "capacitacion", "formacion", "entrenamiento",
  "traduccion", "traducciones", "traductor", "traductora", "traductores",
  "corretaje", "corredor", "corredora", "corredores",
  "reclutamiento", "tercerizacion",
  "mantenimiento", "soporte",
];

/**
 * Adjetivos de serviço: só decidem atrás de cabeça NEUTRA ("Escritório
 * jurídico"). Soltos no termo são adjetivo de qualquer coisa — "Pessoa
 * jurídica", "Estrutura jurídica em Portugal", "Dados contábeis".
 */
const ADJETIVOS_DE_SERVICO = new Set([
  "juridico", "juridica", "juridicos", "juridicas", "contabil", "contabeis", "contable", "contables",
]);

/**
 * Substantivos que nomeiam a prestação em si. Decidem (a) colados à cabeça,
 * sem preposição no meio — "Tax consulting", "Logistics consulting",
 * "Logística e consultoria aduaneira" — e (b) em qualquer posição atrás de
 * cabeça neutra ("Empresa de contabilidade"). Atrás de preposição, com cabeça
 * de outra natureza, são só modificador: "Peças DE manutenção" é produto,
 * "Centro DE treinamento" é infraestrutura, "Ferramenta DE marketing" é
 * tecnologia. "design", "engenharia", "suporte" ficam de fora até da lista —
 * "Móveis de design" e "Peças de engenharia" são produto.
 */
const SUBSTANTIVOS_DE_SERVICO = new Set([
  ...ASSESSORIA.filter(palavra => !ADJETIVOS_DE_SERVICO.has(palavra)),
  "servico", "servicos", "service", "services", "servicio", "servicios",
  "marketing", "publicidade", "publicidad", "advertising",
  "treinamento", "treinamentos", "capacitacao", "capacitacion", "training",
  "traducao", "traduccion", "translation",
  "despachante", "despachantes", "desembaraco",
  "recrutamento", "recruitment", "reclutamiento",
  "terceirizacao", "tercerizacion", "outsourcing",
  "manutencao", "mantenimiento", "maintenance",
]);

/**
 * "Serviços" sozinho não nomeia serviço nenhum: como família (ver
 * `familiaDoServico`) diria que "Serviços" procurado casa com qualquer
 * prestação, e como necessidade genérica seria "preciso de serviços".
 */
const GENERICAS_DEMAIS = new Set(["servico", "servicos", "service", "services", "servicio", "servicios"]);

/** Depois de uma destas, o que vem é complemento da cabeça, não a coisa oferecida. */
const PREPOSICOES = new Set([
  ...Array.from(GENITIVOS), "para", "em", "no", "na", "nos", "nas", "com", "por", "sobre", "ao", "aos", "a", "as",
  "for", "to", "in", "on", "with", "from", "at", "en", "con", "al", "del", "desde", "hacia",
]);

const PRODUTO = [
  "produto", "produtos", "product", "products", "producto", "productos",
  "mercadoria", "mercadorias", "goods", "merchandise", "mercancia", "mercancias",
  "estoque", "estoques", "stock", "inventario", "inventory",
  "commodity", "commodities", "materia", "materias",
];

const ATIVO = [
  "ativo", "ativos", "asset", "assets", "activo", "activos",
  "mina", "minas", "mine", "mines", "jazida", "jazidas",
  "fazenda", "fazendas", "farm", "farms", "granja", "granjas",
  "plantacao", "plantacoes", "plantation", "plantations",
  "criacao", "criacoes",
  "industria", "industrias", "industry", "industries",
  "fabrica", "fabricas", "factory", "factories", "usina", "usinas",
  "laboratorio", "laboratorios", "laboratory", "laboratories", "lab", "labs",
  "licenca", "licencas", "license", "licenses", "licence", "licences", "licencia", "licencias",
  "certificacao", "certificacoes", "certification", "certifications", "certificacion",
  "alvara", "alvaras", "outorga", "outorgas", "concessao", "concessoes", "concession", "concessions",
  "frota", "frotas", "fleet", "fleets",
  "maquina", "maquinas", "maquinario", "machine", "machines", "machinery", "maquinaria",
  "equipamento", "equipamentos", "equipment", "equipo", "equipos",
  "logistica", "logistics", "transporte", "transportes", "transport", "frete", "fretes",
  "armazenagem", "armazenamento", "storage",
];

const OPORTUNIDADE = [
  "oportunidade", "oportunidades", "opportunity", "opportunities",
  "projeto", "projetos", "project", "projects", "proyecto", "proyectos",
  "edital", "editais", "licitacao", "licitacoes", "tender", "tenders", "licitacion", "licitaciones",
  "parceria", "parcerias", "partnership", "partnerships",
];

const INVESTIMENTO = [
  "investimento", "investimentos", "investment", "investments", "inversion", "inversiones",
  "capital", "capitais",
  "fundo", "fundos", "fund", "funds", "fondo", "fondos",
  "financiamento", "financiamentos", "financing", "financiacion",
  "credito", "creditos", "credit", "aporte", "aportes",
  "investidor", "investidora", "investidores", "investidoras", "investor", "investors", "inversor", "inversores",
];

const CONEXAO = [
  "conexao", "conexoes", "connection", "connections", "conexion", "conexiones",
  "rede", "redes", "network", "networks", "networking", "red",
  "contato", "contatos", "contact", "contacts", "contacto", "contactos",
  "acesso", "acessos", "access", "acceso", "accesos",
  "relacionamento", "relacionamentos", "relationship", "relationships",
  "canal", "canais", "channel", "channels", "canales",
  "parceiro", "parceiros", "parceira", "parceiras", "partner", "partners",
  "carteira", "cliente", "clientes", "customer", "customers",
  "comprador", "compradores", "compradora", "compradoras", "buyer", "buyers",
];

const TECNOLOGIA = [
  "tecnologia", "tecnologias", "technology", "technologies", "tech",
  "dados", "datos", "data",
  "software", "softwares", "plataforma", "plataformas", "platform", "platforms",
  "app", "apps", "aplicativo", "aplicativos", "aplicacion", "aplicaciones", "application", "applications",
  "sistema", "sistemas", "system", "systems", "saas", "api", "apis",
  "algoritmo", "algoritmos", "algorithm", "algorithms",
  "patente", "patentes", "patent", "patents",
  "automacao", "automation", "automatizacion",
  "robotica", "robotics", "hardware", "dispositivo", "dispositivos", "device", "devices",
  "sensor", "sensores", "sensors", "iot", "blockchain",
];

const IMOVEL = [
  "imovel", "imoveis", "inmueble", "inmuebles", "property", "properties",
  "terreno", "terrenos", "land", "lote", "lotes",
  "galpao", "galpoes", "armazem", "armazens", "warehouse", "warehouses", "deposito", "depositos",
  "predio", "predios", "building", "buildings", "edificio", "edificios",
  "infraestrutura", "infrastructure", "infraestructura",
  "porto", "portos", "port", "ports", "puerto", "puertos", "aeroporto", "aeroportos",
  "ferrovia", "ferrovias", "rodovia", "rodovias",
  "hotel", "hoteis", "hotels", "pousada", "pousadas",
  "espaco", "espacos", "space", "spaces", "espacio", "espacios",
  "condominio", "condominios", "shopping",
];

/**
 * Cabeças que não dizem O QUE se oferece, só quem: "Empresa de contabilidade",
 * "Escritório de advocacia", "Equipe de engenharia". Não decidem; o resto do
 * termo decide. "Escritório" NÃO está em imóvel por isso: "Escritório
 * comercial" cai em "outros" (conservador), "Escritório de advocacia" em
 * serviço.
 */
const CABECAS_NEUTRAS = new Set([
  "empresa", "empresas", "firma", "firmas", "escritorio", "escritorios", "negocio", "negocios",
  "equipe", "equipes", "grupo", "grupos", "profissional", "profissionais", "especialista", "especialistas",
  "company", "companies", "firm", "firms", "office", "offices", "business", "businesses",
  "team", "teams", "group", "groups", "professional", "professionals", "specialist", "specialists",
  "oficina", "oficinas", "profesional", "profesionales",
]);

const COMPOSTOS = new Map<string, TipoDaOferta>([
  ["real estate", "imovel"],
  ["venture capital", "investimento"],
  ["private equity", "investimento"],
  ["seed capital", "investimento"],
  ["joint venture", "oportunidade"],
  ["supply chain", "ativo"],
  ["law firm", "servico"],
  ["legal advisory", "servico"],
  ["legal services", "servico"],
]);

/** O que a CATEGORIA digitada pela usuária diz do tipo, quando o termo não disse. */
const TIPO_POR_PALAVRA_DA_CATEGORIA = new Map<string, TipoDaOferta>([
  ...["servico", "servicos", "service", "services", "servicio", "servicios", "consultoria", "assessoria",
    "asesoria", "consulting", "advisory", "juridico", "juridica", "legal", "advocacia", "abogacia",
    "contabil", "contabilidade", "contabilidad", "accounting"].map(p => [p, "servico"] as const),
  ...["produto", "produtos", "product", "products", "producto", "productos", "mercadoria", "mercadorias"].map(p => [p, "produto"] as const),
  ...["ativo", "ativos", "asset", "assets", "activo", "activos"].map(p => [p, "ativo"] as const),
  ...["oportunidade", "oportunidades", "opportunity", "opportunities"].map(p => [p, "oportunidade"] as const),
  ...["investimento", "investimentos", "investment", "investments", "inversion", "inversiones", "capital",
    "financiamento", "financing", "financeiro", "financeiros", "financeira", "financeiras", "financial",
    "credito", "creditos", "credit"].map(p => [p, "investimento"] as const),
  ...["conexao", "conexoes", "connection", "connections", "network", "networking", "rede", "contatos",
    "relacionamento"].map(p => [p, "conexao"] as const),
  ...["tecnologia", "technology", "tech", "software", "tecnologico", "tecnologica"].map(p => [p, "tecnologia"] as const),
  ...["imovel", "imoveis", "imobiliario", "imobiliaria", "inmueble", "inmuebles", "infraestrutura",
    "infrastructure", "infraestructura", "property", "properties"].map(p => [p, "imovel"] as const),
]);

/** As listas por tipo — exposto para o teste conferir que nenhuma palavra está em dois tipos. */
export const LISTAS_POR_TIPO: ReadonlyArray<readonly [TipoDaOferta, readonly string[]]> = [
  ["servico", [...ASSESSORIA, ...ASSESSORIA_SO_NA_CABECA, ...OUTROS_SERVICOS]],
  ["produto", PRODUTO],
  ["ativo", ATIVO],
  ["oportunidade", OPORTUNIDADE],
  ["investimento", INVESTIMENTO],
  ["conexao", CONEXAO],
  ["tecnologia", TECNOLOGIA],
  ["imovel", IMOVEL],
];

const TIPO_POR_CABECA = new Map<string, TipoDaOferta>(
  LISTAS_POR_TIPO.flatMap(([tipo, palavras]) => palavras.map(palavra => [palavra, tipo] as const)),
);

const ASSESSORIA_SET = new Set(ASSESSORIA);
const ASSESSORIA_SO_NA_CABECA_SET = new Set(ASSESSORIA_SO_NA_CABECA);

/** A cabeça do termo (a primeira palavra que não é marcador fraco, artigo nem genitivo) e onde ela está. */
function cabecaDoTermo(palavras: string[]) {
  let i = 0;
  while (i < palavras.length - 1 && (MARCADORES_FRACOS.has(palavras[i]) || ARTIGOS.has(palavras[i]) || GENITIVOS.has(palavras[i]))) i += 1;
  return { indice: i, cabeca: palavras[i] as string | undefined, seguinte: palavras[i + 1] as string | undefined };
}

/** As palavras coladas à cabeça, até a primeira preposição. */
function juntoDaCabeca(palavras: string[], indice: number) {
  const fim = palavras.findIndex((palavra, i) => i > indice && PREPOSICOES.has(palavra));
  return palavras.slice(indice + 1, fim < 0 ? undefined : fim);
}

/**
 * O que a categoria digitada diz. Uma palavra de OUTRO tipo vence "serviços":
 * "Serviços financeiros" é capital, "Serviços de tecnologia" é tecnologia —
 * a regra do serviço não pode vazar para investimento e tecnologia por causa
 * da palavra "serviços" na categoria.
 */
function tipoPelaCategoria(categoria: string | null | undefined): TipoDaOferta | null {
  let servico = false;
  for (const palavra of tokensDoTermo(categoria ?? "")) {
    const tipo = TIPO_POR_PALAVRA_DA_CATEGORIA.get(palavra);
    if (!tipo) continue;
    if (tipo === "servico") servico = true;
    else return tipo;
  }
  return servico ? "servico" : null;
}

/**
 * Classifica um item de "o que tenho" / "o que possui". `categoria` é a
 * categoria livre que a usuária digitou junto (opcional) e só decide quando o
 * texto do item não decidiu. Na dúvida, "outros".
 */
export function classificarOferta(rotulo: string, categoria?: string | null): TipoDaOferta {
  const palavras = tokensDoTermo(rotulo);
  const { indice, cabeca, seguinte } = cabecaDoTermo(palavras);
  // Antes do composto: "Real estate consulting" e "Supply chain consulting"
  // são consultoria, não o imóvel nem a cadeia.
  if (juntoDaCabeca(palavras, indice).some(palavra => SUBSTANTIVOS_DE_SERVICO.has(palavra))) return "servico";
  if (cabeca && seguinte) {
    const composto = COMPOSTOS.get(`${cabeca} ${seguinte}`);
    if (composto) return composto;
  }
  if (cabeca && !CABECAS_NEUTRAS.has(cabeca)) {
    const pelaCabeca = TIPO_POR_CABECA.get(cabeca);
    if (pelaCabeca) return pelaCabeca;
  }
  if (cabeca && CABECAS_NEUTRAS.has(cabeca) && palavras.some(palavra => SUBSTANTIVOS_DE_SERVICO.has(palavra) || ADJETIVOS_DE_SERVICO.has(palavra))) {
    return "servico";
  }
  return tipoPelaCategoria(categoria) ?? "outros";
}

/**
 * A FAMÍLIA do serviço oferecido: o primeiro substantivo de serviço do termo
 * ("consultoria" em "Consultoria jurídica" e em "Empresa de consultoria").
 * null quando o item não é serviço ou quando o único substantivo é o genérico
 * "serviços".
 */
export function familiaDoServico(rotulo: string, categoria?: string | null): string | null {
  if (!ehServico(rotulo, categoria)) return null;
  return tokensDoTermo(rotulo).find(palavra => SUBSTANTIVOS_DE_SERVICO.has(palavra) && !GENERICAS_DEMAIS.has(palavra)) ?? null;
}

/**
 * A necessidade é GENÉRICA e nomeia a família do serviço? "Consultoria"
 * procurado diante de "Consultoria jurídica" possuído: quem escreveu
 * "consultoria" declarou precisar de consultoria, e a especialidade da oferta
 * não desfaz a declaração. Só vale com a necessidade reduzida a UMA palavra de
 * serviço (tirados marcadores e artigos): "Consultoria em marketing" procurado
 * é outra necessidade e não casa com "Consultoria jurídica" (objeto
 * diferente); "Serviços" procurado não nomeia família nenhuma.
 */
export function necessidadeGenericaNomeiaOServico(oferta: string, categoriaDaOferta: string | null | undefined, necessidade: string): boolean {
  const palavras = tokensDoTermo(necessidade);
  const { indice, cabeca } = cabecaDoTermo(palavras);
  if (!cabeca || palavras.length - indice !== 1) return false;
  if (!SUBSTANTIVOS_DE_SERVICO.has(cabeca) || GENERICAS_DEMAIS.has(cabeca)) return false;
  return familiaDoServico(oferta, categoriaDaOferta) === cabeca;
}

/** O item é um SERVIÇO — o único tipo em que o portão da demanda expressa atua. */
export function ehServico(rotulo: string, categoria?: string | null): boolean {
  return classificarOferta(rotulo, categoria) === "servico";
}

/**
 * Serviço de assessoria (consultoria, jurídico, contábil, auditoria,
 * mentoria)? É o que atende a opção fixa "Consultoria" de "O que preciso" no
 * perfil: quem marcou essa opção DECLAROU precisar de um serviço desse tipo.
 * Marketing, tradução ou manutenção não são consultoria e ficam de fora.
 */
export function ehServicoDeAssessoria(rotulo: string, categoria?: string | null): boolean {
  if (!ehServico(rotulo, categoria)) return false;
  const palavras = tokensDoTermo(rotulo);
  const { cabeca } = cabecaDoTermo(palavras);
  if (cabeca && ASSESSORIA_SO_NA_CABECA_SET.has(cabeca)) return true;
  if (palavras.some(palavra => ASSESSORIA_SET.has(palavra))) return true;
  return tokensDoTermo(categoria ?? "").some(palavra => ASSESSORIA_SET.has(palavra) || palavra === "juridico" || palavra === "juridica" || palavra === "legal");
}
