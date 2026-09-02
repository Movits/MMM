import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { goldProcedure } from "./_procedures";
import { invokeLLM } from "../_core/llm";
import {
  getDb,
  listOpportunities, getOpportunityById, createOpportunity,
  getDocumentsByOpportunity,
  expressInterest, getInterestsByOpportunity,
  toggleSaveOpportunity, getSavedOpportunities,
  createNotification,
} from "../db";
import { createAuditLog } from "../security";
import { opportunityMatches, opportunities as opportunitiesTable, users } from "../../drizzle/schema";

// ============================================================
// OPORTUNIDADES — CORE DA PLATAFORMA FRAUEN
// ============================================================
export const opportunitiesRouter = router({
  // Listar oportunidades (Prata vê apenas públicas; Ouro vê também confidenciais)
  list: protectedProcedure
    .input(z.object({
      type: z.enum(["offer", "demand", "investment", "partnership", "distribution", "other"]).optional(),
      sector: z.string().optional(),
      country: z.string().length(2).optional(),
      complianceLevel: z.enum(["green", "yellow", "orange", "red"]).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const isGold = ctx.user.role === "gold" || ctx.user.role === "admin" || ctx.user.role === "president";
      const opps = await listOpportunities({
        ...input,
        // Prata só vê oportunidades não confidenciais
        isConfidential: isGold ? undefined : false,
        viewerUserId: ctx.user.id,
      });
      return opps;
    }),

  // Detalhe de uma oportunidade
  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const opp = await getOpportunityById(input.id);
      if (!opp) throw new TRPCError({ code: "NOT_FOUND" });

      const isGold = ctx.user.role === "gold" || ctx.user.role === "admin" || ctx.user.role === "president";
      const isOwner = opp.publishedBy === ctx.user.id;
      const isStaff = ctx.user.role === "admin" || ctx.user.role === "president";

      // Oportunidades rejeitadas: só a criadora e staff podem ver
      if (opp.status === "rejected" && !isOwner && !isStaff) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Oportunidades pendentes: só a criadora e staff podem ver
      if (opp.status === "pending" && !isOwner && !isStaff) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Esta oportunidade ainda está aguardando validação pelas Presidentes." });
      }

      // Oportunidades confidenciais: só Ouro, admin, president ou a criadora
      if (opp.isConfidential && !isGold && !isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Esta oportunidade é de acesso restrito. Requer Status Ouro — reconhecimento institucional concedido pelas Presidentes." });
      }

      // Incrementar view count apenas para oportunidades ativas e quando não é a própria criadora
      if (opp.status === "active" && !isOwner) {
        const db = await getDb();
        if (db) await db.update(opportunitiesTable).set({ viewCount: (opp.viewCount ?? 0) + 1 }).where(eq(opportunitiesTable.id, input.id));
      }

      const docs = await getDocumentsByOpportunity(input.id, isGold || isOwner);
      return { ...opp, documents: docs };
    }),

  // Publicar nova oportunidade
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(10).max(300),
      description: z.string().min(30).max(5000),
      type: z.enum(["offer", "demand", "investment", "partnership", "distribution", "other"]),
      sector: z.string().optional(),
      country: z.string().length(2).optional(),
      region: z.string().optional(),
      tags: z.array(z.string()).max(10).default([]),
      isConfidential: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Análise de compliance pela IA
      let complianceLevel: "green" | "yellow" | "orange" | "red" | "pending" = "pending";
      let complianceExplanation = "";
      let suggestedDocuments: string[] = [];
      let frauenTrustScore = 50;

      try {
        const aiResponse = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você é a IA de Compliance e Due Diligence do ecossistema global "Mulheres que Movem o Mundo" (MMM OS).

Sua tarefa ao analisar uma oportunidade de negócio:
1. Identificar os riscos preliminares da transação (campo: riskAnalysis — parágrafo curto em português)
2. Sugerir documentos obrigatórios com justificativa de cada um (campo: suggestedDocuments — lista de até 6 itens, cada um com nome e justificativa separados por ": ")
3. Classificar o nível de confiança inicial com cor e justificativa (campo: complianceLevel + explanation)

Classificação de nível de confiança:
- "green": Verde (Altamente documentado) — oportunidade clara, setor estabelecido, informações completas
- "yellow": Amarelo (Boa documentação, precisa complementar) — legítima mas com pontos de atenção
- "orange": Laranja (Pouco documentado, necessita validação) — informações incompletas, setor de alto risco
- "red": Vermelho (Baixa confiabilidade) — promessas irreais, esquemas de pirâmide, produtos ilegais

Retorne um JSON estruturado com os campos: complianceLevel, explanation, riskAnalysis, suggestedDocuments (array de strings), trustScore (0-100).`,
            },
            {
              role: "user",
              content: `Analise esta oportunidade:\n\nTítulo: ${input.title}\nTipo: ${input.type}\nSetor: ${input.sector ?? "não informado"}\nDescrição: ${input.description}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "compliance_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  complianceLevel: { type: "string", enum: ["green", "yellow", "orange", "red"] },
                  explanation: { type: "string" },
                  riskAnalysis: { type: "string" },
                  suggestedDocuments: { type: "array", items: { type: "string" } },
                  trustScore: { type: "number" },
                },
                required: ["complianceLevel", "explanation", "riskAnalysis", "suggestedDocuments", "trustScore"],
                additionalProperties: false,
              },
            },
          },
        });
        const result = JSON.parse(aiResponse.choices[0].message.content as string);
        complianceLevel = result.complianceLevel;
        // Combina riskAnalysis + explanation para exibição completa no frontend
        complianceExplanation = result.riskAnalysis
          ? `**Análise de Risco:** ${result.riskAnalysis}\n\n**Status de Confiança:** ${result.explanation}`
          : result.explanation;
        suggestedDocuments = result.suggestedDocuments;
        frauenTrustScore = result.trustScore;
      } catch (e) {
        console.error("[Compliance AI] Erro:", e);
      }

      // Oportunidades RED são automaticamente rejeitadas
      const status = complianceLevel === "red" ? "rejected" : "pending";

      const id = await createOpportunity({
        publishedBy: ctx.user.id,
        title: input.title,
        description: input.description,
        type: input.type,
        sector: input.sector,
        country: input.country,
        region: input.region,
        tags: input.tags,
        isConfidential: input.isConfidential,
        complianceLevel,
        complianceExplanation,
        suggestedDocuments,
        frauenTrustScore,
        lastComplianceAt: new Date(),
        status,
      });

      await createAuditLog({ userId: ctx.user.id, action: "OPPORTUNITY_CREATE", resource: "opportunities", resourceId: String(id), status: "success", riskLevel: "low" });

      // A fila de validação era invisível: nada avisava a moderação de que uma
      // oportunidade nova esperava análise, e ela ficava parada indefinidamente.
      if (status === "pending") {
        try {
          const db = await getDb();
          if (db) {
            const moderadoras = await db
              .select({ id: users.id })
              .from(users)
              .where(inArray(users.role, ["president", "admin"]));
            for (const mod of moderadoras) {
              if (mod.id === ctx.user.id) continue;
              await createNotification({
                userId: mod.id,
                type: "system",
                title: "Nova oportunidade aguardando análise",
                body: `"${input.title.slice(0, 120)}" foi publicada e espera validação no painel.`,
                actionUrl: "/president",
              });
            }
          }
        } catch (e) {
          console.error("[Opportunities] Falha ao notificar a moderação:", e);
        }
      }

      return { id, complianceLevel, complianceExplanation, suggestedDocuments, status };
    }),

  // Demonstrar interesse em uma oportunidade
  expressInterest: protectedProcedure
    .input(z.object({
      opportunityId: z.number().int(),
      message: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await expressInterest(input.opportunityId, ctx.user.id, input.message);
      if (result.alreadyExists) throw new TRPCError({ code: "CONFLICT", message: "Você já demonstrou interesse nesta oportunidade" });
      return { success: true };
    }),

  // Listar interessados (apenas dona da oportunidade ou Ouro). Etapa 10: a
  // procedure era goldProcedure, o que tornava a guarda interna código morto
  // E trancava a própria criadora comum para fora da sua oportunidade — com
  // protectedProcedure a guarda "dona OU Ouro" passa a ser quem decide.
  getInterests: protectedProcedure
    .input(z.object({ opportunityId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const opp = await getOpportunityById(input.opportunityId);
      if (!opp) throw new TRPCError({ code: "NOT_FOUND" });
      if (opp.publishedBy !== ctx.user.id && ctx.user.role !== "admin" && ctx.user.role !== "president" && ctx.user.role !== "gold") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas a criadora da oportunidade pode ver as interessadas" });
      }
      return getInterestsByOpportunity(input.opportunityId);
    }),

  // Salvar/remover oportunidade dos favoritos
  toggleSave: protectedProcedure
    .input(z.object({ opportunityId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return toggleSaveOpportunity(ctx.user.id, input.opportunityId);
    }),

  // Listar oportunidades salvas
  saved: protectedProcedure.query(async ({ ctx }) => {
    return getSavedOpportunities(ctx.user.id);
  }),

  // IA 4.1 — Análise dinâmica no cadastro: pergunta + sugestão de documentos por nicho
  analyzeForCompliance: protectedProcedure
    .input(z.object({
      title: z.string().min(3).max(300),
      sector: z.string().optional(),
      description: z.string().min(10),
      type: z.enum(["offer", "demand", "investment", "partnership", "distribution", "other"]),
    }))
    .mutation(async ({ input }) => {
      try {
        const aiResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você é a IA de Compliance e Due Diligence do ecossistema global "Mulheres que Movem o Mundo" (MMM OS).
Analise a oportunidade de negócio e retorne um JSON com:
- dynamicQuestion: uma pergunta direta e específica para a usuária sobre como comprovar que esta oportunidade existe (ex: "Você possui contrato de fornecimento ou carta de intenção assinada?")
- suggestedDocuments: lista de 3 a 5 documentos específicos para este nicho/setor (ex: para Commodities → SGS, BL, Contrato de Fornecimento; para Tecnologia → Licença de Software, Termos de Uso, NDA)
- documentJustifications: justificativa breve para cada documento sugerido
- riskLevel: nível de risco preliminar ("low", "medium", "high")
- riskSummary: parágrafo curto sobre os riscos identificados`,
            },
            {
              role: "user",
              content: `Título: ${input.title}\nSetor: ${input.sector ?? "Geral"}\nTipo: ${input.type}\nDescrição: ${input.description}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "compliance_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  dynamicQuestion: { type: "string" },
                  suggestedDocuments: { type: "array", items: { type: "string" } },
                  documentJustifications: { type: "array", items: { type: "string" } },
                  riskLevel: { type: "string", enum: ["low", "medium", "high"] },
                  riskSummary: { type: "string" },
                },
                required: ["dynamicQuestion", "suggestedDocuments", "documentJustifications", "riskLevel", "riskSummary"],
                additionalProperties: false,
              },
            },
          },
        });
        return JSON.parse(aiResp.choices[0].message.content as string);
      } catch {
        return {
          dynamicQuestion: "Quais documentos comprovam que esta oportunidade realmente existe?",
          suggestedDocuments: ["Contrato ou Proposta Comercial", "Certidão de Registro da Empresa", "Carta de Intenção (LOI)"],
          documentJustifications: ["Formaliza a oferta comercial", "Valida a existência legal da empresa", "Demonstra intenção formal de negócio"],
          riskLevel: "medium",
          riskSummary: "Análise preliminar indisponível. Recomendamos anexar documentação básica para aumentar a confiabilidade.",
        };
      }
    }),

  // Sugerir documentos faltantes por tipo de oportunidade
  suggestDocuments: protectedProcedure
    .input(z.object({
      opportunityType: z.enum(["offer", "demand", "investment", "partnership", "distribution", "other"]),
      sector: z.string().optional(),
      existingDocuments: z.array(z.string()).default([]),
    }))
    .query(async ({ input }) => {
      try {
        const aiResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `Você é o sistema de compliance FRAUEN. Sugira documentos necessários para validar uma oportunidade de negócio.\nRetorne JSON com:\n- suggestions: lista de até 6 documentos recomendados\n- priority: lista de prioridades correspondentes ("essential", "recommended", "optional")\n- reason: explicação breve de por que cada documento é importante`,
            },
            {
              role: "user",
              content: `Tipo: ${input.opportunityType}\nSetor: ${input.sector ?? "geral"}\nDocumentos já enviados: ${input.existingDocuments.join(", ") || "nenhum"}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "document_suggestions",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  suggestions: { type: "array", items: { type: "string" } },
                  priority: { type: "array", items: { type: "string", enum: ["essential", "recommended", "optional"] } },
                  reason: { type: "array", items: { type: "string" } },
                },
                required: ["suggestions", "priority", "reason"],
                additionalProperties: false,
              },
            },
          },
        });
        return JSON.parse(aiResp.choices[0].message.content as string);
      } catch {
        return {
          suggestions: ["Contrato ou Proposta Comercial", "Certidão de Registro da Empresa", "Comprovante de Capacidade Financeira"],
          priority: ["essential", "essential", "recommended"],
          reason: ["Formaliza a oferta", "Valida a existência legal da empresa", "Demonstra capacidade de execução"],
        };
      }
    }),

  // Minhas oportunidades publicadas
  myOpportunities: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const { opportunities } = await import("../../drizzle/schema");
    return db.select().from(opportunities)
      .where(eq(opportunities.publishedBy, ctx.user.id))
      .orderBy(desc(opportunities.createdAt));
  }),

  // Upload de documento para oportunidade
  uploadDocument: protectedProcedure
    .input(z.object({
      opportunityId: z.number().int(),
      name: z.string().min(1).max(300),
      fileKey: z.string().min(1),
      fileUrl: z.string().min(1),
      mimeType: z.string().optional(),
      fileSize: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { opportunities, opportunityDocuments } = await import("../../drizzle/schema");
      const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, input.opportunityId)).limit(1);
      if (!opp) throw new TRPCError({ code: "NOT_FOUND", message: "Oportunidade não encontrada" });
      if (opp.publishedBy !== ctx.user.id && !['admin', 'president', 'gold'].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Apenas a criadora pode adicionar documentos" });
      }
      const [doc] = await db.insert(opportunityDocuments).values({
        opportunityId: input.opportunityId,
        uploadedBy: ctx.user.id,
        name: input.name,
        fileKey: input.fileKey,
        url: input.fileUrl,
        mimeType: input.mimeType,
        sizeBytes: input.fileSize,
      }).$returningId();
      // Recalcular compliance após novo documento (best-effort)
      try {
        const docs = await db.select().from(opportunityDocuments).where(eq(opportunityDocuments.opportunityId, input.opportunityId));
        const docNames = docs.map(d => d.name).join(", ");
        const aiResp = await invokeLLM({
          messages: [
            { role: "system", content: `Você é a IA de Compliance e Due Diligence do ecossistema global "Mulheres que Movem o Mundo" (MMM OS). Reclassifique a oportunidade considerando os documentos enviados. Retorne JSON com: complianceLevel ("green"/"yellow"/"orange"/"red"), riskAnalysis (parágrafo curto sobre riscos), explanation (justificativa do nível de confiança), trustScore (0-100).` },
            { role: "user", content: `Título: ${opp.title}\nDescrição: ${opp.description}\nDocumentos enviados: ${docNames || 'nenhum'}` },
          ],
          response_format: { type: "json_schema", json_schema: { name: "reanalysis", strict: true, schema: { type: "object", properties: { complianceLevel: { type: "string", enum: ["green","yellow","orange","red"] }, riskAnalysis: { type: "string" }, explanation: { type: "string" }, trustScore: { type: "number" } }, required: ["complianceLevel","riskAnalysis","explanation","trustScore"], additionalProperties: false } } },
        });
        const r = JSON.parse(aiResp.choices[0].message.content as string);
        const reanalysisExplanation = r.riskAnalysis
          ? `**Análise de Risco:** ${r.riskAnalysis}\n\n**Status de Confiança:** ${r.explanation}`
          : r.explanation;
        await db.update(opportunities).set({
          frauenTrustScore: r.trustScore,
          complianceLevel: r.complianceLevel as any,
          complianceExplanation: reanalysisExplanation,
          lastComplianceAt: new Date(),
        }).where(eq(opportunities.id, input.opportunityId));

        // Alerta de subida de nível de confiabilidade
        const levelOrder = { red: 0, orange: 1, yellow: 2, green: 3 };
        const oldLevel = (opp.complianceLevel ?? 'red') as string;
        const newLevel = r.complianceLevel as string;
        const oldRank = levelOrder[oldLevel as keyof typeof levelOrder] ?? 0;
        const newRank = levelOrder[newLevel as keyof typeof levelOrder] ?? 0;
        if (newRank > oldRank) {
          const levelLabels: Record<string, string> = {
            red: '🔴 Baixa Confiabilidade',
            orange: '🟠 Necessita Validação',
            yellow: '🟡 Confiabilidade Média',
            green: '🟢 Alta Confiabilidade',
          };
          const scoreMsg = `Frauen Trust Score: ${Math.round(r.trustScore)}%`;
          await createNotification({
            userId: opp.publishedBy,
            type: 'compliance_update',
            title: `⬆️ Sua oportunidade subiu de nível!`,
            body: `"${opp.title}" passou de ${levelLabels[oldLevel] ?? oldLevel} para ${levelLabels[newLevel] ?? newLevel}. ${scoreMsg}`,
            actionUrl: `/opportunities/${input.opportunityId}`,
          });
        }
      } catch { /* compliance recalc is best-effort */ }
      await createAuditLog({ userId: ctx.user.id, action: "DOCUMENT_UPLOAD", resource: "opportunity_documents", resourceId: String(doc.id), status: "success", riskLevel: "low" });
      return { success: true, documentId: doc.id };
    }),

  // Remover oportunidade indesejada — apenas Ouro
  deleteOpportunity: goldProcedure
    .input(z.object({
      opportunityId: z.number().int(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { opportunities } = await import("../../drizzle/schema");
      // Verificar se a oportunidade existe
      const [opp] = await db.select({ id: opportunities.id, title: opportunities.title, publishedBy: opportunities.publishedBy })
        .from(opportunities).where(eq(opportunities.id, input.opportunityId)).limit(1);
      if (!opp) throw new TRPCError({ code: "NOT_FOUND" });
      // Marcar como removida ao invés de deletar fisicamente
      await db.update(opportunities)
        .set({ status: "removed" })
        .where(eq(opportunities.id, input.opportunityId));
      await createAuditLog({
        userId: ctx.user.id,
        action: "GOLD_REMOVE_OPPORTUNITY",
        resource: "opportunities",
        resourceId: String(input.opportunityId),
        details: { reason: input.reason, opportunityTitle: opp.title },
        status: "success",
        riskLevel: "medium",
      });
      return { success: true };
    }),

  // Matches de oportunidades (IA conecta complementares) — apenas Ouro
  matches: goldProcedure
    .input(z.object({ opportunityId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const { opportunities } = await import("../../drizzle/schema");
      return db.select({
        match: opportunityMatches,
        opportunity: opportunities,
      })
        .from(opportunityMatches)
        .innerJoin(opportunities, eq(opportunities.id, opportunityMatches.opportunityBId))
        .where(eq(opportunityMatches.opportunityAId, input.opportunityId))
        .orderBy(desc(opportunityMatches.score))
        .limit(10);
    }),
});
