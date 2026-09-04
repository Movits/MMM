import { describe, expect, it, vi, beforeEach } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O fluxo da conversa de enriquecimento — os dois modos de morrer em silêncio.
 *
 * A conferência das etapas achou que a conversa travava de dois jeitos, ambos
 * sem sinal nenhum para a usuária:
 *
 *   1. IA extraía com confiança < 0.7 → o cartão era descartado mas a resposta
 *      dizia "aguardando confirmação" → a tela escondia o campo de digitar e
 *      pedia para confirmar um cartão inexistente. Só recarregar destravava.
 *   2. IA fora do ar → o erro era engolido (`.catch(() => null)`) e o fluxo
 *      repetia a MESMA pergunta para sempre, como se a usuária não tivesse
 *      sido clara.
 *
 * Estes testes exercitam o router de verdade (createCaller), com a IA e o
 * banco simulados. O contrato central: a conversa NUNCA responde
 * `awaitingConfirmation: true` sem pelo menos um cartão junto.
 */

const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

const saveEnrichmentMessage = vi.fn(async () => "msg-1");
const saveEnrichmentSuggestions = vi.fn(async (itens: unknown[]) => itens.map((_, i) => `sug-${i}`));

vi.mock("./db", async () => ({
  getDb: vi.fn(async () => null),
  // Derivado do getDb acima, como no db.ts real: sem banco, lança.
  exigirDb: async () => { throw new (await import("./banco-indisponivel")).BancoIndisponivel(); },
  getEnrichmentSessionById: vi.fn(async () => ({
    id: "sessao-1", contactId: 42, status: "active", questionsAnswered: 2, summary: null,
  })),
  getEnrichmentMessages: vi.fn(async () => []),
  saveEnrichmentMessage: (...args: unknown[]) => saveEnrichmentMessage(...(args as [])),
  saveEnrichmentSuggestions: (...args: unknown[]) => saveEnrichmentSuggestions(...(args as [unknown[]])),
  advanceEnrichmentSession: vi.fn(async () => ({ questionsAnswered: 3 })),
  completeEnrichmentSession: vi.fn(),
  getActiveEnrichmentSession: vi.fn(async () => null),
  createEnrichmentSession: vi.fn(),
  getEnrichmentSuggestion: vi.fn(async () => null),
  applyEnrichmentSuggestion: vi.fn(async () => true),
  ignoreEnrichmentSuggestion: vi.fn(async () => true),
  getEnrichmentHistory: vi.fn(async () => []),
  // Sem cartão pendente: o roteiro segue; a pendência tem teste próprio (enriquecimento-pendencia.test.ts).
  getPendingEnrichmentSuggestions: vi.fn(async () => []),
}));

const { enrichmentRouter } = await import("./routers/enrichment");

const ctx = {
  user: { id: 1, openId: "email_teste", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

// questionsAnswered: 2 → a pergunta da vez é a de "assets" (3ª do roteiro).
const pergunta = { sessionId: "sessao-1", contactId: 42, content: "Ela tem uma fábrica de calçados" };

const respostaDaIA = (confidence: number) => ({
  choices: [{ message: { content: JSON.stringify({
    next_question: null,
    extracted_entities: [{ field_type: "assets", value: "fábrica de calçados", confidence, is_complete: true }],
    pending_fields: [],
    session_status: "active",
    notes_for_user: "Confirma: fábrica de calçados?",
  }) } }],
});

describe("Enriquecimento — a conversa nunca trava em silêncio", () => {
  beforeEach(() => {
    invokeLLM.mockReset();
    saveEnrichmentMessage.mockClear();
    saveEnrichmentSuggestions.mockClear();
  });

  it("caminho feliz: confiança alta vira cartão e aí sim espera confirmação", async () => {
    invokeLLM.mockResolvedValue(respostaDaIA(0.9));
    const caller = enrichmentRouter.createCaller(ctx);

    const r = await caller.sendMessage(pergunta);

    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].suggestedValue).toBe("fábrica de calçados");
    expect(r.awaitingConfirmation).toBe(true);
  });

  it("confiança baixa NÃO congela: sem cartão, o campo de digitar continua aberto", async () => {
    // Antes: awaitingConfirmation true com zero cartões → tela travada.
    invokeLLM.mockResolvedValue(respostaDaIA(0.3));
    const caller = enrichmentRouter.createCaller(ctx);

    const r = await caller.sendMessage(pergunta);

    expect(r.suggestions).toHaveLength(0);
    expect(r.awaitingConfirmation).toBe(false);
    expect(r.aiResponse).toMatch(/de outro jeito/i);
    expect(saveEnrichmentSuggestions).not.toHaveBeenCalled();
  });

  it("IA fora do ar: diz a verdade em vez de repetir a pergunta para sempre", async () => {
    invokeLLM.mockRejectedValue(new Error("LLM_API_URL não definida."));
    const caller = enrichmentRouter.createCaller(ctx);

    const r = await caller.sendMessage(pergunta);

    expect(r.awaitingConfirmation).toBe(false);
    expect(r.aiResponse).toMatch(/indisponível/i);
    // e NÃO é a pergunta do roteiro repetida como se a usuária não tivesse sido clara
    expect(r.aiResponse).not.toMatch(/pode oferecer/i);
  });

  it("o contrato: awaitingConfirmation true implica pelo menos um cartão", async () => {
    // A invariante que impede a tela de travar, seja qual for o caminho.
    for (const confidence of [0.9, 0.69, 0.0]) {
      invokeLLM.mockResolvedValue(respostaDaIA(confidence));
      const caller = enrichmentRouter.createCaller(ctx);
      const r = await caller.sendMessage(pergunta);
      if (r.awaitingConfirmation) expect(r.suggestions.length).toBeGreaterThan(0);
    }
  });
});
