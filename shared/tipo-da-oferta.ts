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
 * Ordem da decisão, e por quê (ver `classificarOferta`):
 *   1. composto em inglês cuja última palavra é de outro tipo ("Marketing
 *      platform", "Accounting software", "Training materials"): a cabeça é a
 *      última palavra, o serviço é só o assunto;
 *   2. substantivo de serviço COLADO à cabeça, sem preposição nem conjunção
 *      no meio ("Tax consulting", "Customs brokerage", "Real estate
 *      consulting"): em inglês o substantivo do serviço vem depois;
 *   3. composto fixo de duas palavras ("real estate", "venture capital");
 *   3b. "Direito" seguido de área curada ("Direito tributário", "Direito do
 *      trabalho") é a especialidade do advogado, serviço pelo texto; fora das
 *      áreas curadas ("Direito minerário", "Direito creditório") segue a ordem;
 *   4. cabeça genérica "serviços"/"prestação": o complemento decide
 *      ("Serviços de logística" é logística, "Serviços de tradução" é serviço);
 *   5. a cabeça do termo, quando é palavra de um tipo ("Software de
 *      consultoria" é tecnologia: a cabeça manda);
 *   6. cabeça neutra (empresa, escritório, despacho...): o complemento pelo
 *      genitivo decide ("Escritório de advocacia", "Escritório jurídico";
 *      "Escritório para advogados" não — "para" não é genitivo);
 *   6b. escrita sem fronteira de palavra (chinês, japonês): vocabulário por
 *      substring (`SERVICOS_SEM_ESPACO`);
 *   7. a categoria que a usuária digitou ("Jurídico", "Marketing", "Produto";
 *      palavra específica de serviço decide, o genérico "serviços" cede a
 *      outro tipo: "Serviços financeiros" é capital) — assim por decisão do
 *      time em 14/09, ver o passo 7 de `classificarOferta`;
 *   8. "outros".
 * Por fim, revenda de marca colada à cabeça ("Consultora Natura") não é serviço.
 * Cabeça desconhecida seguida de preposição ou conjunção fica com o que ela
 * é: "Peças DE manutenção" é produto, "Centro DE treinamento" é
 * infraestrutura, "Mina E consultoria mineral" é a mina — o serviço ali é
 * modificador ou outro item, e tratá-lo como tipo apagava o match por
 * categoria que esses itens tinham (revisões adversariais de 12/09).
 */
import { ARTIGOS, ehLugar, GENITIVOS, MARCADORES_FRACOS, normalizar, tokensDoTermo } from "./direcao-do-termo";

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
  "contabilidade", "contabil", "contabeis", "contador", "contadora", "contadores", "contadoras", "contabilista", "contabilistas",
  "auditoria", "auditorias", "auditor", "auditora", "auditores", "auditoras",
  "mentoria", "mentorias", "mentor", "mentora", "mentores", "mentoras",
  "coaching", "coach",
  // en
  "consulting", "consultancy", "consultant", "consultants",
  "advisory", "advisor", "advisors", "adviser", "advisers",
  "lawyer", "lawyers", "attorney", "attorneys",
  "accounting", "accountant", "accountants", "bookkeeping", "bookkeeper", "bookkeepers",
  "audit", "auditing", "audits",
  "mentoring", "mentorship",
  // es
  "asesoria", "asesorias", "asesor", "asesora", "asesores", "asesoras",
  "abogacia", "abogado", "abogada", "abogados", "abogadas",
  "contabilidad", "contable", "contables",
  // de — a normalização já tirou o trema ("Übersetzung" vira "ubersetzung"),
  // então as formas aqui são as normalizadas.
  "beratung", "beratungen", "berater", "beraterin", "unternehmensberatung",
  "rechtsberatung", "rechtsanwalt", "rechtsanwalte", "anwalt", "anwalte", "anwaltin",
  "juristisch", "juristische", "buchhaltung", "buchfuhrung", "buchhalter",
  "steuerberatung", "steuerberater", "wirtschaftsprufung", "wirtschaftsprufer",
  // fr
  "conseil", "conseils", "consultante", "avocat", "avocats", "avocate",
  "juridique", "juridiques", "comptabilite", "comptable", "comptables", "auditeur", "auditeurs",
  // ru
  "консалтинг", "консультация", "консультации", "консультирование", "консультант",
  "юридический", "юридические", "юрист", "адвокат",
  "бухгалтерия", "бухгалтерский", "бухгалтер", "аудит", "аудитор",
  "наставничество", "менторство",
  // hi
  "परामर्श", "सलाहकार", "कानूनी", "वकील", "अधिवक्ता", "लेखांकन", "लेखाकार", "अंकेक्षण",
  // ar
  "استشارات", "استشارة", "استشاري", "محاماة", "محامي", "قانوني", "محاسبة", "محاسب", "تدقيق", "مدقق",
];

/**
 * "Legal" e "law" só valem na CABEÇA ("Legal advisory", "Law firm"): no meio
 * do termo, "legal" é adjetivo de qualquer coisa ("Cannabis legal").
 *
 * "direito" não entra aqui: a palavra é ambígua em português ("lado direito",
 * "acesso direito"). O buraco que isso deixava — "Direito tributário" sem
 * categoria caía em "outros" e escapava do portão — fecha com o critério
 * estreito: "Direito" só é serviço de advocacia seguido de ÁREA curada (ver
 * `areaDoDireito` e o passo 3b de `classificarOferta`).
 */
const ASSESSORIA_SO_NA_CABECA = ["legal", "law"];

/** Os demais serviços profissionais — inequívocos como prestação. */
const OUTROS_SERVICOS = [
  // pt
  "servico", "servicos", "prestacao",
  "marketing", "publicidade", "propaganda",
  "design", "designer", "designers",
  "arquitetura", "arquiteto", "arquiteta", "arquitetos", "arquitetas",
  "engenharia", "engenheiro", "engenheira", "engenheiros", "engenheiras",
  "publicitario", "publicitaria", "publicitarios", "publicitarias", "palestrante", "palestrantes",
  "recrutador", "recrutadora", "recrutadores", "recrutadoras",
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
  "engineering", "engineer", "engineers",
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
  "ingenieria", "ingeniero", "ingeniera", "ingenieros", "ingenieras",
  "capacitacion", "formacion", "entrenamiento",
  "traduccion", "traducciones", "traductor", "traductora", "traductores",
  // "corredor" fica de fora: é também o corredor logístico, e juntava
  // "Corretora de valores" com "Corredor" (revisão de 13/09).
  "corretaje",
  "reclutamiento", "tercerizacion",
  "mantenimiento", "soporte",
  // de
  "werbung", "ubersetzung", "ubersetzungen", "ubersetzer", "dolmetschen", "dolmetscher",
  "schulung", "schulungen", "weiterbildung", "architektur", "architekt",
  "ingenieurwesen", "ingenieur", "wartung", "instandhaltung",
  "personalvermittlung", "makler", "vermittlung",
  // fr
  "publicite", "traduction", "traductions", "traducteur", "traducteurs",
  "architecte", "architectes", "courtage", "courtier", "courtiers", "recrutement", "mentorat",
  // ru
  "маркетинг", "реклама", "переводчик", "обучение", "тренинг", "тренинги",
  "дизайн", "дизайнер", "архитектура", "архитектор", "инжиниринг", "инженер",
  "обслуживание", "техобслуживание", "рекрутинг", "брокер", "брокерские", "посредничество",
  // hi
  "विपणन", "मार्केटिंग", "अनुवाद", "अनुवादक", "प्रशिक्षण", "डिजाइन",
  "वास्तुकला", "वास्तुकार", "इंजीनियरिंग", "अभियांत्रिकी", "रखरखाव", "भर्ती", "दलाली", "दलाल",
  // ar
  "تسويق", "ترجمة", "مترجم", "تدريب", "تصميم", "مصمم", "عمارة", "هندسة", "مهندس",
  "صيانة", "توظيف", "وساطة", "وسيط",
];

/**
 * Adjetivos de serviço: só decidem atrás de cabeça NEUTRA ("Escritório
 * jurídico"). Soltos no termo são adjetivo de qualquer coisa — "Pessoa
 * jurídica", "Estrutura jurídica em Portugal", "Dados contábeis".
 */
const ADJETIVOS_DE_SERVICO = new Set([
  "juridico", "juridica", "juridicos", "juridicas", "contabil", "contabeis", "contable", "contables", "legal", "legales",
  // "publicitário" é adjetivo em "Material publicitário", "Espaço publicitário" (revisão de 13/09)
  "publicitario", "publicitaria", "publicitarios", "publicitarias",
]);

/**
 * "Serviços" (e "prestação") sozinho não nomeia serviço nenhum: como família
 * (ver `familiaDoServico`) diria que "Serviços" procurado casa com qualquer
 * prestação, e como necessidade genérica seria "preciso de serviços". Como
 * CABEÇA, deixa o complemento decidir: "Serviços de logística" é logística.
 */
const GENERICAS_DEMAIS = new Set(["servico", "servicos", "service", "services", "servicio", "servicios", "prestacao"]);

/**
 * Substantivos que nomeiam a prestação em si: toda palavra de serviço das
 * listas que não é adjetivo. Decidem (a) colados à cabeça, sem preposição nem
 * conjunção no meio — "Tax consulting", "Customs brokerage", "Technical
 * support", "International law firm" — porque em inglês o substantivo do
 * serviço vem depois, e é ele a cabeça de fato; e (b) atrás de cabeça neutra,
 * atravessando o genitivo ("Empresa de contabilidade", "Despacho de
 * abogados"). Atrás de OUTRA preposição ou de conjunção, com cabeça de outra
 * natureza, são só modificador ou outro item: "Peças DE manutenção" é
 * produto, "Escritório PARA advogados" é o imóvel, "Mina E consultoria
 * mineral" fica com a mina (revisões de 12/09).
 */
const SUBSTANTIVOS_DE_SERVICO = new Set(
  [...ASSESSORIA, ...ASSESSORIA_SO_NA_CABECA, ...OUTROS_SERVICOS].filter(palavra => !ADJETIVOS_DE_SERVICO.has(palavra)),
);

/**
 * A FAMÍLIA de cada palavra de serviço — o LEMA que junta as flexões e os três
 * idiomas: "advogado", "advocacia", "jurídico", "lawyer" e "abogada" são a
 * mesma família; "consultor", "consulting" e "consultancy" também. Família é
 * lema, não área: consultoria e assessoria, mentoria e coaching, marketing e
 * publicidade, tradução e interpretação, treinamento, curso e palestra,
 * suporte, assistência e atendimento são famílias distintas. Até 13/09 elas
 * eram fundidas, e a fusão dava 100 entre serviços diferentes ("Assessoria de
 * imprensa" × "Consultoria", "Interpretação de exames" × "Tradutor").
 * Consultoria e assessoria só se aproximam com a mesma especialidade
 * (`SINONIMOS_PROXIMOS`). Palavra fora do mapa é a própria família.
 */
const FAMILIAS: Record<string, readonly string[]> = {
  advocacia: ["advocacia", "advogado", "advogada", "advogados", "advogadas", "juridico", "juridica", "juridicos", "juridicas", "lawyer", "lawyers", "attorney", "attorneys", "law", "legal", "legales", "abogacia", "abogado", "abogada", "abogados", "abogadas", "rechtsberatung", "rechtsanwalt", "rechtsanwalte", "anwalt", "anwalte", "anwaltin", "juristisch", "juristische", "avocat", "avocats", "avocate", "juridique", "juridiques", "юридический", "юридические", "юрист", "адвокат", "कानूनी", "वकील", "अधिवक्ता", "محاماة", "محامي", "قانوني"],
  consultoria: ["consultoria", "consultorias", "consultor", "consultora", "consultores", "consultoras", "consulting", "consultancy", "consultant", "consultants", "beratung", "beratungen", "berater", "beraterin", "unternehmensberatung", "conseil", "conseils", "consultante", "консалтинг", "консультация", "консультации", "консультирование", "консультант", "परामर्श", "सलाहकार", "استشارات", "استشارة", "استشاري"],
  assessoria: ["assessoria", "assessorias", "assessor", "assessora", "assessores", "assessoras", "advisory", "advisor", "advisors", "adviser", "advisers", "asesoria", "asesorias", "asesor", "asesora", "asesores", "asesoras"],
  contabilidade: ["contabilidade", "contabil", "contabeis", "contador", "contadora", "contadores", "contadoras", "contabilista", "contabilistas", "accounting", "accountant", "accountants", "bookkeeping", "bookkeeper", "bookkeepers", "contabilidad", "contable", "contables", "buchhaltung", "buchfuhrung", "buchhalter", "steuerberatung", "steuerberater", "comptabilite", "comptable", "comptables", "бухгалтерия", "бухгалтерский", "бухгалтер", "लेखांकन", "लेखाकार", "محاسبة", "محاسب"],
  auditoria: ["auditoria", "auditorias", "auditor", "auditora", "auditores", "auditoras", "audit", "auditing", "audits", "wirtschaftsprufung", "wirtschaftsprufer", "auditeur", "auditeurs", "аудит", "аудитор", "अंकेक्षण", "تدقيق", "مدقق"],
  mentoria: ["mentoria", "mentorias", "mentor", "mentora", "mentores", "mentoras", "mentoring", "mentorship", "наставничество", "менторство", "mentorat"],
  coaching: ["coaching", "coach"],
  marketing: ["marketing", "маркетинг", "विपणन", "मार्केटिंग", "تسويق"],
  publicidade: ["publicidade", "propaganda", "advertising", "publicidad", "publicitario", "publicitaria", "publicitarios", "publicitarias", "werbung", "publicite", "реклама"],
  design: ["design", "designer", "designers", "diseno", "disenador", "disenadora", "disenadores", "дизайн", "дизайнер", "डिजाइन", "تصميم", "مصمم"],
  arquitetura: ["arquitetura", "arquiteto", "arquiteta", "arquitetos", "arquitetas", "architecture", "architect", "architects", "arquitectura", "arquitecto", "arquitecta", "arquitectos", "architektur", "architekt", "architecte", "architectes", "архитектура", "архитектор", "वास्तुकला", "वास्तुकार", "عمارة"],
  engenharia: ["engenharia", "engenheiro", "engenheira", "engenheiros", "engenheiras", "engineering", "engineer", "engineers", "ingenieria", "ingeniero", "ingeniera", "ingenieros", "ingenieras", "ingenieurwesen", "ingenieur", "инжиниринг", "инженер", "इंजीनियरिंग", "अभियांत्रिकी", "هندسة", "مهندس"],
  treinamento: ["treinamento", "treinamentos", "capacitacao", "capacitacoes", "training", "trainings", "capacitacion", "formacion", "entrenamiento", "schulung", "schulungen", "weiterbildung", "обучение", "тренинг", "тренинги", "प्रशिक्षण", "تدريب"],
  curso: ["curso", "cursos"],
  palestra: ["palestra", "palestras", "palestrante", "palestrantes"],
  traducao: ["traducao", "traducoes", "tradutor", "tradutora", "tradutores", "tradutoras", "translation", "translations", "translator", "translators", "traduccion", "traducciones", "traductor", "traductora", "traductores", "ubersetzung", "ubersetzungen", "ubersetzer", "traduction", "traductions", "traducteur", "traducteurs", "переводчик", "अनुवाद", "अनुवादक", "ترجمة", "مترجم"],
  interpretacao: ["interpretacao", "interprete", "interpretes", "interpreting", "interpreter", "interpreters", "dolmetschen", "dolmetscher"],
  despachante: ["despachante", "despachantes", "desembaraco"],
  corretagem: ["corretagem", "corretor", "corretora", "corretores", "corretoras", "brokerage", "broker", "brokers", "corretaje", "makler", "courtage", "courtier", "courtiers", "брокер", "брокерские", "दलाली", "दलाल", "وساطة", "وسيط"],
  recrutamento: ["recrutamento", "recrutador", "recrutadora", "recrutadores", "recrutadoras", "headhunting", "headhunter", "headhunters", "recruitment", "recruiting", "reclutamiento", "personalvermittlung", "recrutement", "рекрутинг", "भर्ती", "توظيف"],
  terceirizacao: ["terceirizacao", "outsourcing", "tercerizacion"],
  manutencao: ["manutencao", "maintenance", "mantenimiento", "wartung", "instandhaltung", "обслуживание", "техобслуживание", "रखरखाव", "صيانة"],
  suporte: ["suporte", "support", "soporte"],
  assistencia: ["assistencia", "assistance"],
  atendimento: ["atendimento"],
  agenciamento: ["agenciamento"],
  intermediacao: ["intermediacao", "vermittlung", "посредничество"],
};
/**
 * Chinês e japonês não separam palavras por espaço, então a classificação por
 * TOKEN não enxerga nada: "税务咨询" (consultoria tributária) chega como uma
 * palavra só e caía em "outros" — o portão da demanda expressa nunca disparava
 * nesses dois idiomas, e a regra da cliente simplesmente não existia para
 * quem escreve neles (defeito relatado depois da #101).
 *
 * Aqui o casamento é por SUBSTRING, que é como se reconhece vocabulário
 * fechado em escrita sem fronteira de palavra. A lista é curta e conservadora
 * de propósito: termo que também é palavra comum fora de serviço (支持/サポート
 * "suporte", 工程 "obra") ficou de fora, porque classificar como serviço por
 * engano SUJEITA o item ao portão — erra para o lado de barrar match legítimo.
 * Faltar termo aqui só mantém o que já havia. As famílias seguem as de
 * FAMILIAS: publicidade (广告) e interpretação (通訳) são famílias próprias.
 *
 * Ordenado do mais longo para o mais curto: "建築設計" tem de ganhar de "設計".
 */
const SERVICOS_SEM_ESPACO: Array<[string, string]> = ([
  // zh
  ["市场营销", "marketing"], ["建筑设计", "arquitetura"],
  ["咨询", "consultoria"], ["諮詢", "consultoria"], ["顾问", "consultoria"],
  ["律师", "advocacia"], ["法律", "advocacia"],
  ["会计", "contabilidade"], ["审计", "auditoria"],
  ["营销", "marketing"], ["广告", "publicidade"],
  ["翻译", "traducao"], ["培训", "treinamento"], ["设计", "design"],
  ["维护", "manutencao"], ["招聘", "recrutamento"], ["经纪", "corretagem"],
  // ja
  ["コンサルティング", "consultoria"], ["マーケティング", "marketing"],
  ["メンテナンス", "manutencao"], ["人材紹介", "recrutamento"], ["建築設計", "arquitetura"],
  ["コンサル", "consultoria"], ["弁護士", "advocacia"], ["法務", "advocacia"],
  ["監査", "auditoria"], ["翻訳", "traducao"], ["通訳", "interpretacao"],
  ["研修", "treinamento"], ["デザイン", "design"], ["設計", "design"],
  ["保守", "manutencao"], ["採用", "recrutamento"], ["仲介", "corretagem"],
] as Array<[string, string]>).sort((a, b) => b[0].length - a[0].length);

/** A família do serviço nomeado por substring, ou null — ver SERVICOS_SEM_ESPACO. */
function servicoPorSubstring(rotulo: string): string | null {
  const texto = normalizar(rotulo);
  for (const [termo, familia] of SERVICOS_SEM_ESPACO) if (texto.includes(termo)) return familia;
  return null;
}
const FAMILIA_DA_PALAVRA = new Map<string, string>(
  Object.entries(FAMILIAS).flatMap(([familia, palavras]) => palavras.map(palavra => [palavra, familia] as const)),
);
const familiaDaPalavra = (palavra: string) => FAMILIA_DA_PALAVRA.get(palavra) ?? palavra;

/** Depois de uma destas, o que vem é complemento da cabeça, não a coisa oferecida. */
const PREPOSICOES = new Set([
  ...Array.from(GENITIVOS), "para", "em", "no", "na", "nos", "nas", "com", "por", "sobre", "ao", "aos", "a", "as",
  "for", "to", "in", "on", "with", "from", "at", "en", "con", "al", "del", "desde", "hacia",
]);
/** Conjunção coordena OUTRO item: "Mina e consultoria mineral" fica com a mina. */
const CONJUNCOES = new Set(["e", "and", "y", "ou", "or"]);
const FRONTEIRAS = new Set([...Array.from(PREPOSICOES), ...Array.from(CONJUNCOES)]);

const PRODUTO = [
  "produto", "produtos", "product", "products", "producto", "productos",
  "mercadoria", "mercadorias", "goods", "merchandise", "mercancia", "mercancias",
  "estoque", "estoques", "stock", "inventario", "inventory",
  "commodity", "commodities", "materia", "materias",
  "material", "materiais", "materials", "materiales",
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
  "financeira", "financeiras", "financeiro", "financeiros", "financial", "financiera", "financiero",
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
  "dados", "datos", "data", "database", "databases",
  "ferramenta", "ferramentas", "tool", "tools", "herramienta", "herramientas",
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
  // O que uma pessoa de fato anuncia como imóvel e faltava aqui: sem estas, a
  // cabeça não decidia e a CATEGORIA passava a decidir — "Apartamento na praia"
  // com a categoria "Serviços jurídicos" virava serviço e caía no portão da
  // demanda expressa, que é restrição (defeito relatado depois da #101).
  "apartamento", "apartamentos", "apartment", "apartments", "flat", "flats",
  "casa", "casas", "house", "houses", "sobrado", "sobrados", "cobertura", "coberturas",
  "sala", "salas", "loja", "lojas", "store", "stores",
  "vaga", "vagas", "garagem", "garagens",
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
  "oficina", "oficinas", "profesional", "profesionales", "despacho", "despachos",
  "agencia", "agencias", "agency", "agencies",
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

/** Toda palavra de serviço (substantivos, adjetivos e genéricas) — a conferência de citação usa para não tolerar serviço inventado. */
export const PALAVRAS_DE_SERVICO: ReadonlySet<string> = new Set(LISTAS_POR_TIPO[0][1]);

const ehPalavraDeServico = (palavra: string) => TIPO_POR_CABECA.get(palavra) === "servico";
const tipoNaoServico = (palavra: string): TipoDaOferta | null => {
  const tipo = TIPO_POR_CABECA.get(palavra);
  return tipo && tipo !== "servico" ? tipo : null;
};

/** Verbos de quem pede, que saem da frente do termo como os marcadores fracos. */
const VERBOS_DE_NECESSIDADE = new Set([
  "precisamos", "buscamos", "procuramos", "queremos", "necessitamos", "desejamos", "gostariamos",
  "contratar", "contratamos", "contrata", "contratando", "estamos", "estou", "gostaria", "se",
  "necesitamos", "necesitan", "we", "are", "am",
]);

/** A cabeça do termo (a primeira palavra que não é marcador fraco, verbo de quem pede, artigo nem genitivo) e onde ela está. */
function cabecaDoTermo(palavras: string[]) {
  let i = 0;
  const saiDaFrente = (palavra: string) =>
    MARCADORES_FRACOS.has(palavra) || VERBOS_DE_NECESSIDADE.has(palavra) || ARTIGOS.has(palavra) || GENITIVOS.has(palavra);
  // "looking for a lawyer": o "for" de quem procura sai junto com o marcador.
  const forDeQuemProcura = (k: number) => palavras[k] === "for" && k > 0 && MARCADORES_FRACOS.has(palavras[k - 1]);
  while (i < palavras.length - 1 && (saiDaFrente(palavras[i]) || forDeQuemProcura(i))) i += 1;
  return { indice: i, cabeca: palavras[i] as string | undefined, seguinte: palavras[i + 1] as string | undefined };
}

/** As palavras coladas à cabeça, até a primeira preposição ou conjunção. */
function juntoDaCabeca(palavras: string[], indice: number) {
  const fim = palavras.findIndex((palavra, i) => i > indice && FRONTEIRAS.has(palavra));
  return palavras.slice(indice + 1, fim < 0 ? undefined : fim);
}

/**
 * O complemento de uma cabeça neutra ou genérica: atravessa o genitivo
 * ("Empresa DE contabilidade"), para em outra preposição ou conjunção
 * ("Escritório PARA advogados" é o imóvel, não os advogados).
 */
function complementoDaCabeca(palavras: string[], indice: number) {
  const fim = palavras.findIndex((palavra, i) => i > indice && !GENITIVOS.has(palavra) && !atravessaEspecialista(palavras, i) && FRONTEIRAS.has(palavra));
  return palavras
    .slice(indice + 1, fim < 0 ? undefined : fim)
    .filter((palavra, k) => !GENITIVOS.has(palavra) && !ARTIGOS.has(palavra) && !ESPECIALISTA.has(palavra) && !atravessaEspecialista(palavras, indice + 1 + k));
}

/**
 * "Especialista EM direito tributário", "Empresa especializada EM consultoria":
 * depois de especialista/especializado, o "em" apresenta o que se presta, e o
 * complemento atravessa (revisão de 13/09).
 */
const ESPECIALISTA = new Set([
  "especialista", "especialistas", "specialist", "specialists", "especializado", "especializada",
  "especializados", "especializadas", "specialized",
]);
const EM_DO_ESPECIALISTA = new Set(["em", "no", "na", "nos", "nas", "in", "en"]);
function atravessaEspecialista(palavras: string[], i: number): boolean {
  return EM_DO_ESPECIALISTA.has(palavras[i]) && i > 0 && ESPECIALISTA.has(palavras[i - 1]);
}

/**
 * O que a categoria digitada diz. Palavra de serviço ESPECÍFICA (consultoria,
 * advocacia, marketing, auditoria, jurídico...) decide serviço em qualquer
 * posição — "Consultoria financeira" e "Advocacia imobiliária" são serviço.
 * Só o genérico "serviços" cede a uma palavra de outro tipo: "Serviços
 * financeiros" é capital, "Serviços de tecnologia" é tecnologia — a regra do
 * serviço não pode vazar para investimento e tecnologia por causa da palavra
 * "serviços" na categoria.
 */
function tipoPelaCategoria(categoria: string | null | undefined): TipoDaOferta | null {
  let generico = false;
  let outro: TipoDaOferta | null = null;
  for (const palavra of tokensDoTermo(categoria ?? "")) {
    const tipo = TIPO_POR_PALAVRA_DA_CATEGORIA.get(palavra) ?? TIPO_POR_CABECA.get(palavra);
    if (!tipo) continue;
    if (tipo === "servico") {
      if (GENERICAS_DEMAIS.has(palavra)) generico = true;
      else return "servico";
    } else if (!outro) {
      outro = tipo;
    }
  }
  return outro ?? (generico ? "servico" : null);
}
/**
 * Adjetivos em português e espanhol que, pospostos a um serviço, qualificam o
 * serviço e não viram a cabeça do termo, embora estejam em lista de outro
 * tipo: "Consultoria financeira", "Assessoria logística". Sem isto, a regra do
 * composto em inglês os lia como cabeça e o serviço escapava do portão como
 * capital ou ativo (revisão de 13/09).
 */
const ADJETIVOS_POSPOSTOS = new Set([
  "financeiro", "financeira", "financeiros", "financeiras", "financiero", "financiera", "financieros", "financieras",
  "logistico", "logistica", "logisticos", "logisticas",
]);
const CABECAS_COM_ADJETIVO_POSPOSTO = new Set(["consultoria", "assessoria", "auditoria", "contabilidade", "advocacia", "mentoria", "coaching"]);

/**
 * "Direito" é serviço de advocacia só com uma ÁREA curada: colada ("Direito
 * tributário", "Derecho laboral") ou pelo genitivo ("Direito do trabalho",
 * "Direito de família"). Fora da lista, "direito" é o próprio ativo: "Direito
 * minerário", "Direito creditório", "Direito real de uso" e "Direito exclusivo
 * de distribuição" não são serviço (revisão de 13/09).
 */
const CABECAS_DO_DIREITO = new Set(["direito", "derecho"]);
const AREAS_DO_DIREITO = new Set([
  "tributario", "tributaria", "fiscal", "trabalhista", "laboral", "civil", "penal", "criminal",
  "empresarial", "societario", "societaria", "previdenciario", "previdenciaria", "ambiental",
  "imobiliario", "imobiliaria", "digital", "internacional", "administrativo", "administrativa",
  "regulatorio", "regulatoria", "aduaneiro", "aduaneira", "concorrencial", "contratual",
  "sucessorio", "sucessoria", "bancario", "bancaria", "eleitoral", "constitucional", "medico",
]);
const AREAS_DO_DIREITO_PELO_GENITIVO = new Set(["trabalho", "familia", "consumidor", "saude"]);
/** Áreas que também qualificam o próprio direito como ativo: "Direito digital DE transmissão do filme". */
const AREAS_QUE_QUALIFICAM_O_ATIVO = new Set(["digital", "internacional"]);

/** A área do direito que faz de "Direito X" um serviço, ou null. */
function areaDoDireito(palavras: string[], indice: number): string | null {
  if (!CABECAS_DO_DIREITO.has(palavras[indice] ?? "")) return null;
  const seguinte = palavras[indice + 1];
  if (seguinte && AREAS_DO_DIREITO.has(seguinte)) {
    // "Direito digital DE transmissão", "Direito internacional SOBRE a marca": o direito é o ativo (revisão de 14/09).
    const objeto = palavras[indice + 2] ?? "";
    return AREAS_QUE_QUALIFICAM_O_ATIVO.has(seguinte) && (GENITIVOS.has(objeto) || objeto === "sobre") ? null : seguinte;
  }
  const depois = palavras[indice + 2];
  if (seguinte && GENITIVOS.has(seguinte) && depois && AREAS_DO_DIREITO_PELO_GENITIVO.has(depois)) return depois;
  return null;
}

/**
 * Classifica um item de "o que tenho" / "o que possui". `categoria` é a
 * categoria livre que a usuária digitou junto (opcional) e só decide quando o
 * texto do item não decidiu. Na dúvida, "outros".
 */
function classificarPeloTexto(rotulo: string, categoria?: string | null): TipoDaOferta {
  const palavras = tokensDoTermo(rotulo);
  const { indice, cabeca, seguinte } = cabecaDoTermo(palavras);
  if (!cabeca) return tipoPelaCategoria(categoria) ?? "outros";
  const junto = juntoDaCabeca(palavras, indice);
  const semFronteira = junto.length === palavras.length - indice - 1;
  // 1. Composto sem preposição cuja ÚLTIMA palavra é de outro tipo, com a
  //    primeira sendo de serviço: "Marketing platform", "Accounting software",
  //    "Training materials", "Legal database" — em inglês a cabeça é a última
  //    palavra, e ali o serviço é só o assunto do produto.
  //    Adjetivo posposto em português ou espanhol não é cabeça inglesa:
  //    "Consultoria financeira" e "Consultoria logística" são serviço.
  if (semFronteira && junto.length > 0 && ehPalavraDeServico(cabeca)) {
    const final = junto[junto.length - 1];
    // Só nas cabeças de aconselhamento: "Suporte financeiro" e "Assistência financeira" são aporte de capital.
    const aconselha = CABECAS_COM_ADJETIVO_POSPOSTO.has(familiaDaPalavra(cabeca));
    const ultimo = ADJETIVOS_POSPOSTOS.has(final) && aconselha ? null : tipoNaoServico(final);
    if (ultimo) return ultimo;
  }
  // 2. Substantivo de serviço colado à cabeça (antes do composto: "Real
  //    estate consulting" é consultoria, não o imóvel).
  if (junto.some(palavra => SUBSTANTIVOS_DE_SERVICO.has(palavra))) return "servico";
  if (seguinte) {
    const composto = COMPOSTOS.get(`${cabeca} ${seguinte}`);
    if (composto) return composto;
  }
  // 3. Cabeça genérica ("Serviços de X", "Prestação de X"): o complemento
  //    decide — "Serviços de logística" é logística, "Serviços financeiros" é
  //    capital, "Serviços de tradução" é serviço.
  if (GENERICAS_DEMAIS.has(cabeca)) {
    const complemento = complementoDaCabeca(palavras, indice);
    return (complemento.length ? tipoNaoServico(complemento[0]) : null) ?? "servico";
  }
  // 3b. "Direito" com área curada é advocacia pelo texto: "Direito tributário",
  //     "Direito do trabalho". Sem isto, "Direito tributário" sem categoria caía
  //     em "outros" e escapava do portão (buraco registrado na #124); "Direito
  //     minerário" e "Direito creditório" seguem sem ser serviço.
  if (areaDoDireito(palavras, indice)) return "servico";
  // 4. A cabeça manda.
  if (!CABECAS_NEUTRAS.has(cabeca)) {
    const pelaCabeca = TIPO_POR_CABECA.get(cabeca);
    if (pelaCabeca) return pelaCabeca;
  }
  // 5. Cabeça neutra: o complemento decide, atravessando só o genitivo.
  if (CABECAS_NEUTRAS.has(cabeca)) {
    const complemento = complementoDaCabeca(palavras, indice);
    // A primeira palavra do complemento de outro tipo manda: "Empresa especializada em SOFTWARES jurídicos" é tecnologia.
    const primeiraDeOutroTipo = tipoNaoServico(complemento[0] ?? "") !== null;
    if (!primeiraDeOutroTipo && complemento.some((palavra, k) => SUBSTANTIVOS_DE_SERVICO.has(palavra) || ADJETIVOS_DE_SERVICO.has(palavra) || areaDoDireito(complemento, k) !== null)) {
      return "servico";
    }
  }
  // 6. Escrita sem fronteira de palavra (chinês, japonês): a esta altura o
  //    caminho por token não achou nada, porque o rótulo inteiro é um token só.
  //    Vem por último de propósito — não passa por cima de decisão nenhuma.
  if (servicoPorSubstring(rotulo)) return "servico";
  // 7. A CATEGORIA decide o que o texto não decidiu. Isto já foi relatado como
  //    defeito duas vezes, por revisores diferentes — "Cafeteira industrial" na
  //    categoria "Consultoria" vira serviço e cai no portão, que é restrição —
  //    e FICA ASSIM por decisão do time em 14/09. O motivo: a categoria é o
  //    último recurso que faz "Direito tributário", "Planejamento patrimonial",
  //    "Contratos" e "Campanhas" serem reconhecidos como serviço, que é o caso
  //    central da regra da cliente. Tirar daqui quebra cinco testes, entre eles
  //    o farol "'Direito tributário' [Serviços] × 'Compradores' [Serviços] não
  //    casa" — o par que a #101 existe para barrar.
  //
  //    O que se faz no lugar: fechar LACUNA DE LÉXICO quando aparecer caso real
  //    (foi assim que apartamento, casa, sala e loja entraram em IMOVEL), para
  //    a cabeça decidir antes de chegar aqui. E a causa raiz — a categoria ser
  //    texto livre — é dívida registrada no quadro, não conserto deste arquivo.
  return tipoPelaCategoria(categoria) ?? "outros";
}

/** "Consultora Natura" é revendedora de produto, não consultoria (revisão de 13/09). */
const MARCAS_DE_VENDA_DIRETA = new Set([
  "natura", "avon", "boticario", "jequiti", "hinode", "eudora", "tupperware", "herbalife", "oriflame", "jeunesse", "racco", "demillus", "polishop", "mary kay",
]);
const CONSULTORA_DE_REVENDA = new Set(["consultor", "consultora", "consultores", "consultoras", "revendedor", "revendedora", "revendedores", "revendedoras"]);

/** Revenda de marca COLADA à cabeça: "Consultora Natura", "Consultora Mary Kay". "Mentoria para revendedoras Natura" continua serviço. */
function ehRevenda(palavras: string[]): boolean {
  const { indice, cabeca } = cabecaDoTermo(palavras);
  if (!cabeca || !CONSULTORA_DE_REVENDA.has(cabeca)) return false;
  const juntos = ` ${[cabeca, ...juntoDaCabeca(palavras, indice)].join(" ")} `;
  return Array.from(MARCAS_DE_VENDA_DIRETA).some(marca => juntos.includes(` ${marca} `));
}
export function classificarOferta(rotulo: string, categoria?: string | null): TipoDaOferta {
  const tipo = classificarPeloTexto(rotulo, categoria);
  if (tipo === "servico" && ehRevenda(tokensDoTermo(rotulo))) {
    const pelaCategoria = tipoPelaCategoria(categoria);
    return pelaCategoria && pelaCategoria !== "servico" ? pelaCategoria : "outros";
  }
  return tipo;
}

/** O item é um SERVIÇO — o único tipo em que o portão da demanda expressa atua. */
export function ehServico(rotulo: string, categoria?: string | null): boolean {
  return classificarOferta(rotulo, categoria) === "servico";
}

// ─── O serviço que o termo NOMEIA: família e especialidade ───────────────────
//
// Defeitos relatados em 13/09 na regra de 12/09, que só reconhecia a
// necessidade GENÉRICA de uma palavra:
//   (a) a mesma especialidade escrita de outro jeito dava zero — "Advocacia
//       tributária" diante de "Advogado tributarista" caía de 60 para 0, e no
//       motor privado a sugestão pendente era apagada na regeneração;
//   (c) a família juntava serviços diferentes — "Assessoria de imprensa"
//       diante de "Consultoria" e "Interpretação de exames" diante de
//       "Tradutor" davam 100.
//
// REGRA ESTRITA (três revisões adversariais em 13/09): o motor só afirma que
// dois serviços são o mesmo quando ENTENDE o que os distingue. A família é o
// lema da palavra que nomeia o serviço; a especialidade são as palavras que o
// qualificam. Palavra fora das listas curadas precisa aparecer IGUAL dos dois
// lados, e a oferta não pode ter palavra desconhecida a mais ("Consultoria em
// SEGURANÇA do trabalho" não é consultoria trabalhista, "Consultoria em
// SEGUROS empresariais" não é consultoria empresarial). Na dúvida, não casa —
// que é o comportamento de antes da correção.

/**
 * Consultoria e assessoria são lemas diferentes, mas próximos: "Consultoria
 * tributária" atende "Assessoria tributária". Só com especialidade escrita dos
 * dois lados, e nunca com assessoria que não aconselha.
 */
const SINONIMOS_PROXIMOS = new Set(["consultoria|assessoria", "assessoria|consultoria"]);

/** As famílias que atendem a opção fixa "Consultoria" de "O que preciso". */
const FAMILIAS_DE_ASSESSORIA = new Set(["consultoria", "assessoria", "advocacia", "contabilidade", "auditoria", "mentoria", "coaching"]);

/** Pedido de apoio que pode nomear a profissão pelo adjetivo: "assessoria JURÍDICA", "suporte CONTÁBIL". */
const FAMILIAS_DE_APOIO = new Set(["consultoria", "assessoria", "suporte", "assistencia", "atendimento"]);
const PROFISSOES_PELO_ADJETIVO = new Set(["advocacia", "contabilidade"]);

/**
 * Preposições que apresentam o ASSUNTO do serviço: "Consultoria EM marketing",
 * "Advogado DE imigração". As demais ("para", "com", "for", "to"...) abrem
 * público-alvo ou finalidade.
 */
const PREPOSICOES_DE_ASSUNTO = new Set([...Array.from(GENITIVOS), "em", "no", "na", "nos", "nas", "sobre", "in", "on", "en", "del"]);

/** Palavras que qualificam quem presta ou como se pede, não o que se presta. */
const PALAVRAS_SEM_ESPECIALIDADE = new Set([
  ...Array.from(VERBOS_DE_NECESSIDADE),
  "especializado", "especializada", "especializados", "especializadas", "especialidade", "especialidades", "specialized",
  "area", "areas", "urgente", "urgentes", "urgentemente", "experiente", "experientes", "qualificado", "qualificada", "qualificados",
  "qualificadas", "bom", "boa", "bons", "boas", "confiavel", "confiaveis", "nosso", "nossa", "nossos", "nossas",
  "meu", "minha", "seu", "sua", "um", "uma", "algum", "alguma", "queria",
  // "público" e "seleção" não: nomeiam área ("gestão pública") e serviço ("consultoria de seleção").
  "confianca", "online",
  "senior", "junior", "pleno", "bilingue", "trilingue", "altamente", "freelancer", "autonomo", "autonoma",
  "inscrito", "inscrita", "registrado", "registrada", "habilitado", "habilitada", "oab", "crc", "crea",
  "indicacao", "indicacoes", "contratacao", "contratacoes",
  // en/es/fr: artigo e possessivos que o ARTIGOS compartilhado não tem ("We need an accountant", "our marketing")
  "an", "i", "our", "my", "your", "their", "nuestro", "nuestra", "nuestros", "nuestras", "su", "sus", "notre", "votre",
  "experienced", "reliable", "good", "qualified", "trusted",
]);

/** Depois destas, "em"/"para"/"a" apresentam o assunto: "com foco em", "voltada para", "com especialização em". */
const QUALIFICA_O_ASSUNTO = new Set([
  "foco", "experiencia", "atuacao", "enfase", "focus", "experience", "expertise", "focado", "focada",
  "voltado", "voltada", "dedicado", "dedicada", "direcionado", "direcionada", "orientado", "orientada",
  "especializacao", "mba", "formacao", "pos", "graduacao",
  "especializado", "especializada", "especializados", "especializadas", "specialized",
]);

/**
 * O lema das especialidades mais comuns, CURADO: flexões, as formas em -ista e
 * a tradução. Corte de sufixo foi medido e descartado — juntava "carreira" com
 * "carros", "social" com "sócios" e "ambiental" com "ambientes". Palavra fora
 * daqui perde só o número e o gênero, e só casa escrita igual.
 */
const LEMAS_DE_ESPECIALIDADE: Record<string, readonly string[]> = {
  tributario: ["tributario", "tributaria", "tributarios", "tributarias", "tributarista", "tributaristas", "tributo", "tributos", "tributacao", "fiscal", "fiscais", "fiscalista", "fiscalistas", "imposto", "impostos", "tax", "taxes", "taxation", "icms", "iss", "pis", "cofins", "irpj", "csll", "impuesto", "impuestos", "tributacion"],
  trabalhista: ["trabalhista", "trabalhistas", "trabalho", "laboral", "laborais", "laboralista", "laboralistas", "labor", "labour", "employment", "laborales"],
  societario: ["societario", "societaria", "societarios", "societarias", "societarista", "societaristas"],
  previdenciario: ["previdenciario", "previdenciaria", "previdenciarios", "previdenciarias", "previdenciarista", "previdenciaristas", "previdencia"],
  criminal: ["criminal", "criminais", "criminalista", "criminalistas", "penal", "penais", "penalista", "penalistas", "penales"],
  civil: ["civil", "civel", "civeis", "civis", "civiles", "civilista", "civilistas"],
  imobiliario: ["imobiliario", "imobiliaria", "imobiliarios", "imobiliarias", "inmobiliario", "inmobiliaria", "inmobiliarios", "imovel", "imoveis", "property", "properties"],
  ambiental: ["ambiental", "ambientais", "ambientales", "ambientalista", "ambientalistas", "environmental", "environment"],
  empresarial: ["empresarial", "empresariais", "empresa", "empresas", "mercantil", "mercantis"],
  familia: ["familia", "familias", "familiar", "familiares", "family", "divorcio", "divorcios", "partilha", "partilhas"],
  imigracao: ["imigracao", "imigratorio", "imigratoria", "migratorio", "migratoria", "immigration", "inmigracion"],
  financeiro: ["financeiro", "financeira", "financeiros", "financeiras", "financas", "financial", "finance", "financiero", "financiera", "finanzas"],
  juramentado: ["juramentado", "juramentada", "juramentados", "juramentadas", "sworn"],
  contratual: ["contratual", "contratuais", "contrato", "contratos", "contract", "contracts", "contractual"],
  digital: ["digital", "digitais", "digitales"],
  internacional: ["internacional", "internacionais", "international", "internacionales"],
  tecnico: ["tecnico", "tecnica", "tecnicos", "tecnicas", "technical"],
};

const LEMA_DA_ESPECIALIDADE = new Map<string, string>(
  Object.entries(LEMAS_DE_ESPECIALIDADE).flatMap(([lema, palavras]) => palavras.map(palavra => [palavra, lema] as const)),
);
/** Áreas que, junto de "corporativo", dizem que ele é só o público (empresas): "Advocacia tributária corporativa". */
const AREAS_CONTENCIOSAS = new Set(["tributario", "trabalhista", "criminal", "previdenciario", "civil", "familia", "imobiliario", "ambiental", "imigracao"]);

/**
 * Palavras que só são de família na advocacia: "Advogado para inventário", "para
 * pensão alimentícia". Fora dela são outra coisa — "Auditoria de inventário" é
 * estoque, "Consultoria em inventário de emissões" é carbono — e por isso não
 * estão em LEMAS_DE_ESPECIALIDADE (revisão de 14/09).
 */
const FAMILIA_SO_NA_ADVOCACIA = new Set(["inventario", "inventarios", "pensao", "pensoes"]);
const COMPLEMENTO_DA_PENSAO = new Set(["alimenticia", "alimenticias", "alimentar", "alimentares"]);
/** "Holding FAMILIAR", "empresa FAMILIAR", "FAMILY business": o tipo da empresa, não a área de família. */
const FAMILIAR = new Set(["familiar", "familiares", "family"]);
const EMPRESAS_FAMILIARES = new Set(["holding", "holdings", "empresa", "empresas", "negocio", "negocios", "business", "businesses", "company", "companies"]);

/**
 * Palavras de atividade que não mudam o serviço QUANDO há uma especialidade
 * reconhecida no mesmo item: "Consultoria em PLANEJAMENTO financeiro",
 * "Auditoria de DEMONSTRAÇÕES financeiras". Sozinhas, são assunto como
 * qualquer outro ("Consultoria em gestão" não é a consultoria genérica).
 */
const PALAVRAS_DE_ATIVIDADE = new Set([
  "planejamento", "gestao", "questao", "questoes", "obrigacao", "obrigacoes", "demonstracao", "demonstracoes",
  "processo", "processos", "acao", "acoes", "contencioso", "rotina", "rotinas", "departamento", "setor", "setores",
  "regularizacao", "consultivo", "consultiva", "controle", "analise", "revisao", "assunto", "assuntos", "demanda",
  "demandas", "caso", "casos", "problema", "problemas", "causa", "causas", "defesa", "planning", "management",
]);

/** Plurais que não terminam só em -s: exportações, gerais, papéis, embalagens, exportadores. */
const PLURAIS_IRREGULARES: ReadonlyArray<readonly [string, string]> = [
  ["coes", "cao"], ["oes", "ao"], ["ais", "al"], ["eis", "el"], ["ns", "m"], ["wares", "ware"], ["ores", "or"], ["eres", "er"], ["ares", "ar"],
];

/** O singular (só palavras de mais de cinco letras perdem os plurais irregulares: "reais", "mais" e "bares" ficam). */
const singularDe = (palavra: string) => {
  if (palavra.length > 5) {
    for (const [plural, singular] of PLURAIS_IRREGULARES) {
      if (palavra.endsWith(plural)) return palavra.slice(0, -plural.length) + singular;
    }
  }
  return palavra.length > 4 && palavra.endsWith("s") ? palavra.slice(0, -1) : palavra;
};

const semGeneroNemNumero = (palavra: string) => {
  const lema = singularDe(palavra);
  return lema.length > 4 && (lema.endsWith("a") || lema.endsWith("o")) ? lema.slice(0, -1) : lema;
};

const CORPORATIVO = new Set(["corporativo", "corporativa", "corporativos", "corporativas", "corporate"]);

const lemaCurado = (palavra: string) => LEMA_DA_ESPECIALIDADE.get(palavra) ?? LEMA_DA_ESPECIALIDADE.get(singularDe(palavra));

/** O lema de uma palavra de especialidade; palavra de serviço vira a sua família ("jurídica" → advocacia). */
function lemaDaEspecialidade(palavra: string): string {
  const curado = lemaCurado(palavra);
  if (curado) return curado;
  if (SUBSTANTIVOS_DE_SERVICO.has(palavra) || ADJETIVOS_DE_SERVICO.has(palavra)) return familiaDaPalavra(palavra);
  return semGeneroNemNumero(palavra);
}

const ehSubstantivoDeServico = (palavra: string) => SUBSTANTIVOS_DE_SERVICO.has(palavra) && !GENERICAS_DEMAIS.has(palavra);

/** "e-commerce", "e-mail": o "e" com hífen não é conjunção. Vírgula e barra coordenam como "e". */
const E_COM_HIFEN = new RegExp("(^|[^\\p{L}])([eE])[-\\u2010\\u2011](\\p{L})", "gu");
const COORDENA_COMO_E = new RegExp("[,;/]+", "g");
const palavrasDe = (texto: string) => tokensDoTermo(texto.replace(E_COM_HIFEN, "$1$2$3").replace(COORDENA_COMO_E, " e "));

/** Onde o termo começa de fato: depois de marcadores, artigos, genitivo e verbos de quem pede. */
function inicioDoServico(palavras: string[]): number {
  let i = 0;
  const forDeQuemProcura = (k: number) => palavras[k] === "for" && k > 0 && MARCADORES_FRACOS.has(palavras[k - 1]);
  while (i < palavras.length - 1 && (MARCADORES_FRACOS.has(palavras[i]) || ARTIGOS.has(palavras[i]) || GENITIVOS.has(palavras[i]) || PALAVRAS_SEM_ESPECIALIDADE.has(palavras[i]) || forDeQuemProcura(i))) i += 1;
  return i;
}

/** Quantas palavras a partir de `indice` formam um lugar ("são paulo", "brasil"); 0 se não é lugar. */
function comprimentoDoLugar(palavras: string[], indice: number): number {
  for (let n = Math.min(4, palavras.length - indice); n >= 1; n -= 1) {
    if (ehLugar(palavras.slice(indice, indice + n))) return n;
  }
  return 0;
}

/**
 * Em serviço de língua o idioma É a especialidade: "Tradução de alemão" não
 * atende "Tradutor de japonês". Lido antes do corte por lugar, porque os
 * gentílicos também são lugar.
 */
const IDIOMAS: Record<string, readonly string[]> = {
  portugues: ["portugues", "portuguesa", "portuguese"],
  espanhol: ["espanhol", "espanhola", "spanish", "espanol", "castelhano"],
  ingles: ["ingles", "inglesa", "english"],
  alemao: ["alemao", "alema", "german", "aleman", "alemana"],
  frances: ["frances", "francesa", "french"],
  italiano: ["italiano", "italiana", "italian"],
  chines: ["chines", "chinesa", "chinese", "mandarim", "mandarin", "chino"],
  japones: ["japones", "japonesa", "japanese"],
  arabe: ["arabe", "arabic"],
  russo: ["russo", "russa", "russian", "ruso"],
  coreano: ["coreano", "coreana", "korean"],
  hebraico: ["hebraico", "hebrew"],
  libras: ["libras"],
};
const IDIOMA_DA_PALAVRA = new Map<string, string>(
  Object.entries(IDIOMAS).flatMap(([idioma, formas]) => formas.map(forma => [forma, `idioma:${idioma}`] as const)),
);

/**
 * Cidades e siglas lidas como lugar SÓ depois de "em/no/na/in/en" ("Contador em
 * Campinas/SP", "Advogado em BH e região"). Ficam aqui, e não nos lugares de
 * direcao-do-termo.ts, porque "Natal" e "Salvador" soltos são outra coisa.
 */
const UFS = new Set(["sp", "rj", "mg", "rs", "sc", "pr", "ba", "pe", "ce", "df", "go", "pa", "es", "mt", "ms", "am", "ma", "pb", "rn", "al", "se", "pi", "to", "ro", "ac", "ap", "rr"]);
const CIDADES = new Set([
  ...Array.from(UFS), "bh", "poa", "rio",
  "curitiba", "recife", "salvador", "fortaleza", "brasilia", "goiania", "manaus", "belem", "natal", "maceio",
  "teresina", "aracaju", "vitoria", "florianopolis", "floripa", "cuiaba", "campinas", "santos", "guarulhos",
  "osasco", "sorocaba", "londrina", "joinville", "uberlandia", "niteroi", "jundiai", "maringa", "uberaba",
  "lisboa", "madrid", "miami", "londres", "london", "paris", "roma", "milao", "berlim", "toquio", "xangai", "pequim",
]);
const CIDADES_COMPOSTAS = new Set([
  "sao paulo", "rio de janeiro", "belo horizonte", "porto alegre", "ribeirao preto", "sao jose dos campos", "joao pessoa",
  "campo grande", "sao luis", "porto velho", "buenos aires", "nova york", "new york", "cidade do mexico", "santo andre",
  "sao bernardo do campo",
]);
const EM_DO_LUGAR = new Set(["em", "no", "na", "in", "en"]);
const COMPLEMENTO_DO_LUGAR = new Set(["regiao", "metropolitana", "grande", "capital", "interior"]);

function comprimentoDaCidade(palavras: string[], indice: number): number {
  if (!EM_DO_LUGAR.has(palavras[indice - 1] ?? "")) return 0;
  let n = 0;
  for (let k = Math.min(5, palavras.length - indice); k >= 2 && n === 0; k -= 1) {
    if (CIDADES_COMPOSTAS.has(palavras.slice(indice, indice + k).join(" "))) n = k;
  }
  if (n === 0 && (CIDADES.has(palavras[indice]) || COMPLEMENTO_DO_LUGAR.has(palavras[indice]))) n = 1;
  if (n === 0) return 0;
  // "Campinas/SP", "Campinas - SP", "Curitiba e região", "Grande SP"
  while (indice + n < palavras.length) {
    const seguinte = palavras[indice + n];
    const depois = palavras[indice + n + 1] ?? "";
    if (UFS.has(seguinte) || COMPLEMENTO_DO_LUGAR.has(seguinte)) n += 1;
    else if (seguinte === "e" && (UFS.has(depois) || depois === "regiao")) n += 2;
    else break;
  }
  return n;
}

/**
 * A palavra que NOMEIA o serviço, e a família dela. É a da cabeça — não a
 * primeira palavra de serviço em qualquer posição, que fazia "Marketing para
 * advogados" parecer serviço jurídico:
 *   - "Direito" com área: advocacia;
 *   - cabeça genérica ou neutra ("Serviços de tradução", "Escritório de
 *     advocacia", "Especialista em contabilidade"): a palavra de serviço do complemento;
 *   - composto em inglês ("Tax consulting", "Legal advisory", "Tax lawyer"):
 *     o substantivo de serviço colado DEPOIS, que é a cabeça de fato — mas
 *     empréstimos colados a um serviço em português ("Consultoria SEO",
 *     "Consultoria marketing digital") não trocam a família;
 *   - dois profissionais colados ("Advogado consultor", "Tradutora-intérprete")
 *     e adjetivo de profissão posposto em outro idioma ("Traduction juridique"):
 *     a cabeça;
 *   - senão, a própria cabeça, substantivo ou adjetivo ("Jurídico").
 */
const EMPRESTIMOS_POSPOSTOS = new Set(["compliance", "seo", "branding", "valuation", "diligence", "marketing", "design"]);

/**
 * Adjetivo de profissão que o francês, o alemão, o russo, o hindi e o árabe põem
 * DEPOIS do serviço ("Traduction juridique", "Audit comptable", "محاسب قانوني").
 * Nas listas é palavra de serviço comum; aqui qualifica e não troca a família
 * (revisão de 14/09).
 */
const ADJETIVOS_DE_PROFISSAO_POSPOSTOS = new Set([
  "juridique", "juridiques", "juristisch", "juristische", "comptable", "comptables",
  "юридический", "юридические", "бухгалтерский", "कानूनी", "قانوني",
]);

/**
 * Quem presta, não a prestação: "advogado", "tradutora", "intérprete",
 * "consultant". Dois colados são dois serviços sem conjunção ("Tradutora-intérprete
 * de Libras", "Advogado consultor"), e não o composto inglês, cuja primeira
 * palavra é a atividade ("Marketing consultant").
 */
const SUFIXO_DE_PROFISSIONAL = new RegExp("(?:or|ora|ores|oras|ado|ada|ados|adas|ista|istas|ete|etes|eiro|eira|eiros|eiras|eto|eta|etos|etas|er|ers|ant|ants)$");
const ehProfissional = (palavra: string) => ehSubstantivoDeServico(palavra) && SUFIXO_DE_PROFISSIONAL.test(palavra);

function nucleoDoServico(palavras: string[]): { indice: number; familia: string } | null {
  const inicio = inicioDoServico(palavras);
  const cabeca = palavras[inicio];
  if (!cabeca) return null;
  if (areaDoDireito(palavras, inicio)) return { indice: inicio, familia: "advocacia" };
  if (GENERICAS_DEMAIS.has(cabeca) || CABECAS_NEUTRAS.has(cabeca)) {
    for (let i = inicio + 1; i < palavras.length; i += 1) {
      const palavra = palavras[i];
      if (GENITIVOS.has(palavra) || ARTIGOS.has(palavra) || GENERICAS_DEMAIS.has(palavra) || ESPECIALISTA.has(palavra) || atravessaEspecialista(palavras, i)) continue;
      if (ehSubstantivoDeServico(palavra) || ADJETIVOS_DE_SERVICO.has(palavra)) return { indice: i, familia: familiaDaPalavra(palavra) };
      if (areaDoDireito(palavras, i)) return { indice: i, familia: "advocacia" };
      return null;
    }
    return null;
  }
  let fim = palavras.findIndex((palavra, i) => i > inicio && (FRONTEIRAS.has(palavra) || CONJUNCOES.has(palavra)));
  if (fim < 0) fim = palavras.length;
  const cabecaEhServico = ehSubstantivoDeServico(cabeca);
  // Dois profissionais colados são dois serviços: a família é a da cabeça, e `partesDoServico` separa o segundo.
  if (ehProfissional(cabeca) && ehProfissional(palavras[inicio + 1] ?? "")) return { indice: inicio, familia: familiaDaPalavra(cabeca) };
  for (let i = fim - 1; i > inicio; i -= 1) {
    if (cabecaEhServico && (EMPRESTIMOS_POSPOSTOS.has(palavras[i]) || ADJETIVOS_DE_PROFISSAO_POSPOSTOS.has(palavras[i]))) continue;
    if (ehSubstantivoDeServico(palavras[i])) return { indice: i, familia: familiaDaPalavra(palavras[i]) };
  }
  if (cabecaEhServico) return { indice: inicio, familia: familiaDaPalavra(cabeca) };
  if (ADJETIVOS_DE_SERVICO.has(cabeca)) return { indice: inicio, familia: familiaDaPalavra(cabeca) };
  return null;
}

/**
 * Uma alternativa de especialidade do serviço. Termo com conjunção tem uma por
 * item coordenado: "Advocacia tributária e trabalhista" oferece as duas.
 *   - lemas: o que qualifica o serviço, reconhecido ou não;
 *   - conhecidos: os lemas que as listas reconhecem (curados, idioma, outro serviço);
 *   - servicos: OUTRO serviço nomeado por substantivo ("marketing" em "Consultoria de marketing jurídico");
 *   - publico: público-alvo ou finalidade ("para MEI", "para divórcio");
 *   - publicoEspecifico: o público sem o destinatário genérico ("para a nossa
 *     EMPRESA", "holding FAMILIAR"), que é o que o portão da IA lê;
 *   - assunto: lemas desconhecidos que vieram como assunto ("consultoria EM e-commerce").
 */
export type EspecialidadeDoServico = {
  lemas: ReadonlySet<string>;
  conhecidos: ReadonlySet<string>;
  servicos: ReadonlySet<string>;
  publico: ReadonlySet<string>;
  publicoEspecifico: ReadonlySet<string>;
  assunto: ReadonlySet<string>;
};
export type ServicoNomeado = { familia: string; especialidades: readonly EspecialidadeDoServico[] };

type Alternativa = {
  lemas: Set<string>; conhecidos: Set<string>; servicos: Set<string>; publico: Set<string>; publicoEspecifico: Set<string>;
  assunto: Set<string>; atividade: Set<string>; corporativo: boolean;
};
const novaAlternativa = (): Alternativa => ({
  lemas: new Set(), conhecidos: new Set(), servicos: new Set(), publico: new Set(), publicoEspecifico: new Set(),
  assunto: new Set(), atividade: new Set(), corporativo: false,
});

/** Destinatário genérico: no público, não diz qual especialidade se pede ("advogado para a nossa EMPRESA"). */
const DESTINATARIOS_GENERICOS = new Set(["empresa", "empresas", "familiar", "familiares", "family", "trabalho", "contrato", "contratos", "contract", "contracts"]);

const pulaNoServico = (palavra: string) =>
  MARCADORES_FRACOS.has(palavra) || ARTIGOS.has(palavra) || GENERICAS_DEMAIS.has(palavra) || PALAVRAS_SEM_ESPECIALIDADE.has(palavra) || QUALIFICA_O_ASSUNTO.has(palavra) || ESPECIALISTA.has(palavra);

function especialidadesDoServico(palavras: string[], nucleo: { indice: number; familia: string }): EspecialidadeDoServico[] {
  const alternativas = [novaAlternativa()];
  let noPublico = false;
  let noAssunto = false;
  for (let i = inicioDoServico(palavras); i < palavras.length; i += 1) {
    const palavra = palavras[i];
    const atual = alternativas[alternativas.length - 1];
    if (i === nucleo.indice) continue;
    if (CONJUNCOES.has(palavra)) {
      // Conjunção dentro do público continua o público: "para startups E empresas de tecnologia".
      if (!noPublico) alternativas.push(novaAlternativa());
      continue;
    }
    if (PREPOSICOES.has(palavra)) {
      const anterior = palavras[i - 1] ?? "";
      const seguinte = palavras[i + 1] ?? "";
      if (QUALIFICA_O_ASSUNTO.has(anterior)) { // "com foco EM", "voltada PARA", "dedicada AO"
        noPublico = false;
        noAssunto = true;
      } else if ((palavra === "com" || palavra === "with") && QUALIFICA_O_ASSUNTO.has(seguinte)) continue;
      else if (!PREPOSICOES_DE_ASSUNTO.has(palavra)) noPublico = true;
      else if (i > nucleo.indice && !noPublico) noAssunto = true;
      continue;
    }
    const cidade = comprimentoDaCidade(palavras, i);
    if (cidade > 0) {
      i += cidade - 1;
      continue;
    }
    const idioma = IDIOMA_DA_PALAVRA.get(palavra);
    if (!idioma) {
      const lugar = comprimentoDoLugar(palavras, i);
      if (lugar > 0) {
        i += lugar - 1;
        continue;
      }
    }
    if (pulaNoServico(palavra) || (i < nucleo.indice && CABECAS_NEUTRAS.has(palavra))) continue;
    let lema: string;
    let conhecido: boolean;
    if (CABECAS_DO_DIREITO.has(palavra)) {
      // "Consultoria em DIREITO digital" é serviço jurídico; na advocacia, "direito" não acrescenta nada.
      lema = "advocacia";
      conhecido = true;
    } else if (idioma) {
      lema = idioma;
      conhecido = true;
    } else if (CORPORATIVO.has(palavra)) {
      // "corporativo" é societário na advocacia, e só sem outra área ("Advocacia tributária corporativa" é tributária);
      // fora dela é empresarial ("Corporate training" = "Treinamento empresarial", revisão de 14/09).
      conhecido = true;
      lema = nucleo.familia === "advocacia" ? "societario" : "empresarial";
      if (lema === "societario" && !noPublico) atual.corporativo = true;
    } else if (FAMILIA_SO_NA_ADVOCACIA.has(palavra) && nucleo.familia === "advocacia") {
      lema = "familia";
      conhecido = true;
      if (COMPLEMENTO_DA_PENSAO.has(palavras[i + 1] ?? "")) i += 1; // "pensão ALIMENTÍCIA"
    } else if (FAMILIAR.has(palavra) && (EMPRESAS_FAMILIARES.has(palavras[i - 1] ?? "") || EMPRESAS_FAMILIARES.has(palavras[i + 1] ?? ""))) {
      lema = semGeneroNemNumero(palavra);
      conhecido = false;
    } else {
      conhecido = lemaCurado(palavra) !== undefined || SUBSTANTIVOS_DE_SERVICO.has(palavra) || ADJETIVOS_DE_SERVICO.has(palavra);
      lema = lemaDaEspecialidade(palavra);
    }
    if (lema === nucleo.familia) continue;
    if (noPublico) {
      atual.publico.add(lema);
      if (!DESTINATARIOS_GENERICOS.has(palavra)) atual.publicoEspecifico.add(lema);
      continue;
    }
    const comoAssunto = noAssunto || i < nucleo.indice;
    if (!conhecido && PALAVRAS_DE_ATIVIDADE.has(palavra)) {
      atual.atividade.add(lema);
      if (comoAssunto) atual.assunto.add(lema);
      continue;
    }
    atual.lemas.add(lema);
    if (conhecido) atual.conhecidos.add(lema);
    else if (comoAssunto) atual.assunto.add(lema);
    // Outro serviço na oferta: o substantivo ("Consultoria de MARKETING jurídico") e o adjetivo de outra família
    // ("Consultoria PUBLICITÁRIA imobiliária"). Não contam "jurídico" e "contábil", que nomeiam a profissão
    // ("Consultoria jurídica tributária"), nem o adjetivo de profissão posposto ("Traduction JURIDIQUE").
    const substantivo = ehSubstantivoDeServico(palavra) && !(i > nucleo.indice && ADJETIVOS_DE_PROFISSAO_POSPOSTOS.has(palavra));
    const adjetivoDeOutraFamilia = ADJETIVOS_DE_SERVICO.has(palavra) && !PROFISSOES_PELO_ADJETIVO.has(lema);
    if (substantivo || adjetivoDeOutraFamilia) atual.servicos.add(lema);
  }
  const prontas: EspecialidadeDoServico[] = [];
  for (const alternativa of alternativas) {
    // Atividade sem especialidade reconhecida é assunto como outro qualquer.
    if (alternativa.conhecidos.size === 0) for (const lema of Array.from(alternativa.atividade)) alternativa.lemas.add(lema);
    if (alternativa.corporativo && Array.from(alternativa.conhecidos).some(lema => AREAS_CONTENCIOSAS.has(lema))) {
      alternativa.lemas.delete("societario");
      alternativa.conhecidos.delete("societario");
    }
    if (alternativa.lemas.size > 0 || alternativa.publico.size > 0) {
      prontas.push({
        lemas: alternativa.lemas, conhecidos: alternativa.conhecidos, servicos: alternativa.servicos,
        publico: alternativa.publico, publicoEspecifico: alternativa.publicoEspecifico, assunto: alternativa.assunto,
      });
    }
  }
  return prontas;
}

/** O recálculo do motor privado cruza milhares de pares com os mesmos rótulos: as leituras são puras e ficam guardadas. */
const MAXIMO_NO_CACHE = 5000;
const cacheDoServico = new Map<string, ServicoNomeado | null>();
const cacheDasPartes = new Map<string, string[]>();
function guardar<T>(cache: Map<string, T>, chave: string, valor: T): T {
  if (cache.size >= MAXIMO_NO_CACHE) cache.clear();
  cache.set(chave, valor);
  return valor;
}

/** O serviço que o texto nomeia, sem olhar a classificação (vale para a necessidade). */
function entenderServico(rotulo: string): ServicoNomeado | null {
  const guardado = cacheDoServico.get(rotulo);
  if (guardado !== undefined) return guardado;
  const palavras = palavrasDe(rotulo);
  const nucleo = nucleoDoServico(palavras);
  return guardar(cacheDoServico, rotulo, nucleo ? { familia: nucleo.familia, especialidades: especialidadesDoServico(palavras, nucleo) } : null);
}

/**
 * O serviço que o item OFERECIDO nomeia: família e especialidades. null quando
 * o item não é serviço pela classificação ou só diz "serviços".
 */
export function servicoDoTermo(rotulo: string): ServicoNomeado | null {
  return classificarOferta(rotulo) === "servico" ? entenderServico(rotulo) : null;
}

/**
 * A FAMÍLIA do serviço oferecido (o lema, ver FAMILIAS): "advocacia" em
 * "Advocacia tributária", "Advogada tributarista" e "Serviços jurídicos";
 * "consultoria" em "Consultoria jurídica" e "Tax consulting". null quando o
 * item não é serviço ou só diz "serviços". Em chinês e japonês a família vem
 * do vocabulário por substring.
 */
export function familiaDoServico(rotulo: string, categoria?: string | null): string | null {
  if (!ehServico(rotulo, categoria)) return null;
  return entenderServico(rotulo)?.familia ?? servicoPorSubstring(rotulo);
}

/**
 * A especialidade declarada num termo de serviço, em lemas: o que qualifica a
 * prestação, sem as palavras que nomeiam a própria prestação. "Advocacia
 * tributária" e "Advogado tributarista" dão os dois ["tributario"];
 * "Consultoria jurídica" dá [] (só nomeia a prestação); "Sell-side advisory"
 * dá ["sell", "side"].
 */
export function especialidadeDoServico(rotulo: string, categoria?: string | null): string[] {
  if (!ehServico(rotulo, categoria)) return [];
  const lemas = new Set<string>();
  for (const especialidade of entenderServico(rotulo)?.especialidades ?? []) {
    for (const lema of Array.from(especialidade.lemas)) if (!FAMILIAS_CONHECIDAS.has(lema)) lemas.add(lema);
  }
  return Array.from(lemas);
}

/**
 * As partes de um rótulo que coordena SERVIÇOS diferentes: "Advogado e
 * contador", "Tradução e interpretação". A conjunção (ou vírgula) só abre outro
 * serviço quando o item seguinte começa por substantivo de serviço e ela não
 * está dentro do público ("Marketing para advogados e contadores") nem do
 * assunto de um serviço ("Consultoria em gestão e marketing", "Curso de
 * marketing e design"). A especialidade e o público do último serviço valem
 * para os anteriores que não têm os seus: "Advogados e consultores
 * tributários", "Mentoria e consultoria para mulheres empreendedoras".
 */
function partesDoServico(rotulo: string): string[] {
  const guardadas = cacheDasPartes.get(rotulo);
  if (guardadas) return guardadas;
  const palavras = palavrasDe(rotulo);
  const abreServico = (k: number) => {
    let j = k;
    while (j < palavras.length && (ARTIGOS.has(palavras[j]) || MARCADORES_FRACOS.has(palavras[j]) || PALAVRAS_SEM_ESPECIALIDADE.has(palavras[j]))) j += 1;
    const primeira = palavras[j];
    if (!primeira || PREPOSICOES.has(primeira)) return false;
    if (ehSubstantivoDeServico(primeira) || areaDoDireito(palavras, j)) return true;
    return CABECAS_NEUTRAS.has(primeira) && GENITIVOS.has(palavras[j + 1] ?? "") && ehSubstantivoDeServico(palavras[j + 2] ?? "");
  };
  // "Consultoria jurídica para startups E CONSULTORIA em marketing": outro serviço da mesma família sai do público.
  const mesmaFamiliaAdiante = (atual: string[], k: number) => {
    const nucleo = nucleoDoServico(atual);
    let j = k;
    while (j < palavras.length && (ARTIGOS.has(palavras[j]) || MARCADORES_FRACOS.has(palavras[j]))) j += 1;
    return nucleo !== null && familiaDaPalavra(palavras[j] ?? "") === nucleo.familia;
  };
  const partes: string[][] = [[]];
  let noPublico = false;
  let noAssunto = false;
  for (let i = 0; i < palavras.length; i += 1) {
    const palavra = palavras[i];
    const atual = partes[partes.length - 1];
    if (CONJUNCOES.has(palavra) && !noAssunto && abreServico(i + 1) && (!noPublico || mesmaFamiliaAdiante(atual, i + 1))) {
      partes.push([]);
      noPublico = false;
      continue;
    }
    // Dois profissionais colados, sem conjunção: "Tradutora-intérprete de Libras", "Advogado consultor tributário".
    if (!noPublico && !noAssunto && atual.length > 0 && ehProfissional(palavra) && ehProfissional(atual[atual.length - 1])) {
      partes.push([palavra]);
      continue;
    }
    if (PREPOSICOES.has(palavra)) {
      if (!PREPOSICOES_DE_ASSUNTO.has(palavra)) noPublico = true;
      else if (atual.some(ehSubstantivoDeServico)) noAssunto = true;
    }
    atual.push(palavra);
  }
  const cheias = partes.filter(parte => parte.length > 0);
  if (cheias.length > 1) {
    const ultima = cheias[cheias.length - 1];
    const nucleoDaUltima = nucleoDoServico(ultima);
    if (nucleoDaUltima) {
      const cauda = ultima.slice(nucleoDaUltima.indice + 1);
      const ehPublico = (p: string) => PREPOSICOES.has(p) && !PREPOSICOES_DE_ASSUNTO.has(p);
      const inicioDoPublico = cauda.findIndex(ehPublico);
      for (const parte of cheias.slice(0, -1)) {
        const nucleo = nucleoDoServico(parte);
        if (!nucleo) continue;
        const depois = parte.slice(nucleo.indice + 1);
        if (depois.length === 0) parte.push(...cauda);
        else if (inicioDoPublico >= 0 && !depois.some(ehPublico)) parte.push(...cauda.slice(inicioDoPublico));
      }
    }
  }
  return guardar(cacheDasPartes, rotulo, cheias.map(parte => parte.join(" ")));
}

/** Os serviços que um rótulo nomeia: cada parte coordenada e, com mais de uma, o rótulo inteiro. */
function servicosDoRotulo(rotulo: string): ServicoNomeado[] {
  const partes = partesDoServico(rotulo);
  const textos = partes.length > 1 ? [...partes, rotulo] : partes;
  return textos.map(entenderServico).filter((servico): servico is ServicoNomeado => servico !== null);
}

const LEMAS_DE_ATIVIDADE = new Set(Array.from(PALAVRAS_DE_ATIVIDADE).map(semGeneroNemNumero));
const desconhecidosDe = (especialidade: EspecialidadeDoServico) => Array.from(especialidade.lemas).filter(lema => !especialidade.conhecidos.has(lema));
const ehGenerico = (servico: ServicoNomeado) => servico.especialidades.length === 0;

/**
 * A especialidade oferecida cobre a pedida? Todo lema pedido está na oferta; o
 * que a oferta tem a mais não é outro serviço nomeado e é reconhecido pelas
 * listas. "Advocacia tributária empresarial" cobre "Advogado tributarista";
 * "Consultoria em segurança do trabalho" não cobre "Consultoria trabalhista".
 */
function cobre(oferecida: EspecialidadeDoServico, pedida: EspecialidadeDoServico): boolean {
  if (!Array.from(pedida.lemas).every(lema => oferecida.lemas.has(lema))) return false;
  if (!Array.from(oferecida.servicos).every(lema => pedida.lemas.has(lema))) return false;
  return desconhecidosDe(oferecida).every(lema => pedida.lemas.has(lema));
}

/**
 * Pedido só com público ou finalidade ("Contador para MEI", "Advogado para
 * divórcio"): não é a genérica da família. Todo lema dele, tirando as palavras
 * de atividade ("para REVISÃO tributária", "para DEFESA criminal"), precisa
 * estar na oferta — na especialidade ou no público —, também ao lado de uma
 * especialidade curada: "para SEGURANÇA do trabalho" não é trabalhista, "para
 * AVIAÇÃO civil" não é engenharia civil (revisão de 14/09). Serviço nomeado no
 * público ("para ADVOGADOS") só casa com o público da oferta: "Consultoria
 * jurídica" não é consultoria para advogados.
 */
const LEMAS_CURADOS = new Set(Object.keys(LEMAS_DE_ESPECIALIDADE));
const lemaCuradoOuIdioma = (lema: string) => LEMAS_CURADOS.has(lema) || lema.startsWith("idioma:");

function cobrePublico(oferecida: EspecialidadeDoServico, pedida: EspecialidadeDoServico): boolean {
  const exigidos = Array.from(pedida.publico).filter(lema => !LEMAS_DE_ATIVIDADE.has(lema));
  return exigidos.length > 0
    && exigidos.every(lema => oferecida.publico.has(lema) || (!FAMILIAS_CONHECIDAS.has(lema) && oferecida.lemas.has(lema)));
}

function atendeEspecialidades(oferecido: ServicoNomeado, pedido: ServicoNomeado): boolean {
  if (ehGenerico(pedido)) return true;
  return pedido.especialidades.some(pedida => (pedida.lemas.size > 0
    ? oferecido.especialidades.some(oferecida => cobre(oferecida, pedida))
    : oferecido.especialidades.some(oferecida => cobrePublico(oferecida, pedida))));
}

const semOLema = (especialidade: EspecialidadeDoServico, lema: string): EspecialidadeDoServico => ({
  ...especialidade,
  lemas: new Set(Array.from(especialidade.lemas).filter(outro => outro !== lema)),
  conhecidos: new Set(Array.from(especialidade.conhecidos).filter(outro => outro !== lema)),
});

/** Assuntos de assessoria/coaching que não são aconselhamento profissional (já como lema). */
const ASSESSORIAS_QUE_NAO_ACONSELHAM = new Set(
  ["imprensa", "comunicacao", "evento", "eventos", "casamento", "casamentos", "cerimonial", "cerimoniais", "festa", "festas",
    "esportiva", "esportivo", "esportivas", "esportivos", "press", "midia", "midias", "cobranca", "viagem", "viagens",
    "redes", "corrida", "corridas", "fitness", "musculacao", "maratona"].map(lemaDaEspecialidade),
);
/** Lemas que provam aconselhamento: "Assessoria jurídica em cobrança" continua assessoria. */
const LEMAS_DE_ACONSELHAMENTO = new Set([...Array.from(FAMILIAS_DE_ASSESSORIA), ...Array.from(AREAS_CONTENCIOSAS), "societario", "empresarial"]);

function naoAconselha(especialidade: EspecialidadeDoServico, lista: ReadonlySet<string>): boolean {
  return Array.from(especialidade.lemas).some(lema => lista.has(lema))
    && !Array.from(especialidade.conhecidos).some(lema => LEMAS_DE_ACONSELHAMENTO.has(lema));
}

/**
 * O serviço oferecido atende a necessidade? A regra dos motores
 * determinísticos (privado e perfis), sobre cada serviço coordenado:
 *   1. a oferta é serviço pela classificação; a necessidade nomeia serviço pelo texto;
 *   2. mesma família: necessidade genérica ("Advogado") é atendida; com
 *      especialidade, a oferta precisa cobri-la (`cobre`); só com público,
 *      precisa tratar daquele público (`cobrePublico`);
 *   3. "Assessoria jurídica" e "Suporte contábil" pedidos nomeiam a profissão
 *      (Lei 8.906/94, art. 1º, II): atendidos pela advocacia e pela contabilidade;
 *   4. consultoria e assessoria se atendem só com especialidade, e nunca a
 *      assessoria que não aconselha ("Assessoria esportiva").
 */
function umServicoAtende(oferecido: ServicoNomeado, pedido: ServicoNomeado): boolean {
  if (oferecido.familia === pedido.familia) return atendeEspecialidades(oferecido, pedido);
  if (FAMILIAS_DE_APOIO.has(pedido.familia) && PROFISSOES_PELO_ADJETIVO.has(oferecido.familia)) {
    const comoProfissao = pedido.especialidades.filter(pedida => pedida.lemas.has(oferecido.familia)).map(pedida => semOLema(pedida, oferecido.familia));
    const restantes = comoProfissao.filter(pedida => pedida.lemas.size > 0 || pedida.publico.size > 0);
    if (comoProfissao.length > 0 && (restantes.length < comoProfissao.length || atendeEspecialidades(oferecido, { familia: oferecido.familia, especialidades: restantes }))) return true;
  }
  if (SINONIMOS_PROXIMOS.has(`${oferecido.familia}|${pedido.familia}`)) {
    const pedidas = pedido.especialidades.filter(pedida => pedida.lemas.size > 0 && !naoAconselha(pedida, ASSESSORIAS_QUE_NAO_ACONSELHAM));
    if (pedidas.length === 0 || oferecido.especialidades.some(oferecida => naoAconselha(oferecida, ASSESSORIAS_QUE_NAO_ACONSELHAM))) return false;
    return atendeEspecialidades(oferecido, { familia: pedido.familia, especialidades: pedidas });
  }
  return false;
}

/**
 * Como a necessidade é atendida pelo serviço oferecido:
 *   - "especifico": pede ESTE serviço — mesma família e mesma especialidade
 *     ("Advogado tributarista" × "Advocacia tributária"), o público que a oferta
 *     atende ("Contador para MEI"), ou a profissão com a especialidade
 *     ("Assessoria jurídica tributária" × "Advocacia tributária");
 *   - "familia": nomeia só a família ("Advogado", "Consultoria", "Assessoria
 *     jurídica" × "Advocacia tributária") — um bom palpite, que no motor
 *     privado vale 60 (decisão da #124).
 * A oferta precisa ser serviço por inteiro ("Mina e consultoria mineral" é a
 * mina); basta um serviço coordenado de cada lado.
 */
type ComoAtende = "especifico" | "familia";
function comoAtende(oferta: string, categoriaDaOferta: string | null | undefined, necessidade: string): ComoAtende | null {
  if (classificarOferta(oferta, categoriaDaOferta) !== "servico") return null;
  const pedidos = servicosDoRotulo(necessidade);
  if (pedidos.length === 0) return null;
  const oferecidos = servicosDoRotulo(oferta);
  // Chinês e japonês: a oferta só tem a família, lida por substring ("律师"), e atende a necessidade genérica dela.
  const familiaSemEspaco = oferecidos.length === 0 ? servicoPorSubstring(oferta) : null;
  if (familiaSemEspaco) oferecidos.push({ familia: familiaSemEspaco, especialidades: [] });
  let melhor: ComoAtende | null = null;
  for (const pedido of pedidos) {
    // Cada alternativa por si: em "Assessoria jurídica e tributária" diante de "Advocacia trabalhista", só a parte
    // "jurídica" é atendida, e ela nomeia a profissão — vale a família, não a especialidade que ninguém atendeu.
    const alternativas = ehGenerico(pedido)
      ? [pedido]
      : pedido.especialidades.map(especialidade => ({ familia: pedido.familia, especialidades: [especialidade] }));
    for (const oferecido of oferecidos) {
      for (const alternativa of alternativas) {
        if (!umServicoAtende(oferecido, alternativa)) continue;
        const soAFamilia = alternativa.especialidades.every(especialidade =>
          especialidade.publico.size === 0 && Array.from(especialidade.lemas).every(lema => lema === oferecido.familia));
        if (!soAFamilia) return "especifico";
        melhor = "familia";
      }
    }
  }
  return melhor;
}

/**
 * A necessidade pede ESTE serviço, não só a família dele: mesma família E
 * mesma especialidade ("Advogado tributarista" × "Advocacia tributária"). No
 * motor privado vale 100, a nota de quem tem a mesma coisa.
 */
export function mesmaFamiliaEEspecialidade(oferta: string, categoriaDaOferta: string | null | undefined, necessidade: string): boolean {
  return comoAtende(oferta, categoriaDaOferta, necessidade) === "especifico";
}

/**
 * A necessidade nomeia só a FAMÍLIA do serviço oferecido: "Consultoria"
 * procurado diante de "Consultoria jurídica", "Advogado" diante de "Advocacia
 * tributária". Quem escreveu isso declarou precisar daquela família; no motor
 * privado vale 60 (decisão da #124). "Consultoria em marketing" procurado é
 * outra necessidade e não casa com "Consultoria jurídica".
 */
export function necessidadeGenericaNomeiaOServico(oferta: string, categoriaDaOferta: string | null | undefined, necessidade: string): boolean {
  return comoAtende(oferta, categoriaDaOferta, necessidade) === "familia";
}

/** A necessidade nomeia o serviço oferecido, pela família ou pela especialidade — o que o motor de perfis aceita. */
export function necessidadeNomeiaOServico(oferta: string, categoriaDaOferta: string | null | undefined, necessidade: string): boolean {
  return comoAtende(oferta, categoriaDaOferta, necessidade) !== null;
}

/** O serviço oferecido atende a necessidade, de qualquer dos dois jeitos (sem categoria). */
export function servicoAtendeNecessidade(oferta: string, necessidade: string): boolean {
  return comoAtende(oferta, null, necessidade) !== null;
}

/**
 * Serviço de assessoria? É o que atende a opção fixa "Consultoria" de "O que
 * preciso": quem marcou essa opção DECLAROU precisar de aconselhamento
 * profissional. Decide a família da cabeça de cada serviço coordenado
 * ("Marketing e contabilidade para MEI" tem contabilidade); suporte,
 * assistência e atendimento contam quando nomeiam a profissão ("Suporte
 * jurídico"); assessoria de imprensa, de viagens, esportiva e coach de corrida
 * não aconselham.
 */
export function ehServicoDeAssessoria(rotulo: string, categoria?: string | null): boolean {
  if (classificarOferta(rotulo, categoria) !== "servico") return false;
  const servicos = servicosDoRotulo(rotulo);
  if (servicos.length === 0) {
    // Serviço reconhecido só pela categoria ou pelo vocabulário sem espaço (zh/ja): decide o que se sabe dele.
    const familia = servicoPorSubstring(rotulo);
    if (familia) return FAMILIAS_DE_ASSESSORIA.has(familia);
    return tokensDoTermo(categoria ?? "").some(palavra => FAMILIAS_DE_ASSESSORIA.has(familiaDaPalavra(palavra)));
  }
  return servicos.some(servico => {
    if (servico.familia === "suporte" || servico.familia === "assistencia" || servico.familia === "atendimento") {
      return servico.especialidades.some(especialidade => Array.from(especialidade.conhecidos).some(lema => PROFISSOES_PELO_ADJETIVO.has(lema)));
    }
    if (!FAMILIAS_DE_ASSESSORIA.has(servico.familia)) return false;
    // Consultoria de qualquer assunto conta ("Consultoria de viagens"): a opção fixa nomeia a família, e a
    // necessidade que nomeia só a família vale (decisão da #124).
    if (servico.familia !== "assessoria" && servico.familia !== "coaching") return true;
    const comEspecialidade = servico.especialidades.filter(especialidade => especialidade.lemas.size > 0);
    return comEspecialidade.length === 0 || comEspecialidade.some(especialidade => !naoAconselha(especialidade, ASSESSORIAS_QUE_NAO_ACONSELHAM));
  });
}

// ─── Para o portão da IA (server/portao-da-demanda-expressa.ts) ──────────────
//
// Na IA a regra é mais frouxa que nos motores determinísticos, de propósito:
// o modelo leu o texto todo e citou a necessidade. O portão só BARRA quando a
// citação nomeia um serviço que o texto ENTENDE e que claramente não é o do
// perfil ("consultoria em marketing" para "Consultoria jurídica", "contador
// tributário" para "Advocacia tributária"). O que o texto não entende fica com
// a IA, como antes da amarração.

/** Palavras que não provam nada numa citação: ligação, artigo, preposição. Uma lista só, para a conferência e a localização. */
export const PALAVRAS_VAZIAS_DA_CITACAO: ReadonlySet<string> = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "um", "uma", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "que", "of", "the", "and", "for", "to", "in", "on", "with", "an", "y", "el",
  "la", "los", "las", "en", "con", "del", "al",
]);

type VereditoDoPortao = "atende" | "neutro" | "nao";

/** A especialidade pedida diante da oferecida, só pelo que as listas reconhecem. */
function compararConhecidos(oferecido: ServicoNomeado, pedido: ServicoNomeado, ignorar: string | null): VereditoDoPortao {
  if (ehGenerico(pedido)) return "atende";
  // O que o pedido exige e as listas reconhecem: a especialidade e, sem ela, a especialidade curada do
  // público ("advogado para DIVÓRCIO", "para recuperar créditos de ICMS"). Do público só conta o específico:
  // "para a nossa EMPRESA" e "holding FAMILIAR" não pedem advocacia empresarial nem de família (revisão de 14/09).
  const pedidas = pedido.especialidades.map(especialidade => [
    ...Array.from(especialidade.conhecidos),
    ...(especialidade.lemas.size === 0 ? Array.from(especialidade.publicoEspecifico).filter(lemaCuradoOuIdioma) : []),
  ].filter(lema => lema !== ignorar));
  if (pedidas.every(pedida => pedida.length === 0)) {
    // Especialidade que as listas não leem fica com a IA: "advogado também", "lawyer urgently", "avocat pour
    // notre filiale". Só barra o ASSUNTO desconhecido de consultoria ou assessoria, diante de oferta com
    // especialidade reconhecida e sem nada em comum — ali o assunto é o serviço: "consultoria em e-commerce"
    // para "Consultoria jurídica".
    const ofertaReconhecida = oferecido.especialidades.some(especialidade => especialidade.conhecidos.size > 0);
    const assuntoDesconhecido = FAMILIAS_DE_APOIO.has(pedido.familia) && pedido.especialidades.some(especialidade => especialidade.assunto.size > 0);
    const emComum = pedido.especialidades.some(pedida => Array.from(pedida.lemas).some(lema =>
      oferecido.especialidades.some(oferecida => oferecida.lemas.has(lema) || oferecida.publico.has(lema))));
    return ignorar === null && ofertaReconhecida && assuntoDesconhecido && !emComum ? "nao" : "neutro";
  }
  if (oferecido.especialidades.every(especialidade => especialidade.conhecidos.size === 0)) return ehGenerico(oferecido) ? "atende" : "neutro";
  let idiomaQueAOfertaNaoDiz = false;
  for (const pedida of pedidas) {
    // Alternativa sem nada reconhecido não salva a que foi lida: "consultoria em marketing E redes sociais".
    if (pedida.length === 0) continue;
    // Idioma pedido diante de oferta que não diz idioma ("tradutor de INGLÊS" para "Tradução juramentada"):
    // são dimensões diferentes, e fica com a IA.
    const soIdioma = pedida.every(lema => lema.startsWith("idioma:"));
    if (soIdioma && oferecido.especialidades.every(oferecida => !Array.from(oferecida.conhecidos).some(lema => lema.startsWith("idioma:")))) {
      idiomaQueAOfertaNaoDiz = true;
      continue;
    }
    // A oferta cobre o pedido sem nomear outro serviço que ele não pede ("Consultoria de MARKETING jurídico").
    const cobre = oferecido.especialidades.some(oferecida =>
      pedida.every(lema => oferecida.conhecidos.has(lema) || oferecida.publico.has(lema))
      && Array.from(oferecida.servicos).every(lema => pedida.includes(lema)));
    // Pedido mais específico que a oferta no mesmo serviço ("consultoria em marketing digital" para "Consultoria em
    // marketing"), desde que a oferta não tenha palavra que as listas não leem ("Consultoria em TRANSFORMAÇÃO
    // digital") e o que o pedido tem a mais não seja OUTRO serviço nomeado antes do da oferta: "consultoria em
    // MARKETING jurídico" é marketing; "consultoria jurídica de DESIGN de marca" é jurídica, sobre design.
    const maisEspecifico = oferecido.especialidades.some(oferecida => {
      if (oferecida.conhecidos.size === 0 || desconhecidosDe(oferecida).length > 0) return false;
      if (!Array.from(oferecida.conhecidos).every(lema => pedida.includes(lema))) return false;
      const ultimoDaOferta = Math.max(...pedida.map((lema, k) => (oferecida.conhecidos.has(lema) ? k : -1)));
      return pedida.every((lema, k) => oferecida.conhecidos.has(lema) || !FAMILIAS_CONHECIDAS.has(lema) || k > ultimoDaOferta);
    });
    if (cobre || maisEspecifico) return "atende";
  }
  return idiomaQueAOfertaNaoDiz ? "neutro" : "nao";
}

const FAMILIAS_CONHECIDAS = new Set(Object.keys(FAMILIAS));

function vereditoDoPedido(pedido: ServicoNomeado, oferecidos: readonly ServicoNomeado[]): VereditoDoPortao {
  let melhor: VereditoDoPortao = "nao";
  // "assessoria de imprensa", "coach de corrida": o nome é de apoio, o serviço não aconselha.
  const pedidoNaoAconselha = (pedido.familia === "assessoria" || pedido.familia === "coaching")
    && pedido.especialidades.some(especialidade => naoAconselha(especialidade, ASSESSORIAS_QUE_NAO_ACONSELHAM));
  for (const oferecido of oferecidos) {
    if (umServicoAtende(oferecido, pedido)) return "atende";
    if (pedidoNaoAconselha && oferecido.familia !== pedido.familia) continue;
    let veredito: VereditoDoPortao = "nao";
    if (oferecido.familia === pedido.familia || SINONIMOS_PROXIMOS.has(`${oferecido.familia}|${pedido.familia}`)) {
      veredito = compararConhecidos(oferecido, pedido, null);
    } else if (FAMILIAS_DE_APOIO.has(pedido.familia) && pedido.especialidades.some(especialidade => especialidade.lemas.has(oferecido.familia))) {
      // "suporte em MARKETING", "consultoria em COMPLIANCE": o pedido nomeia o serviço da oferta.
      const comparado = compararConhecidos(oferecido, pedido, oferecido.familia);
      veredito = comparado === "neutro" ? "atende" : comparado;
    } else if (PROFISSOES_PELO_ADJETIVO.has(pedido.familia) && FAMILIAS_DE_APOIO.has(oferecido.familia)
      && oferecido.especialidades.some(especialidade => especialidade.lemas.has(pedido.familia))) {
      // "Precisamos de um advogado" para quem oferece "Consultoria jurídica": consultoria jurídica é trabalho de
      // advogado (Lei 8.906/94, art. 1º, II). Nos motores determinísticos não casa; na IA fica com o modelo.
      veredito = "neutro";
    } else if (FAMILIAS_DE_APOIO.has(pedido.familia) && FAMILIAS_DE_ASSESSORIA.has(oferecido.familia)) {
      // Apoio genérico ("suporte para obter a autorização") diante de assessoria fica com a IA, salvo se o
      // pedido nomeia OUTRO serviço ("consultoria em MARKETING") ou especialidade que a oferta não tem.
      const nomeiaOutroServico = pedido.especialidades.some(especialidade =>
        Array.from(especialidade.conhecidos).some(lema => FAMILIAS_CONHECIDAS.has(lema) && lema !== oferecido.familia));
      veredito = nomeiaOutroServico || compararConhecidos(oferecido, pedido, null) === "nao" ? "nao" : "neutro";
    }
    if (veredito === "atende") return "atende";
    if (veredito === "neutro") melhor = "neutro";
  }
  return melhor;
}

/** Verbos de pedido que só a IA precisa ler, para tirar a autodescrição da frente: "Marketing agency REQUIRES a lawyer". */
const VERBOS_DE_PEDIDO_NA_IA = new Set([
  "requer", "requerem", "demanda", "demandam", "solicita", "solicitam", "exige", "exigem",
  "requires", "require", "seeks", "seek", "seeking", "hiring", "hires", "requiere", "requieren",
]);
const ehMarcaDePedido = (palavra: string) => MARCADORES_FRACOS.has(palavra) || VERBOS_DE_NECESSIDADE.has(palavra) || VERBOS_DE_PEDIDO_NA_IA.has(palavra);
/** Pronome relativo: abre outra oração, que já não é o pedido ("advogado QUE nos ajude", "lawyer WHO speaks"). */
const ABRE_ORACAO = new Set(["que", "who", "which", "that", "qui", "quien", "quienes"]);
const nomeiaServicoEm = (item: readonly string[], k: number) =>
  ehSubstantivoDeServico(item[k]) || areaDoDireito(item as string[], k) !== null || (ADJETIVOS_DE_SERVICO.has(item[k]) && k > 0 && CABECAS_NEUTRAS.has(item[k - 1]));
/** Antes do substantivo, só entra no pedido o que qualifica serviço de fato: "TAX lawyer", "LEGAL support", "escritório contábil". */
const qualificaAntes = (palavra: string) =>
  lemaCurado(palavra) !== undefined || ADJETIVOS_DE_SERVICO.has(palavra) || SUBSTANTIVOS_DE_SERVICO.has(palavra) || IDIOMA_DA_PALAVRA.has(palavra) || CORPORATIVO.has(palavra) || CABECAS_NEUTRAS.has(palavra);

/** O pedido de serviço de um item: começa no serviço, ou no serviço depois do último verbo de pedido ("Agência de marketing BUSCA advogada"). */
function pedidoDoItem(item: readonly string[]): string | null {
  let primeiro = item.findIndex((_, k) => nomeiaServicoEm(item, k));
  if (primeiro < 0) return null;
  for (let k = item.length - 1; k > primeiro; k -= 1) {
    if (!ehMarcaDePedido(item[k])) continue;
    const depois = item.findIndex((_, j) => j > k && nomeiaServicoEm(item, j));
    if (depois >= 0) primeiro = depois;
    break;
  }
  let comeco = primeiro;
  while (comeco > 0 && qualificaAntes(item[comeco - 1])) comeco -= 1;
  return item.slice(comeco).join(" ");
}

/** O pedaço que começa em `j` abre outro serviço? ("e contador", ", designer"). Senão é especialidade do anterior ("e previdenciária"). */
function abreOutroServico(tokens: readonly string[], j: number): boolean {
  let k = j;
  while (k < tokens.length && (ARTIGOS.has(tokens[k]) || MARCADORES_FRACOS.has(tokens[k]) || PALAVRAS_SEM_ESPECIALIDADE.has(tokens[k]) || GENITIVOS.has(tokens[k]))) k += 1;
  return k < tokens.length && nomeiaServicoEm(tokens, k);
}

/** Separa os pedidos de um trecho: vírgula, quebra de campo e conjunção só separam quando o pedaço seguinte nomeia outro serviço. */
function itensDoTrecho(tokens: readonly string[], quebraAntes: readonly boolean[]): string[][] {
  const itens: string[][] = [[]];
  for (let k = 0; k < tokens.length; k += 1) {
    const palavra = tokens[k];
    const conjuncao = CONJUNCOES.has(palavra);
    if (conjuncao || (k > 0 && quebraAntes[k])) {
      if (abreOutroServico(tokens, conjuncao ? k + 1 : k)) {
        itens.push([]);
        if (conjuncao) continue;
      } else if (!conjuncao) {
        itens[itens.length - 1].push("e");
      }
    }
    itens[itens.length - 1].push(palavra);
  }
  return itens.filter(item => item.length > 0);
}

function julgarTrecho(tokens: readonly string[], quebraAntes: readonly boolean[], oferecidos: readonly ServicoNomeado[], vigiadas: ReadonlySet<string> | null): VereditoDoPortao | null {
  const pedidos = itensDoTrecho(tokens, quebraAntes)
    .map(pedidoDoItem)
    .filter((pedido): pedido is string => pedido !== null)
    .map(entenderServico)
    .filter((servico): servico is ServicoNomeado => servico !== null);
  if (!pedidos.length) return null;
  const vereditos = pedidos.map(pedido => {
    const veredito = vereditoDoPedido(pedido, oferecidos);
    return veredito === "nao" && vigiadas && !vigiadas.has(pedido.familia) ? "neutro" : veredito;
  });
  if (vereditos.includes("atende")) return "atende";
  return vereditos.includes("neutro") ? "neutro" : "nao";
}

const oferecidosDe = (servicosOferecidos: readonly string[]) =>
  servicosOferecidos.filter(oferta => classificarOferta(oferta) === "servico").flatMap(servicosDoRotulo);

/** Para os testes do módulo: o veredito de um trecho solto (vírgula separa itens). */
export function trechoNomeiaServicoAtendido(trecho: string, servicosOferecidos: readonly string[]): "nao-nomeia-servico" | "atende" | "nao-atende" {
  const { tokens, quebraAntes } = tokensDoTexto(trecho);
  const veredito = julgarTrecho(tokens, quebraAntes, oferecidosDe(servicosOferecidos), null);
  return veredito === "atende" ? "atende" : veredito === "nao" ? "nao-atende" : "nao-nomeia-servico";
}

/** Fim de frase e separador de campo (" | ") encerram o trecho; vírgula e barra só separam itens. */
const FIM_DE_FRASE = new RegExp("[.!?;:|\\n]+");
const SEPARA_ITENS = new RegExp("[,/]+");
const semEHifen = (texto: string) => texto.replace(E_COM_HIFEN, "$1$2$3");

function tokensDoTexto(texto: string): { tokens: string[]; quebraAntes: boolean[]; fimAntes: boolean[] } {
  const tokens: string[] = [];
  const quebraAntes: boolean[] = [];
  const fimAntes: boolean[] = [];
  semEHifen(texto).split(FIM_DE_FRASE).forEach((frase, f) => {
    frase.split(SEPARA_ITENS).forEach((pedaco, p) => {
      tokensDoTermo(pedaco).forEach((palavra, k) => {
        tokens.push(palavra);
        quebraAntes.push(k === 0 && (p > 0 || f > 0));
        fimAntes.push(k === 0 && p === 0 && f > 0);
      });
    });
  });
  return { tokens, quebraAntes, fimAntes };
}

const ehConteudo = (palavra: string) => palavra.length >= 3 && !PALAVRAS_VAZIAS_DA_CITACAO.has(palavra);

/** As janelas [início, fim] em que as palavras citadas aparecem EM ORDEM, com até duas palavras de conteúdo quaisquer entre elas. */
function janelasDaCitacao(citadas: readonly string[], tokens: readonly string[]): Array<[number, number]> {
  const conteudo = tokens.map((palavra, k) => [palavra, k] as const).filter(([palavra]) => ehConteudo(palavra));
  const naFonte = new Set(tokens);
  const tolerancia = citadas.length > 3 ? 1 : 0;
  const janelas: Array<[number, number]> = [];
  for (let c0 = 0; c0 < conteudo.length; c0 += 1) {
    for (let primeira = 0; primeira <= tolerancia; primeira += 1) {
      if (conteudo[c0][0] !== citadas[primeira]) continue;
      if (primeira === 1 && naFonte.has(citadas[0])) continue;
      let faltas = primeira;
      let posicao = c0;
      for (let c = primeira + 1; c < citadas.length && faltas <= tolerancia; c += 1) {
        let achou = -1;
        for (let k = posicao + 1; k <= Math.min(conteudo.length - 1, posicao + 3); k += 1) {
          if (conteudo[k][0] === citadas[c]) {
            achou = k;
            break;
          }
        }
        if (achou >= 0) posicao = achou;
        else faltas += naFonte.has(citadas[c]) ? tolerancia + 1 : 1;
      }
      if (faltas <= tolerancia) janelas.push([conteudo[c0][1], conteudo[posicao][1]]);
    }
  }
  return janelas;
}

/**
 * A citação conferida pede um serviço que o perfil oferece? (defeito relatado
 * em 13/09: "consultoria em marketing" passava para quem oferece "Consultoria
 * jurídica"). A citação é localizada na fonte EM ORDEM e cada ocorrência é
 * julgada; basta uma que não barre:
 *   - trecho sem serviço que o texto entenda fica com a IA, como antes;
 *   - quando a citação TERMINA num serviço, o trecho segue até o fim da frase
 *     ou do item, para a citação cortada ("Precisamos de consultoria") ser
 *     julgada como a inteira ("... com foco em marketing digital");
 *   - vírgula, quebra de campo e conjunção só separam pedidos quando o pedaço
 *     seguinte nomeia outro serviço ("advogado, contador e designer"); senão
 *     são especialidade ("advogada trabalhista e previdenciária").
 * `soFamiliasDoPerfil`: o perfil tem outra base em "O que tenho" (ids fixos,
 * produto), e o modelo pode ter se apoiado nela — só barra pedido de
 * assessoria ou da família que o perfil oferece.
 */
export function citacaoPedeServicoOferecido(citacao: string, fonte: string, servicosOferecidos: readonly string[], soFamiliasDoPerfil = false): boolean {
  const oferecidos = oferecidosDe(servicosOferecidos);
  if (!oferecidos.length) return true;
  const vigiadas = soFamiliasDoPerfil ? new Set([...Array.from(FAMILIAS_DE_ASSESSORIA), ...oferecidos.map(oferecido => oferecido.familia)]) : null;
  const citadas = tokensDoTermo(semEHifen(citacao)).filter(ehConteudo);
  const { tokens, quebraAntes, fimAntes } = tokensDoTexto(fonte);
  const janelas = janelasDaCitacao(citadas, tokens);
  let candidatas = janelas;
  if (!candidatas.length) {
    // Citação que não aparece em ordem na fonte: julga o serviço citado ONDE ele aparece
    // ("Startup jurídica | Precisamos de consultoria em marketing" citada como "consultoria jurídica").
    const daCitacao = tokensDoTermo(semEHifen(citacao));
    const servicosCitados = new Set(daCitacao.filter((_, k) => nomeiaServicoEm(daCitacao, k)));
    candidatas = tokens.flatMap((palavra, k): Array<[number, number]> => {
      if (!servicosCitados.has(palavra)) return [];
      let comeco = k;
      while (comeco > 0 && !fimAntes[comeco] && qualificaAntes(tokens[comeco - 1])) comeco -= 1;
      return [[comeco, k]];
    });
    if (!candidatas.length) {
      const soCitacao = tokensDoTexto(citacao);
      return julgarTrecho(soCitacao.tokens, soCitacao.quebraAntes, oferecidos, vigiadas) !== "nao";
    }
  }
  return candidatas.some(([inicio, fim]) => {
    let ate = fim;
    const terminaEmServico = [fim, fim - 1, fim - 2].some(k => k >= inicio && (nomeiaServicoEm(tokens, k) || ADJETIVOS_DE_SERVICO.has(tokens[k])));
    if (terminaEmServico) {
      let conteudo = 0;
      for (let k = fim + 1; k < tokens.length && !fimAntes[k]; k += 1) {
        if (quebraAntes[k] && abreOutroServico(tokens, k)) break;
        // Conjunção que abre outro serviço ou outra oração ("e BUSCAMOS parceiros") e pronome relativo encerram o pedido.
        if (CONJUNCOES.has(tokens[k]) && (abreOutroServico(tokens, k + 1) || ehMarcaDePedido(tokens[k + 1] ?? ""))) break;
        if (ABRE_ORACAO.has(tokens[k])) break;
        if (ehConteudo(tokens[k]) && ++conteudo > 6) break;
        ate = k;
      }
    }
    return julgarTrecho(tokens.slice(inicio, ate + 1), quebraAntes.slice(inicio, ate + 1), oferecidos, vigiadas) !== "nao";
  });
}
