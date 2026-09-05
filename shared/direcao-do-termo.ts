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
 * DISCIPLINA DA LISTA — só entram palavras de direção inequívoca, e em duas
 * listas separadas, porque verbo e substantivo de ação não dizem a mesma coisa:
 *
 *   - VERBO flexionado ("Exportar vinho") declara a ação de quem escreveu.
 *   - SUBSTANTIVO de ação ("Exportação de vinho", "Captação de recursos") nomeia
 *     a ação — e, no campo de procura, nomeia o SERVIÇO de que a pessoa precisa.
 *     Escrito igual dos dois lados, é o serviço que uma presta e a outra quer:
 *     casa, não concorre. (Reverificação de 04/09: "Captação de recursos" ×
 *     idem saía 0 como "concorrentes" — e "Supply chain management" também,
 *     porque em inglês a mesma palavra é verbo e substantivo.)
 *   - Substantivo seguido de palavra justaposta ("Compras públicas", "Venda
 *     direta") é um composto que nomeia uma coisa, não a ação de quem escreveu:
 *     neutro. Em inglês o mesmo vale para o verbo seguido de complemento nominal
 *     ("Import license", "Sell-side advisory").
 *   - Ator não é direção. "Compradores no exterior" nomeia uma coisa que
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

/** VERBO na cabeça: quem escreve isto está dando/saindo com alguma coisa. */
const VERBOS_DE_OFERTA = [
  // pt
  "exportar", "vender", "fornecer", "distribuir", "escoar", "prestar", "investir",
  // en — "export" e "supply" são verbo E substantivo; a leitura de verbo
  // continua, e o composto nominal ("Export manager") e a forma com "of"
  // ("Supply of rare earths") são tratados em `analisar` (CABECAS_NOMINAIS_EN).
  "export", "exporting", "sell", "selling", "supply", "supplying",
  "distribute", "distributing",
  // es
  "exportar", "vender", "suministrar", "distribuir",
];

/** VERBO na cabeça: quem escreve isto está pedindo/entrando com alguma coisa. */
const VERBOS_DE_DEMANDA = [
  // pt
  "importar", "comprar", "adquirir", "contratar", "terceirizar", "captar",
  // en
  "import", "importing", "buy", "buying", "purchase", "purchasing", "acquire",
  "hire", "hiring", "outsource", "outsourcing",
  // es
  "importar", "comprar", "adquirir", "contratar", "subcontratar",
];

/** SUBSTANTIVO de ação na cabeça, do lado de quem dá/sai. */
const SUBSTANTIVOS_DE_OFERTA = [
  // pt
  "exportacao", "exportacoes", "venda", "vendas", "fornecimento",
  "distribuicao", "escoamento",
  // en — "exports" na cabeça de uma tag é o plural ("Exports of coffee"), como
  // "exportações"; a 3ª pessoa do verbo não se escreve em tag.
  "exports",
  // es
  "exportacion", "exportaciones", "venta", "ventas", "suministro",
];

/** SUBSTANTIVO de ação na cabeça, do lado de quem pede/entra. */
const SUBSTANTIVOS_DE_DEMANDA = [
  // pt
  "importacao", "importacoes", "compra", "compras", "aquisicao",
  "contratacao", "captacao",
  // en
  "imports",
  // es
  "importacion", "importaciones", "compra", "compras", "adquisicion",
];

const VERBOS_FLEXIONADOS = new Set([...VERBOS_DE_OFERTA, ...VERBOS_DE_DEMANDA]);
const SUBSTANTIVOS_DE_ACAO = new Set([...SUBSTANTIVOS_DE_OFERTA, ...SUBSTANTIVOS_DE_DEMANDA]);

/**
 * Cabeças inglesas que são verbo E substantivo com a mesma grafia ("import",
 * "export", "supply", "purchase"), ou gerúndio que se usa como adjetivo
 * ("purchasing manager", "exporting company", "hiring manager"). Seguidas de
 * um COMPLEMENTO NOMINAL abrem um composto que nomeia uma coisa — "import
 * license", "supply chain management", "export manager" — e não a ação de
 * quem escreveu. O termo fica neutro e vale por inteiro.
 *
 * Verbo PURO fica de fora de propósito: "sell", "buy", "hire", "acquire",
 * "distribute", "outsource" não são substantivo, e o que vem depois deles é o
 * objeto. "Sell insurance" × "Buy insurance" é o negócio (revisão adversarial
 * de 05/09: a lista aplicada a todo verbo derrubou esse par de 100 para 60).
 * "Exports"/"imports" não estão aqui porque são substantivo de ação, e o
 * composto deles ("Exports department") já cai na regra do justaposto.
 */
const CABECAS_NOMINAIS_EN = new Set([
  "export", "exporting", "import", "importing", "supply", "supplying",
  "purchase", "purchasing", "selling", "buying", "hiring", "outsourcing",
  "distributing",
]);

/**
 * "Sell-side" e "buy-side" são compostos fixos do mercado financeiro: a única
 * vez em que verbo puro abre composto, e "side" nunca é o que se vende.
 */
const COMPOSTOS_FIXOS = new Set(["sell side", "buy side"]);

const COMPLEMENTOS_NOMINAIS = new Set([
  "license", "licence", "permit", "duty", "tariff", "quota", "chain", "order",
  "credit", "insurance", "finance", "financing", "agreement", "contract",
  "management", "side", "compliance", "logistics", "control", "regulation",
  "regulations", "documentation", "consulting", "advisory", "services",
  "department", "agent", "agents", "broker", "brokers", "market", "markets",
  "data", "strategy", "process", "procedure", "planning",
  // papéis e organizações — "Export manager" × "Import manager" saía em 100
  // com objeto "manager" dos dois lados (revisão adversarial de 05/09)
  "manager", "managers", "director", "directors", "team", "teams", "company",
  "companies", "specialist", "specialists", "officer", "officers",
  "coordinator", "coordinators", "office", "unit", "units", "operations",
  "declaration", "declarations", "clearance", "document", "documents",
]);

/** Cabeça + palavra seguinte formam composto nominal (neutro)? */
function ehCompostoNominal(cabeca: string, seguinte: string | undefined): boolean {
  if (!seguinte) return false;
  if (COMPOSTOS_FIXOS.has(`${cabeca} ${seguinte}`)) return true;
  return CABECAS_NOMINAIS_EN.has(cabeca) && COMPLEMENTOS_NOMINAIS.has(seguinte);
}

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

const DIRECAO_POR_CABECA = new Map<string, Direcao>([
  ...VERBOS_DE_OFERTA.map(v => [v, "oferta" as Direcao] as const),
  ...SUBSTANTIVOS_DE_OFERTA.map(v => [v, "oferta" as Direcao] as const),
  ...VERBOS_DE_DEMANDA.map(v => [v, "demanda" as Direcao] as const),
  ...SUBSTANTIVOS_DE_DEMANDA.map(v => [v, "demanda" as Direcao] as const),
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
 *
 * As contrações do espanhol "al" (a + el) e "del" (de + el) e a origem "from"/
 * "desde" são locativos também: "Exportar al Brasil" × "Importar al Brasil" e
 * "Export from Brazil" × "Import from Brazil" reduziam os dois lados ao país e
 * saíam em 100 (revisão adversarial de 05/09). "Del" não vai para GENITIVOS
 * porque em tag ele apresenta origem ("Importar del Brasil"), não a coisa.
 */
const LOCATIVOS = new Set([
  "para", "em", "no", "na", "nos", "nas", "com", "por", "ao", "aos", "entre",
  "sobre", "for", "to", "in", "on", "at", "with", "from", "en", "hacia", "con",
  "al", "del", "desde",
]);

/**
 * Expressões de modo e condição em pt/es/en: "a granel", "a prazo", "à vista",
 * "a varejo", "retail", "wholesale". Depois delas não vem mercadoria, e sim
 * COMO se negocia — o mesmo papel dos LOCATIVOS. Sem esta lista, "Exportação
 * a granel" × "Importação a granel" reduzia os dois lados a "granel" e saía em
 * 100 (reverificação de 04/09). Em inglês a expressão vem SEM preposição
 * ("Sell retail"), por isso a guarda também vale quando nada foi descascado.
 * "Al contado" e "al por mayor" já param no "al" dos LOCATIVOS; "contado" e
 * "mayoreo" ficam aqui para a forma sem contração.
 */
const MODOS_E_CONDICOES = new Set([
  "granel", "prazo", "vista", "varejo", "atacado", "domicilio", "consignacao",
  "credito", "bulk", "retail", "wholesale", "plazo", "contado", "mayoreo",
]);

/**
 * O objeto que vem depois de uma cabeça, ou `null` quando não há objeto
 * extraível — caso em que o termo vale por inteiro e não empresta o
 * complemento a ninguém.
 *
 * `complementoDeDirecao` diz que a cabeça é palavra de direção (verbo ou
 * substantivo de ação), e aí lugar e modo nunca são a mercadoria: "Exportar
 * China", "Sell retail" valem por inteiro. Depois de um MARCADOR fraco a
 * guarda não se aplica: "Procura China" e "China" são a mesma coisa dita de
 * dois jeitos, como "Procura terras raras" e "Terras raras".
 */
function objetoDepoisDe(resto: string[], complementoDeDirecao = false): string[] | null {
  if (!resto.length || LOCATIVOS.has(resto[0])) return null;
  const palavras = [...resto];
  let descascada: string | undefined;
  while (palavras.length && (GENITIVOS.has(palavras[0]) || ARTIGOS.has(palavras[0]))) descascada = palavras.shift();
  if (!palavras.length || LOCATIVOS.has(palavras[0])) return null;
  // "a"/"as" estão em ARTIGOS, mas em pt/es são também preposição: de destino
  // ("exportar a China", "exportação à China", "exportar às Filipinas" — o
  // acento some na normalização) e de modo ("a granel", "a prazo"). Diante de
  // lugar ou de expressão de modo, o que sobra não é a mercadoria: o termo
  // vale por inteiro, como diante de "para". "Vender a soja" continua rendendo
  // "soja" — ali o "a" é artigo mesmo. Depois de genitivo ("Importação da
  // China") o lugar segue como objeto: é o motor de match que o descarta.
  const preposicaoAmbigua = descascada === "a" || descascada === "as";
  const nadaDescascado = descascada === undefined && complementoDeDirecao;
  if ((preposicaoAmbigua || nadaDescascado) && (ehLugar(palavras) || MODOS_E_CONDICOES.has(palavras[0]))) return null;
  return palavras;
}

/**
 * Escrita de qualquer idioma sobrevive à normalização (auditoria de 04/09):
 * o cruzamento só enxergava [a-z0-9], e uma tag em chinês, japonês, árabe,
 * russo ou hindi — os cinco idiomas abertos pela PR #55 — virava vazio. Nem
 * tag idêntica casava, nem categoria idêntica.
 *
 *   - NFKD decompõe acento E compatibilidade (Ａ→A, ２→2, ﬁ→fi, ㎡→m2).
 *   - Sai SÓ o bloco latino de diacríticos (U+0300–036F), como sempre saiu:
 *     "ção" continua "cao". Marca de outra escrita não é acento — a matra do
 *     devanágari (शराब), o harakat do árabe, a vogal do tailandês ficam.
 *   - NFC recompõe o que sobrou (hangul volta a ser sílaba); minúsculas.
 *
 * Para o latim só muda o que antes era descartado sem motivo (ø, ß, æ, ł) e
 * o que o NFKD traduz (º→o, ²→2, ™→tm). Tudo que já era [a-z0-9] depois de
 * tirar o acento dá EXATAMENTE o mesmo resultado de antes.
 */
// O diacr\u00edtico s\u00f3 sai depois de LETRA LATINA: na NFD, \u0439 = \u0438 + U+0306 e \u0451 = \u0435 +
// U+0308 \u2014 letras distintas do alfabeto cir\u00edlico, n\u00e3o acentos \u2014 e um strip
// cego juntava "\u0432\u043e\u0439\u043d\u044b" (guerras) com "\u0432\u043e\u0438\u043d\u044b" (guerreiros). RegExp por string
// pelo mesmo motivo da SEPARADOR_DE_PALAVRA (tsc em ES5 sem "target").
const DIACRITICO_APOS_LATINA = new RegExp("(\\p{Script=Latin})[\\u0300-\\u036f]+", "gu");

export function normalizar(texto: string) {
  return texto.normalize("NFKD").replace(DIACRITICO_APOS_LATINA, "$1").normalize("NFC").toLowerCase();
}

/**
 * Letra, marca ou dígito de QUALQUER escrita é palavra; o resto separa. Em
 * escrita sem espaço (zh/ja) a "palavra" é a tag inteira — tag idêntica casa
 * por slug e por objeto; cabeça transparente e verbo simplesmente não se
 * aplicam (as listas são latinas), e o termo vale por inteiro, que é o
 * comportamento conservador de sempre.
 *
 * RegExp por string, não literal: o tsconfig não declara "target" e o tsc
 * checa em ES5, onde a flag "u" num literal é o erro TS1501. Em execução
 * (Node 20+ e todo navegador atual) é a mesma expressão.
 */
export const SEPARADOR_DE_PALAVRA = new RegExp("[^\\p{L}\\p{M}\\p{N}]+", "gu");

function tokens(texto: string) {
  return normalizar(texto).split(SEPARADOR_DE_PALAVRA).filter(Boolean);
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
 * A FORMA em que a direção foi escrita, que `saoConcorrentes` precisa e
 * `analisarTermo` não expõe (o contrato dele é {direcao, objeto, verbo}):
 *
 *   - "verbo": "Exportar vinho", "Export wine" — ação declarada.
 *   - "substantivo-com-objeto": "Exportação de vinho", "Captação de recursos" —
 *     a ação nomeada com a coisa no genitivo. Igual dos dois lados, é serviço.
 *   - "substantivo-sem-objeto": "Exportação", "Exportação para a China",
 *     "Venda a prazo" — a ação nomeada, sem mercadoria extraível.
 *   - null: termo neutro.
 */
type Forma = "verbo" | "substantivo-com-objeto" | "substantivo-sem-objeto";
type Analise = TermoAnalisado & { forma: Forma | null };

function analisar(rotulo: string): Analise {
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
  const direcao = cabeca ? DIRECAO_POR_CABECA.get(cabeca) : undefined;
  const neutro: Analise = { direcao: "neutro", objeto: resto.join("-"), verbo: null, forma: null };
  if (!direcao) return neutro;

  const depois = resto.slice(1);
  const inteiro = (forma: Forma): Analise => ({ direcao, objeto: resto.join("-"), verbo: cabeca, forma });

  // "Import/export", "Importar e exportar", "Comprar e vender imóveis": os dois
  // sentidos no mesmo termo nomeiam o fluxo inteiro (a atividade, o serviço),
  // não a ação de quem escreveu. Lido pela primeira palavra, "Import/export"
  // × idem saía 0 como "concorrentes" (revisão adversarial de 05/09). Neutro,
  // e o termo vale por inteiro.
  if (depois.some(palavra => { const outra = DIRECAO_POR_CABECA.get(palavra); return !!outra && outra !== direcao; })) return neutro;

  // Substantivo de ação com a coisa no genitivo: a forma que, igual dos dois
  // lados, é serviço prestado × serviço procurado (ver saoConcorrentes).
  const nominalComObjeto = (): Analise => {
    const objeto = objetoDepoisDe(depois, true);
    return objeto
      ? { direcao, objeto: objeto.join("-"), verbo: cabeca, forma: "substantivo-com-objeto" }
      : inteiro("substantivo-sem-objeto");
  };

  if (VERBOS_FLEXIONADOS.has(cabeca)) {
    // "Import license", "Supply chain management", "Export manager": cabeça
    // ambígua + complemento nominal é composto que nomeia uma coisa, não a
    // ação de quem escreveu.
    if (ehCompostoNominal(cabeca, depois[0])) return neutro;
    // "Supply of rare earths", "Export of wine", "Hiring of staff": o "of"
    // denuncia a forma NOMINAL da mesma grafia — é "fornecimento de terras
    // raras", não "fornecer". Só "of": em pt/es o "de" depois de verbo é
    // origem ("Exportar do Brasil"), e a leitura de verbo permanece.
    if (depois[0] === "of") return nominalComObjeto();
    // Sem objeto extraível — "Exportar" sozinho, ou "Exportar para a China" —
    // o termo vale por inteiro. É o que impede o complemento de lugar de virar
    // a coisa que as duas pontas supostamente têm em comum.
    const objeto = objetoDepoisDe(depois, true);
    return objeto ? { direcao, objeto: objeto.join("-"), verbo: cabeca, forma: "verbo" } : inteiro("verbo");
  }

  // Daqui para baixo a cabeça é SUBSTANTIVO de ação (toda cabeça com direção
  // está numa das duas listas; a guarda deixa isso explícito).
  if (!SUBSTANTIVOS_DE_ACAO.has(cabeca)) return neutro;
  if (!depois.length) return inteiro("substantivo-sem-objeto");
  if (GENITIVOS.has(depois[0])) return nominalComObjeto();
  // "Exportação para a China", "Venda a prazo", "Exportação às Filipinas": a
  // ação continua declarada, o complemento é lugar ou modo — sem objeto, o
  // termo vale por inteiro.
  if (LOCATIVOS.has(depois[0]) || (ARTIGOS.has(depois[0]) && !objetoDepoisDe(depois, true))) {
    return inteiro("substantivo-sem-objeto");
  }
  // "Compras públicas", "Venda direta", "Vendas online": substantivo seguido de
  // palavra justaposta é um composto nominal, que nomeia uma coisa. Neutro.
  return neutro;
}

/**
 * Lê a cabeça do termo. Se ela for palavra de direção, separa a direção do
 * objeto; se não, o termo inteiro é o objeto e a direção fica com o campo.
 */
export function analisarTermo(rotulo: string): TermoAnalisado {
  const { direcao, objeto, verbo } = analisar(rotulo);
  return { direcao, objeto, verbo };
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
 * Lugares que NUNCA são a substância de um termo (achado da revisão de 01/09:
 * "Fornecedor da China" era reduzido a "china", e dois contatos sem nada em
 * comum além do país casavam em 100 — a nota reservada a quem tem exatamente
 * a mesma coisa — passando do corte de e-mail). É o mesmo erro que o
 * comentário dos LOCATIVOS descreve como o caso COMUM em comércio exterior:
 * o complemento do termo é quase sempre o lugar, não a mercadoria.
 *
 * Lista curada (sem acentos, como tudo aqui): continentes e regiões, países
 * do circuito de comércio da plataforma, gentílicos e estados brasileiros.
 * Não precisa ser o atlas inteiro — precisa cobrir o que aparece em tag de
 * possui/procura; na dúvida, um lugar fora da lista mantém o comportamento
 * de hoje, que é o risco conhecido.
 */
const LUGARES = new Set([
  // continentes e regiões
  "africa", "europa", "asia", "america", "americas", "oceania", "mercosul",
  "latam", "caribe", "iberia", "balcas", "magrebe", "nordeste", "amazonia",
  // países — pt/en/es correntes
  "brasil", "brazil", "china", "india", "japao", "japan", "alemanha",
  "germany", "franca", "france", "espanha", "spain", "italia", "italy",
  "portugal", "angola", "mocambique", "nigeria", "egito", "marrocos",
  "argelia", "gana", "quenia", "etiopia", "senegal", "argentina", "chile",
  "uruguai", "paraguai", "bolivia", "peru", "colombia", "venezuela",
  "equador", "mexico", "canada", "eua", "usa", "russia", "turquia",
  "ucrania", "polonia", "grecia", "irlanda", "inglaterra", "holanda",
  "belgica", "suica", "suecia", "noruega", "dinamarca", "finlandia",
  "austria", "israel", "catar", "dubai", "coreia", "vietna", "tailandia",
  "indonesia", "malasia", "singapura", "filipinas", "australia", "panama",
  "cuba", "haiti", "jamaica", "guiana", "suriname", "taiwan", "vietnam",
  "uganda", "tanzania", "camaroes", "cameroon", "zambia", "zimbabue",
  "botsuana", "namibia", "ruanda", "sudao", "libia", "tunisia", "tunes",
  "netherlands", "germany", "sweden", "norway", "denmark", "finland",
  "switzerland", "austria", "greece", "ireland", "scotland", "wales",
  "belgium", "poland", "ukraine", "turkey", "japon", "alemania", "francia",
  "espana", "paises", "reino", "emirados", "arabia", "kuwait", "omã", "oma",
  // regiões e pontos cardeais usados como lugar
  "sul", "norte", "leste", "oeste", "ocidente", "oriente", "south", "north",
  "east", "west", "sur", "norte-africa",
  // gentílicos correntes (masc/fem/plural mais comuns)
  "chines", "chinesa", "chineses", "chinesas", "brasileiro", "brasileira",
  "brasileiros", "brasileiras", "americano", "americana", "americanos",
  "americanas", "argentino", "argentina", "argentinos", "argentinas",
  "europeu", "europeia", "europeus", "europeias", "africano", "africana",
  "africanos", "africanas", "asiatico", "asiatica", "asiaticos", "asiaticas",
  "portugues", "portuguesa", "portugueses", "portuguesas", "frances",
  "francesa", "franceses", "francesas", "alemao", "alema", "alemaes",
  "italiano", "italiana", "italianos", "italianas", "espanhol", "espanhola",
  "espanhois", "japones", "japonesa", "japoneses", "indiano", "indiana",
  "mexicano", "mexicana", "canadense", "canadenses", "russo", "russa",
  "turco", "turca", "arabe", "arabes", "coreano", "coreana", "australiano",
  "australiana", "angolano", "angolana", "nigeriano", "nigeriana",
  // estados brasileiros de uma palavra
  "bahia", "ceara", "pernambuco", "amazonas", "parana", "goias", "tocantins",
  "rondonia", "roraima", "acre", "amapa", "maranhao", "piaui", "alagoas",
  "sergipe", "paraiba",
]);

const LUGARES_COMPOSTOS = new Set([
  "estados unidos", "reino unido", "nova zelandia", "coreia do sul",
  "coreia do norte", "africa do sul", "america latina", "america do sul",
  "america do norte", "america central", "oriente medio", "arabia saudita",
  "emirados arabes", "emirados arabes unidos", "hong kong", "porto rico",
  "costa rica", "el salvador", "republica dominicana", "cabo verde",
  "guine bissau", "timor leste", "sri lanka", "uniao europeia",
  "sao paulo", "rio de janeiro", "minas gerais", "rio grande do sul",
  "rio grande do norte", "mato grosso", "mato grosso do sul",
  "santa catarina", "espirito santo", "distrito federal",
  // formas em inglês e espanhol dos mesmos lugares — o motor recebe tag em
  // três idiomas (CABECAS_TRANSPARENTES tem supplier/proveedor)
  "united states", "united kingdom", "south africa", "south korea",
  "north korea", "new zealand", "latin america", "south america",
  "middle east", "saudi arabia", "european union", "ivory coast",
  "estados unidos de america", "corea del sur", "reino de espana",
  "america del sur", "medio oriente", "union europea", "paises baixos",
  "paises bajos", "costa do marfim",
]);

/**
 * A substância inteira é um lugar? (uma palavra da lista, ou um composto)
 *
 * O plural conta: sem isto, "Fazenda de perus" reduzia e "Fornecedor de peru"
 * não — mesma mercadoria, comportamentos opostos. A regra vale para os dois.
 *
 * TROCA ACEITA: mercadoria homônima de lugar perde a redução — "peru" (a ave),
 * "chile" (a pimenta, em espanhol), "china" (a louça, em inglês). O par
 * legítimo continua casando por slug exato quando as duas pontas escrevem o
 * mesmo termo; o que se perde é o 100 por núcleo. É o lado conservador de
 * propósito: o erro oposto (100 para quem só divide geografia) chega a e-mail
 * de oportunidade e foi o que motivou o cartão.
 *
 * Exportada porque o motor de match aplica a mesma guarda ao objeto e ao
 * núcleo: "China" × "Procura China" reduzia os dois lados a "china" e saía em
 * 100 (reverificação de 04/09).
 */
export function ehLugar(palavras: string[]): boolean {
  if (!palavras.length) return false;
  const frase = palavras.join(" ");
  if (LUGARES_COMPOSTOS.has(frase) || LUGARES_COMPOSTOS.has(semPluralFinal(frase))) return true;
  if (palavras.length !== 1) return false;
  const palavra = palavras[0];
  return LUGARES.has(palavra) || LUGARES.has(semPluralFinal(palavra));
}

/** "perus" → "peru". Só o plural simples; não é lematizador. */
function semPluralFinal(texto: string): string {
  return texto.endsWith("s") ? texto.slice(0, -1) : texto;
}

/**
 * O núcleo do termo: a substância de que ele trata, atravessando uma cabeça
 * transparente quando houver. "Mina de terras raras" → "terras-raras";
 * "Fornecedor de terras raras" → "terras-raras"; "Terras raras" → "terras-raras".
 * Sem cabeça transparente seguida de genitivo, o núcleo é o próprio objeto —
 * nada muda para quem já casava antes.
 *
 * E a substância NÃO pode ser lugar: "Fornecedor da China" fala de um
 * fornecedor, não da China — reduzir ao país casaria em 100 qualquer par que
 * só compartilha geografia. Com lugar no genitivo, o termo vale por inteiro.
 * ("Fornecedor de vinhos da Europa" segue reduzindo a "vinhos-da-europa": a
 * substância começa na mercadoria, e o lugar é só o complemento dela.)
 */
export function nucleoDoTermo(rotulo: string): string {
  const { objeto } = analisarTermo(rotulo);
  const palavras = objeto.split("-").filter(Boolean);
  if (palavras.length < 3) return objeto;
  // Exige a forma exata "CABEÇA + genitivo + substância": é o padrão em que a
  // cabeça comprovadamente não é a mercadoria. Qualquer outra forma fica inteira.
  if (!CABECAS_TRANSPARENTES.has(palavras[0]) || !GENITIVOS.has(palavras[1])) return objeto;
  const substancia = objetoDepoisDe(palavras.slice(1));
  if (!substancia || ehLugar(substancia)) return objeto;
  return substancia.join("-");
}

/**
 * São concorrentes? Só respondemos que sim quando AS DUAS pontas trazem
 * direção explícita e as duas apontam para o mesmo lado. Com uma ponta neutra
 * não há evidência de conflito nas palavras — e o campo já separou uma da
 * outra, que é o comportamento de sempre.
 *
 * E o SERVIÇO escrito igual dos dois lados não é concorrência (decisão do
 * Nicolas, 04/09): "Captação de recursos" possuído diante de "Captação de
 * recursos" procurado é quem presta o serviço diante de quem precisa dele.
 * Só a forma substantivo + objeto ("Exportação de vinho") ganha essa leitura,
 * só quando é a forma dos DOIS lados, e só com o MESMO objeto (revisão
 * adversarial de 05/09): "Exportação de vinho" × "Exportação de uva" são
 * duas exportadoras, como na regra original. "Exportar vinho" × "Exportar
 * vinho" continua sendo concorrência, e "Exportação" × "Exportação" também.
 */
export function saoConcorrentes(rotuloOferta: string, rotuloDemanda: string) {
  const a = analisar(rotuloOferta);
  const b = analisar(rotuloDemanda);
  if (a.direcao === "neutro" || b.direcao === "neutro") return false;
  if (a.direcao !== b.direcao) return false;
  const mesmoServico = a.forma === "substantivo-com-objeto" && b.forma === "substantivo-com-objeto" && a.objeto === b.objeto;
  return !mesmoServico;
}
