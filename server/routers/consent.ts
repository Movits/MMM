import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { consents, documentVersions } from "../../drizzle/schema";
import { getRequestIp } from "../password-reset-security";

export const DOCUMENT_TYPES = [
  "termo_smart_match",
  "acordo_intermediacao",
  "contrato_comissao",
  "termo_gravacao",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const documentTypeInput = z.enum(DOCUMENT_TYPES);

/**
 * Banco fora do ar. Existe como tipo próprio porque a diferença entre "não há
 * documento publicado" e "não consegui perguntar ao banco" decide se o
 * cruzamento libera ou barra — e as duas coisas eram `null` antes, o que fazia
 * a queda do banco liberar todo mundo.
 */
export class BancoIndisponivel extends Error {
  constructor() {
    super("Banco de dados indisponível.");
    this.name = "BancoIndisponivel";
  }
}

async function exigirBanco() {
  const db = await getDb();
  if (!db) throw new BancoIndisponivel();
  return db;
}

/**
 * Versão vigente de um documento, ou null se ainda não houver nenhuma
 * publicada — é o caso enquanto o texto jurídico não fica pronto.
 *
 * Banco indisponível NÃO devolve null: lança. Quem chama precisa poder
 * distinguir as duas situações.
 */
export async function getCurrentDocument(type: DocumentType) {
  const db = await exigirBanco();
  const [document] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.type, type), eq(documentVersions.isCurrent, true)))
    .limit(1);
  return document ?? null;
}

/**
 * Consentimento vale apenas para a versão vigente e enquanto não revogado.
 * A condição é avaliada aqui, na consulta, e não guardada num campo: revogar
 * tem efeito imediato, sem rotina de limpeza.
 *
 * Sem documento publicado não há o que consentir, e a resposta é `true` — do
 * contrário a etapa 11 desligaria o Smart Match de todo mundo antes de o termo
 * existir. Essa é a ÚNICA porta que libera sem consentimento, e ela depende de
 * uma consulta que respondeu. Se o banco não responder, a exceção sobe e o
 * cruzamento não acontece: na dúvida, barra.
 */
export async function hasValidConsent(userId: number, type: DocumentType) {
  const db = await exigirBanco();

  const [document] = await db
    .select({ id: documentVersions.id })
    .from(documentVersions)
    .where(and(eq(documentVersions.type, type), eq(documentVersions.isCurrent, true)))
    .limit(1);
  if (!document) return true;

  const [consent] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(and(
      eq(consents.userId, userId),
      eq(consents.documentVersionId, document.id),
      isNull(consents.revokedAt),
    ))
    .limit(1);
  return Boolean(consent);
}

export const consentRouter = router({
  /** Texto vigente do documento e a situação da usuária diante dele. */
  status: protectedProcedure
    .input(z.object({ type: documentTypeInput }))
    .query(async ({ ctx, input }) => {
      const document = await getCurrentDocument(input.type);
      if (!document) {
        return { document: null, accepted: true, acceptedAt: null, pendingText: true };
      }

      const db = await exigirBanco();
      const [consent] = await db
        .select({ grantedAt: consents.grantedAt })
        .from(consents)
        .where(and(
          eq(consents.userId, ctx.user.id),
          eq(consents.documentVersionId, document.id),
          isNull(consents.revokedAt),
        ))
        .limit(1);

      return {
        document: {
          id: document.id,
          type: document.type,
          version: document.version,
          text: document.text,
          publishedAt: document.publishedAt,
        },
        accepted: Boolean(consent),
        acceptedAt: consent?.grantedAt ?? null,
        pendingText: false,
      };
    }),

  accept: protectedProcedure
    .input(z.object({ type: documentTypeInput }))
    .mutation(async ({ ctx, input }) => {
      const document = await getCurrentDocument(input.type);
      if (!document) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Não há versão vigente deste documento." });
      }

      const db = await exigirBanco();

      // Aceitar de novo o que já está aceito não cria uma segunda linha.
      if (await hasValidConsent(ctx.user.id, input.type)) {
        return { success: true, documentVersionId: document.id };
      }

      await db.insert(consents).values({
        userId: ctx.user.id,
        documentVersionId: document.id,
        ipAddress: getRequestIp(ctx.req.headers["x-forwarded-for"], ctx.req.socket?.remoteAddress),
        userAgent: ctx.req.headers["user-agent"] ?? null,
      });

      return { success: true, documentVersionId: document.id };
    }),

  /** Revogar preenche a data; a linha do consentimento permanece como prova. */
  revoke: protectedProcedure
    .input(z.object({ type: documentTypeInput }))
    .mutation(async ({ ctx, input }) => {
      const document = await getCurrentDocument(input.type);
      if (!document) return { success: true };

      const db = await exigirBanco();
      await db
        .update(consents)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(consents.userId, ctx.user.id),
          eq(consents.documentVersionId, document.id),
          isNull(consents.revokedAt),
        ));

      return { success: true };
    }),

  /** Histórico completo, inclusive o que foi revogado. */
  history: protectedProcedure.query(async ({ ctx }) => {
    const db = await exigirBanco();
    return db
      .select({
        id: consents.id,
        grantedAt: consents.grantedAt,
        revokedAt: consents.revokedAt,
        type: documentVersions.type,
        version: documentVersions.version,
      })
      .from(consents)
      .innerJoin(documentVersions, eq(documentVersions.id, consents.documentVersionId))
      .where(eq(consents.userId, ctx.user.id))
      .orderBy(desc(consents.grantedAt));
  }),
});
