// server/matching.ts resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../drizzle/schema";

/**
 * Os exemplos da spec da Glenda (14/09, "lógica do MATCH para SERVIÇO") nos
 * TRÊS motores: o privado (`scoreMatch`), o de perfis
 * (`calculateCompatibilityScore`) e a camada de IA (os prompts de
 * routers/matching.ts com o portão da citação). A regra: serviço só casa com
 * necessidade EXPRESSA, e a equivalência pode ser SEMÂNTICA.
 *
 * Retrato ANTES desta mudança (medido na branch feat/entrega-glenda-16-09):
 *   privado  — 1 não casava, 2 e 3 barrados, 4, 5 e 6 não casavam;
 *   perfis   — o mesmo;
 *   IA       — 1, 4, 5 e 6 passavam; 2 e 3 também passavam quando o modelo
 *              citava a contraparte ("Distribuidor para expansão na África") ou
 *              a descrição da empresa ("Empresa brasileira com operações
 *              internacionais"), porque trecho sem palavra de serviço ficava
 *              sempre com a IA.
 * Depois: os seis como a spec manda, nos três. Nenhuma chamada real de IA.
 */

vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));
const createNotification = vi.fn(async () => {});
const filas: unknown[][] = [];
function cadeiaDeSelect() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["from", "where", "innerJoin", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
  (cadeia as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(filas.shift() ?? []).then(resolve, reject);
  return cadeia;
}
const fakeDb = { select: () => cadeiaDeSelect() };
vi.mock("./db", () => ({
  getDb: async () => fakeDb as never,
  exigirDb: async () => fakeDb as never,
  createNotification: (...args: unknown[]) => createNotification(...(args as [])),
}));

const { scoreMatch, slugifyMatchTag } = await import("./match-service");
const { calculateCompatibilityScore } = await import("./matching");
const { passaNoPortao, perfilDeclarouPrecisarDoServico, textoEscritoPelaPessoa } = await import("./portao-da-demanda-expressa");
const { matchingRouter, notifyHighCompatibilityForOpportunity } = await import("./routers/matching");
const { necessidadeDeclaraOAssuntoDoServico, servicoAtendeNecessidade } = await import("@shared/tipo-da-oferta");

const item = (label: string, category: string | null = null) => ({ slug: slugifyMatchTag(label), label, category });
const perfil = (extra: Partial<UserProfile>) => ({ whatIHave: null, whatINeed: null, ...extra }) as unknown as UserProfile;
const respostaDaIA = (corpo: unknown) => ({ choices: [{ message: { content: JSON.stringify(corpo) } }] });
const ctx = { user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;

beforeEach(() => { invokeLLM.mockReset(); createNotification.mockClear(); filas.length = 0; });

type Exemplo = { n: string; oferta: string; necessidade: string; empresa?: string; setor?: string; casa: boolean };
const TRIBUTARIO = "Serviços jurídicos especializados em Direito Tributário";
const INTERNACIONALIZACAO = "Consultoria em internacionalização de empresas";
const EXEMPLOS: Exemplo[] = [
  { n: "1", oferta: TRIBUTARIO, necessidade: "Assessoria tributária para revisão da carga fiscal da empresa", casa: true },
  { n: "2", oferta: TRIBUTARIO, empresa: "Indústria farmacêutica", setor: "Saúde", necessidade: "Distribuidor para expansão na África", casa: false },
  { n: "3", oferta: INTERNACIONALIZACAO, empresa: "Empresa brasileira com operações internacionais", setor: "Indústria", necessidade: "Investidor para ampliação da fábrica", casa: false },
  { n: "4", oferta: INTERNACIONALIZACAO, necessidade: "Apoio para estruturar a entrada da minha empresa no Paraguai", casa: true },
  { n: "semântico A", oferta: "Advocacia tributária", necessidade: "Precisamos revisar nossos tributos e identificar créditos fiscais", casa: true },
  { n: "semântico B", oferta: "Consultoria para registro de medicamentos", necessidade: "Precisamos de suporte para obter autorização regulatória para comercializar nosso medicamento no Brasil", casa: true },
];
const QUE_CASAM = EXEMPLOS.filter(exemplo => exemplo.casa);
const QUE_NAO_CASAM = EXEMPLOS.filter(exemplo => !exemplo.casa);

describe("Exemplos da spec — motor privado (scoreMatch)", () => {
  it.each(QUE_CASAM.map(e => [e.n, e] as const))("exemplo %s casa, com ou sem categoria", (_n, exemplo) => {
    for (const categoria of [null, "Serviços"]) {
      const r = scoreMatch(item(exemplo.oferta, categoria), item(exemplo.necessidade, categoria));
      expect(r.score, String(categoria)).toBeGreaterThanOrEqual(50); // SAVE_THRESHOLD: vira sugestão
      expect((r as { bloqueio?: string }).bloqueio).toBeUndefined();
    }
  });

  it("as notas: a assessoria na área da profissão é o mesmo serviço (100); o assunto declarado sem nomear o serviço vale 60, com o selo de significados parecidos", () => {
    expect(scoreMatch(item(EXEMPLOS[0].oferta), item(EXEMPLOS[0].necessidade))).toEqual({ score: 100, type: "exact" });
    for (const exemplo of [EXEMPLOS[3], EXEMPLOS[4], EXEMPLOS[5]]) {
      expect(scoreMatch(item(exemplo.oferta), item(exemplo.necessidade)), exemplo.n).toEqual({ score: 60, type: "semantic" });
    }
  });

  it.each(QUE_NAO_CASAM.map(e => [e.n, e] as const))("exemplo %s não casa: nem a necessidade, nem a descrição da empresa, com ou sem categoria", (_n, exemplo) => {
    for (const categoria of [null, "Serviços", "Consultoria"]) {
      for (const necessidade of [exemplo.necessidade, exemplo.empresa as string]) {
        const r = scoreMatch(item(exemplo.oferta, categoria), item(necessidade, categoria));
        expect(r.score, `${necessidade} [${categoria}]`).toBe(0);
        expect((r as { bloqueio?: string }).bloqueio, `${necessidade} [${categoria}]`).toBe("servico-sem-demanda-expressa");
      }
    }
  });

  it("setor, porte, localização, cargo, atividade, obrigação legal e 'poderia se beneficiar' escritos como necessidade não criam match de serviço", () => {
    for (const presumida of [
      "Setor farmacêutico", "Indústria de grande porte", "Empresa em São Paulo", "Diretora financeira",
      "Indústria com alta carga tributária", "Obrigações fiscais do setor", "Poderia se beneficiar de planejamento tributário",
      "Empresa com operações no Paraguai",
    ]) {
      expect(scoreMatch(item("Advocacia tributária", "Serviços"), item(presumida, "Serviços")).score, presumida).toBe(0);
      expect(scoreMatch(item(INTERNACIONALIZACAO, "Serviços"), item(presumida, "Serviços")).score, presumida).toBe(0);
    }
  });
});

describe("Exemplos da spec — motor de perfis (calculateCompatibilityScore)", () => {
  const outroLado = (exemplo: Exemplo) => perfil({
    whatINeed: [exemplo.necessidade], activityArea: exemplo.empresa ?? null, sector: exemplo.setor ?? null,
  });

  it.each(QUE_CASAM.map(e => [e.n, e] as const))("exemplo %s casa, com o serviço em 'o que tenho' ou só na especialidade", (_n, exemplo) => {
    const emOQueTenho = calculateCompatibilityScore(perfil({ whatIHave: [exemplo.oferta] }), outroLado(exemplo));
    expect(emOQueTenho.bloqueio).toBeUndefined();
    expect(emOQueTenho.complementarity).toBe(60); // uma via: o serviço atende a necessidade declarada
    expect(emOQueTenho.overall).toBeGreaterThanOrEqual(40); // o corte de gravação (decisão do Roberto: 40)
    // Na especialidade o serviço é base expressa (sem bloqueio); a nota de complementaridade segue lendo só "o que tenho".
    const naEspecialidade = calculateCompatibilityScore(perfil({ primarySpecialty: exemplo.oferta }), outroLado(exemplo));
    expect(naEspecialidade.bloqueio).toBeUndefined();
    expect(naEspecialidade.overall).toBeGreaterThanOrEqual(40);
  });

  it.each(QUE_NAO_CASAM.map(e => [e.n, e] as const))("exemplo %s não casa: bloqueado, nota zero", (_n, exemplo) => {
    for (const oferece of [perfil({ whatIHave: [exemplo.oferta] }), perfil({ primarySpecialty: exemplo.oferta })]) {
      const r = calculateCompatibilityScore(oferece, outroLado(exemplo));
      expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
      expect(r.overall).toBe(0);
    }
  });

  it("a contraparte pedida depois de uma ação não vira base expressa, em 'o que preciso' ou em 'Outra necessidade' (achado de 14/09)", () => {
    for (const outro of [
      perfil({ whatINeed: ["Entrada de investidor internacional na empresa"] }),
      perfil({ seekingOtherNeed: "Entrada de investidor internacional na empresa" } as Partial<UserProfile>),
    ]) {
      const r = calculateCompatibilityScore(perfil({ whatIHave: [INTERNACIONALIZACAO] }), outro);
      expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
      expect(r.overall).toBe(0);
    }
  });

  it("mesmo setor, cidade, país, valores, porte e cargo não salvam o exemplo 2", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: [TRIBUTARIO], sector: "Saúde", country: "BR", city: "São Paulo", values: ["innovation"] }),
      perfil({
        whatINeed: ["Distribuidor para expansão na África"], activityArea: "Indústria farmacêutica", sector: "Saúde", country: "BR",
        city: "São Paulo", values: ["innovation"], currentRole: "Diretora financeira", companySize: "grande",
      } as Partial<UserProfile>),
    );
    expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
    expect(r.overall).toBe(0);
  });
});

describe("Exemplos da spec — camada de IA (portão da citação)", () => {
  const citando = (exemplo: Exemplo, citacao: string) => {
    const fonte = textoEscritoPelaPessoa(exemplo.necessidade, [], [exemplo.empresa, exemplo.necessidade].filter(Boolean).join(". "));
    return passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: citacao }, fonte, { whatIHave: [exemplo.oferta], whatINeed: [] });
  };

  it.each(QUE_CASAM.map(e => [e.n, e] as const))("exemplo %s: a necessidade citada passa", (_n, exemplo) => {
    expect(citando(exemplo, exemplo.necessidade)).toBe(true);
  });

  it.each(QUE_NAO_CASAM.map(e => [e.n, e] as const))("exemplo %s: o modelo que citar a necessidade de outra coisa ou a descrição da empresa é barrado", (_n, exemplo) => {
    expect(citando(exemplo, exemplo.necessidade)).toBe(false);
    expect(citando(exemplo, exemplo.empresa as string)).toBe(false);
  });

  it("no sentido oposto (a oportunidade OFERECE o serviço), só quem declarou a necessidade compatível recebe", () => {
    for (const exemplo of EXEMPLOS) {
      expect(perfilDeclarouPrecisarDoServico({ whatINeed: [exemplo.necessidade] }, exemplo.oferta), exemplo.n).toBe(exemplo.casa);
    }
  });

  it("getRecommendedOpportunities: o exemplo 1 entra com a citação; o 2 sai citando o distribuidor, a indústria ou sem citação", async () => {
    const oportunidades = [
      { id: 21, title: "Revisão da carga fiscal", sector: "Indústria", type: "demand", tags: [], description: EXEMPLOS[0].necessidade, status: "active", publishedBy: 9, isConfidential: false },
      { id: 22, title: "Distribuidor para expansão na África", sector: "Saúde", type: "demand", tags: [], description: "Indústria farmacêutica. Distribuidor para expansão na África", status: "active", publishedBy: 9, isConfidential: false },
      { id: 23, title: "Parceria na África", sector: "Saúde", type: "demand", tags: [], description: "Indústria farmacêutica. Distribuidor para expansão na África", status: "active", publishedBy: 9, isConfidential: false },
      { id: 24, title: "Expansão", sector: "Saúde", type: "demand", tags: [], description: "Indústria farmacêutica. Distribuidor para expansão na África", status: "active", publishedBy: 9, isConfidential: false },
    ];
    filas.push([{ userId: 1, whatIHave: [TRIBUTARIO], whatINeed: [], seekingTypes: [], sector: "Jurídico" }], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 0, score: 92, reason: "Declarada", tipoDaOferta: "servico", necessidadeExpressa: "Assessoria tributária para revisão da carga fiscal da empresa" },
      { index: 1, score: 88, reason: "Indústria tem impostos", tipoDaOferta: "servico", necessidadeExpressa: "Distribuidor para expansão na África" },
      { index: 2, score: 86, reason: "Setor", tipoDaOferta: "servico", necessidadeExpressa: "Indústria farmacêutica" },
      { index: 3, score: 80, reason: "Setor", tipoDaOferta: "nenhuma", necessidadeExpressa: "" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    expect(lista.map(o => o.id)).toEqual([21]);
  });

  it("getRecommendedOpportunities: exemplos 4 e semânticos entram; o 3 sai citando a descrição ou o investidor", async () => {
    const oportunidades = [
      { id: 31, title: "Entrada no Paraguai", sector: "Varejo", type: "demand", tags: [], description: EXEMPLOS[3].necessidade, status: "active", publishedBy: 9, isConfidential: false },
      { id: 32, title: "Ampliação da fábrica", sector: "Indústria", type: "demand", tags: [], description: `${EXEMPLOS[2].empresa}. ${EXEMPLOS[2].necessidade}`, status: "active", publishedBy: 9, isConfidential: false },
    ];
    filas.push([{ userId: 1, whatIHave: [INTERNACIONALIZACAO], whatINeed: [], seekingTypes: [] }], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 0, score: 90, reason: "Declarada", tipoDaOferta: "servico", necessidadeExpressa: "Apoio para estruturar a entrada da minha empresa no Paraguai" },
      { index: 1, score: 85, reason: "Opera fora", tipoDaOferta: "servico", necessidadeExpressa: "Empresa brasileira com operações internacionais" },
      { index: 1, score: 84, reason: "Capital", tipoDaOferta: "servico", necessidadeExpressa: "Investidor para ampliação da fábrica" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    expect(lista.map(o => o.id)).toEqual([31]);
  });

  it("notifyHighCompatibilityForOpportunity: a oportunidade do exemplo semântico B avisa a consultoria regulatória e retém marketing e tributarista que citam a mesma necessidade", async () => {
    const oportunidade = { id: 41, title: "Registro do medicamento", sector: "Saúde", type: "demand", tags: [], description: EXEMPLOS[5].necessidade, status: "active", publishedBy: 9, isConfidential: false };
    filas.push([oportunidade], [
      { userId: 2, role: "silver", whatIHave: ["Consultoria para registro de medicamentos"], whatINeed: [], sector: "Saúde", seekingTypes: [], interestSectors: [], activityArea: null },
      { userId: 3, role: "silver", whatIHave: ["Consultoria em marketing"], whatINeed: [], sector: "Marketing", seekingTypes: [], interestSectors: [], activityArea: null },
      { userId: 4, role: "silver", whatIHave: ["Advocacia tributária"], whatINeed: [], sector: "Jurídico", seekingTypes: [], interestSectors: [], activityArea: null },
    ]);
    invokeLLM.mockResolvedValue(respostaDaIA({ alerts: [
      { index: 0, score: 90, tipoDaOferta: "servico", necessidadeExpressa: "suporte para obter autorização regulatória para comercializar nosso medicamento" },
      // Cortada no serviço: o portão completa a frase até o fim e lê o assunto regulatório, que marketing não presta.
      { index: 1, score: 85, tipoDaOferta: "servico", necessidadeExpressa: "Precisamos de suporte" },
      { index: 2, score: 82, tipoDaOferta: "servico", necessidadeExpressa: "suporte para obter autorização regulatória para comercializar nosso medicamento" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await notifyHighCompatibilityForOpportunity(41);

    silencio.mockRestore();
    expect(createNotification.mock.calls.map(c => (c[0] as { userId: number }).userId)).toEqual([2]);
    expect(r).toEqual({ notified: 1 });
  });

  it("a frase que nem pede ajuda nem ação fica com o modelo, como antes (limite aceito do portão)", () => {
    // "comercializar nosso medicamento no Brasil" é o negócio de quem escreveu; o vocabulário não o lê como pedido.
    // O prompt proíbe a presunção; o portão só barra o que entende.
    const fonte = textoEscritoPelaPessoa("Registro do medicamento", [], EXEMPLOS[5].necessidade);
    expect(passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: "comercializar nosso medicamento no Brasil" }, fonte, { whatIHave: ["Advocacia tributária"], whatINeed: [] })).toBe(true);
  });
});

/**
 * Cada entrada do vocabulário curado com o teste NEGATIVO dela: o que parece o
 * assunto e não é necessidade expressa daquele serviço. Um caso por linha, para
 * a falha dizer qual entrada abriu falso positivo.
 */
describe("Vocabulário — assessoria na área da profissão (AREAS_DAS_PROFISSOES)", () => {
  it.each([
    ["Advocacia tributária", "Assessoria tributária"],
    ["Contabilidade tributária", "Assessoria tributária"],
    ["Advocacia trabalhista", "Consultoria trabalhista"],
    ["Advocacia societária", "Assessoria societária"],
  ])("%s atende %s", (oferta, necessidade) => {
    expect(servicoAtendeNecessidade(oferta, necessidade)).toBe(true);
    expect(scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços"))).toEqual({ score: 100, type: "exact" });
  });

  it.each([
    ["Advocacia empresarial", "Consultoria empresarial", "empresarial é gestão"],
    ["Advocacia imobiliária", "Assessoria imobiliária", "imobiliária é corretagem"],
    ["Contabilidade financeira", "Consultoria financeira", "financeira é investimento"],
    ["Advocacia ambiental", "Consultoria ambiental", "ambiental é engenharia"],
    ["Advocacia tributária", "Assessoria contábil tributária", "nomeou outra profissão"],
    ["Advocacia tributária", "Contador tributário", "nomeou outra profissão"],
    ["Advocacia trabalhista", "Assessoria tributária", "outra área"],
    ["Advocacia tributária", "Assessoria tributária empresarial", "a oferta não cobre a especialidade inteira"],
    ["Consultoria em marketing", "Assessoria tributária", "a família não presta a área"],
  ])("%s não atende %s (%s)", (oferta, necessidade) => {
    expect(servicoAtendeNecessidade(oferta, necessidade)).toBe(false);
    expect(scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços")).score).toBe(0);
  });
});

describe("Vocabulário — assunto TRIBUTÁRIO (lemas curados + 'fisco')", () => {
  it.each([
    ["Advocacia tributária", "Precisamos revisar nossos tributos e identificar créditos fiscais"],
    ["Advocacia tributária", "Recuperação de créditos de ICMS"],
    ["Contabilidade tributária", "Apoio para reduzir impostos"],
    ["Consultoria tributária", "Revisão de tributos"],
    ["Advocacia tributária", "Defesa contra o fisco"],
    ["Advocacia tributária", "Obter créditos de ICMS", "o crédito do fisco é o assunto, não capital"],
    ["Advocacia tributária", "Planejamento tributário para investidores estrangeiros e sócios", "a contraparte é o público do serviço"],
    ["Advocacia tributária", "Planejamento tributário dos sócios", "o sócio é o público do serviço"],
  ])("%s × %s: declara o assunto", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(true);
  });

  it.each([
    ["Advocacia tributária", "Créditos tributários", "pede o crédito (capital), não uma ação"],
    ["Advocacia tributária", "Pagamento de impostos", "pagar não é ação que o serviço presta"],
    ["Advocacia tributária", "Emissão de nota fiscal", "'nota fiscal' não é tributo"],
    ["Contabilidade tributária", "Revisão do conselho fiscal", "'conselho fiscal' não é tributo"],
    ["Advocacia tributária", "Indústria com alta carga tributária", "descreve a empresa"],
    ["Advocacia tributária", "Contador para revisar nossos tributos", "nomeou outra profissão"],
    ["Contabilidade tributária", "Apoio jurídico para revisar tributos", "pediu apoio jurídico"],
    ["Marketing tributário", "Precisamos revisar nossos tributos", "marketing não presta o assunto"],
    ["Tradução juramentada", "Precisamos revisar nossos tributos", "a oferta não nomeia o assunto"],
    ["Advocacia tributária", "Apoio para obter crédito para pagar impostos", "pede o crédito (capital) depois da ação"],
  ])("%s × %s: NÃO (%s)", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(false);
    expect(scoreMatch(item(oferta), item(necessidade)).score).toBe(0);
  });
});

describe("Vocabulário — assunto INTERNACIONALIZAÇÃO (internacionalizar, exportar, movimento para outro país)", () => {
  it.each([
    [INTERNACIONALIZACAO, "Apoio para estruturar a entrada da minha empresa no Paraguai"],
    [INTERNACIONALIZACAO, "Apoio para exportar café"],
    [INTERNACIONALIZACAO, "Apoio para expansão internacional"],
    [INTERNACIONALIZACAO, "Entrada no mercado europeu"],
    ["Consultoria em exportação", "Precisamos de apoio para levar a marca a Portugal"],
    [INTERNACIONALIZACAO, "Entrada de produtos no mercado europeu"],
    [INTERNACIONALIZACAO, "Apoio para exportar nossos produtos"],
    [INTERNACIONALIZACAO, "Apoio para abrir loja em Portugal"],
  ])("%s × %s: declara o assunto", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(true);
  });

  it.each([
    [INTERNACIONALIZACAO, "Exportar café", "é o negócio de quem escreveu (quer compradores), não pedido de ajuda"],
    [INTERNACIONALIZACAO, "Distribuidor para expansão na África", "pede a contraparte"],
    [INTERNACIONALIZACAO, "Investidor para ampliação da fábrica", "pede capital"],
    [INTERNACIONALIZACAO, "Empresa brasileira com operações internacionais", "descreve a empresa"],
    [INTERNACIONALIZACAO, "Apoio para abrir filial em São Paulo", "São Paulo não é outro país"],
    [INTERNACIONALIZACAO, "Expansão para aumentar vendas no Brasil", "o Brasil é casa"],
    [INTERNACIONALIZACAO, "Apoio para expansão da fábrica", "expansão sem destino fora"],
    [INTERNACIONALIZACAO, "Frete internacional", "nomeou outro serviço"],
    [INTERNACIONALIZACAO, "Tradução para entrada no mercado chinês", "nomeou outro serviço"],
    [INTERNACIONALIZACAO, "Consultoria financeira para exportação", "o apoio pedido é financeiro"],
    [INTERNACIONALIZACAO, "Consultoria em marketing para exportação", "o apoio pedido é de marketing"],
    ["Marketing para exportação", "Apoio para exportar café", "marketing não presta o assunto"],
    // Achado da revisão de 14/09: a cabeça é uma ação, e o resto do pedido pede a contraparte ou o capital.
    [INTERNACIONALIZACAO, "Entrada de investidor internacional na empresa", "pede o investidor depois da ação"],
    ["Consultoria em internacionalização", "Expandir para a África via distribuidores", "pede o canal (distribuidores)"],
    ["Consultoria em internacionalização", "Entrar no mercado europeu com compradores", "pede os compradores"],
    [INTERNACIONALIZACAO, "Entrada de capital internacional", "pede capital"],
    [INTERNACIONALIZACAO, "Apoio para expansão internacional e captação de investidores", "pede também investidores"],
    [INTERNACIONALIZACAO, "Expansão internacional e distribuidores", "pede também distribuidores"],
    [INTERNACIONALIZACAO, "Entrada de novo sócio internacional", "pede o sócio"],
    [INTERNACIONALIZACAO, "Conseguir galpão para expansão internacional", "pede o imóvel"],
  ])("%s × %s: NÃO (%s)", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(false);
    expect(scoreMatch(item(oferta), item(necessidade)).score).toBe(0);
  });
});

describe("Vocabulário — assunto REGULATÓRIO SANITÁRIO (agência sanitária, ou ato regulatório + objeto sanitário)", () => {
  const REGISTRO = "Consultoria para registro de medicamentos";

  it.each([
    [REGISTRO, "Precisamos de suporte para obter autorização regulatória para comercializar nosso medicamento no Brasil"],
    [REGISTRO, "Registro de cosmético na Anvisa"],
    ["Assessoria regulatória para a Anvisa", "Apoio para aprovação na Anvisa"],
    [REGISTRO, "Registro de produtos na Anvisa"],
  ])("%s × %s: declara o assunto", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(true);
  });

  it.each([
    [REGISTRO, "Registro de marca", "sem objeto sanitário"],
    [REGISTRO, "Autorização regulatória da Anatel para rádio", "outra agência, sem objeto sanitário"],
    [REGISTRO, "Licença sanitária para restaurante", "sem objeto sanitário"],
    [REGISTRO, "Distribuidor de medicamentos", "pede a contraparte"],
    [REGISTRO, "Apoio para vender nosso medicamento", "sem ato regulatório: é venda"],
    [REGISTRO, "Suporte técnico para o sistema da Anvisa", "o suporte pedido é técnico"],
    [REGISTRO, "Medicamentos genéricos", "pede o produto"],
    [REGISTRO, "Obter capital para registro de medicamentos", "pede capital depois da ação"],
    [REGISTRO, "Apoio para obter financiamento para registro de medicamentos", "pede financiamento"],
    [REGISTRO, "Registrar marca de cosméticos no INPI", "registro de marca é propriedade intelectual"],
    [REGISTRO, "Registro de cosméticos no INPI", "o INPI não é agência sanitária"],
  ])("%s × %s: NÃO (%s)", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(false);
    expect(scoreMatch(item(oferta), item(necessidade)).score).toBe(0);
  });
});

describe("Vocabulário — outra área curada na necessidade separa (AREAS_QUE_SEPARAM)", () => {
  it.each([
    [INTERNACIONALIZACAO, "Revisão de contratos de exportação", "é trabalho contratual"],
    ["Advocacia tributária", "Planejamento tributário e trabalhista", "pede também a área trabalhista, que a oferta não diz"],
    ["Consultoria para registro de medicamentos", "Apoio para registro de medicamento e contrato com distribuidor", "pede também contrato"],
  ])("%s × %s: NÃO (%s)", (oferta, necessidade) => {
    expect(necessidadeDeclaraOAssuntoDoServico(oferta, null, necessidade)).toBe(false);
  });

  it("a área que a oferta também nomeia não separa", () => {
    expect(necessidadeDeclaraOAssuntoDoServico("Advocacia tributária e trabalhista", null, "Planejamento tributário e trabalhista")).toBe(true);
  });
});

describe("Portão da IA — contraparte e autodescrição barram; o resto segue com o modelo", () => {
  const citando = (fonte: string, citacao: string, perfilDoPortao: Record<string, unknown>) =>
    passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: citacao }, textoEscritoPelaPessoa("Oportunidade", [], fonte), { whatINeed: [], ...perfilDoPortao });

  it("barra capital, imóvel e a autodescrição com obrigação legal", () => {
    expect(citando("Capital de giro para expansão.", "Capital de giro para expansão", { whatIHave: ["Advocacia tributária"] })).toBe(false);
    expect(citando("Galpão em Santos para estoque.", "Galpão em Santos", { whatIHave: ["Advocacia tributária"] })).toBe(false);
    expect(citando("Indústria sujeita a obrigações tributárias complexas.", "Indústria sujeita a obrigações tributárias", { whatIHave: ["Advocacia tributária"] })).toBe(false);
  });

  it("barra a contraparte e o capital pedidos depois de uma ação sobre o assunto (achado de 14/09: bastava trocar a ordem das palavras)", () => {
    expect(citando("Entrada de investidor internacional na empresa.", "entrada de investidor internacional", { whatIHave: [INTERNACIONALIZACAO] })).toBe(false);
    expect(citando("Expandir para a África via distribuidores.", "Expandir para a África via distribuidores", { whatIHave: [INTERNACIONALIZACAO] })).toBe(false);
    expect(citando("Obter capital para registro de medicamentos.", "Obter capital para registro de medicamentos", { whatIHave: ["Consultoria para registro de medicamentos"] })).toBe(false);
    // A logística atende o distribuidor, como na cabeça.
    expect(citando("Expandir para a África via distribuidores.", "Expandir para a África via distribuidores", { whatIHave: ["Transporte rodoviário de cargas"] })).toBe(true);
  });

  it("não barra: ação sobre outro objeto que cita um papel de comércio, logística diante de distribuidor, e perfil com outra base", () => {
    expect(citando("Precisamos revisar contratos com nossos distribuidores.", "Precisamos revisar contratos com nossos distribuidores", { whatIHave: ["Advocacia contratual"] })).toBe(true);
    expect(citando("Indústria busca distribuidor para a África.", "busca distribuidor para a África", { whatIHave: ["Transporte rodoviário de cargas"] })).toBe(true);
    expect(citando("Indústria busca distribuidor para a África.", "busca distribuidor para a África", { whatIHave: ["Advocacia tributária", "fazenda"] })).toBe(true);
  });

  it("a paráfrase que o vocabulário não lê continua com o modelo, como antes", () => {
    expect(citando("Queremos entender melhor nossa situação perante a Receita.", "entender melhor nossa situação perante a Receita", { whatIHave: ["Advocacia tributária"] })).toBe(true);
  });

  it("o pedido sobre um assunto entendido barra quem não tem relação com ele; quem não diz a especialidade fica com o modelo", () => {
    const fonte = "Precisamos revisar nossos tributos e identificar créditos fiscais.";
    const citacao = "Precisamos revisar nossos tributos e identificar créditos fiscais";
    expect(citando(fonte, citacao, { whatIHave: ["Consultoria em marketing"] })).toBe(false);
    expect(citando(fonte, citacao, { whatIHave: [INTERNACIONALIZACAO] })).toBe(false);
    expect(citando(fonte, citacao, { whatIHave: ["Consultoria jurídica"] })).toBe(true); // advocacia presta o assunto
    expect(citando(fonte, citacao, { whatIHave: ["Consultoria em gestão"] })).toBe(true); // nada reconhecido: modelo
  });
});
