/**
 * SIVC — Sistema Inteligente de Verificação e Classificação de Usuários
 * Pipeline: Recebimento → Parsing → OCR → Cross-Checking → Scoring → State Machine → Relatório
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getRequestIp } from "../password-reset-security";

// ─── Tabela de Pesos de Confiança (conforme especificação) ───────────────────
const CONFIDENCE_WEIGHTS = {
  gov_api: 100,        // API governamental direta
  open_finance: 98,    // Open Finance
  ocr_100: 95,         // OCR com match 100%
  official_site: 90,   // Site oficial institucional
  news_media: 75,      // Portais de notícias
  social_media: 30,    // Redes sociais
  declaration_only: 5, // Apenas declaração textual
} as const;

// ─── Módulos obrigatórios para nível Prata ───────────────────────────────────
const MANDATORY_MODULES = ["identity"] as const;

// ─── Status de ciclo de vida do dado ────────────────────────────────────────
type CheckStatus = "verified" | "partial" | "analyzing" | "insufficient" | "unverified" | "inconsistent";

const STATUS_EMOJI: Record<CheckStatus, string> = {
  verified: "🟢",
  partial: "🟡",
  analyzing: "🔵",
  insufficient: "🟠",
  unverified: "🔴",
  inconsistent: "⚫",
};

// ─── Definição dos módulos e campos ─────────────────────────────────────────
const SIVC_MODULES = {
  identity: {
    label: "Identidade e Contato",
    description: "Nome completo, CPF, documento de identidade, endereço, telefone e e-mail",
    mandatory: true,
    fields: ["full_name", "cpf", "birth_date", "document_rg_cnh", "address", "phone", "email"],
    docTypes: ["RG", "CNH", "Passaporte", "Comprovante de Endereço"],
  },
  corporate: {
    label: "Corporativo e Societário",
    description: "Razão Social, CNPJ, situação cadastral, quadro societário",
    mandatory: false,
    fields: ["company_name", "cnpj", "cnae", "qsa_link"],
    docTypes: ["Contrato Social", "Cartão CNPJ", "Certidão da Junta Comercial"],
  },
  finance: {
    label: "Finanças Corporativas",
    description: "Faturamento, balanço patrimonial, DRE, patrimônio líquido",
    mandatory: false,
    fields: ["monthly_revenue", "annual_revenue", "net_worth"],
    docTypes: ["Balanço Patrimonial", "DRE", "Declaração Fiscal", "Extrato Open Finance"],
  },
  employment: {
    label: "Vínculo Empregatício",
    description: "Empregador, cargo, data de admissão, salário",
    mandatory: false,
    fields: ["employer", "position", "admission_date", "salary"],
    docTypes: ["Holerite", "Contrato de Trabalho", "Extrato eSocial"],
  },
  professional_council: {
    label: "Conselhos Profissionais",
    description: "Registros em OAB, CRM, CREA, CRP, CRC e outros",
    mandatory: false,
    fields: ["council_name", "council_number", "council_status"],
    docTypes: ["Carteira do Conselho", "Certidão de Regularidade"],
  },
  academic: {
    label: "Formação Acadêmica",
    description: "Instituição, curso, nível de graduação, certificações",
    mandatory: false,
    fields: ["institution", "course", "degree_level", "graduation_year"],
    docTypes: ["Diploma", "Histórico Escolar", "Certificado"],
  },
  assets: {
    label: "Ativos Imobiliários e Veículos",
    description: "Imóveis, veículos, matrículas, RENAVAM",
    mandatory: false,
    fields: ["property_address", "property_registration", "vehicle_plate", "vehicle_renavam"],
    docTypes: ["Certidão de Matrícula", "CRLV Digital", "Escritura"],
  },
  financial_assets: {
    label: "Patrimônio Financeiro",
    description: "Investimentos, saldos, IR, dívidas — patrimônio líquido estimado",
    mandatory: false,
    fields: ["investments", "bank_balance", "debts", "net_worth_calculated"],
    docTypes: ["DIRPF", "Informe de Rendimentos", "Extrato Bancário"],
  },
  background: {
    label: "Background Check e Presença Digital",
    description: "Processos judiciais, sanções, LinkedIn, portfólio",
    mandatory: false,
    fields: ["judicial_status", "sanctions_check", "linkedin_url", "portfolio_url"],
    docTypes: ["Certidão Negativa de Débitos", "Certidão Judicial"],
  },
};

// ─── Scoring Engine ──────────────────────────────────────────────────────────
function calculateOverallScore(checks: Array<{ confidenceScore: number; weight: number; isMandatory: boolean }>): {
  score: number;
  mandatoryPassed: boolean;
} {
  if (checks.length === 0) return { score: 0, mandatoryPassed: false };

  let totalWeight = 0;
  let weightedScore = 0;
  let mandatoryPassed = true;

  for (const check of checks) {
    totalWeight += check.weight;
    weightedScore += check.confidenceScore * check.weight;
    if (check.isMandatory && check.confidenceScore < 95) {
      mandatoryPassed = false;
    }
  }

  return {
    score: totalWeight > 0 ? weightedScore / totalWeight : 0,
    mandatoryPassed,
  };
}

// ─── State Machine: Bronze vs Prata ─────────────────────────────────────────
function classifyLevel(mandatoryPassed: boolean, score: number): {
  level: "bronze" | "silver";
  message: string;
} {
  if (mandatoryPassed && score >= 80) {
    return {
      level: "silver",
      message: "Parabéns! Todas as informações obrigatórias foram verificadas com sucesso. Sua conta foi promovida automaticamente para o nível Prata.",
    };
  }
  return {
    level: "bronze",
    message: "Você foi classificado como Bronze porque ainda existem informações obrigatórias que não puderam ser comprovadas. Assim que todos os documentos e verificações forem concluídos com sucesso, sua conta será reavaliada automaticamente.",
  };
}

// ─── OCR via IA Vision ───────────────────────────────────────────────────────
async function performOCR(fileUrl: string, docType: string, declaredData: Record<string, string>): Promise<{
  extractedData: Record<string, string>;
  confidenceScore: number;
  ocrText: string;
  status: CheckStatus;
}> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um sistema de OCR e verificação de documentos. Analise o documento fornecido e extraia as informações estruturadas. 
          Tipo de documento: ${docType}.
          Dados declarados pelo usuário: ${JSON.stringify(declaredData)}.
          
          Retorne um JSON com:
          - extractedData: objeto com os campos extraídos do documento
          - confidenceScore: 0-100 (quão confiável é a extração)
          - consistencyScore: 0-100 (quão consistente é com os dados declarados)
          - inconsistencies: array de inconsistências encontradas
          - ocrText: texto bruto extraído do documento`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analise este documento (${docType}) e extraia as informações, comparando com os dados declarados.`,
            },
            {
              type: "image_url",
              image_url: { url: fileUrl, detail: "high" },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ocr_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              extractedData: { type: "object", additionalProperties: { type: "string" } },
              confidenceScore: { type: "number" },
              consistencyScore: { type: "number" },
              inconsistencies: { type: "array", items: { type: "string" } },
              ocrText: { type: "string" },
            },
            required: ["extractedData", "confidenceScore", "consistencyScore", "inconsistencies", "ocrText"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty OCR response");

    const result = JSON.parse(typeof content === "string" ? content : JSON.stringify(content));
    
    // Determinar status com base nos scores
    let status: CheckStatus = "unverified";
    if (result.inconsistencies?.length > 0) {
      status = "inconsistent";
    } else if (result.consistencyScore >= 95 && result.confidenceScore >= 90) {
      status = "verified";
    } else if (result.consistencyScore >= 70) {
      status = "partial";
    } else if (result.confidenceScore < 50) {
      status = "insufficient";
    } else {
      status = "analyzing";
    }

    return {
      extractedData: result.extractedData || {},
      confidenceScore: (result.confidenceScore + result.consistencyScore) / 2,
      ocrText: result.ocrText || "",
      status,
    };
  } catch (err) {
    console.error("[SIVC OCR] Erro:", err);
    return {
      extractedData: {},
      confidenceScore: 0,
      ocrText: "",
      status: "insufficient",
    };
  }
}

// ─── Router SIVC ─────────────────────────────────────────────────────────────
export const sivcRouter = router({
  // Iniciar ou obter verificação existente
  startVerification: protectedProcedure
    .input(z.object({
      consentGranted: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.consentGranted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Consentimento explícito é obrigatório para iniciar a verificação." });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verificar se já existe uma verificação ativa
      const [existing] = await db.execute(
        sql`SELECT id, status, level, overallScore FROM sivc_verifications WHERE userId = ${ctx.user.id} AND status != 'failed' ORDER BY createdAt DESC LIMIT 1`
      ) as any[];

      const rows = Array.isArray(existing) ? existing : [];
      if (rows.length > 0) {
        return { verificationId: rows[0].id, status: rows[0].status, level: rows[0].level, isNew: false };
      }

      // IP sempre do servidor — nunca do cliente
      const ipAddress = getRequestIp(ctx.req.headers["x-forwarded-for"], ctx.req.socket?.remoteAddress);

      // Registrar consentimento
      await db.execute(sql`
        INSERT INTO sivc_consents (userId, consentType, ipAddress, payloadJson)
        VALUES (${ctx.user.id}, 'sivc_full_verification', ${ipAddress}, '{"version": "1.0", "scope": "full_verification"}')
      `);

      // Criar nova verificação
      const [result] = await db.execute(sql`
        INSERT INTO sivc_verifications (userId, status, consentGrantedAt)
        VALUES (${ctx.user.id}, 'in_progress', NOW())
      `) as any[];

      const verificationId = (result as any).insertId;

      // Criar checks iniciais para todos os campos obrigatórios
      const identityModule = SIVC_MODULES.identity;
      for (const field of identityModule.fields) {
        await db.execute(sql`
          INSERT INTO sivc_checks (verificationId, module, field, status, confidenceScore, weight, isMandatory, auditLog)
          VALUES (${verificationId}, 'identity', ${field}, 'unverified', 0, 1, TRUE, '[]')
        `);
      }

      return { verificationId, status: "in_progress", level: null, isNew: true };
    }),

  // Obter status completo da verificação
  getStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [verRows] = await db.execute(sql`
        SELECT * FROM sivc_verifications
        WHERE userId = ${ctx.user.id}
        ORDER BY createdAt DESC LIMIT 1
      `) as any[];

      const verifications = Array.isArray(verRows) ? verRows : [];
      if (verifications.length === 0) {
        return { hasVerification: false, verification: null, checks: [], documents: [] };
      }

      const verification = verifications[0];

      const [checkRows] = await db.execute(sql`
        SELECT * FROM sivc_checks WHERE verificationId = ${verification.id} ORDER BY module, field
      `) as any[];

      const [docRows] = await db.execute(sql`
        SELECT * FROM sivc_documents WHERE verificationId = ${verification.id} ORDER BY createdAt DESC
      `) as any[];

      const checks = Array.isArray(checkRows) ? checkRows : [];
      const documents = Array.isArray(docRows) ? docRows : [];

      // Calcular score geral
      const { score, mandatoryPassed } = calculateOverallScore(
        checks.map((c: any) => ({
          confidenceScore: parseFloat(c.confidenceScore) || 0,
          weight: parseFloat(c.weight) || 1,
          isMandatory: Boolean(c.isMandatory),
        }))
      );

      // Agrupar checks por módulo
      const moduleStatus: Record<string, { status: CheckStatus; score: number; checkCount: number; verifiedCount: number }> = {};
      for (const check of checks) {
        const mod = check.module;
        if (!moduleStatus[mod]) {
          moduleStatus[mod] = { status: "unverified", score: 0, checkCount: 0, verifiedCount: 0 };
        }
        moduleStatus[mod].checkCount++;
        moduleStatus[mod].score += parseFloat(check.confidenceScore) || 0;
        if (check.status === "verified") moduleStatus[mod].verifiedCount++;
      }
      for (const mod of Object.keys(moduleStatus)) {
        const m = moduleStatus[mod];
        m.score = m.checkCount > 0 ? m.score / m.checkCount : 0;
        if (m.verifiedCount === m.checkCount && m.checkCount > 0) m.status = "verified";
        else if (m.verifiedCount > 0) m.status = "partial";
        else m.status = "unverified";
      }

      return {
        hasVerification: true,
        verification: {
          ...verification,
          overallScore: score,
          mandatoryPassed,
          level: classifyLevel(mandatoryPassed, score).level,
          levelMessage: classifyLevel(mandatoryPassed, score).message,
        },
        checks,
        documents,
        moduleStatus,
        statusEmoji: STATUS_EMOJI,
        modules: SIVC_MODULES,
      };
    }),

  // Upload de documento + OCR automático
  uploadDocument: protectedProcedure
    .input(z.object({
      verificationId: z.number(),
      module: z.string(),
      docType: z.string(),
      fileBase64: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
      declaredData: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verificar que a verificação pertence ao usuário
      const [verRows] = await db.execute(sql`
        SELECT id FROM sivc_verifications WHERE id = ${input.verificationId} AND userId = ${ctx.user.id}
      `) as any[];
      if (!Array.isArray(verRows) || verRows.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verificação não encontrada." });
      }

      // Fazer upload do arquivo para S3
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      const fileKey = `sivc/${ctx.user.id}/${input.verificationId}/${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(fileKey, fileBuffer, input.mimeType);

      // Inserir documento com status "processing"
      const [insertResult] = await db.execute(sql`
        INSERT INTO sivc_documents (verificationId, userId, module, docType, fileKey, url, mimeType, sizeBytes, ocrStatus)
        VALUES (${input.verificationId}, ${ctx.user.id}, ${input.module}, ${input.docType}, ${fileKey}, ${url}, ${input.mimeType}, ${fileBuffer.length}, 'processing')
      `) as any[];

      const docId = (insertResult as any).insertId;

      // Executar OCR assíncrono (não bloqueia a resposta). O arquivo já está
      // no storage S3 (storagePut acima) e é lido pela própria URL do proxy; o
      // presign antigo do Manus (BUILT_IN_FORGE_API_URL) era código morto e saiu.
      (async () => {
        try {
          const ocrResult = await performOCR(url, input.docType, (input.declaredData || {}) as Record<string, string>);
          
          await db.execute(sql`
            UPDATE sivc_documents
            SET ocrStatus = 'completed',
                ocrText = ${ocrResult.ocrText},
                extractedData = ${JSON.stringify(ocrResult.extractedData)},
                confidenceScore = ${ocrResult.confidenceScore}
            WHERE id = ${docId}
          `);

          // Atualizar checks do módulo com base no OCR
          const moduleFields = SIVC_MODULES[input.module as keyof typeof SIVC_MODULES]?.fields || [];
          for (const field of moduleFields) {
            const extractedValue = ocrResult.extractedData[field];
            if (extractedValue) {
              const auditEntry = {
                timestamp: new Date().toISOString(),
                source: `OCR — ${input.docType}`,
                action: "field_verified",
                confidence: ocrResult.confidenceScore,
              };

              await db.execute(sql`
                UPDATE sivc_checks
                SET status = ${ocrResult.status},
                    verifiedValue = ${extractedValue},
                    confidenceScore = ${ocrResult.confidenceScore},
                    source = ${auditEntry.source},
                    auditLog = JSON_ARRAY_APPEND(COALESCE(auditLog, '[]'), '$', CAST(${JSON.stringify(auditEntry)} AS JSON))
                WHERE verificationId = ${input.verificationId} AND module = ${input.module} AND field = ${field}
              `);
            }
          }

          // Recalcular score e nível
          const [allChecks] = await db.execute(sql`
            SELECT confidenceScore, weight, isMandatory FROM sivc_checks WHERE verificationId = ${input.verificationId}
          `) as any[];
          
          const checks = Array.isArray(allChecks) ? allChecks : [];
          const { score, mandatoryPassed } = calculateOverallScore(
            checks.map((c: any) => ({
              confidenceScore: parseFloat(c.confidenceScore) || 0,
              weight: parseFloat(c.weight) || 1,
              isMandatory: Boolean(c.isMandatory),
            }))
          );
          const { level } = classifyLevel(mandatoryPassed, score);

          await db.execute(sql`
            UPDATE sivc_verifications
            SET overallScore = ${score}, mandatoryPassed = ${mandatoryPassed}, level = ${level}
            WHERE id = ${input.verificationId}
          `);

        } catch (err) {
          console.error("[SIVC OCR Background]", err);
          await db.execute(sql`
            UPDATE sivc_documents SET ocrStatus = 'failed' WHERE id = ${docId}
          `);
        }
      })();

      return { docId, fileKey, url, ocrStatus: "processing" };
    }),

  // Atualizar dado declarado de um campo
  updateDeclaredField: protectedProcedure
    .input(z.object({
      verificationId: z.number(),
      module: z.string(),
      field: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verificar que a verificação pertence ao usuário
      const [verRows] = await db.execute(sql`
        SELECT id FROM sivc_verifications WHERE id = ${input.verificationId} AND userId = ${ctx.user.id}
      `) as any[];
      if (!Array.isArray(verRows) || verRows.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Verificação não encontrada." });
      }

      const auditEntry = {
        timestamp: new Date().toISOString(),
        source: "Declaração do usuário",
        action: "field_declared",
        confidence: CONFIDENCE_WEIGHTS.declaration_only,
      };

      // Upsert do check
      await db.execute(sql`
        INSERT INTO sivc_checks (verificationId, module, field, declaredValue, status, confidenceScore, weight, isMandatory, auditLog)
        VALUES (${input.verificationId}, ${input.module}, ${input.field}, ${input.value}, 'unverified', ${CONFIDENCE_WEIGHTS.declaration_only}, 1, ${MANDATORY_MODULES.includes(input.module as any)}, '[]')
        ON DUPLICATE KEY UPDATE
          declaredValue = ${input.value},
          auditLog = JSON_ARRAY_APPEND(COALESCE(auditLog, '[]'), '$', CAST(${JSON.stringify(auditEntry)} AS JSON))
      `);

      return { success: true };
    }),

  // Obter definição dos módulos (para o frontend)
  getModules: protectedProcedure
    .query(() => {
      return { modules: SIVC_MODULES, confidenceWeights: CONFIDENCE_WEIGHTS, statusEmoji: STATUS_EMOJI };
    }),
});
