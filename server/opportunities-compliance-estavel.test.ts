import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.LLM_API_URL = "https://ia.teste.local/v1beta/openai";
process.env.LLM_API_KEY = "chave-de-teste";

/**
 * Reteste v4, item 1 — o MESMO anúncio recebia notas de confiança diferentes
 * (88, 75, 75) e fatores de risco diferentes a cada publicação. A nota vem do
 * modelo, e a chamada ia sem temperatura e sem nenhuma memória do que já havia
 * sido analisado: cada ida amostrava uma resposta nova.
 *
 * O que estes testes prendem:
 * 1. a chamada de compliance (criação e reanálise por documento) leva
 *    `temperature: 0` NO CORPO da requisição — quem não informa continua sem o
 *    campo, para não mudar o comportamento dos outros chamadores;
 * 2. conteúdo idêntico (título, descrição, tipo, setor, país e a lista de
 *    documentos) vai ao modelo UMA vez só; a segunda publicação reaproveita a
 *    análise guardada e devolve exatamente a mesma nota;
 * 3. conteúdo diferente volta ao modelo — o cache é por conteúdo, não por
 *    usuária nem por sessão.
 *
 * O dublê é o `fetch`: o invokeLLM real roda por inteiro, então o corpo que
 * sobe é o corpo de verdade e contar requisições é contar idas ao modelo.
 */

const { opportunities, opportunityDocuments } = await import("../drizzle/schema");

// ---------------------------------------------------------------- dublê do banco
const filaPorTabela = new Map<unknown, unknown[]>();
const atualizacoes: Record<string, unknown>[] = [];
const oportunidadesCriadas: Record<string, unknown>[] = [];

const consulta = (linhas: unknown[]) => {
  const encadeavel: Record<string, unknown> = {
    where: () => encadeavel,
    orderBy: () => encadeavel,
    limit: () => Promise.resolve(linhas),
    // Thenable: o router às vezes aguarda o select sem .limit().
    then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(linhas).then(ok, falha),
  };
  return encadeavel;
};

const dbFalso = {
  select: () => ({ from: (tabela: unknown) => consulta(filaPorTabela.get(tabela) ?? []) }),
  // O documento gravado ENTRA na fila da tabela: no banco de verdade o insert
  // vem ANTES de a lista ser lida de volta, então cada envio deixa a lista uma
  // linha maior. Um dublê que devolvesse sempre a mesma lista esconderia
  // exatamente o defeito que estes testes prendem.
  insert: (tabela: unknown) => ({
    values: (valores: Record<string, unknown>) => ({
      $returningId: async () => {
        const linhas = filaPorTabela.get(tabela) ?? [];
        linhas.push({ id: linhas.length + 7, ...valores });
        filaPorTabela.set(tabela, linhas);
        return [{ id: linhas.length + 6 }];
      },
    }),
  }),
  update: () => ({
    set: (valores: Record<string, unknown>) => {
      atualizacoes.push(valores);
      return { where: async () => undefined };
    },
  }),
};

vi.mock("./db", () => {
  return new Proxy({}, {
    has: () => true, // o vitest confere `prop in mock` antes de entregar o export
    get: (_alvo, prop) => {
      if (prop === "exigirDb") return async () => dbFalso;
      if (prop === "getDb") return async () => dbFalso;
      if (prop === "createOpportunity") {
        return async (valores: Record<string, unknown>) => {
          oportunidadesCriadas.push(valores);
          return 101;
        };
      }
      if (prop === "then" || prop === Symbol.toStringTag) return undefined; // não é uma Promise
      return async () => undefined;
    },
  });
});
vi.mock("./security", () => ({ createAuditLog: async () => {} }));

const { opportunitiesRouter } = await import("./routers/opportunities");
const { invokeLLM } = await import("./_core/llm");

// ---------------------------------------------------------------- dublê do modelo
type Corpo = Record<string, unknown>;
const corpos: Corpo[] = [];
let respostaDoModelo: Record<string, unknown> = {};
// Resposta 200 com conteúdo que não é JSON: o `JSON.parse` do router estoura na
// hora (sem as 4 retentativas de rede do invokeLLM, que gastariam segundos de
// espera real na suíte). É a falha de análise que os testes usam.
let conteudoCruDoModelo: string | undefined;

const fetchDoModelo = vi.fn((_url: string, init: RequestInit) => {
  corpos.push(JSON.parse(String(init.body)) as Corpo);
  return Promise.resolve(
    new Response(
      JSON.stringify({
        id: "r1",
        choices: [{ index: 0, message: { role: "assistant", content: conteudoCruDoModelo ?? JSON.stringify(respostaDoModelo) }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
});

const ctxComUser = (id: number, role: string) => ({
  user: { id, openId: `u-${id}`, email: "t@local", role },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const anuncio = (sufixo: string) => ({
  title: `Exportação de café verde para a Europa ${sufixo}`,
  description:
    "Cooperativa com contrato de fornecimento assinado busca compradores europeus " +
    `para lotes mensais de café verde certificado. Documentação disponível. ${sufixo}`,
  type: "offer" as const,
  sector: "Commodities",
  country: "BR",
  tags: ["cafe", "exportacao"],
  isConfidential: false,
});

beforeEach(() => {
  globalThis.fetch = fetchDoModelo as never;
  corpos.length = 0;
  atualizacoes.length = 0;
  oportunidadesCriadas.length = 0;
  filaPorTabela.clear();
  fetchDoModelo.mockClear();
  conteudoCruDoModelo = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
  respostaDoModelo = {
    complianceLevel: "yellow",
    explanation: "Documentação parcial.",
    riskAnalysis: "Risco cambial e de logística.",
    suggestedDocuments: ["Contrato de Fornecimento: formaliza a oferta"],
    trustScore: 75,
  };
});

describe("Compliance da oportunidade — a mesma entrada dá a mesma nota", () => {
  it("a análise da criação sobe com temperature 0 no corpo", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    await caller.create(anuncio("A"));

    expect(console.error).not.toHaveBeenCalled();
    expect(corpos).toHaveLength(1);
    // Mutante "chamar sem temperatura": o campo simplesmente não existiria.
    expect(corpos[0].temperature).toBe(0);
  });

  it("publicar o MESMO anúncio duas vezes vai ao modelo uma vez só, com a nota idêntica", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    const primeira = await caller.create(anuncio("B"));

    // O modelo passa a responder OUTRA nota: se houver segunda ida, ela aparece.
    respostaDoModelo = { ...respostaDoModelo, trustScore: 88, riskAnalysis: "Outro risco.", complianceLevel: "green" };
    const segunda = await caller.create(anuncio("B"));

    expect(fetchDoModelo).toHaveBeenCalledTimes(1);
    expect(segunda.complianceLevel).toBe(primeira.complianceLevel);
    expect(segunda.complianceExplanation).toBe(primeira.complianceExplanation);
    expect(oportunidadesCriadas).toHaveLength(2);
    expect(oportunidadesCriadas[1].frauenTrustScore).toBe(oportunidadesCriadas[0].frauenTrustScore);
    expect(oportunidadesCriadas[1].frauenTrustScore).toBe(75);
  });

  it("descrição diferente é conteúdo diferente: volta ao modelo", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    await caller.create(anuncio("C"));
    await caller.create({ ...anuncio("C"), description: `${anuncio("C").description} Lotes semanais também.` });

    // Mutante "cache por título" ou "cache global": ficaria em 1.
    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
  });

  it("reanálise por documento: temperature 0 e o mesmo conjunto de documentos não paga outra ida", async () => {
    const oportunidade = {
      id: 42,
      publishedBy: 1,
      title: "Exportação de café verde para a Europa D",
      description: "Cooperativa com contrato assinado busca compradores europeus.",
      type: "offer",
      sector: "Commodities",
      country: "BR",
      complianceLevel: "orange",
    };
    filaPorTabela.set(opportunities, [oportunidade]);
    // A oportunidade começa SEM documento: quem põe a linha na tabela é o
    // próprio uploadDocument, como no banco.
    filaPorTabela.set(opportunityDocuments, []);

    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    respostaDoModelo = {
      complianceLevel: "green",
      explanation: "Documentação completa.",
      riskAnalysis: "Risco baixo.",
      trustScore: 92,
    };
    await caller.uploadDocument({ opportunityId: 42, name: "Contrato de Fornecimento", fileKey: "k1", fileUrl: "u1" });

    expect(corpos).toHaveLength(1);
    expect(corpos[0].temperature).toBe(0);
    const primeiraAtualizacao = atualizacoes.at(-1);
    expect(primeiraAtualizacao?.frauenTrustScore).toBe(92);

    // Reenviar o MESMO documento não muda o conjunto de documentos da
    // oportunidade — muda só o número de linhas na tabela. O modelo não é
    // consultado de novo, e a nota gravada continua a mesma.
    respostaDoModelo = { ...respostaDoModelo, trustScore: 60, complianceLevel: "yellow" };
    await caller.uploadDocument({ opportunityId: 42, name: "Contrato de Fornecimento", fileKey: "k1", fileUrl: "u1" });

    expect(fetchDoModelo).toHaveBeenCalledTimes(1);
    expect(atualizacoes.at(-1)?.frauenTrustScore).toBe(92);
    expect(atualizacoes.at(-1)?.complianceLevel).toBe("green");
  });

  it("documento NOVO é conteúdo novo: a reanálise volta ao modelo", async () => {
    filaPorTabela.set(opportunities, [{
      id: 43, publishedBy: 1, title: "Exportação de café verde para a Europa E",
      description: "Cooperativa com contrato assinado busca compradores europeus.",
      type: "offer", sector: "Commodities", country: "BR", complianceLevel: "orange",
    }]);
    filaPorTabela.set(opportunityDocuments, []);

    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    respostaDoModelo = { complianceLevel: "yellow", explanation: "Parcial.", riskAnalysis: "Médio.", trustScore: 70 };
    await caller.uploadDocument({ opportunityId: 43, name: "Contrato de Fornecimento", fileKey: "k1", fileUrl: "u1" });
    await caller.uploadDocument({ opportunityId: 43, name: "Certidão de Registro", fileKey: "k2", fileUrl: "u2" });

    // Mutante "reaproveitar sempre" ou "hash sem os documentos": ficaria em 1.
    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
  });
});

/**
 * Reteste v4, item 1 (segunda volta) — a NOTA ficou estável, mas o reteste
 * continuou vendo FATORES DE RISCO e LISTA DE DOCUMENTOS diferentes para o
 * mesmo anúncio. Eles não vêm da análise de compliance da criação: vêm das
 * duas chamadas que a tela de cadastro faz enquanto a usuária escreve —
 * `analyzeForCompliance` (riskSummary, riskLevel, suggestedDocuments) e
 * `suggestDocuments` (suggestions, priority, reason). As duas iam sem
 * temperatura e sem nenhuma memória do que já havia sido analisado.
 */
describe("Cadastro: fatores de risco e documentos sugeridos também são estáveis", () => {
  const entrada = (sufixo: string) => ({
    title: `Exportação de café verde para a Europa ${sufixo}`,
    description: `Cooperativa busca compradores europeus para lotes mensais. ${sufixo}`,
    type: "offer" as const,
    sector: "Commodities",
  });

  beforeEach(() => {
    respostaDoModelo = {
      dynamicQuestion: "Você possui contrato de fornecimento assinado?",
      suggestedDocuments: ["SGS", "BL", "Contrato de Fornecimento"],
      documentJustifications: ["Qualidade", "Embarque", "Formaliza a oferta"],
      riskLevel: "medium",
      riskSummary: "Risco cambial e de logística.",
    };
  });

  it("a análise dinâmica do cadastro sobe com temperature 0", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    await caller.analyzeForCompliance(entrada("F"));

    expect(corpos).toHaveLength(1);
    // Mutante "chamar sem temperatura": o campo não existiria no corpo.
    expect(corpos[0].temperature).toBe(0);
  });

  it("a mesma oportunidade no cadastro devolve os MESMOS fatores de risco e documentos, sem segunda ida", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    const primeira = await caller.analyzeForCompliance(entrada("G"));

    // O modelo passa a responder outra coisa: se houver segunda ida, aparece.
    respostaDoModelo = {
      ...respostaDoModelo,
      riskSummary: "Outro risco completamente diferente.",
      riskLevel: "high",
      suggestedDocuments: ["Apólice de Seguro"],
    };
    const segunda = await caller.analyzeForCompliance(entrada("G"));

    expect(fetchDoModelo).toHaveBeenCalledTimes(1);
    expect(segunda.riskSummary).toBe(primeira.riskSummary);
    expect(segunda.riskLevel).toBe(primeira.riskLevel);
    expect(segunda.suggestedDocuments).toEqual(primeira.suggestedDocuments);
  });

  it("descrição diferente no cadastro é conteúdo novo: volta ao modelo", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    await caller.analyzeForCompliance(entrada("H"));
    await caller.analyzeForCompliance({ ...entrada("H"), description: `${entrada("H").description} Lotes semanais.` });

    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
  });

  it("sugestão de documentos: temperature 0, mesma entrada sem segunda ida, documento novo volta ao modelo", async () => {
    respostaDoModelo = {
      suggestions: ["Contrato de Fornecimento", "Certidão de Registro"],
      priority: ["essential", "essential"],
      reason: ["Formaliza a oferta", "Valida a empresa"],
    };
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    const pedido = { opportunityType: "offer" as const, sector: "Logística", existingDocuments: ["Contrato de Fornecimento"] };

    const primeira = await caller.suggestDocuments(pedido);
    respostaDoModelo = { suggestions: ["Apólice"], priority: ["optional"], reason: ["Outra coisa"] };
    const segunda = await caller.suggestDocuments(pedido);

    expect(corpos[0].temperature).toBe(0);
    expect(fetchDoModelo).toHaveBeenCalledTimes(1);
    expect(segunda.suggestions).toEqual(primeira.suggestions);

    // Outra lista de documentos já enviados é outro conteúdo.
    await caller.suggestDocuments({ ...pedido, existingDocuments: ["Contrato de Fornecimento", "Certidão de Registro"] });
    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
  });

  it("análise que FALHOU não fica guardada: a próxima tentativa volta ao modelo e traz a resposta de verdade", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    // Primeira ida: o modelo responde 200 com conteúdo que não é JSON. O router
    // devolve o texto de reserva — que NÃO pode ficar guardado como se fosse
    // análise daquele anúncio.
    conteudoCruDoModelo = "isto não é json";
    const comFalha = await caller.analyzeForCompliance(entrada("I"));
    expect(comFalha.riskSummary).toContain("Análise preliminar indisponível");

    conteudoCruDoModelo = undefined;
    const depois = await caller.analyzeForCompliance(entrada("I"));

    // Mutante "guardar antes de saber se deu certo": ficaria em 1 e a usuária
    // carregaria o texto de reserva para sempre.
    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
    expect(depois.riskSummary).toBe("Risco cambial e de logística.");
  });

  it("compliance da criação que FALHOU não fica guardada: nasce 'pending' e a próxima publicação tenta de novo", async () => {
    const caller = opportunitiesRouter.createCaller(ctxComUser(1, "silver"));
    respostaDoModelo = {
      complianceLevel: "yellow",
      explanation: "Documentação parcial.",
      riskAnalysis: "Risco cambial e de logística.",
      suggestedDocuments: ["Contrato de Fornecimento: formaliza a oferta"],
      trustScore: 75,
    };
    conteudoCruDoModelo = "isto não é json";
    const comFalha = await caller.create(anuncio("J"));
    expect(comFalha.complianceLevel).toBe("pending");

    conteudoCruDoModelo = undefined;
    const depois = await caller.create(anuncio("J"));

    expect(fetchDoModelo).toHaveBeenCalledTimes(2);
    expect(depois.complianceLevel).toBe("yellow");
    expect(oportunidadesCriadas.at(-1)?.frauenTrustScore).toBe(75);
  });
});

describe("invokeLLM — temperatura e semente só sobem quando informadas", () => {
  const mensagens = [{ role: "user" as const, content: "oi" }];

  it("com temperature e seed, os dois chegam ao corpo da requisição", async () => {
    globalThis.fetch = fetchDoModelo as never;
    await invokeLLM({ messages: mensagens, temperature: 0, seed: 7 });

    expect(corpos[0].temperature).toBe(0);
    expect(corpos[0].seed).toBe(7);
  });

  it("sem informar nada, o corpo não ganha campo novo (quem não pediu não muda)", async () => {
    globalThis.fetch = fetchDoModelo as never;
    await invokeLLM({ messages: mensagens });

    expect(corpos[0]).not.toHaveProperty("temperature");
    expect(corpos[0]).not.toHaveProperty("seed");
  });
});
