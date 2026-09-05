import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Etapa 4 — corridas entre abas e a ordem do que fica gravado.
 *
 * Router REAL (createCaller) sobre o db.ts REAL, com o drizzle falando com um
 * cliente mysql2 falso que responde pelo CONTEÚDO de cada consulta e captura o
 * SQL. Só a IA, o consentimento e o recálculo de matches são dublês. É o que
 * os testes com o db.ts dublado não provam: QUAL SQL sai do router, em que
 * ordem, e com que parâmetros.
 *
 * A revisão da PR-C reproduziu com banco real: duas abas confirmando os dois
 * últimos cartões da etapa avançavam o roteiro DUAS vezes (2 → 4, pulando a
 * pergunta de "procura"), porque o avanço RELIA a sessão antes do UPDATE
 * condicional — cada aba relia o valor já avançado pela outra e passava no
 * WHERE. Agora o router passa a etapa que leu e o UPDATE exige exatamente
 * ela, sem reler. E dois detalhes de ordem: a resposta da usuária, gravada
 * só depois de a IA responder, leva o instante de ANTES da chamada; os N
 * cartões de uma etapa de lista nascem com created_at crescente.
 */

const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => false,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
vi.mock("./match-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./match-service")>()),
  recalculatePrivateMatches: async () => ({ created: 0 }),
}));

type Consulta = { sql: string; params: unknown[] };

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** Linha de enrichment_sessions, na ordem das colunas do schema. */
  sessao: null as unknown[] | null,
  /** A sugestão buscada pelo id (confirmar/ignorar). */
  sugestao: null as unknown[] | null,
  /** O que ainda está pendente na sessão depois da decisão. */
  pendentes: [] as unknown[][],
  /** Linhas que o UPDATE condicional do avanço pega (0 = outra aba avançou antes). */
  linhasDoAvanco: 1,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      const sql = config.sql;
      if (sql.startsWith("insert into `contact_")) return [{ affectedRows: 1, insertId: 99 }, []];
      if (sql.startsWith("insert")) return [{ affectedRows: 1 }, []];
      // O avanço do roteiro é o UPDATE da sessão que toca questions_answered;
      // o de last_activity_at (saveEnrichmentMessage) sempre pega a linha.
      if (sql.startsWith("update `enrichment_sessions`") && sql.includes("`questions_answered` = ?")) {
        return [{ affectedRows: estado.linhasDoAvanco }, []];
      }
      if (sql.startsWith("update")) return [{ affectedRows: 1 }, []];
      if (sql.includes("from `enrichment_sessions`")) return [estado.sessao ? [estado.sessao] : [], []];
      // Pendentes da sessão (session_id no WHERE) × uma sugestão pelo id.
      if (sql.includes("from `enrichment_suggestions`")) {
        return [sql.includes("`session_id` = ?") ? estado.pendentes : (estado.sugestao ? [estado.sugestao] : []), []];
      }
      if (sql.includes("from `enrichment_messages`")) return [[], []];
      if (/^select `id` from `private_contacts`/.test(sql)) return [[[42]], []];
      if (/^select `id` from `contact_(assets|needs)`/.test(sql)) return [[], []];
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { enrichmentRouter } = await import("./routers/enrichment");
const db = await import("./db");

const DONA = "dona-1";
const ctx = {
  user: { id: 1, openId: DONA, email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;
const caller = enrichmentRouter.createCaller(ctx);

// id, owner_id, contact_id, status, questions_answered, questions_skipped,
// summary, last_activity_at, completed_at, created_at, updated_at
const sessaoNaEtapa = (questionsAnswered: number) => ["sessao-1", DONA, 42, "active", questionsAnswered, 0, null, 1000, null, 1000, 1000];
// id, session_id, message_id, owner_id, contact_id, field_type, suggested_value,
// applied_value, tag_id, tag_is_new, confidence, status, actioned_at,
// actioned_by, undo_snapshot, created_at, updated_at
const cartaoPendente = (fieldType: string, valor: string) => [
  "sug-1", "sessao-1", "msg-ia", DONA, 42, fieldType, valor, null, null, 0, "0.900", "pending", null, null, null, 1000, 1000,
];

const consultas = () => estado.consultas as Consulta[];
const selectDaSessao = (c: Consulta) => c.sql.includes("from `enrichment_sessions`");
const selectDosPendentes = (c: Consulta) => c.sql.includes("from `enrichment_suggestions`") && c.sql.includes("`session_id` = ?");
const avancoDaSessao = (c: Consulta) => c.sql.startsWith("update `enrichment_sessions`") && c.sql.includes("`questions_answered` = ?");
const perguntasGravadas = () => consultas().filter(c => c.sql.startsWith("insert into `enrichment_messages`"));

// O valor de uma coluna num INSERT: lê a lista de colunas e a de VALUES do
// próprio SQL, para não depender da posição — coluna não informada sai como
// `default`, sem parâmetro, e deslocaria a contagem.
function valorDa(consulta: Consulta, coluna: string) {
  const partes = consulta.sql.match(/\(([^)]*)\) values \(([^)]*)\)/);
  expect(partes, `INSERT em: ${consulta.sql}`).not.toBeNull();
  const colunas = partes![1].split(",").map(s => s.trim().replace(/`/g, ""));
  const valores = partes![2].split(",").map(s => s.trim());
  let parametro = 0;
  for (let i = 0; i < colunas.length; i++) {
    const ehParametro = valores[i] === "?";
    if (colunas[i] === coluna) return ehParametro ? consulta.params[parametro] : valores[i];
    if (ehParametro) parametro++;
  }
  throw new Error(`coluna ${coluna} não está em: ${consulta.sql}`);
}

const respostaDaIA = (fieldType: string, valores: string[]) => ({
  choices: [{ message: { content: JSON.stringify({
    next_question: null,
    extracted_entities: valores.map(value => ({ field_type: fieldType, value, confidence: 0.9, is_complete: true })),
    pending_fields: [], session_status: "active", notes_for_user: "Confirma?",
  }) } }],
});

beforeEach(() => {
  estado.consultas = [];
  estado.sessao = null;
  estado.sugestao = null;
  estado.pendentes = [];
  estado.linhasDoAvanco = 1;
  invokeLLM.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("decidir o último cartão da etapa — o avanço exige a etapa LIDA, sem reler a sessão", () => {
  it("confirmar: o UPDATE leva questions_answered = etapa lida no WHERE e não há SELECT da sessão entre a checagem de pendentes e ele", async () => {
    estado.sessao = sessaoNaEtapa(2); // "o que oferece"
    estado.sugestao = cartaoPendente("assets", "porto");
    estado.pendentes = []; // o outro cartão já foi decidido

    const r = await caller.confirmSuggestion({ suggestionId: "sug-1" });

    expect(r).toMatchObject({ status: "applied", pendentesRestantes: 0, sessionComplete: false });
    expect(r.nextQuestion).toMatch(/procurando/i);

    const iPendentes = consultas().findIndex(selectDosPendentes);
    const iAvanco = consultas().findIndex(avancoDaSessao);
    expect(iPendentes).toBeGreaterThan(-1);
    expect(iAvanco).toBeGreaterThan(iPendentes);

    // SET questions_answered = 3 ... WHERE id AND owner_id AND status = 'active'
    // AND questions_answered = 2 — o 2 é o que o router leu, não uma releitura.
    const avanco = consultas()[iAvanco];
    expect(avanco.sql).toMatch(/where .*`questions_answered` = \?/);
    expect(avanco.params).toEqual(expect.arrayContaining([3, "sessao-1", DONA, "active", 2]));
    expect(avanco.params.indexOf(3)).toBeLessThan(avanco.params.indexOf(2));

    // Mutante "reler a sessão dentro do avanço" (o 2 → 4 de duas abas): um 2º
    // SELECT da sessão apareceria entre a checagem de pendentes e o UPDATE.
    expect(consultas().slice(iPendentes + 1, iAvanco).filter(selectDaSessao)).toHaveLength(0);
    expect(consultas().filter(selectDaSessao)).toHaveLength(1);

    // A pergunta seguinte foi gravada uma vez.
    expect(perguntasGravadas()).toHaveLength(1);
    expect(valorDa(perguntasGravadas()[0], "content")).toMatch(/procurando/i);
  });

  it("outra aba avançou primeiro (o UPDATE não pega linha): nextQuestion null, pendentesRestantes 0, nenhuma pergunta gravada, sem concluir", async () => {
    estado.sessao = sessaoNaEtapa(2);
    estado.sugestao = cartaoPendente("assets", "armazém");
    estado.pendentes = [];
    estado.linhasDoAvanco = 0;

    const r = await caller.confirmSuggestion({ suggestionId: "sug-1" });

    expect(r).toEqual({ success: true, status: "applied", nextQuestion: null, sessionComplete: false, pendentesRestantes: 0 });
    expect(perguntasGravadas()).toHaveLength(0);
    // Mutante "null → fim do roteiro": concluiria a sessão no meio.
    expect(consultas().some(c => c.sql.startsWith("update `enrichment_sessions`") && c.params.includes("completed"))).toBe(false);
  });

  it("ignorar o último: o mesmo UPDATE incrementa questions_skipped no SQL, sem ler o contador antes", async () => {
    estado.sessao = sessaoNaEtapa(2);
    estado.sugestao = cartaoPendente("assets", "porto");
    estado.pendentes = [];

    const r = await caller.ignoreSuggestion({ suggestionId: "sug-1" });

    expect(r).toMatchObject({ status: "ignored", pendentesRestantes: 0 });
    const avanco = consultas().find(avancoDaSessao)!;
    expect(avanco.sql).toMatch(/`questions_skipped` = [^,]*`questions_skipped` \+ 1/);
    expect(avanco.params).toEqual(expect.arrayContaining([3, 2]));
    expect(consultas().filter(selectDaSessao)).toHaveLength(1);
  });

  it("sobrando outro cartão da etapa, não há UPDATE da sessão nem pergunta nova", async () => {
    estado.sessao = sessaoNaEtapa(2);
    estado.sugestao = cartaoPendente("assets", "porto");
    estado.pendentes = [cartaoPendente("assets", "armazém")];

    const r = await caller.confirmSuggestion({ suggestionId: "sug-1" });

    expect(r).toMatchObject({ status: "applied", nextQuestion: null, pendentesRestantes: 1 });
    expect(consultas().some(avancoDaSessao)).toBe(false);
    expect(perguntasGravadas()).toHaveLength(0);
  });
});

describe("a ordem da conversa não depende do relógio da IA", () => {
  it("a resposta da usuária leva o created_at de ANTES de chamar a IA, mesmo gravada depois da resposta dela", async () => {
    const T0 = 1_700_000_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    estado.sessao = sessaoNaEtapa(0); // telefone
    invokeLLM.mockImplementation(async () => {
      vi.setSystemTime(T0 + 2_000); // a IA demorou 2 s
      return respostaDaIA("phone", ["11 99999-8888"]);
    });

    const r = await caller.sendMessage({ sessionId: "sessao-1", contactId: 42, content: "11 99999-8888" });

    expect(r.awaitingConfirmation).toBe(true);
    const gravadas = perguntasGravadas();
    expect(gravadas.map(c => valorDa(c, "role"))).toEqual(["user", "assistant"]);
    // Mutante "created_at lido na hora de gravar": os dois seriam T0 + 2000 e
    // a conversa reabriria com a resposta da IA antes da pergunta respondida.
    expect(valorDa(gravadas[0], "created_at")).toBe(T0);
    expect(valorDa(gravadas[1], "created_at")).toBe(T0 + 2_000);
    // A IA foi chamada ANTES de a mensagem da usuária ir para o banco.
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("getEnrichmentMessages desempata o mesmo instante: em ordem decrescente, a resposta da IA antes da mensagem da usuária", async () => {
    await db.getEnrichmentMessages("sessao-1", DONA, 10);

    const leitura = consultas().find(c => c.sql.includes("from `enrichment_messages`"))!;
    expect(leitura.sql).toMatch(COM_DONA);
    // Mutante "só created_at": duas mensagens gravadas no mesmo milissegundo
    // ("não sei" e a pergunta seguinte) voltariam na ordem que o banco quiser.
    expect(leitura.sql).toMatch(/order by `enrichment_messages`\.`created_at` desc, case when `enrichment_messages`\.`role` = 'user' then 0 else 1 end desc/i);
  });

  it("N cartões da mesma resposta nascem com created_at crescente, na ordem em que a IA os listou", async () => {
    const valores = ["mina de lítio", "fábrica de baterias", "patente de eletrólito"];

    await db.saveEnrichmentSuggestions(valores.map(suggestedValue => ({
      sessionId: "sessao-1", messageId: "msg-ia", ownerId: DONA, contactId: 42, fieldType: "assets", suggestedValue, confidence: 0.9,
    })));

    const inserts = consultas().filter(c => c.sql.startsWith("insert into `enrichment_suggestions`"));
    expect(inserts.map(c => valorDa(c, "suggested_value"))).toEqual(valores);
    const datas = inserts.map(c => valorDa(c, "created_at") as number);
    // Mutante "o mesmo now para os três": ao reabrir, a ordem seria a do banco.
    expect(datas[1]).toBeGreaterThan(datas[0]);
    expect(datas[2]).toBeGreaterThan(datas[1]);
  });
});

const COM_DONA = /`owner_id` = \?/;
