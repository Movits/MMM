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

const DIRECAO_POR_VERBO = new Map<string, Direcao>([
  ...VERBOS_DE_OFERTA.map(v => [v, "oferta" as Direcao] as const),
  ...VERBOS_DE_DEMANDA.map(v => [v, "demanda" as Direcao] as const),
]);

/** Conectivos que sobram entre o verbo e o objeto: "exportação DE vinho". */
const CONECTIVOS = new Set([
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "para",
  "com", "a", "o", "as", "os", "um", "uma", "of", "for", "to", "the", "in",
  "el", "la", "los", "las", "un", "una", "por",
]);

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
  const cabeca = palavras[0];
  const direcao = cabeca ? DIRECAO_POR_VERBO.get(cabeca) : undefined;

  if (!direcao) return { direcao: "neutro", objeto: palavras.join("-"), verbo: null };

  // Sobrando só o verbo ("Exportação", sem objeto), não há o que separar: o
  // termo continua sendo ele mesmo, senão o objeto virava string vazia e
  // casaria com qualquer outro termo igualmente vazio.
  const resto = palavras.slice(1);
  while (resto.length && CONECTIVOS.has(resto[0])) resto.shift();
  if (!resto.length) return { direcao, objeto: palavras.join("-"), verbo: cabeca };

  return { direcao, objeto: resto.join("-"), verbo: cabeca };
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
