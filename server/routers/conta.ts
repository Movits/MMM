// A conta da própria dona: hoje só a exclusão.
//
// O cartão "Não existe caminho para excluir os dados de uma usuária" pedia o
// caminho que faltava: até aqui a única forma de sair da plataforma era pedir
// para alguém rodar SQL à mão no Aiven. O que este procedimento faz de
// diferente de um DELETE solto está em `server/exclusao-de-conta.ts`; o que
// está AQUI é a autorização, e ela tem três travas, nesta ordem:
//
// 1. A palavra digitada tem de ser o e-mail da própria conta. Não é segurança
//    (quem está logada sabe o próprio e-mail): é a trava contra o clique sem
//    querer, e é independente de idioma — uma palavra traduzida em 10 JSONs
//    nunca casaria com uma constante do servidor.
// 2. A SENHA é conferida de novo, com bcrypt, como no login. Sessão roubada não
//    apaga a vida de ninguém. Conta sem senha (login por provedor externo) é
//    recusada com instrução, não com erro genérico.
// 3. A última administradora não pode se apagar. Sem nenhuma conta
//    {admin, president, gold} a plataforma fica sem moderação de oportunidade,
//    sem painel e sem quem conceda Ouro — um estado do qual não se sai pela
//    interface.
//
// Tentativa de senha errada é registrada e, passando de LIMITE_DE_TENTATIVAS na
// janela, o procedimento fecha: o rate limit global (100 req/min por IP) não
// serve de nada aqui, porque este endpoint responde "senha certa/errada" para
// quem já tem a sessão.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { protectedProcedure, router } from "../_core/trpc";
import { exigirDb } from "../db";
import { createAuditLog } from "../security";
import { getRequestIp } from "../password-reset-security";
import { auditLogs, users } from "../../drizzle/schema";
import { excluirConta } from "../exclusao-de-conta";

export const ACAO_EXCLUSAO = "ACCOUNT_DELETED";
export const ACAO_EXCLUSAO_RECUSADA = "ACCOUNT_DELETE_FAILED";
export const LIMITE_DE_TENTATIVAS = 5;
export const JANELA_DE_TENTATIVAS_MS = 15 * 60 * 1000;

/** Os papéis que enxergam o painel de governança (o mesmo trio de `_procedures.ts`). */
export const PAPEIS_DE_GOVERNANCA = ["admin", "president", "gold"] as const;

/**
 * O que a dona tem de digitar para confirmar. O e-mail da própria conta quando
 * existe; a palavra fixa quando a conta veio de provedor externo sem e-mail.
 * Pura, para o teste e o client concordarem sem copiar a regra.
 */
export const PALAVRA_DE_CONFIRMACAO = "EXCLUIR";

export function confirmacaoEsperada(email: string | null | undefined): string {
  const limpo = (email ?? "").trim();
  return limpo ? limpo.toLowerCase() : PALAVRA_DE_CONFIRMACAO;
}

export function confirmacaoConfere(email: string | null | undefined, digitado: string): boolean {
  return digitado.trim().toLowerCase() === confirmacaoEsperada(email).toLowerCase();
}

export const contaRouter = router({
  /**
   * O que a tela precisa saber ANTES de oferecer o botão: o que digitar, se a
   * conta tem senha para conferir e se ela é a última administradora. Assim o
   * aviso aparece na tela em vez de virar erro depois de digitar tudo.
   */
  requisitosDaExclusao: protectedProcedure.query(async ({ ctx }) => {
    const db = await exigirDb();
    const [outras] = await db.select({ total: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(
        inArray(users.role, [...PAPEIS_DE_GOVERNANCA]),
        sql`${users.id} <> ${ctx.user.id}`,
      ));
    const souGovernanca = (PAPEIS_DE_GOVERNANCA as readonly string[]).includes(ctx.user.role);
    return {
      confirmacaoEsperada: confirmacaoEsperada(ctx.user.email),
      temSenha: Boolean(ctx.user.passwordHash),
      ultimaAdministradora: souGovernanca && Number(outras?.total ?? 0) === 0,
    };
  }),

  excluirMinhaConta: protectedProcedure
    .input(z.object({
      senha: z.string().min(1).max(200),
      confirmacao: z.string().min(1).max(320),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();
      const ipAddress = getRequestIp(ctx.req.headers["x-forwarded-for"], ctx.req.ip);
      const userAgent = ctx.req.headers["user-agent"];

      const inicioDaJanela = new Date(Date.now() - JANELA_DE_TENTATIVAS_MS);
      const [tentativas] = await db.select({ total: sql<number>`COUNT(*)` })
        .from(auditLogs)
        .where(and(
          eq(auditLogs.userId, ctx.user.id),
          eq(auditLogs.action, ACAO_EXCLUSAO_RECUSADA),
          sql`${auditLogs.createdAt} >= ${inicioDaJanela}`,
        ));
      if (Number(tentativas?.total ?? 0) >= LIMITE_DE_TENTATIVAS) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Muitas tentativas de exclusão. Espere 15 minutos e tente de novo.",
        });
      }

      // Trava 1: a confirmação digitada. Erro de digitação não vira tentativa
      // registrada — só a senha errada vira.
      if (!confirmacaoConfere(ctx.user.email, input.confirmacao)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Para confirmar, digite exatamente: ${confirmacaoEsperada(ctx.user.email)}`,
        });
      }

      // Trava 2: a senha. Sem hash não há o que conferir, e apagar tudo sem
      // conferir nada é justamente o que este procedimento não pode fazer.
      if (!ctx.user.passwordHash) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Esta conta não tem senha cadastrada. Use \"Esqueci minha senha\" para criar uma e depois volte para excluir a conta.",
        });
      }
      const bcrypt = await import("bcryptjs");
      const senhaConfere = await bcrypt.compare(input.senha, ctx.user.passwordHash);
      if (!senhaConfere) {
        await createAuditLog({
          userId: ctx.user.id,
          action: ACAO_EXCLUSAO_RECUSADA,
          resource: "conta",
          ipAddress,
          userAgent,
          status: "failure",
          riskLevel: "medium",
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha incorreta." });
      }

      // Trava 3: a última administradora.
      const souGovernanca = (PAPEIS_DE_GOVERNANCA as readonly string[]).includes(ctx.user.role);
      if (souGovernanca) {
        const [outras] = await db.select({ total: sql<number>`COUNT(*)` })
          .from(users)
          .where(and(
            inArray(users.role, [...PAPEIS_DE_GOVERNANCA]),
            sql`${users.id} <> ${ctx.user.id}`,
          ));
        if (Number(outras?.total ?? 0) === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Você é a última administradora da plataforma. Promova outra membra a Ouro antes de excluir sua conta.",
          });
        }
      }

      const relatorio = await excluirConta(db, {
        id: ctx.user.id,
        openId: ctx.user.openId,
        email: ctx.user.email,
      });

      // O registro da exclusão nasce DEPOIS de apagar: o passo de `audit_logs`
      // levaria embora uma linha escrita antes. `details` não guarda nome nem
      // e-mail — contagens e nomes de tabela, nada mais.
      await createAuditLog({
        userId: ctx.user.id,
        action: ACAO_EXCLUSAO,
        resource: "conta",
        details: {
          linhasApagadas: relatorio.linhasApagadas,
          arquivosApagados: relatorio.arquivosApagados,
          arquivosComFalha: relatorio.arquivosComFalha.length,
          passos: relatorio.passos.map(passo => `${passo.nome}=${passo.linhas}`),
        },
        ipAddress,
        userAgent,
        status: relatorio.arquivosComFalha.length ? "failure" : "success",
        riskLevel: "high",
      });

      // As sessões saíram no plano, então o JWT do navegador já não resolve;
      // o cookie sai também para a próxima requisição não chegar como "sessão
      // inválida" e sim como visitante.
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

      return {
        sucesso: true as const,
        linhasApagadas: relatorio.linhasApagadas,
        arquivosApagados: relatorio.arquivosApagados,
        arquivosComFalha: relatorio.arquivosComFalha.length,
      };
    }),
});
