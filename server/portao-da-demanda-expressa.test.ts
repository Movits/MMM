import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O portão da demanda expressa na camada de IA (routers/matching.ts) —
 * pedido do Nicolas, 12/09/2026.
 *
 * O modelo passa a dizer em que TIPO de item de "o que tenho" o match se
 * apoia e, quando é serviço, a citar o trecho do outro lado que declara a
 * necessidade. O código confere a citação no texto que o modelo recebeu:
 * serviço sem citação conferida não sai da tela nem vira alerta, seja qual
 * for a nota. Os outros tipos passam como antes.
 */
const { citacaoConfere, cortarEmPalavra, exigeCitacao, normalizarTipo, passaNoPortao, reconhecerTipo, REGRA_DA_DEMANDA_EXPRESSA, textoEscritoPelaPessoa, TIPOS_PARA_A_IA } = await import("./portao-da-demanda-expressa");

describe("normalizarTipo — a grafia do modelo vira o enum", () => {
  it("aceita variações e sinônimos", () => {
    for (const valor of ["servico", "Serviço", "SERVICO", "service", "Serviços"]) expect(normalizarTipo(valor)).toBe("servico");
    expect(normalizarTipo("investimento/capital")).toBe("investimento");
    expect(normalizarTipo("Conexão/Network")).toBe("conexao");
    expect(normalizarTipo("nenhuma")).toBe("nenhuma");
    expect(normalizarTipo("none")).toBe("nenhuma");
  });

  it("num valor misto o serviço vence: 'produto/servico' não desliga o portão", () => {
    expect(normalizarTipo("produto/servico")).toBe("servico");
    expect(reconhecerTipo("produto ou serviço")).toBe("servico");
    expect(reconhecerTipo("banana")).toBeNull();
  });

  it("o que não reconhece vira 'outros' (o modelo não disse que era serviço)", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizarTipo("banana")).toBe("outros");
    expect(normalizarTipo(undefined)).toBe("outros");
    expect(normalizarTipo(42)).toBe("outros");
    aviso.mockRestore();
  });

  it("o enum do schema tem os nove tipos mais 'nenhuma'", () => {
    expect(TIPOS_PARA_A_IA).toHaveLength(10);
    expect(TIPOS_PARA_A_IA).toContain("nenhuma");
  });
});

describe("citacaoConfere — a citação precisa estar no texto-fonte", () => {
  const fonte = `[0] ID:7 Título:"Assessoria tributária" Setor:Indústria Tipo:demand Tags:["tributos"] Descrição:"Precisamos revisar nossos tributos e identificar créditos fiscais para 2026"`;

  it("trecho literal, com ou sem acento e caixa, confere", () => {
    expect(citacaoConfere("Precisamos revisar nossos tributos e identificar créditos fiscais", fonte)).toBe(true);
    expect(citacaoConfere("precisamos revisar nossos TRIBUTOS e identificar creditos fiscais", fonte)).toBe(true);
    expect(citacaoConfere("revisar nossos tributos", fonte)).toBe(true);
  });

  it("paráfrase e necessidade inventada não conferem", () => {
    expect(citacaoConfere("a empresa tem questões tributárias típicas de indústria", fonte)).toBe(false);
    expect(citacaoConfere("precisa de advocacia tributária", fonte)).toBe(false);
  });

  it("vazio, só palavras de ligação, uma palavra só ou não-texto: não confere", () => {
    expect(citacaoConfere("", fonte)).toBe(false);
    expect(citacaoConfere("de para com", fonte)).toBe(false);
    expect(citacaoConfere("tributos", fonte)).toBe(false); // uma tag solta é palavra-chave, não declaração
    expect(citacaoConfere(undefined, fonte)).toBe(false);
    expect(citacaoConfere(null, fonte)).toBe(false);
  });

  it("a palavra ausente nunca pode ser de serviço: 'frase real + serviço emendado' não passa", () => {
    expect(citacaoConfere("precisamos revisar nossos tributos advocacia", fonte)).toBe(false);
    expect(citacaoConfere("precisamos revisar nossos tributos consultoria", fonte)).toBe(false);
    expect(citacaoConfere("precisamos revisar nossos tributos hoje", fonte)).toBe(true); // ausente comum, tolerada
  });

  it("tolera UMA palavra ausente a partir de quatro; até três, nenhuma — tolerância fixa, não proporção", () => {
    expect(citacaoConfere("revisar nossos tributos identificar bônus", fonte)).toBe(true); // 4 de 5
    expect(citacaoConfere("precisamos revisar nossos impostos", fonte)).toBe(true); // 3 de 4 (fecha a janela do limiar por baixo)
    expect(citacaoConfere("revisar nossos impostos", fonte)).toBe(false); // 2 de 3
    expect(citacaoConfere("revisar tributos bônus taxas", fonte)).toBe(false); // 2 de 4 (fecha por cima)
    // "frase real + serviço presumido emendado no fim": com 70% proporcional
    // passava (5 de 7); com tolerância fixa, duas inventadas derrubam.
    expect(citacaoConfere("precisamos revisar nossos tributos identificar créditos fiscais advocacia empresarial", fonte)).toBe(false);
  });
});

describe("textoEscritoPelaPessoa e cortarEmPalavra — a fonte da citação", () => {
  it("é título, tags e descrição; setor, tipo e id ficam de fora", () => {
    const texto = textoEscritoPelaPessoa("Revisão fiscal", ["tributos", 7], "Precisamos revisar nossos tributos");
    expect(texto).toBe("Revisão fiscal | tributos | Precisamos revisar nossos tributos");
    expect(textoEscritoPelaPessoa(null, null, undefined)).toBe(" | ");
  });

  it("corta em fronteira de palavra, com reticência, e não mexe no que cabe", () => {
    expect(cortarEmPalavra("curto", 800)).toBe("curto");
    const cortado = cortarEmPalavra("precisamos revisar nossos tributos e identificar créditos", 30);
    expect(cortado.endsWith("…")).toBe(true);
    expect(cortado.length).toBeLessThanOrEqual(31);
    expect(cortado.slice(0, -1)).toBe("precisamos revisar nossos");
  });
});

describe("passaNoPortao — só serviço precisa de citação", () => {
  const fonte = "Distribuidor para a África | Indústria farmacêutica busca distribuidor para expansão na África";

  it("serviço sem citação conferida não passa, com qualquer nota", () => {
    expect(passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: "" }, fonte)).toBe(false);
    expect(passaNoPortao({ tipoDaOferta: "Serviço", necessidadeExpressa: "toda indústria tem impostos" }, fonte)).toBe(false);
  });

  it("serviço com a necessidade citada da própria oportunidade passa", () => {
    expect(passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: "busca distribuidor para expansão na África" }, fonte)).toBe(true);
  });

  it("setor e tipo não são necessidade: a 'citação' do setor não confere na fonte escrita pela pessoa", () => {
    const fonteEscrita = textoEscritoPelaPessoa("Distribuidor para a África", [], "Indústria farmacêutica busca distribuidor para expansão na África");
    expect(passaNoPortao({ tipoDaOferta: "servico", necessidadeExpressa: "Setor: Farmacêutico Tipo: demand" }, fonteEscrita)).toBe(false);
  });

  it("produto, ativo, investimento, conexão e 'nenhuma' passam sem citação", () => {
    for (const tipo of ["produto", "ativo", "investimento", "conexao", "tecnologia", "imovel", "outros", "nenhuma"]) {
      expect(passaNoPortao({ tipoDaOferta: tipo, necessidadeExpressa: "" }, fonte), tipo).toBe(true);
    }
  });

  it("o piso determinístico: perfil só de serviço e sem nada em 'preciso'/'busca' exige citação seja qual for o tipo que o modelo escreveu", () => {
    const soServico = { whatIHave: ["Advocacia tributária"], whatINeed: [], seekingTypes: [], lookingForInvestment: false };
    for (const tipo of ["produto", "nenhuma", "outros", "banana", undefined]) {
      expect(exigeCitacao({ tipoDaOferta: tipo, necessidadeExpressa: "" }, soServico), String(tipo)).toBe(true);
      expect(passaNoPortao({ tipoDaOferta: tipo, necessidadeExpressa: "" }, fonte, soServico), String(tipo)).toBe(false);
    }
    expect(passaNoPortao({ tipoDaOferta: "produto", necessidadeExpressa: "busca distribuidor para expansão na África" }, fonte, soServico)).toBe(true);
  });

  it("o piso não fecha quando há outra base declarada: necessidade, busca ou 'busco investimento'", () => {
    const item = { tipoDaOferta: "nenhuma", necessidadeExpressa: "" };
    expect(passaNoPortao(item, fonte, { whatIHave: ["Advocacia tributária"], whatINeed: ["distribuidores"] })).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: ["Advocacia tributária"], seekingTypes: ["investor"] })).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: ["Advocacia tributária"], lookingForInvestment: true })).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: ["Advocacia tributária", "fazenda"] })).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: [] })).toBe(true);
  });

  it("tipo irreconhecível com serviço no perfil fecha; sem serviço no perfil, passa", () => {
    expect(exigeCitacao({ tipoDaOferta: "banana" }, { whatIHave: ["Advocacia tributária", "fazenda"], whatINeed: ["tecnologia"] })).toBe(true);
    expect(exigeCitacao({ tipoDaOferta: "banana" }, { whatIHave: ["fazenda"] })).toBe(false);
  });

  it("com 'O que tenho' vazio, o piso lê a área de atuação e a especialidade (que o prompt também recebe)", () => {
    expect(exigeCitacao({ tipoDaOferta: "nenhuma" }, { whatIHave: [], activityArea: "Advocacia tributária", whatINeed: [] })).toBe(true);
    expect(exigeCitacao({ tipoDaOferta: "nenhuma" }, { whatIHave: [], activityArea: "Advocacia tributária", primarySpecialty: "vendas" })).toBe(false);
    expect(exigeCitacao({ tipoDaOferta: "nenhuma" }, { whatIHave: ["fazenda"], activityArea: "Advocacia tributária" })).toBe(false);
  });

  it("nos dois sentidos: oportunidade que OFERECE um serviço só passa para quem declarou precisar de algo", () => {
    const oferta = { type: "offer", title: "Assessoria tributária para indústrias" };
    const item = { tipoDaOferta: "nenhuma", necessidadeExpressa: "" };
    expect(passaNoPortao(item, fonte, { whatIHave: ["fazenda"], whatINeed: [] }, oferta)).toBe(false);
    expect(passaNoPortao(item, fonte, { whatIHave: ["fazenda"], whatINeed: ["consultoria"] }, oferta)).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: ["fazenda"], whatINeed: [] }, { type: "demand", title: "Assessoria tributária para indústrias" })).toBe(true);
    expect(passaNoPortao(item, fonte, { whatIHave: ["fazenda"], whatINeed: [] }, { type: "offer", title: "Café especial da Bahia" })).toBe(true);
  });

  it("a regra escrita para o modelo diz o essencial", () => {
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("servico, produto, ativo, oportunidade, investimento, conexao, tecnologia, imovel, outros");
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("NÃO conta como necessidade");
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("necessidadeExpressa");
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("alguém declarou que precisa");
  });
});

// ─── O router de verdade, com IA e banco simulados ───────────────────────────

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
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));

const { matchingRouter, notifyHighCompatibilityForOpportunity } = await import("./routers/matching");
const ctx = { user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;

// Declara uma busca ("investor") de propósito: sem base fora do serviço, o
// piso do portão exigiria citação até para o café — e o teste do piso cobre isso.
const perfilTributarista = { userId: 1, whatIHave: ["Advocacia tributária"], whatINeed: [], seekingTypes: ["investor"], sector: "Jurídico" };
const oportunidades = [
  { id: 10, title: "Revisão fiscal", sector: "Indústria", type: "demand", tags: [], description: "Precisamos revisar nossos tributos e identificar créditos fiscais", status: "active", publishedBy: 9, isConfidential: false },
  { id: 11, title: "Distribuidor para a África", sector: "Farmacêutico", type: "demand", tags: [], description: "Indústria farmacêutica busca distribuidor para expansão na África", status: "active", publishedBy: 9, isConfidential: false },
  { id: 12, title: "Compra de café especial", sector: "Agronegócio", type: "demand", tags: ["café"], description: "Torrefação compra café especial", status: "active", publishedBy: 9, isConfidential: false },
];
const respostaDaIA = (corpo: unknown) => ({ choices: [{ message: { content: JSON.stringify(corpo) } }] });

beforeEach(() => { invokeLLM.mockReset(); createNotification.mockClear(); filas.length = 0; });

describe("matching.getRecommendedOpportunities — o portão na recomendação", () => {
  it("serviço com citação conferida entra; serviço com necessidade presumida sai; produto passa sem citação", async () => {
    filas.push([perfilTributarista], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 0, score: 90, reason: "Necessidade declarada", tipoDaOferta: "servico", necessidadeExpressa: "revisar nossos tributos e identificar créditos fiscais" },
      { index: 1, score: 85, reason: "Toda indústria tem impostos", tipoDaOferta: "servico", necessidadeExpressa: "a farmacêutica precisa de assessoria tributária" },
      { index: 2, score: 70, reason: "Café", tipoDaOferta: "produto", necessidadeExpressa: "" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    // A tributarista não tem nada em "preciso": o café (índice 2) só passa
    // porque o perfil deste teste declara uma busca — sem isso o piso fecharia.
    expect(lista.map(o => o.id)).toEqual([10, 12]);
  });

  it("a citação é conferida contra a PRÓPRIA oportunidade: copiar a necessidade de outra do mesmo prompt não libera", async () => {
    filas.push([perfilTributarista], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 1, score: 88, reason: "Presumido", tipoDaOferta: "servico", necessidadeExpressa: "revisar nossos tributos e identificar créditos fiscais" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    expect(lista).toEqual([]);
  });

  it("o piso: perfil só de serviço e sem busca declarada exige citação mesmo quando o modelo diz 'produto' ou 'nenhuma'", async () => {
    filas.push([{ ...perfilTributarista, seekingTypes: [] }], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 1, score: 85, reason: "Setor", tipoDaOferta: "nenhuma", necessidadeExpressa: "" },
      { index: 2, score: 70, reason: "Café", tipoDaOferta: "produto", necessidadeExpressa: "" },
      { index: 0, score: 90, reason: "Declarada", tipoDaOferta: "outros", necessidadeExpressa: "revisar nossos tributos e identificar créditos fiscais" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    expect(lista.map(o => o.id)).toEqual([10]);
  });

  it("a descrição vai em 800 caracteres em fronteira de palavra: a necessidade antes do corte confere, depois do corte não chega ao modelo", async () => {
    const necessidade = "Precisamos de assessoria tributária para revisar a carga fiscal.";
    const enchimento = "Empresa consolidada no setor. ".repeat(30); // 900 caracteres
    const cabe = { ...oportunidades[0], description: `${necessidade} ${enchimento}` };
    const naoCabe = { ...oportunidades[0], id: 13, description: `${enchimento}${necessidade}` };
    filas.push([perfilTributarista], [cabe, naoCabe]);
    const citacao = { tipoDaOferta: "servico", necessidadeExpressa: "Precisamos de assessoria tributária para revisar a carga fiscal" };
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 0, score: 90, reason: "Declarada", ...citacao },
      { index: 1, score: 90, reason: "Declarada", ...citacao },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    const chamada = invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const usuario = chamada.messages.find(m => m.role === "user")!.content;
    expect(usuario).toContain("cortadas em 800 caracteres");
    // a linha da segunda oportunidade termina com reticência e sem a necessidade
    const linhaCortada = usuario.split("\n").find(l => l.startsWith("[1] "))!;
    expect(linhaCortada).toContain("…");
    expect(linhaCortada).not.toContain("carga fiscal");
    expect(lista.map(o => o.id)).toEqual([10]);
  });

  it("a citação é conferida contra o que a pessoa escreveu, não contra a linha do prompt: setor e tipo não valem", async () => {
    filas.push([perfilTributarista], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      // "Farmacêutico" e "demand" estão na linha do prompt (Setor:/Tipo:), não no texto da oportunidade 11
      { index: 1, score: 88, reason: "Setor", tipoDaOferta: "servico", necessidadeExpressa: "Farmacêutico demand" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    expect(lista).toEqual([]);
  });

  it("o prompt carrega a regra e a resposta pede tipo e citação no schema", async () => {
    filas.push([perfilTributarista], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [] }));

    await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    const chamada = invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }>; response_format: { json_schema: { schema: { properties: { matches: { items: { required: string[]; properties: Record<string, unknown> } } } } } } };
    const sistema = chamada.messages.find(m => m.role === "system")!.content;
    expect(sistema).toContain("REGRA DA DEMANDA EXPRESSA");
    expect(sistema).not.toContain("necessidades implícitas");
    const itens = chamada.response_format.json_schema.schema.properties.matches.items;
    expect(itens.required).toEqual(["index", "score", "reason", "tipoDaOferta", "necessidadeExpressa"]);
    expect((itens.properties.tipoDaOferta as { enum: string[] }).enum).toContain("servico");
  });
});

describe("notifyHighCompatibilityForOpportunity — o portão no alerta", () => {
  it("avisa quem tem citação conferida ou oferta que não é serviço; retém o serviço presumido", async () => {
    const oportunidade = oportunidades[1]; // distribuidor para a África
    filas.push([oportunidade], [
      { userId: 2, role: "silver", whatIHave: ["Advocacia tributária"], whatINeed: [], sector: "Jurídico", seekingTypes: [], interestSectors: [], activityArea: null },
      { userId: 3, role: "silver", whatIHave: ["Rede de distribuição na África"], whatINeed: [], sector: "Logística", seekingTypes: [], interestSectors: [], activityArea: null },
      { userId: 4, role: "silver", whatIHave: ["Consultoria em distribuição"], whatINeed: [], sector: "Consultoria", seekingTypes: [], interestSectors: [], activityArea: null },
    ]);
    invokeLLM.mockResolvedValue(respostaDaIA({ alerts: [
      { index: 0, score: 88, tipoDaOferta: "servico", necessidadeExpressa: "indústria com obrigações tributárias" },
      { index: 1, score: 92, tipoDaOferta: "conexao", necessidadeExpressa: "" },
      { index: 2, score: 85, tipoDaOferta: "servico", necessidadeExpressa: "busca distribuidor para expansão na África" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await notifyHighCompatibilityForOpportunity(11);

    silencio.mockRestore();
    // A descrição vai inteira ao alerta (não mais 300 caracteres).
    const chamada = invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(chamada.messages.find(m => m.role === "user")!.content).toContain(oportunidade.description);
    expect(r).toEqual({ notified: 2 });
    expect(createNotification.mock.calls.map(c => (c[0] as { userId: number }).userId)).toEqual([3, 4]);
  });

  it("o piso no alerta: perfil só de serviço e sem busca declarada é retido mesmo quando o modelo diz 'produto'", async () => {
    filas.push([oportunidades[1]], [
      { userId: 2, role: "silver", whatIHave: ["Advocacia tributária"], whatINeed: [], sector: "Jurídico", seekingTypes: [], interestSectors: [], activityArea: null, lookingForInvestment: false, primarySpecialty: null },
    ]);
    invokeLLM.mockResolvedValue(respostaDaIA({ alerts: [{ index: 0, score: 90, tipoDaOferta: "produto", necessidadeExpressa: "" }] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const r = await notifyHighCompatibilityForOpportunity(11);

    silencio.mockRestore();
    expect(r).toEqual({ notified: 0 });
    expect(createNotification).not.toHaveBeenCalled();
  });
});
