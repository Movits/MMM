/**
 * Etapa 11 — o cruzamento não pode ser feito por palavra parecida.
 *
 * "Exportar vinho" e "importar vinho" são quase o mesmo texto, mas uma ponta
 * quer vender e a outra quer comprar: é aí que existe negócio. Duas pontas que
 * querem exportar são concorrentes e nunca devem ser apresentadas uma à outra.
 *
 * A direção mora em dois lugares, e eles podem se contradizer:
 *
 *   1. No CAMPO — `contact_assets` é o que a pessoa possui, `contact_needs` é o
 *      que ela procura. É o que o motor sempre usou.
 *   2. Na PALAVRA — quem escreve "procuro exportar vinho" está oferecendo, não
 *      demandando, ainda que o texto esteja no campo de procura. E é assim que
 *      se fala: a necessidade é redigida como objetivo.
 *
 * Quando as duas fontes discordam, a palavra manda: a pessoa disse com todas as
 * letras o que pretende fazer. Foi essa contradição que fez o motor casar duas
 * exportadoras em 100 antes desta regra existir.
 *
 * DISCIPLINA DA LISTA — só entram VERBOS de direção, e só quando o verbo é
 * inequívoco:
 *
 *   - Verbo, não substantivo. "Compradores no exterior" nomeia uma coisa que
 *     alguém pode ter para oferecer; não diz que quem escreveu vai comprar.
 *     Classificar atores por direção quebraria matches legítimos que já
 *     funcionam hoje.
 *   - Inequívoco nos dois sentidos. "Alugar" fica de fora de propósito: em
 *     português serve tanto para quem cede quanto para quem toma o imóvel.
 *   - Só conta na CABEÇA do termo. "Exportar vinho" começa com o verbo e
 *     declara uma ação. "Assessoria em exportação" começa com o serviço
 *     oferecido — a exportação ali é assunto, não direção, e o termo fica
 *     neutro.
 *
 * Em caso de dúvida, o termo é neutro: neutro devolve o comportamento anterior,
 * que é o pior que pode acontecer aqui. Uma classificação errada, não.
 */

export type Direcao = "oferta" | "demanda" | "neutro";

/** Quem escreve isto na cabeça do termo está dando/saindo com alguma coisa. */
const VERBOS_DE_OFERTA = [
  // pt
  "exportar", "exportacao", "exportacoes", "vender", "venda", "vendas",
  "fornecer", "fornecimento", "distribuir", "distribuicao", "escoar",
  "escoamento", "prestar", "investir",
  // en
  "export", "exporting", "exports", "sell", "selling", "supply", "supplying",
  "distribute", "distributing",
  // es
  "exportar", "exportacion", "exportaciones", "vender", "venta", "ventas",
  "suministrar", "suministro", "distribuir",
];

/** Quem escreve isto na cabeça do termo está pedindo/entrando com alguma coisa. */
const VERBOS_DE_DEMANDA = [
  // pt
  "importar", "importacao", "importacoes", "comprar", "compra", "compras",
  "adquirir", "aquisicao", "contratar", "contratacao", "terceirizar",
  "captar", "captacao",
  // en
  "import", "importing", "imports", "buy", "buying", "purchase", "purchasing",
  "acquire", "hire", "hiring", "outsource", "outsourcing",
  // es
  "importar", "importacion", "importaciones", "comprar", "compra", "compras",
  "adquirir", "adquisicion", "contratar", "subcontratar",
];

/**
 * Marcadores fracos: anunciam que ali vem o que a pessoa tem ou quer, mas não
 * dizem QUE ação ela vai tomar. "Procura terras raras" e "Terras raras" são a
 * mesma coisa dita de dois jeitos — e é assim que se escreve, principalmente
 * porque aqui se registra o que OS CONTATOS têm e querem, na terceira pessoa.
 *
 * Servem só para revelar o objeto, e por isso a direção que sobra é `neutro`.
 * Deixá-los marcar direção quebraria o caso legítimo: uma recrutadora que
 * OFERECE "Procura de talentos" e uma empresa que PROCURA "Procura de talentos"
 * seriam lidas como duas demandas — ou seja, concorrentes — e o motor deixaria
 * de apresentar exatamente quem devia. Quem manda em direção é a lista de
 * verbos abaixo, e só ela.
 *
 * Quando um verbo de direção vem DEPOIS do marcador, é ele que vale:
 * "procuro exportar vinho" é oferta, porque quem escreveu disse o que pretende
 * fazer.
 */
const MARCADORES_FRACOS = new Set([
  // pt — o que a pessoa quer
  "procura", "procuro", "procurar", "procurando", "busca", "busco", "buscar",
  "buscando", "precisa", "preciso", "precisar", "precisando", "necessita",
  "necessito", "necessitar", "quer", "quero", "querer", "querendo", "interesse",
  "interessada", "interessado",
  // pt — o que a pessoa tem
  "possui", "possuo", "possuir", "tem", "tenho", "ter", "oferece", "ofereco",
  "oferecer", "oferecendo", "oferta", "disponibiliza", "disponivel", "dispoe",
  // en
  "needs", "need", "wants", "want", "looking", "seeking", "searching",
  "has", "have", "offers", "offering", "available",
  // es
  "necesita", "necesito", "quiere", "quiero", "tiene", "tengo", "ofrece", "ofrezco",
]);

const DIRECAO_POR_VERBO = new Map<string, Direcao>([
  ...VERBOS_DE_OFERTA.map(v => [v, "oferta" as Direcao] as const),
  ...VERBOS_DE_DEMANDA.map(v => [v, "demanda" as Direcao] as const),
]);

/**
 * Só o genitivo apresenta o objeto: "exportação DE vinho" — o vinho é a coisa.
 */
const GENITIVOS = new Set(["de", "da", "do", "das", "dos", "of"]);

const ARTIGOS = new Set(["a", "o", "as", "os", "um", "uma", "the", "el", "la", "los", "las", "un", "una"]);

/**
 * Preposição que apresenta destino, canal ou circunstância — nunca o produto.
 * Diante de uma delas o termo NÃO tem objeto extraível, e é isso que impede um
 * dos piores erros possíveis aqui:
 *
 *   "Exportação PARA a China"  x  "Importação DA China"
 *
 * Descascando os dois até o fim sobrava "china" dos dois lados, e o par saía em
 * 100 — o score máximo, reservado a quem tem a mesma coisa — sendo que um
 * exporta calçado e o outro importa eletrônico. Em comércio exterior o
 * complemento do termo é quase sempre o lugar, não a mercadoria, então o erro
 * não era raro: era o caso comum. Pior, 100 passa de EMAIL_THRESHOLD e o par
 * ainda saía por e-mail como oportunidade.
 *
 * "Importação da China" continua rendendo objeto "china", porque o genitivo é
 * genuinamente ambíguo em português. O que se evita é o par entre um genitivo e
 * um locativo, que era de onde vinham os casos medidos.
 */
const LOCATIVOS = new Set([
  "para", "em", "no", "na", "nos", "nas", "com", "por", "ao", "aos", "entre",
  "sobre", "for", "to", "in", "on", "at", "with", "en", "hacia", "con",
]);

/**
 * O objeto que vem depois de uma cabeça, ou `null` quando não há objeto
 * extraível — caso em que o termo vale por inteiro e não empresta o
 * complemento a ninguém.
 */
function objetoDepoisDe(resto: string[]): string[] | null {
  if (!resto.length || LOCATIVOS.has(resto[0])) return null;
  const palavras = [...resto];
  while (palavras.length && (GENITIVOS.has(palavras[0]) || ARTIGOS.has(palavras[0]))) palavras.shift();
  if (!palavras.length || LOCATIVOS.has(palavras[0])) return null;
  return palavras;
}

function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokens(texto: string) {
  return normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
}

export type TermoAnalisado = {
  /** O que a palavra declara, independente do campo em que foi escrita. */
  direcao: Direcao;
  /** O termo sem o verbo de direção: é isto que as duas pontas têm em comum. */
  objeto: string;
  /** O verbo encontrado, para poder explicar a decisão a quem lê a tela. */
  verbo: string | null;
};

/**
 * Lê a cabeça do termo. Se ela for um verbo de direção, separa o verbo do
 * objeto; se não, o termo inteiro é o objeto e a direção fica com o campo.
 */
export function analisarTermo(rotulo: string): TermoAnalisado {
  const palavras = tokens(rotulo);

  // Descasca os marcadores fracos da frente. Quando o que vem depois não é
  // objeto extraível, para de descascar: "Procura", sozinho, continua sendo
  // "procura", senão o objeto virava vazio e casaria com qualquer outro vazio.
  let resto = [...palavras];
  while (resto.length > 1 && MARCADORES_FRACOS.has(resto[0])) {
    const depois = objetoDepoisDe(resto.slice(1));
    if (!depois) break;
    resto = depois;
  }

  const cabeca = resto[0];
  const direcao = cabeca ? DIRECAO_POR_VERBO.get(cabeca) : undefined;

  if (!direcao) return { direcao: "neutro", objeto: resto.join("-"), verbo: null };

  // Sem objeto extraível — "Exportação" sozinho, ou "Exportação para a China" —
  // o termo vale por inteiro. É o que impede o complemento de lugar de virar a
  // coisa que as duas pontas supostamente têm em comum.
  const objeto = objetoDepoisDe(resto.slice(1));
  if (!objeto) return { direcao, objeto: resto.join("-"), verbo: cabeca };

  return { direcao, objeto: objeto.join("-"), verbo: cabeca };
}

/**
 * A direção que vale, cruzando o campo com a palavra. `campo` é "oferta" para
 * o que a pessoa possui e "demanda" para o que ela procura.
 */
export function direcaoEfetiva(rotulo: string, campo: "oferta" | "demanda") {
  const { direcao } = analisarTermo(rotulo);
  return direcao === "neutro" ? campo : direcao;
}

/**
 * Cabeças TRANSPARENTES: substantivos de papel ou estrutura que apresentam a
 * substância pelo genitivo sem mudar do que se trata. "Mina DE terras raras" e
 * "fornecedor DE terras raras" falam ambos de terras raras — e é exatamente o
 * exemplo de aceite da etapa 7, que sem esta lista pontuava 0.
 *
 * Mesma disciplina da lista de verbos: só entra substantivo cujo genitivo é
 * inequivocamente a mercadoria. "Sapatos de couro" fica de fora de propósito —
 * ali o genitivo é o MATERIAL, e reduzir os dois lados a "couro" casaria sapato
 * com bolsa. Papel (fornecedor, produtor) e estrutura produtiva (mina, fazenda,
 * fábrica) são os casos seguros; na dúvida, o termo vale por inteiro, que é o
 * comportamento anterior.
 */
const CABECAS_TRANSPARENTES = new Set([
  // pt — papéis
  "fornecedor", "fornecedora", "fornecedores", "fornecedoras",
  "produtor", "produtora", "produtores", "produtoras",
  "fabricante", "fabricantes", "distribuidor", "distribuidora",
  "distribuidores", "distribuidoras", "atacadista", "atacadistas",
  "revendedor", "revendedora", "revendedores", "revendedoras",
  "representante", "representantes", "importador", "importadora",
  "importadores", "importadoras", "exportador", "exportadora",
  "exportadores", "exportadoras",
  // pt — estruturas produtivas
  "mina", "minas", "jazida", "jazidas", "fazenda", "fazendas",
  "plantacao", "plantacoes", "criacao", "criacoes", "industria",
  "industrias", "fabrica", "fabricas", "usina", "usinas",
  "producao", "estoque", "estoques", "safra", "safras",
  // en
  "supplier", "suppliers", "producer", "producers", "manufacturer",
  "manufacturers", "distributor", "distributors", "mine", "mines",
  "farm", "farms", "factory", "factories", "stock",
  // es
  "proveedor", "proveedores", "productor", "productores", "distribuidor",
  "distribuidores", "granja", "granjas",
]);

/**
 * O núcleo do termo: a substância de que ele trata, atravessando uma cabeça
 * transparente quando houver. "Mina de terras raras" → "terras-raras";
 * "Fornecedor de terras raras" → "terras-raras"; "Terras raras" → "terras-raras".
 * Sem cabeça transparente seguida de genitivo, o núcleo é o próprio objeto —
 * nada muda para quem já casava antes.
 */
export function nucleoDoTermo(rotulo: string): string {
  const { objeto } = analisarTermo(rotulo);
  const palavras = objeto.split("-").filter(Boolean);
  if (palavras.length < 3) return objeto;
  // Exige a forma exata "CABEÇA + genitivo + substância": é o padrão em que a
  // cabeça comprovadamente não é a mercadoria. Qualquer outra forma fica inteira.
  if (!CABECAS_TRANSPARENTES.has(palavras[0]) || !GENITIVOS.has(palavras[1])) return objeto;
  const substancia = objetoDepoisDe(palavras.slice(1));
  return substancia ? substancia.join("-") : objeto;
}

/**
 * São concorrentes? Só respondemos que sim quando AS DUAS pontas trazem verbo
 * explícito e os dois verbos apontam para o mesmo lado. Com uma ponta neutra
 * não há evidência de conflito nas palavras — e o campo já separou uma da
 * outra, que é o comportamento de sempre.
 */
export function saoConcorrentes(rotuloOferta: string, rotuloDemanda: string) {
  const a = analisarTermo(rotuloOferta);
  const b = analisarTermo(rotuloDemanda);
  if (a.direcao === "neutro" || b.direcao === "neutro") return false;
  return a.direcao === b.direcao;
}
