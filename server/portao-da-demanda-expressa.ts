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
 * perfil que declarou algo que possa ser aquele serviço (até 14/09 bastava
 * declarar qualquer coisa). Para produtos, ativos, investimento,
 * conexões, tecnologia e imóveis nada muda: o portão só atua no tipo
 * "servico".
 */
import { nomeiamAMesmaCoisa, slugDoTermo, tokensDoTermo } from "@shared/direcao-do-termo";
import { CHAVE_OUTRA_NECESSIDADE, CHAVE_QUERO_MENTORAR, opcaoDaBusca } from "@shared/o-que-busca";
import {
  chavesQueValemComoNecessidade, demandaValida, lerDemandas, necessidadesDasDemandas, qualificadoresDaDemanda, rotuloDoQuePreciso,
} from "@shared/o-que-preciso";
import {
  citacaoPedeServicoOferecido, classificarOferta, ehServico, ehServicoDeAssessoria, familiaDoServico, necessidadeNomeiaOServico,
  PALAVRAS_DE_SERVICO, PALAVRAS_VAZIAS_DA_CITACAO, PAPEIS_DE_COMERCIO, servicoDoTermo, TIPOS_DA_OFERTA, trechoNomeiaServicoAtendido, type TipoDaOferta,
} from "@shared/tipo-da-oferta";

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
4. Sem necessidade expressa compatível, o serviço não gera match: não o liste. Vale nos dois sentidos: uma OPORTUNIDADE que oferece um serviço só é compatível com quem DECLAROU precisar dele em "preciso" — nunca com quem "poderia precisar" por causa do setor. Quem procura distribuidor, comprador, fornecedor ou investidor pede a contraparte, não um serviço; e a frase que só descreve a empresa ("empresa com operações internacionais") não é necessidade.
5. "Buscando" são as opções marcadas em "O que você busca?". "Serviço Especializado" é genérica: não declara necessidade de nenhum serviço e nunca sustenta sozinha um match de serviço. As demais opções (investimento, parceiro, clientes, fornecedores, talentos, conexões, visibilidade, expandir o negócio, internacionalização, tecnologia) não pedem serviço. O texto de "Outra necessidade" é necessidade declarada, como "preciso". Em "Demandas detalhadas" (a segunda camada de "O que preciso"), vale a DESCRIÇÃO de cada demanda, que já vai em "preciso": a categoria sozinha não declara necessidade ("Especialistas / Serviços" sem descrição é genérica, como "Serviço Especializado"), e setor, país, região, cidade, valor e prazo só qualificam uma demanda — nunca a criam.
6.Em cada resultado informe "tipoDaOferta": o tipo do item de "tenho" em que o match se apoia — ou "nenhuma" quando o match se apoia no que a pessoa PRECISA (o outro lado oferece o que ela declarou procurar). Quando "tipoDaOferta" for "servico", copie em "necessidadeExpressa" o trecho LITERAL do título, das tags ou da descrição do outro lado que declara a necessidade (as mesmas palavras, sem parafrasear, pelo menos duas palavras; setor e tipo não são necessidade); nos demais casos deixe "necessidadeExpressa" vazio.
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

// Palavras que não provam nada numa citação: ligação, artigo, preposição (a mesma lista da localização da citação).
const PALAVRAS_VAZIAS = PALAVRAS_VAZIAS_DA_CITACAO;

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
  /** As demandas detalhadas de "O que preciso" (shared/o-que-preciso.ts): a descrição é necessidade DECLARADA. */
  whatINeedDetails?: unknown;
  seekingTypes?: unknown;
  /** O texto de "Outra necessidade" em "O que você busca?" — necessidade DECLARADA, como "O que preciso". */
  seekingOtherNeed?: unknown;
  lookingForInvestment?: unknown;
  activityArea?: unknown;
  primarySpecialty?: unknown;
};

/** O que o portão lê da oportunidade do outro lado. */
export type OportunidadeNoPortao = { type?: unknown; title?: unknown };

const lista = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
const texto = (valor: unknown): string[] => (typeof valor === "string" && valor.trim() !== "" ? [valor] : []);

// ─── "O que você busca?" (12 opções desde 14/09, pedido do Lucas no grupo) ────
//
// A regra da Glenda vale para as opções marcadas também. "Serviço Especializado
// (Jurídico, tributário, regulatório, marketing etc.)" é GENÉRICA: marcá-la não
// é necessidade expressa de serviço nenhum, e abrir o portão por ela recriaria o
// falso positivo que a spec proíbe. As outras dez não pedem serviço
// (investimento, parceiro, clientes, fornecedores, talentos, conexões
// institucionais, visibilidade, expandir o negócio, internacionalização,
// tecnologia): nunca liberam serviço sozinhas. Só o TEXTO de "Outra
// necessidade" é necessidade declarada, e vale como "O que preciso". As chaves
// antigas seguem no banco: "mentor" pede só mentoria; "investor",
// "strategic_partner", "team" e "job" não pedem serviço; "be_mentor" ("Quero
// também mentorar") é oferta, não busca.

/** A opção genérica de serviço: não declara necessidade de serviço nenhum. */
export const BUSCA_GENERICA_DE_SERVICO = "servico_especializado";
/** Buscas que não dão ao perfil base nenhuma fora do serviço: a genérica, a oferta de mentorar e "Outra" sem texto. */
const BUSCAS_SEM_BASE = new Set<string>([BUSCA_GENERICA_DE_SERVICO, CHAVE_QUERO_MENTORAR, CHAVE_OUTRA_NECESSIDADE]);
const ROTULO_DAS_BUSCAS_SEM_EQUIVALENTE: Readonly<Record<string, string>> = {
  job: "Emprego/Projeto", mentor: "Mentora", be_mentor: "Quer também mentorar",
};

/** O rótulo pt-BR de uma busca, para os prompts; a genérica de serviço vai marcada como genérica. */
export function rotuloDaBusca(valor: string): string {
  const opcao = opcaoDaBusca(valor);
  if (!opcao) return ROTULO_DAS_BUSCAS_SEM_EQUIVALENTE[valor] ?? valor;
  return opcao.chave === BUSCA_GENERICA_DE_SERVICO ? `${opcao.titulo} (genérica: não declara necessidade de um serviço específico)` : opcao.titulo;
}

/** As buscas de um perfil, rotuladas e separadas por vírgula (vazio quando não há). */
export function rotularBuscas(seekingTypes: unknown): string {
  return lista(seekingTypes).map(rotuloDaBusca).join(", ");
}

/**
 * As necessidades que o perfil ESCREVEU: "O que preciso", a descrição das demandas detalhadas e o texto de
 * "Outra necessidade" — este só com a opção marcada, porque desmarcá-la apaga o texto
 * (`textoDaOutraNecessidade` em shared/o-que-busca.ts).
 *
 * Das chaves de "O que preciso" (14/09, Rosber), as nove categorias novas NÃO entram: a seleção sozinha não
 * gera conexão, e lida como texto "expansao_internacionalizacao" casava com "Consultoria em
 * internacionalização" e "especialistas_servicos" era classificada como serviço — abririam o portão sem
 * necessidade declarada. Delas vale só a descrição de cada demanda (`necessidadesDasDemandas`), e só da
 * categoria marcada. As oito chaves antigas reaproveitadas e "consultoria" seguem como antes: perfil antigo
 * sem detalhamento segue com a regra de hoje.
 */
export function necessidadesEscritasDoPerfil(perfil: PerfilNoPortao): string[] {
  const outra = lista(perfil.seekingTypes).includes(CHAVE_OUTRA_NECESSIDADE) ? texto(perfil.seekingOtherNeed).map(item => item.trim()) : [];
  return [...chavesQueValemComoNecessidade(perfil.whatINeed), ...necessidadesDasDemandas(perfil.whatINeed, perfil.whatINeedDetails), ...outra];
}

/**
 * As demandas detalhadas para o prompt: uma por linha, com a categoria, a descrição (a necessidade) e os
 * dados estruturados rotulados como qualificadores. Vazio quando não há demanda válida de categoria marcada.
 */
export function descreverDemandasParaIA(perfil: PerfilNoPortao): string {
  const marcadas = lista(perfil.whatINeed);
  return lerDemandas(perfil.whatINeedDetails)
    .filter(demanda => marcadas.includes(demanda.category) && demandaValida(demanda))
    .map((demanda, indice) => {
      const qualificadores = qualificadoresDaDemanda(demanda);
      // JSON.stringify: o texto é da membra; aspas e quebras de linha não podem desmontar a linha do prompt.
      return `${indice + 1}. ${rotuloDoQuePreciso(demanda.category)}: ${JSON.stringify(demanda.description)}${qualificadores.length ? ` qualificadores: ${JSON.stringify(qualificadores)}` : ""}`;
    })
    .join("\n");
}

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

/**
 * O perfil declarou precisar de alguma coisa (necessidade escrita, busca ou "busco investimento")? A busca
 * genérica de serviço, "Quero também mentorar" e "Outra necessidade" sem texto não contam: não dão ao modelo
 * base nenhuma fora do serviço do perfil.
 */
export function temNecessidadeDeclarada(perfil: PerfilNoPortao): boolean {
  if (necessidadesEscritasDoPerfil(perfil).length > 0 || perfil.lookingForInvestment === true) return true;
  return lista(perfil.seekingTypes).some(busca => !BUSCAS_SEM_BASE.has(busca));
}

/** A oportunidade OFERECE um serviço (tipo "offer" com título de serviço)? */
export function oportunidadeOfereceServico(oportunidade: OportunidadeNoPortao): boolean {
  return oportunidade.type === "offer" && typeof oportunidade.title === "string" && ehServico(oportunidade.title);
}

// ─── Oportunidade que oferece serviço × o que o perfil declarou (14/09) ───────
//
// Até 14/09 bastava o perfil ter declarado QUALQUER coisa: "Consultoria
// tributária" oferecida passava para quem só procurava distribuidores, desde que
// o modelo casasse. Agora ao menos uma declaração tem de poder pedir aquele
// serviço. O critério é o da IA, não o dos motores determinísticos: só barra o
// que o texto ENTENDE e que claramente não é o serviço — contraparte comercial,
// capital, produto, imóvel, ou outro serviço nomeado. O que o texto não entende
// ("aprovação na Anvisa", "tecnologia para rastreabilidade") fica com o modelo,
// que recebeu a regra da demanda expressa no prompt.

/** Ids fixos de "O que preciso" que pedem quem TEM a mercadoria, o canal ou o capital: serviço nenhum os entrega. */
const NECESSIDADES_QUE_SERVICO_NAO_ENTREGA = new Set(["fornecedores", "compradores", "distribuidores", "investidores", "financiamento", "parceiros"]);
/** Os mesmos que a opção "Logística" atende no motor de perfis (HAVE_SATISFIES_NEED em matching.ts). */
const NECESSIDADES_DA_LOGISTICA = new Set(["distribuidores", "fornecedores"]);
const FAMILIAS_DA_LOGISTICA = new Set(["logistica", "transporte", "frete", "armazenagem"]);
// Em texto livre, quem procura distribuidor, comprador ou fornecedor procura quem tem a mercadoria ou o canal
// (PAPEIS_DE_COMERCIO mora em shared/tipo-da-oferta.ts desde 14/09: a conferência da citação usa a mesma lista).
/** O que um serviço não entrega, pelo tipo que o classificador dá à necessidade: "Galpão em Santos", "Capital de giro". */
const TIPOS_QUE_SERVICO_NAO_ENTREGA = new Set<TipoDaOferta>(["produto", "investimento", "imovel"]);
/** "Busca" do onboarding: só "mentor" pede um serviço, e só o de mentoria. */
const FAMILIAS_DO_MENTOR = new Set(["mentoria", "coaching"]);

type PedeOServico = "pede" | "talvez" | "nao";

function necessidadePedeOServico(servico: string, necessidade: string): PedeOServico {
  const chave = tokensDoTermo(necessidade).join(" ");
  if (chave === "consultoria") return ehServicoDeAssessoria(servico) ? "pede" : "nao";
  if (NECESSIDADES_QUE_SERVICO_NAO_ENTREGA.has(chave)) {
    const logistica = FAMILIAS_DA_LOGISTICA.has(familiaDoServico(servico) ?? "");
    return logistica && NECESSIDADES_DA_LOGISTICA.has(chave) ? "talvez" : "nao";
  }
  if (slugDoTermo(necessidade) === slugDoTermo(servico) || nomeiamAMesmaCoisa(servico, necessidade)) return "pede";
  if (necessidadeNomeiaOServico(servico, null, necessidade)) return "pede";
  // A necessidade nomeia OUTRO serviço que o texto entende ("consultoria em marketing" para "Consultoria jurídica").
  // Serviço oferecido sem família lida ("Planejamento tributário") não tem com o que comparar: fica com o modelo.
  if (servicoDoTermo(servico) !== null && trechoNomeiaServicoAtendido(necessidade, [servico]) === "nao-atende") return "nao";
  if (ehServico(necessidade)) return "talvez";
  if (tokensDoTermo(necessidade).some(palavra => PAPEIS_DE_COMERCIO.has(palavra))) return "nao";
  return TIPOS_QUE_SERVICO_NAO_ENTREGA.has(classificarOferta(necessidade)) ? "nao" : "talvez";
}

/**
 * O perfil declarou algo que pode ser ESTE serviço? Uma declaração ESCRITA basta
 * ("O que preciso" ou o texto de "Outra necessidade"). Das opções de "O que você
 * busca?", nenhuma das 12 libera serviço sozinha — nem "Serviço Especializado",
 * que é genérica —, e das antigas só "mentor" pede um serviço: a mentoria. Até
 * 14/09 toda busca fora de uma lista curta passava pela leitura de texto livre, e
 * "be_mentor" (uma oferta) liberava qualquer serviço.
 */
export function perfilDeclarouPrecisarDoServico(perfil: PerfilNoPortao, servico: string): boolean {
  if (necessidadesEscritasDoPerfil(perfil).some(necessidade => necessidadePedeOServico(servico, necessidade) !== "nao")) return true;
  return lista(perfil.seekingTypes).some(busca => busca === "mentor" && FAMILIAS_DO_MENTOR.has(familiaDoServico(servico) ?? ""));
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
 * A citação conferida precisa se apoiar num serviço que o perfil OFERECE
 * (defeito relatado em 13/09): o portão conferia que o trecho estava na
 * oportunidade, mas não que ele pedia o serviço da pessoa — "consultoria em
 * marketing" passava para quem oferece "Consultoria jurídica". Quando o trecho
 * citado nomeia um serviço, algum serviço do perfil tem de atendê-lo
 * (`citacaoPedeServicoOferecido`, que localiza a citação na fonte e completa a
 * especialidade). Trecho sem palavra de serviço é paráfrase e fica com a IA,
 * como antes; perfil sem serviço classificável também.
 */
export function citacaoAmarradaAoPerfil(citacao: unknown, fonte: string, perfil?: PerfilNoPortao): boolean {
  if (typeof citacao !== "string" || !perfil) return true;
  // Os serviços do perfil vêm de "O que tenho" E da área e da especialidade: a UI só grava
  // ids fixos em "O que tenho", e a advogada que marcou "Canais comerciais" continua advogada.
  const declaradas = lista(perfil.whatIHave);
  const candidatas = [...declaradas, ...texto(perfil.activityArea), ...texto(perfil.primarySpecialty)];
  const servicos = candidatas.filter(oferta => servicoDoTermo(oferta) !== null);
  if (servicos.length === 0) return true;
  const temOutraBase = declaradas.some(oferta => servicoDoTermo(oferta) === null);
  return citacaoPedeServicoOferecido(citacao, fonte, servicos, temOutraBase);
}

/**
 * O portão: match apoiado em SERVIÇO só passa com a necessidade expressa
 * citada e conferida no texto que a pessoa escreveu, e apoiada num serviço que
 * o perfil oferece; e oportunidade que oferece um serviço só passa para quem
 * declarou algo que pode ser aquele serviço (`perfilDeclarouPrecisarDoServico`).
 * Qualquer outro tipo passa como antes.
 */
export function passaNoPortao(item: ItemComPortao, fonte: string, perfil?: PerfilNoPortao, oportunidade?: OportunidadeNoPortao): boolean {
  if (perfil && oportunidade && oportunidadeOfereceServico(oportunidade) && !perfilDeclarouPrecisarDoServico(perfil, oportunidade.title as string)) return false;
  if (!exigeCitacao(item, perfil)) return true;
  return citacaoConfere(item.necessidadeExpressa, fonte) && citacaoAmarradaAoPerfil(item.necessidadeExpressa, fonte, perfil);
}
