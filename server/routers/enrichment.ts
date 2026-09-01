import { TRPCError } from "@trpc/server";
import { hasValidConsent } from "./consent";
import { recalculatePrivateMatches } from "../match-service";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getActiveEnrichmentSession, createEnrichmentSession, getEnrichmentMessages,
  saveEnrichmentMessage, saveEnrichmentSuggestions, getEnrichmentSuggestion,
  applyEnrichmentSuggestion, ignoreEnrichmentSuggestion, completeEnrichmentSession,
  getEnrichmentHistory, getEnrichmentSessionById, advanceEnrichmentSession,
} from "../db";
import { ENRICHMENT_STEPS, getEnrichmentStep, isExpectedField, isSkipResponse } from "../enrichment-flow";

// ─── Módulo de Enriquecimento com IA (Etapa 4) ────────────────────────────────
export const enrichmentRouter = router({
  // Verificar sessão ativa de um contato
  getActiveSession: protectedProcedure
    .input(z.object({ contactId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      return getActiveEnrichmentSession(ctx.user.openId, input.contactId);
    }),

  // Iniciar sessão de enriquecimento
  startSession: protectedProcedure
    .input(z.object({ contactId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getActiveEnrichmentSession(ctx.user.openId, input.contactId);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "SESSION_ALREADY_ACTIVE" });
      const sessionId = await createEnrichmentSession(ctx.user.openId, input.contactId);
      const firstQuestion = ENRICHMENT_STEPS[0].question;
      const msgId = await saveEnrichmentMessage({
        sessionId, ownerId: ctx.user.openId, role: "assistant", content: firstQuestion,
        metadata: { questionIndex: 0, fieldType: ENRICHMENT_STEPS[0].fieldType },
      });
      return { sessionId, firstQuestion, firstMessageId: msgId };
    }),

  // Enviar mensagem e receber resposta da IA
  sendMessage: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      contactId: z.number().int(),
      content:   z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await getEnrichmentSessionById(input.sessionId, ctx.user.openId);
      if (!session || session.contactId !== input.contactId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SESSION_NOT_FOUND" });
      }
      if (session.status !== "active") {
        return { messageId: null, aiResponse: null, suggestions: [], sessionComplete: true, completionSummary: session.summary, awaitingConfirmation: false };
      }
      const step = getEnrichmentStep(session.questionsAnswered ?? 0);
      if (!step) {
        await completeEnrichmentSession(input.sessionId, ctx.user.openId, "Cadastro enriquecido com sucesso!");
        return { messageId: null, aiResponse: null, suggestions: [], sessionComplete: true, completionSummary: "Cadastro enriquecido com sucesso!", awaitingConfirmation: false };
      }

      // Salvar mensagem da usuária apenas uma vez para a pergunta atual.
      const userMsgId = await saveEnrichmentMessage({
        sessionId: input.sessionId, ownerId: ctx.user.openId, role: "user", content: input.content,
      });

      // "Não sei" avança diretamente sem abrir confirmação nem repetir a pergunta anterior.
      if (isSkipResponse(input.content)) {
        const advanced = await advanceEnrichmentSession(input.sessionId, ctx.user.openId, true);
        const nextStep = getEnrichmentStep(advanced?.questionsAnswered ?? ENRICHMENT_STEPS.length);
        if (!nextStep) {
          await completeEnrichmentSession(input.sessionId, ctx.user.openId, "Cadastro enriquecido com sucesso!");
          return { messageId: null, aiResponse: null, suggestions: [], sessionComplete: true, completionSummary: "Cadastro enriquecido com sucesso!", awaitingConfirmation: false };
        }
        const messageId = await saveEnrichmentMessage({
          sessionId: input.sessionId, ownerId: ctx.user.openId, role: "assistant", content: nextStep.question,
          metadata: { questionIndex: advanced?.questionsAnswered, fieldType: nextStep.fieldType, skippedPrevious: true },
        });
        return { messageId, aiResponse: nextStep.question, suggestions: [], sessionComplete: false, completionSummary: null, awaitingConfirmation: false };
      }

      // Buscar histórico das últimas 10 mensagens (em ordem cronológica)
      const history = await getEnrichmentMessages(input.sessionId, ctx.user.openId, 10);
      const historyAsc = [...history].reverse();

      const { invokeLLM } = await import("../_core/llm");
      const systemPrompt = `Você é o Assistente de Enriquecimento do MMM. Sua única função é extrair dados estruturados de respostas em português e conduzir um roteiro de 6 perguntas.

ROTEIRO OBRIGATÓRIO (nunca fuja disso):
1. phone → "Qual é o telefone dele/dela?"
2. company → "Em qual empresa trabalha?"
3. assets → "O que essa pessoa pode oferecer? (ex: mina, fábrica, patente, acesso)"
4. needs → "O que ela está procurando? (ex: investidores, parceiros, compradores)"
5. how_met → "Como vocês se conheceram?"
6. relationship_type → "O relacionamento é pessoal, profissional ou ambos?"

REGRAS DE OURO:
- Se o usuário responder algo relevante a uma pergunta do roteiro, EXTRAIA a entidade imediatamente.
- Se a resposta for vaga (ex: "tem uma empresa"), PERGUNTE O NOME em vez de aceitar.
- Se o usuário disser "não sei", pule para a próxima pergunta do roteiro.
- NUNCA diga "Pode me contar mais sobre esta pessoa?" — isso é proibido. Seja específico.
- SEMPRE responda em JSON válido. NUNCA adicione texto fora do JSON.

NESTE TURNO, extraia SOMENTE o campo "${step.fieldType}". Não avance o roteiro; a interface avançará após uma única confirmação da usuária.
FORMATO DE SAÍDA (JSON obrigatório):
{"next_question": null, "extracted_entities": [{"field_type": "${step.fieldType}", "value": "valor extraído da resposta", "confidence": 0.9, "is_complete": true}], "pending_fields": ["array dos campos ainda não respondidos"], "session_status": "active", "notes_for_user": "texto curto e direto para confirmar o valor, máximo 15 palavras"}`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...historyAsc.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      let falhaDaIA: string | null = null;
      const aiResp = await invokeLLM({ messages }).catch((erro: unknown) => {
        falhaDaIA = erro instanceof Error ? erro.message : String(erro);
        return null;
      });

      // IA fora do ar NÃO é "não entendi". A versão anterior engolia o erro e
      // caía no ramo que repete a pergunta — a usuária respondia para sempre,
      // recebendo a mesma pergunta, sem nenhum sinal de que o problema era o
      // sistema. Dizer a verdade custa uma frase.
      if (falhaDaIA !== null) {
        console.warn("[Enriquecimento] IA indisponível:", falhaDaIA);
        const aviso =
          "O assistente de IA está indisponível neste momento, então sua resposta ainda não foi processada. Tente de novo em instantes.";
        const messageId = await saveEnrichmentMessage({
          sessionId: input.sessionId, ownerId: ctx.user.openId, role: "assistant", content: aviso,
          metadata: { questionIndex: session.questionsAnswered, fieldType: step.fieldType, aiUnavailable: true },
        });
        return { messageId, aiResponse: aviso, suggestions: [], sessionComplete: false, completionSummary: null, awaitingConfirmation: false };
      }

      let aiText = `Confirme esta informação para continuar.`;
      let extracted: Array<{ field_type: string; value: string; confidence: number; display_label?: string; is_complete?: boolean }> = [];
      if (aiResp?.choices?.[0]?.message?.content) {
        try {
          const rawContent = aiResp.choices[0].message.content as string;
          const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
          if (parsed.notes_for_user) aiText = parsed.notes_for_user;
          if (parsed.extracted_entities) extracted = parsed.extracted_entities;
        } catch { /* usa defaults */ }
      }

      // Não aceitar sugestões de pergunta anterior/seguinte: uma confirmação por etapa.
      extracted = extracted.filter(entity => isExpectedField(entity.field_type, step.fieldType) && entity.value?.trim());
      if (extracted.length > 1) extracted = [extracted[0]];
      if (extracted.length === 0) {
        const repeatQuestion = step.fieldType === "company"
          ? "Qual é o nome da empresa em que trabalha?"
          : step.question;
        const messageId = await saveEnrichmentMessage({
          sessionId: input.sessionId, ownerId: ctx.user.openId, role: "assistant", content: repeatQuestion,
          metadata: { questionIndex: session.questionsAnswered, fieldType: step.fieldType, needsClarification: true },
        });
        return { messageId, aiResponse: repeatQuestion, suggestions: [], sessionComplete: false, completionSummary: null, awaitingConfirmation: false };
      }

      // Só vira cartão o que tem confiança >= 0.7 — e isso é decidido ANTES de
      // salvar a resposta. A versão anterior decidia depois: devolvia
      // "aguardando confirmação" com zero cartões, a tela escondia o campo de
      // digitar e pedia para confirmar algo que não existia. Só recarregar a
      // página destravava a conversa.
      const suggestions = extracted.filter(e => e.confidence >= 0.7);
      if (suggestions.length === 0) {
        const pedido = "Não tenho certeza se entendi. Pode dizer de outro jeito?";
        const messageId = await saveEnrichmentMessage({
          sessionId: input.sessionId, ownerId: ctx.user.openId, role: "assistant", content: pedido,
          metadata: { questionIndex: session.questionsAnswered, fieldType: step.fieldType, needsClarification: true, lowConfidence: true },
        });
        return { messageId, aiResponse: pedido, suggestions: [], sessionComplete: false, completionSummary: null, awaitingConfirmation: false };
      }

      // Salvar resposta da IA
      const aiMsgId = await saveEnrichmentMessage({
        sessionId: input.sessionId, ownerId: ctx.user.openId, role: "assistant", content: aiText,
        metadata: { extracted_entities: extracted, questionIndex: session.questionsAnswered, fieldType: step.fieldType, awaitingConfirmation: true },
      });

      const suggestionIds = await saveEnrichmentSuggestions(suggestions.map(e => ({
        sessionId: input.sessionId, messageId: aiMsgId, ownerId: ctx.user.openId,
        contactId: input.contactId, fieldType: e.field_type, suggestedValue: e.value,
        confidence: e.confidence,
      })));

      return {
        messageId: aiMsgId,
        aiResponse: aiText,
        suggestions: suggestions.map((e, i) => ({
          id: suggestionIds[i] ?? "",
          fieldType: e.field_type,
          suggestedValue: e.value,
          confidence: e.confidence,
          displayLabel: e.display_label,
          status: "pending",
        })),
        sessionComplete: false,
        completionSummary: null,
        awaitingConfirmation: true,
      };
    }),

  // Confirmar sugestão
  confirmSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string(), editedValue: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await applyEnrichmentSuggestion(input.suggestionId, ctx.user.openId, input.editedValue);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "SUGGESTION_NOT_FOUND" });
      const sug = await getEnrichmentSuggestion(input.suggestionId, ctx.user.openId);
      if (!sug) return { success: true, status: "applied", nextQuestion: null, sessionComplete: false };

      // A resposta acabou de virar "o que possui" ou "o que procura": recalcular
      // aqui é o que fecha o circuito automático — a pessoa conversa, o item
      // entra, o match nasce, sem passar pela tela de matches.
      //
      // Etapa 11: o recálculo é CRUZAMENTO, e cruzamento exige o termo aceito.
      // Sem consentimento vigente, a resposta fica gravada no contato (isso é
      // dado da agenda, não cruzamento) e o recálculo acontece quando a pessoa
      // autorizar e clicar em atualizar. Falha de recálculo não desfaz o aceite
      // da sugestão: o dado dela já está seguro.
      if (sug.fieldType === "assets" || sug.fieldType === "needs") {
        try {
          if (await hasValidConsent(ctx.user.id, "termo_smart_match")) {
            await recalculatePrivateMatches(ctx.user.openId, ctx.user.email);
          }
        } catch (erro) {
          console.warn("[Enriquecimento] Recálculo adiado:", erro instanceof Error ? erro.message : erro);
        }
      }

      const advanced = await advanceEnrichmentSession(sug.sessionId, ctx.user.openId, false);
      const nextStep = getEnrichmentStep(advanced?.questionsAnswered ?? ENRICHMENT_STEPS.length);
      if (!nextStep) {
        await completeEnrichmentSession(sug.sessionId, ctx.user.openId, "Cadastro enriquecido com sucesso!");
        return { success: true, status: "applied", nextQuestion: null, sessionComplete: true };
      }
      const nextMsgId = await saveEnrichmentMessage({
        sessionId: sug.sessionId, ownerId: ctx.user.openId, role: "assistant", content: nextStep.question,
        metadata: { questionIndex: advanced?.questionsAnswered, fieldType: nextStep.fieldType },
      });
      return { success: true, status: "applied", nextQuestion: nextStep.question, nextMessageId: nextMsgId, sessionComplete: false };
    }),

  // Ignorar sugestão
  ignoreSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await ignoreEnrichmentSuggestion(input.suggestionId, ctx.user.openId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "SUGGESTION_NOT_FOUND" });
      const sug = await getEnrichmentSuggestion(input.suggestionId, ctx.user.openId);
      if (!sug) return { success: true, status: "ignored", nextQuestion: null, sessionComplete: false };

      const advanced = await advanceEnrichmentSession(sug.sessionId, ctx.user.openId, true);
      const nextStep = getEnrichmentStep(advanced?.questionsAnswered ?? ENRICHMENT_STEPS.length);
      if (!nextStep) {
        await completeEnrichmentSession(sug.sessionId, ctx.user.openId, "Cadastro enriquecido com sucesso!");
        return { success: true, status: "ignored", nextQuestion: null, sessionComplete: true };
      }
      const nextMsgId = await saveEnrichmentMessage({
        sessionId: sug.sessionId, ownerId: ctx.user.openId, role: "assistant", content: nextStep.question,
        metadata: { questionIndex: advanced?.questionsAnswered, fieldType: nextStep.fieldType },
      });
      return { success: true, status: "ignored", nextQuestion: nextStep.question, nextMessageId: nextMsgId, sessionComplete: false };
    }),

  // Concluir sessão manualmente
  completeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await completeEnrichmentSession(input.sessionId, ctx.user.openId, "Sessão concluída pela usuária.");
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "SESSION_NOT_FOUND" });
      return { success: true };
    }),

  // Histórico de enriquecimento de um contato
  getHistory: protectedProcedure
    .input(z.object({ contactId: z.number().int(), page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.limit;
      return getEnrichmentHistory(ctx.user.openId, input.contactId, input.limit, offset);
    }),

  // Buscar mensagens de uma sessão
  getMessages: protectedProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const msgs = await getEnrichmentMessages(input.sessionId, ctx.user.openId, input.limit);
      return [...msgs].reverse(); // cronológica
    }),
});
