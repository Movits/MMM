/**
 * O portão da demanda expressa na camada de IA (pedido do Nicolas, 12/09/2026).
 *
 * Os dois motores por LLM de routers/matching.ts — recomendação de
 * oportunidades para o perfil e alerta de oportunidade nova para os perfis —
 * pediam ao modelo que considerasse "necessidades implícitas". Era a origem
 * exata do defeito: quem tinha "Advocacia tributária" em "O que tenho" casava
 * com toda oportunidade de empresa que "poderia precisar" de um tributarista.
 *
 * A regra vai no prompt (é a IA que interpreta "o que tenho" e "o que
 * preciso"), mas prompt é pedido, não garantia. Por isso o modelo passa a
 * responder, em cada match, o TIPO do item de "o que tenho" em que se apoiou
 * e, quando é serviço, o trecho LITERAL do outro lado que declara a
 * necessidade — e o código confere que esse trecho está mesmo no texto que a
 * pessoa escreveu na oportunidade. Serviço sem citação conferida não sai da
 * tela, seja qual for a nota.
 *
 * E o rótulo do modelo não é a única trava (revisões adversariais de 12/09):
 * o classificador determinístico (shared/tipo-da-oferta.ts) é o PISO. Perfil
 * que só tem serviço a oferecer — em "O que tenho" ou, sem nada ali, na área
 * de atuação e na especialidade que o prompt também recebe — e nada declarado
 * em "preciso"/"busca" exige citação seja qual for o tipo que o modelo
 * escreveu; tipo irreconhecível com serviço no perfil também exige. E a regra
 * vale nos dois sentidos: oportunidade que OFERECE um serviço só casa com
 * perfil que declarou precisar de algo. Para produtos, ativos, investimento,
 * conexões, tecnologia e imóveis nada muda: o portão só atua no tipo
 * "servico".
 */
import { tokensDoTermo } from "@shared/direcao-do-termo";
import { ehServico, PALAVRAS_DE_SERVICO, TIPOS_DA_OFERTA, type TipoDaOferta } from "@shared/tipo-da-oferta";

/** Os nove tipos mais "nenhuma": o match que se apoia no que a pessoa PRECISA, não no que tem. */
export const TIPOS_PARA_A_IA = [...TIPOS_DA_OFERTA.map(item => item.tipo), "nenhuma"] as const;
export type TipoParaAIA = TipoDaOferta | "nenhuma";

/** As duas propriedades que todo item de resposta do LLM passa a carregar (schema JSON estrito). */
export const PROPRIEDADES_DO_PORTAO = {
  tipoDaOferta: { type: "string", enum: [...TIPOS_PARA_A_IA] },
  necessidadeExpressa: { type: "string" },
} as const;

/**
 * Quanto da descrição de cada oportunidade vai à recomendação (o prompt
 * carrega até 50 delas). Eram 200 caracteres: com o portão, a necessidade
 * declarada precisa CABER no que o modelo vê, senão o serviço legítimo nunca
 * casa. O alerta, que é de uma oportunidade só, manda a descrição inteira.
 */
export const DESCRICAO_NA_RECOMENDACAO = 800;

/** Corta em fronteira de palavra, com reticência, para o modelo não "completar" uma frase partida. */
export function cortarEmPalavra(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.lastIndexOf(" ", maximo);
  return `${texto.slice(0, corte > maximo / 2 ? corte : maximo).trimEnd()}…`;
}

/**
 * O texto que a PESSOA escreveu na oportunidade — título, tags e descrição.
 * É contra isto que a citação é conferida. Setor, tipo e id ficam de fora de
 * propósito: setor é exatamente o que o pedido diz que NÃO é necessidade, e a
 * linha inteira do prompt (com "Setor:") fazia uma "citação" do setor conferir.
 */
export function textoEscritoPelaPessoa(titulo: string | null | undefined, tags: unknown, descricao: string | null | undefined): string {
  const lista = Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
  return [titulo ?? "", ...lista, descricao ?? ""].join(" | ");
}

/**
 * O texto da regra, igual nos dois prompts. Fala de "tenho" (é como os
 * perfis chegam ao modelo: `tenho:[...] preciso:[...]`) e de "o outro lado"
 * (a oportunidade, na recomendação; a oportunidade de novo, no alerta).
 */
export const REGRA_DA_DEMANDA_EXPRESSA = `REGRA DA DEMANDA EXPRESSA (obrigatória; vale para SERVIÇOS):
1. Antes de pontuar, classifique cada item de "tenho" / "O que tenho" em um destes tipos: servico, produto, ativo, oportunidade, investimento, conexao, tecnologia, imovel, outros.
2. Um item do tipo SERVIÇO (advocacia, consultoria, assessoria, contabilidade, marketing, treinamento...) só sustenta compatibilidade quando o outro lado DECLARA, com todas as letras, que precisa desse serviço ou de uma solução semanticamente equivalente. As palavras podem ser outras: "advocacia tributária" atende "precisamos revisar nossos tributos e identificar créditos fiscais"; "consultoria para registro de medicamentos" atende "suporte para obter autorização regulatória do nosso medicamento".
3. NÃO conta como necessidade: setor ou atividade econômica, porte, localização, cargo, problemas típicos do segmento, obrigações legais que normalmente se aplicam, serviços que "seriam úteis", necessidades prováveis ou oportunidades comerciais genéricas. Uma indústria farmacêutica que procura "distribuidor para a África" NÃO é match para um serviço tributário, ainda que toda indústria tenha impostos. Essas informações só podem aumentar a nota de um match que JÁ passou por esta regra; nunca criá-lo.
4. Sem necessidade expressa compatível, o serviço não gera match: não o liste. Vale nos dois sentidos: uma OPORTUNIDADE que oferece um serviço só é compatível com quem DECLAROU precisar dele em "preciso"/"busca" — nunca com quem "poderia precisar" por causa do setor.
5. Em cada resultado informe "tipoDaOferta": o tipo do item de "tenho" em que o match se apoia — ou "nenhuma" quando o match se apoia no que a pessoa PRECISA (o outro lado oferece o que ela declarou procurar). Quando "tipoDaOferta" for "servico", copie em "necessidadeExpressa" o trecho LITERAL do título, das tags ou da descrição do outro lado que declara a necessidade (as mesmas palavras, sem parafrasear, pelo menos duas palavras; setor e tipo não são necessidade); nos demais casos deixe "necessidadeExpressa" vazio.
Princípio: não fazemos match porque alguém poderia precisar; fazemos match porque alguém declarou que precisa.`;

const SINONIMOS_DE_TIPO: Record<string, TipoParaAIA> = {
  servico: "servico", servicos: "servico", service: "servico", services: "servico", servicio: "servico", servicios: "servico",
  produto: "produto", produtos: "produto", product: "produto", products: "produto", producto: "produto",
  ativo: "ativo", ativos: "ativo", asset: "ativo", assets: "ativo", activo: "ativo",
  oportunidade: "oportunidade", oportunidades: "oportunidade", opportunity: "oportunidade",
  investimento: "investimento", investimentos: "investimento", investment: "investimento", capital: "investimento",
  conexao: "conexao", conexoes: "conexao", connection: "conexao", network: "conexao", networking: "conexao",
  tecnologia: "tecnologia", technology: "tecnologia", tech: "tecnologia",
  imovel: "imovel", imoveis: "imovel", infraestrutura: "imovel", infrastructure: "imovel",
  outros: "outros", outro: "outros", other: "outros", others: "outros",
  nenhuma: "nenhuma", nenhum: "nenhuma", none: "nenhuma",
};

/**
 * O tipo como o modelo o escreveu, trazido ao vocabulário do enum — ou null
 * quando nenhuma palavra é reconhecida. Num valor misto ("produto/servico") o
 * tipo restritivo vence: é o portão que existe para o serviço, e a mistura
 * não pode desligá-lo.
 */
export function reconhecerTipo(valor: unknown): TipoParaAIA | null {
  if (typeof valor !== "string") return null;
  let primeiro: TipoParaAIA | null = null;
  for (const palavra of tokensDoTermo(valor)) {
    const tipo = SINONIMOS_DE_TIPO[palavra];
    if (tipo === "servico") return "servico";
    if (tipo && !primeiro) primeiro = tipo;
  }
  return primeiro;
}

/**
 * `reconhecerTipo` com "outros" para o que não se reconhece (e um aviso no
 * log): o schema pede o enum exato; esta tradução é para "Serviço", "SERVICO"
 * ou "investimento/capital" não escaparem do portão por grafia.
 */
export function normalizarTipo(valor: unknown): TipoParaAIA {
  const tipo = reconhecerTipo(valor);
  if (tipo) return tipo;
  console.warn(`[Match] Tipo de oferta fora do vocabulário na resposta da IA: ${JSON.stringify(valor)}`);
  return "outros";
}

// Palavras que não provam nada numa citação: ligação, artigo, preposição.
const PALAVRAS_VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "um", "uma", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "que", "of", "the", "and", "for", "to", "in", "on", "with", "an", "y", "el",
  "la", "los", "las", "en", "con", "del", "al",
]);

/**
 * A citação está no texto-fonte? Conferência por palavras, não por texto
 * exato: a normalização apaga acento e caixa, e o modelo às vezes corta uma
 * palavra de ligação ou corrige um plural. Exige pelo menos DUAS palavras de
 * conteúdo (uma tag solta é palavra-chave, não declaração) e, entre elas, no
 * máximo UMA ausente da fonte — com até três, nenhuma; e a ausente nunca pode
 * ser palavra de serviço, porque "frase real + serviço presumido emendado no
 * fim" é justamente como o modelo presume. Tolerância fixa, não proporção:
 * 70% deixava passar duas palavras inventadas a partir de sete (revisões
 * adversariais de 12/09). Uma citação inventada não passa, porque as palavras
 * dela não estão na fonte.
 */
export function citacaoConfere(citacao: unknown, fonte: string): boolean {
  if (typeof citacao !== "string") return false;
  const palavras = tokensDoTermo(citacao).filter(palavra => palavra.length >= 3 && !PALAVRAS_VAZIAS.has(palavra));
  if (palavras.length < 2) return false;
  const daFonte = new Set(tokensDoTermo(fonte));
  const ausentes = palavras.filter(palavra => !daFonte.has(palavra));
  if (ausentes.some(palavra => PALAVRAS_DE_SERVICO.has(palavra))) return false;
  return palavras.length <= 3 ? ausentes.length === 0 : ausentes.length <= 1;
}

export type ItemComPortao = { tipoDaOferta?: unknown; necessidadeExpressa?: unknown };

/** O que o portão lê do perfil de quem oferece — só o que decide se há base expressa fora do serviço. */
export type PerfilNoPortao = {
  whatIHave?: unknown;
  whatINeed?: unknown;
  seekingTypes?: unknown;
  lookingForInvestment?: unknown;
  activityArea?: unknown;
  primarySpecialty?: unknown;
};

/** O que o portão lê da oportunidade do outro lado. */
export type OportunidadeNoPortao = { type?: unknown; title?: unknown };

const lista = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
const texto = (valor: unknown): string[] => (typeof valor === "string" && valor.trim() !== "" ? [valor] : []);

/**
 * O que o perfil OFERECE aos olhos do portão: "O que tenho" e, quando está
 * vazio, a área de atuação e a especialidade — que o prompt também recebe e
 * das quais o modelo deduz o serviço ("Área de atuação: advocacia
 * tributária"). Sem isto o piso nunca disparava com a UI de hoje, que só
 * grava ids fixos em "O que tenho".
 */
function ofertasDoPerfil(perfil: PerfilNoPortao): string[] {
  const declaradas = lista(perfil.whatIHave);
  return declaradas.length ? declaradas : [...texto(perfil.activityArea), ...texto(perfil.primarySpecialty)];
}

/** O perfil declarou precisar de alguma coisa (necessidade, busca ou "busco investimento")? */
export function temNecessidadeDeclarada(perfil: PerfilNoPortao): boolean {
  return lista(perfil.whatINeed).length > 0 || lista(perfil.seekingTypes).length > 0 || perfil.lookingForInvestment === true;
}

/** A oportunidade OFERECE um serviço (tipo "offer" com título de serviço)? */
export function oportunidadeOfereceServico(oportunidade: OportunidadeNoPortao): boolean {
  return oportunidade.type === "offer" && typeof oportunidade.title === "string" && ehServico(oportunidade.title);
}

/**
 * Este match exige a citação da necessidade expressa? Sim quando o modelo
 * disse que se apoia em serviço — e também, pelo piso determinístico, quando
 * o perfil só tem serviço a oferecer e nada declarado em "preciso"/"busca"/
 * "busco investimento" (não há outra base possível), ou quando o tipo veio
 * irreconhecível e há serviço no perfil (na dúvida, fecha).
 */
export function exigeCitacao(item: ItemComPortao, perfil?: PerfilNoPortao): boolean {
  const tipo = reconhecerTipo(item.tipoDaOferta);
  if (tipo === "servico") return true;
  if (!perfil) return false;
  const ofertas = ofertasDoPerfil(perfil);
  if (ofertas.length === 0) return false;
  const servicos = ofertas.filter(oferta => ehServico(oferta));
  if (tipo === null && servicos.length > 0) return true;
  return servicos.length === ofertas.length && !temNecessidadeDeclarada(perfil);
}

/**
 * O portão: match apoiado em SERVIÇO só passa com a necessidade expressa
 * citada e conferida no texto que a pessoa escreveu; e oportunidade que
 * oferece um serviço só passa para quem declarou precisar de algo. Qualquer
 * outro tipo passa como antes.
 */
export function passaNoPortao(item: ItemComPortao, fonte: string, perfil?: PerfilNoPortao, oportunidade?: OportunidadeNoPortao): boolean {
  if (perfil && oportunidade && oportunidadeOfereceServico(oportunidade) && !temNecessidadeDeclarada(perfil)) return false;
  if (!exigeCitacao(item, perfil)) return true;
  return citacaoConfere(item.necessidadeExpressa, fonte);
}
