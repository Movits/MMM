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
 * necessidade — e o código confere que esse trecho está mesmo no texto que o
 * modelo recebeu. Serviço sem citação conferida não sai da tela, seja qual for
 * a nota. Para produtos, ativos, investimento, conexões, tecnologia e imóveis
 * nada muda: o portão só atua no tipo "servico".
 */
import { tokensDoTermo } from "@shared/direcao-do-termo";
import { TIPOS_DA_OFERTA, type TipoDaOferta } from "@shared/tipo-da-oferta";

/** Os nove tipos mais "nenhuma": o match que se apoia no que a pessoa PRECISA, não no que tem. */
export const TIPOS_PARA_A_IA = [...TIPOS_DA_OFERTA.map(item => item.tipo), "nenhuma"] as const;
export type TipoParaAIA = TipoDaOferta | "nenhuma";

/** As duas propriedades que todo item de resposta do LLM passa a carregar (schema JSON estrito). */
export const PROPRIEDADES_DO_PORTAO = {
  tipoDaOferta: { type: "string", enum: [...TIPOS_PARA_A_IA] },
  necessidadeExpressa: { type: "string" },
} as const;

/**
 * O texto da regra, igual nos dois prompts. Fala de "tenho" (é como os
 * perfis chegam ao modelo: `tenho:[...] preciso:[...]`) e de "o outro lado"
 * (a oportunidade, na recomendação; a oportunidade de novo, no alerta).
 */
export const REGRA_DA_DEMANDA_EXPRESSA = `REGRA DA DEMANDA EXPRESSA (obrigatória; vale para SERVIÇOS):
1. Antes de pontuar, classifique cada item de "tenho" / "O que tenho" em um destes tipos: servico, produto, ativo, oportunidade, investimento, conexao, tecnologia, imovel, outros.
2. Um item do tipo SERVIÇO (advocacia, consultoria, assessoria, contabilidade, marketing, treinamento...) só sustenta compatibilidade quando o outro lado DECLARA, com todas as letras, que precisa desse serviço ou de uma solução semanticamente equivalente. As palavras podem ser outras: "advocacia tributária" atende "precisamos revisar nossos tributos e identificar créditos fiscais"; "consultoria para registro de medicamentos" atende "suporte para obter autorização regulatória do nosso medicamento".
3. NÃO conta como necessidade: setor ou atividade econômica, porte, localização, cargo, problemas típicos do segmento, obrigações legais que normalmente se aplicam, serviços que "seriam úteis", necessidades prováveis ou oportunidades comerciais genéricas. Uma indústria farmacêutica que procura "distribuidor para a África" NÃO é match para um serviço tributário, ainda que toda indústria tenha impostos. Essas informações só podem aumentar a nota de um match que JÁ passou por esta regra; nunca criá-lo.
4. Sem necessidade expressa compatível, o serviço não gera match: não o liste.
5. Em cada resultado informe "tipoDaOferta": o tipo do item de "tenho" em que o match se apoia — ou "nenhuma" quando o match se apoia no que a pessoa PRECISA (o outro lado oferece o que ela declarou procurar). Quando "tipoDaOferta" for "servico", copie em "necessidadeExpressa" o trecho LITERAL do outro lado que declara a necessidade (as mesmas palavras, sem parafrasear); nos demais casos deixe "necessidadeExpressa" vazio.
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
 * O tipo como o modelo o escreveu, trazido ao vocabulário do enum. O schema
 * pede o enum exato; esta tradução é para "Serviço", "SERVICO" ou
 * "investimento/capital" não escaparem do portão por grafia. O que não se
 * reconhece vira "outros" (o modelo não disse que era serviço) e fica no log.
 */
export function normalizarTipo(valor: unknown): TipoParaAIA {
  if (typeof valor !== "string") return "outros";
  for (const palavra of tokensDoTermo(valor)) {
    const tipo = SINONIMOS_DE_TIPO[palavra];
    if (tipo) return tipo;
  }
  console.warn(`[Match] Tipo de oferta fora do vocabulário na resposta da IA: ${JSON.stringify(valor)}`);
  return "outros";
}

// Palavras que não provam nada numa citação: ligação, artigo, preposição.
const PALAVRAS_VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "um", "uma", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "que", "um", "of", "the", "and", "for", "to", "in", "on", "with", "an", "y", "el",
  "la", "los", "las", "en", "con", "del", "al",
]);

/**
 * A citação está no texto-fonte? Conferência por palavras, não por texto
 * exato: a normalização apaga acento e caixa, e o modelo às vezes corta uma
 * palavra de ligação ou corrige um plural. Exige pelo menos uma palavra de
 * conteúdo e 70% delas presentes na fonte — com quatro ou mais palavras, no
 * máximo uma pode faltar; com até três, nenhuma. Uma citação inventada (a
 * necessidade que o modelo "presumiu" e escreveu como se fosse do outro lado)
 * não passa, porque as palavras dela não estão na fonte.
 */
export function citacaoConfere(citacao: unknown, fonte: string): boolean {
  if (typeof citacao !== "string") return false;
  const palavras = tokensDoTermo(citacao).filter(palavra => palavra.length >= 3 && !PALAVRAS_VAZIAS.has(palavra));
  if (palavras.length === 0) return false;
  const daFonte = new Set(tokensDoTermo(fonte));
  const presentes = palavras.filter(palavra => daFonte.has(palavra)).length;
  return presentes / palavras.length >= 0.7;
}

export type ItemComPortao = { tipoDaOferta?: unknown; necessidadeExpressa?: unknown };

/**
 * O portão: match apoiado em SERVIÇO só passa com a necessidade expressa
 * citada e conferida na fonte. Qualquer outro tipo passa como antes.
 */
export function passaNoPortao(item: ItemComPortao, fonte: string): boolean {
  if (normalizarTipo(item.tipoDaOferta) !== "servico") return true;
  return citacaoConfere(item.necessidadeExpressa, fonte);
}
