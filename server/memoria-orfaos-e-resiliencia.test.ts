import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Memória Inteligente (etapa 6) — três contratos que a versão anterior não tinha:
 *
 * 1. Fonte apagada leva o documento da memória junto. Antes, notas de um
 *    contato excluído continuavam pesquisáveis (e citáveis pela resposta da IA)
 *    para sempre.
 * 2. Ritmo: embeddings saem em LOTES (uma requisição por lote, que é o que o
 *    plano do Gemini conta), com teto de tempo por rodada; cota ou pico no meio
 *    não derruba nada — o que faltou fica pendente para a próxima rodada.
 * 3. Resiliência: a busca não morre quando a reindexação falha, e a resposta da
 *    IA fora do ar vira um aviso honesto — nunca o JSON cru do provedor no
 *    toast da usuária.
 *
 * O banco é simulado por identidade das tabelas do schema; as escritas ficam
 * capturadas para as asserções.
 */

const embedWithGemini = vi.fn();
const embedManyWithGemini = vi.fn();
vi.mock("./gemini", () => ({
  embedWithGemini: (...args: unknown[]) => embedWithGemini(...args),
  embedManyWithGemini: (...args: unknown[]) => embedManyWithGemini(...args),
}));

const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: unknown[]) => invokeLLM(...args),
}));

// Marcador: uma tabela "fora do ar" faz o SELECT dela estourar.
const TABELA_FORA_DO_AR = Symbol("tabela fora do ar");
const tabelas = new Map<unknown, unknown>();
const escritas = { inseridos: [] as Record<string, unknown>[], atualizados: [] as Record<string, unknown>[], delecoes: 0 };
const fakeDb = {
  // A assinatura de mudança pede agregados {n, m} que o fake precisa CALCULAR:
  // devolver linhas cruas faria cada tabela virar "undefined:undefined" e o
  // teste da assinatura passaria com qualquer implementação.
  select: (projecao?: Record<string, unknown>) => ({
    from: (tabela: unknown) => ({
      where: async () => {
        const linhas = tabelas.get(tabela) ?? [];
        if (linhas === TABELA_FORA_DO_AR) throw new Error("tabela fora do ar");
        const cru = linhas as Record<string, unknown>[];
        if (projecao && "n" in projecao && "m" in projecao) {
          return [{ n: cru.length, m: cru.reduce((maior, linha) => Math.max(maior, Number(linha.updatedAt ?? 0)), 0) }];
        }
        return cru;
      },
    }),
  }),
  insert: () => ({ values: async (valores: Record<string, unknown>) => { escritas.inseridos.push(valores); } }),
  update: () => ({ set: (valores: Record<string, unknown>) => ({ where: async () => { escritas.atualizados.push(valores); } }) }),
  delete: () => ({ where: async () => { escritas.delecoes += 1; } }),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb as never, exigirDb: async () => fakeDb as never }));

const schema = await import("../drizzle/schema");
const servico = await import("./memory-service");

const vetor768 = () => new Array(768).fill(0.1);

const docDeContato = (id: number, nome: string, extra: Record<string, unknown> = {}) => ({
  id: `doc-${id}`, ownerId: "dona", sourceType: "contact", sourceId: String(id),
  title: nome, content: `Contato: ${nome}`, metadata: {},
  embedding: vetor768(), contentHash: servico.buildMemoryHash(`Contato: ${nome}`),
  indexedAt: 1, createdAt: 1, updatedAt: 1, ...extra,
});

beforeEach(() => {
  tabelas.clear();
  tabelas.set(schema.privateContacts, []);
  tabelas.set(schema.contexts, []);
  tabelas.set(schema.meetingTranscripts, []);
  tabelas.set(schema.memoryDocuments, []);
  tabelas.set(schema.contactAssets, []);
  tabelas.set(schema.contactNeeds, []);
  tabelas.set(schema.contextParticipants, []);
  tabelas.set(schema.meetings, []);
  escritas.inseridos = []; escritas.atualizados = []; escritas.delecoes = 0;
  embedWithGemini.mockReset(); embedManyWithGemini.mockReset(); invokeLLM.mockReset();
  embedManyWithGemini.mockImplementation(async (textos: string[]) => textos.map(() => vetor768()));
  // A assinatura de mudança é estado de módulo; sem limpar, um teste herdaria
  // o "nada mudou" do anterior e a indexação nem rodaria.
  servico.esquecerAssinaturasDeIndexacao();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Memória — órfão não sobrevive à fonte", () => {
  it("apagar o contato remove o documento correspondente do índice", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana"), docDeContato(99, "Excluída")]);

    const resultado = await servico.indexOwnerMemory("dona");

    expect(resultado.removed).toBe(1);
    expect(escritas.delecoes).toBe(1);
    // a Ana não mudou: reaproveita o vetor, sem gastar embedding
    expect(resultado.skipped).toBe(1);
    expect(embedManyWithGemini).not.toHaveBeenCalled();
  });

  it("sem órfão, nenhum DELETE é disparado", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana")]);

    const resultado = await servico.indexOwnerMemory("dona");

    expect(resultado.removed).toBe(0);
    expect(escritas.delecoes).toBe(0);
  });

  it("órfão de reunião também sai: a chave usa meetingId, não o id da linha", async () => {
    tabelas.set(schema.meetingTranscripts, [{ id: "linha-1", meetingId: "reuniao-1", ownerId: "dona", transcript: "Reunião sobre vinho", language: "pt" }]);
    const docReuniao = {
      id: "doc-r1", ownerId: "dona", sourceType: "meeting", sourceId: "reuniao-1",
      title: "Transcrição de reunião", content: "Reunião sobre vinho", metadata: {},
      embedding: vetor768(), contentHash: servico.buildMemoryHash("Reunião sobre vinho"),
      indexedAt: 1, createdAt: 1, updatedAt: 1,
    };
    const docOrfao = { ...docReuniao, id: "doc-r99", sourceId: "reuniao-apagada" };
    tabelas.set(schema.memoryDocuments, [docReuniao, docOrfao]);

    const resultado = await servico.indexOwnerMemory("dona");

    expect(resultado.removed).toBe(1);
    expect(resultado.skipped).toBe(1);
    expect(embedManyWithGemini).not.toHaveBeenCalled();
  });

  it("o que o contato possui/procura entra no documento da memória (etapa 9)", async () => {
    // "Quem exporta medicamentos?" mora no possui/procura, não no cargo — sem
    // estas linhas no documento, a pesquisa do requisito não tinha resposta.
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.contactAssets, [{ contactId: 1, tagLabel: "Exportar medicamentos" }]);
    tabelas.set(schema.contactNeeds, [{ contactId: 1, tagLabel: "Distribuidores na Europa" }]);

    await servico.indexOwnerMemory("dona");

    expect(escritas.inseridos).toHaveLength(1);
    const conteudo = escritas.inseridos[0].content as string;
    expect(conteudo).toContain("Possui / oferece: Exportar medicamentos");
    expect(conteudo).toContain("Procura: Distribuidores na Europa");
  });

  it("participantes do contexto entram no documento — 'quem conhece ministros' tem onde morar", async () => {
    tabelas.set(schema.contexts, [{ id: "ctx-1", name: "Fórum de Investimentos", visibility: "private" }]);
    tabelas.set(schema.contextParticipants, [{ contextId: "ctx-1", name: "Carlos Andrade", role: "Ministro da Saúde", company: null, notes: null }]);

    await servico.indexOwnerMemory("dona");

    const doc = escritas.inseridos.find(item => item.sourceType === "context");
    expect(String(doc?.content)).toContain("Participantes: Carlos Andrade, Ministro da Saúde");
  });

  it("a transcrição ganha o título da reunião — deixa de ser um texto anônimo", async () => {
    tabelas.set(schema.meetingTranscripts, [{ meetingId: "m-1", transcript: "Falamos de vinho e logística", language: "pt" }]);
    tabelas.set(schema.meetings, [{ id: "m-1", title: "Reunião com a vinícola" }]);

    await servico.indexOwnerMemory("dona");

    const doc = escritas.inseridos.find(item => item.sourceType === "meeting");
    expect(doc?.title).toBe("Reunião com a vinícola");
    expect(String(doc?.content)).toContain("Reunião: Reunião com a vinícola");
  });

  it("nada mudou desde a última rodada: a seguinte nem carrega as fontes (assinatura)", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    await servico.indexOwnerMemory("dona");
    embedManyWithGemini.mockClear();

    const segunda = await servico.indexOwnerMemory("dona");

    expect(segunda.indexed).toBe(0);
    expect(embedManyWithGemini).not.toHaveBeenCalled();
  });

  it("edição sem linha nova também muda a assinatura: updatedAt maior reindexa", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana", updatedAt: 10 }]);
    await servico.indexOwnerMemory("dona");
    embedManyWithGemini.mockClear();
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana Paula", updatedAt: 20 }]);

    const segunda = await servico.indexOwnerMemory("dona");

    expect(segunda.indexed).toBe(1);
    expect(embedManyWithGemini).toHaveBeenCalled();
  });

  it("rodada interrompida NÃO congela o índice: a assinatura só é lembrada completa", async () => {
    // Sem o guarda de pendência, a primeira rodada (cota estourada) carimbaria
    // a assinatura e toda busca seguinte pularia a retomada prometida.
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }, { id: 2, fullName: "Bia" }]);
    embedManyWithGemini.mockRejectedValueOnce(new Error("cota esgotada"));

    const primeira = await servico.indexOwnerMemory("dona");
    expect(primeira.pending).toBe(2);

    const segunda = await servico.indexOwnerMemory("dona");

    expect(segunda.indexed).toBe(2);
    expect(segunda.pending).toBe(0);
  });

  it("cada documento recebe o vetor do seu próprio texto (ordem do lote)", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }, { id: 2, fullName: "Bia" }]);
    embedManyWithGemini.mockImplementation(async (textos: string[]) => textos.map((_, posicao) => {
      const marcado = new Array(768).fill(0);
      marcado[posicao] = 1;
      return marcado;
    }));

    await servico.indexOwnerMemory("dona");

    const porConteudo = new Map(escritas.inseridos.map(linha => [linha.content as string, linha.embedding as number[]]));
    expect(porConteudo.get("Contato: Ana")?.[0]).toBe(1);
    expect(porConteudo.get("Contato: Bia")?.[1]).toBe(1);
  });

  it("vetor da era OpenAI (1536) é reindexado sem apagar o documento", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana", { embedding: new Array(1536).fill(0.1) })]);

    const resultado = await servico.indexOwnerMemory("dona");

    expect(resultado.indexed).toBe(1);
    expect(escritas.atualizados).toHaveLength(1);
    expect((escritas.atualizados[0] as { embedding: number[] }).embedding).toHaveLength(768);
    expect(escritas.delecoes).toBe(0);
  });
});

describe("Memória — ritmo dos embeddings", () => {
  it("cota no meio da indexação não derruba: o resto fica pendente", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }, { id: 2, fullName: "Bia" }]);
    embedManyWithGemini.mockRejectedValue(new Error("cota esgotada"));

    const resultado = await servico.indexOwnerMemory("dona");

    expect(resultado.indexed).toBe(0);
    expect(resultado.pending).toBe(2);
    expect(escritas.inseridos).toHaveLength(0);
  });

  it("acima do teto: lotes de até 16 com pausa, excedente avisado, e o documento além do teto NÃO vira órfão", async () => {
    vi.useFakeTimers();
    const muitos = Array.from({ length: 801 }, (_, indice) => ({ id: indice + 1, fullName: `Contato ${indice + 1}` }));
    tabelas.set(schema.privateContacts, muitos);
    // O contato 801 fica fora do índice pelo teto — mas a fonte EXISTE, então o
    // documento antigo dele não pode ser apagado como órfão.
    tabelas.set(schema.memoryDocuments, [docDeContato(801, "Contato 801")]);

    const promessa = servico.indexOwnerMemory("dona");
    // a pausa entre lotes é real: sem avançar o relógio, só o primeiro lote sai
    await vi.advanceTimersByTimeAsync(0);
    expect(embedManyWithGemini).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    const resultado = await promessa;

    expect(resultado.total).toBe(800);
    expect(resultado.truncated).toBe(1);
    expect(resultado.indexed).toBe(800);
    expect(resultado.removed).toBe(0);
    expect(escritas.delecoes).toBe(0);
    // 800 documentos em lotes de 16 = 50 requisições — nunca uma por documento
    expect(embedManyWithGemini).toHaveBeenCalledTimes(50);
    const maiorLote = Math.max(...embedManyWithGemini.mock.calls.map(chamada => (chamada[0] as string[]).length));
    expect(maiorLote).toBeLessThanOrEqual(16);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("acima do teto"));

    // A rodada seguinte cai no atalho da assinatura — e o truncamento continua
    // visível, em vez do zero fixo que o atalho devolveria sem memória dele.
    const seguinte = await servico.indexOwnerMemory("dona");
    expect(seguinte.indexed).toBe(0);
    expect(seguinte.truncated).toBe(1);
  });

  it("orçamento de tempo estourado: para com pendência em vez de segurar a requisição", async () => {
    vi.useFakeTimers();
    const contatos = Array.from({ length: 32 }, (_, indice) => ({ id: indice + 1, fullName: `C${indice + 1}` }));
    tabelas.set(schema.privateContacts, contatos);
    embedManyWithGemini.mockImplementation(async (textos: string[]) => {
      await new Promise(resolve => setTimeout(resolve, 31_000));
      return textos.map(() => vetor768());
    });

    const promessa = servico.indexOwnerMemory("dona");
    await vi.advanceTimersByTimeAsync(31_000);
    const resultado = await promessa;

    expect(resultado.indexed).toBe(16);
    expect(resultado.pending).toBe(16);
  });
});

describe("Memória — busca e resposta resilientes", () => {
  it("busca segue funcionando quando os embeddings de indexação falham", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana", { contentHash: "hash-desatualizado" })]);
    embedManyWithGemini.mockRejectedValue(new Error("IA fora do ar"));
    embedWithGemini.mockResolvedValue(vetor768());

    const { hits, pending } = await servico.semanticSearch("dona", "quem é a Ana?");

    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Ana");
    expect(hits[0].score).toBeCloseTo(1);
    // e a pendência não é segredo: a busca conta o que ficou por indexar
    expect(pending).toBe(1);
  });

  it("até um erro inesperado na reindexação não mata a busca", async () => {
    tabelas.set(schema.privateContacts, TABELA_FORA_DO_AR as never);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana")]);
    embedWithGemini.mockResolvedValue(vetor768());

    const { hits } = await servico.semanticSearch("dona", "quem é a Ana?");

    expect(hits).toHaveLength(1);
  });

  it("LLM fora do ar vira aviso honesto: hits continuam e nada de JSON cru", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana")]);
    embedWithGemini.mockResolvedValue(vetor768());
    invokeLLM.mockRejectedValue(new Error('LLM invoke failed: 429 Too Many Requests – {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'));

    const resultado = await servico.searchAndAnswer("dona", "quem é a Ana?");

    expect(resultado.hits).toHaveLength(1);
    expect(resultado.answer).toBe(servico.AI_UNAVAILABLE_ANSWER);
    expect(resultado.answer).not.toMatch(/429|RESOURCE_EXHAUSTED/);
  });

  it("LLM saudável continua respondendo normalmente", async () => {
    tabelas.set(schema.privateContacts, [{ id: 1, fullName: "Ana" }]);
    tabelas.set(schema.memoryDocuments, [docDeContato(1, "Ana")]);
    embedWithGemini.mockResolvedValue(vetor768());
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: "A Ana é sua conexão. [1]" } }] });

    const resultado = await servico.searchAndAnswer("dona", "quem é a Ana?");

    expect(resultado.answer).toBe("A Ana é sua conexão. [1]");
  });
});
