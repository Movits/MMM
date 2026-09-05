import { TRPCError } from "@trpc/server";
import { z } from "zod";
import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { publicProcedure, router } from "../_core/trpc";
import { exigirDb } from "../db";
import {
  ehErroDeBancoIndisponivel,
  ehErroDoDriverDeBanco,
  MENSAGEM_BANCO_INDISPONIVEL,
} from "../banco-indisponivel";
import { createAuditLog, invalidateSession } from "../security";
import { users, passwordResetTokens, passwordResetRequests } from "../../drizzle/schema";
import { registerUser, loginUser, toPublicUser } from "../auth";
import {
  getRequestIp,
  hashPasswordResetToken,
  PASSWORD_RESET_GENERIC_MESSAGE,
  PASSWORD_RESET_RATE_LIMIT,
  PASSWORD_RESET_RATE_WINDOW_MS,
  PASSWORD_RESET_TTL_MS,
} from "../password-reset-security";

// ============================================================
// AUTENTICAÇÃO
// ============================================================
// login e register embrulham o que loginUser/registerUser lançam em
// UNAUTHORIZED/BAD_REQUEST com a mensagem original, porque essas funções falam
// com a usuária por Error("E-mail ou senha incorretos."). Erro do banco não é
// mensagem para a usuária: relançado cru, o middleware de _core/trpc.ts traduz
// a queda em "banco indisponível" e o errorFormatter mascara o SQL dos demais.
const ehErroDeBanco = (err: unknown) => ehErroDeBancoIndisponivel(err) || ehErroDoDriverDeBanco(err);

export const authRouter = router({
  // Público de propósito: sem sessão, devolve null e a tela manda para o login.
  // Mas "sem sessão porque o banco caiu" (ctx.bancoIndisponivel, ver
  // _core/context.ts) não pode virar null: null é exatamente o que o client
  // lê como "não autenticada", e a usuária logada seria expulsa para o login
  // enquanto o banco estivesse fora do ar.
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.user && ctx.bancoIndisponivel) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: MENSAGEM_BANCO_INDISPONIVEL });
    }
    return toPublicUser(ctx.user);
  }),

  register: publicProcedure
    .input(z.object({
      name: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      try {
        const { userId } = await registerUser(input);
        return { success: true, userId };
      } catch (err: any) {
        if (ehErroDeBanco(err)) throw err;
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
    }),

  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const ip = (ctx.req.headers["x-forwarded-for"] as string) || (ctx.req.socket as any)?.remoteAddress;
      const ua = ctx.req.headers["user-agent"];
      try {
        const { token, user, expiresAt } = await loginUser({ email: input.email, password: input.password, ip, userAgent: ua });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
        await createAuditLog({ userId: user.id, action: "LOGIN", resource: "auth", ipAddress: ip, userAgent: ua, status: "success", riskLevel: "low" });
        return { success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, onboardingCompleted: user.onboardingCompleted } };
      } catch (err: any) {
        if (ehErroDeBanco(err)) throw err;
        throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
      }
    }),

  forgotPassword: publicProcedure
    .input(z.object({
      email: z.string().email(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await exigirDb();

      const genericResponse = { success: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
      const ipAddress = getRequestIp(ctx.req.headers["x-forwarded-for"], ctx.req.socket?.remoteAddress);
      const windowStart = new Date(Date.now() - PASSWORD_RESET_RATE_WINDOW_MS);
      const [rateWindow] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(passwordResetRequests)
        .where(and(
          eq(passwordResetRequests.ipAddress, ipAddress),
          sql`${passwordResetRequests.createdAt} >= ${windowStart}`,
        ));
      // A mesma resposta é retornada ao exceder o limite para não revelar informações.
      if (Number(rateWindow?.count ?? 0) >= PASSWORD_RESET_RATE_LIMIT) return genericResponse;
      await db.insert(passwordResetRequests).values({ id: crypto.randomUUID(), ipAddress });

      const normalizedEmail = input.email.trim().toLowerCase();
      // Buscar usuário pelo e-mail
      const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      // Sempre retornar sucesso para não revelar se o e-mail existe (segurança)
      if (!user) return genericResponse;
      // Invalidar tokens anteriores do mesmo usuário
      await db.update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, user.id), sql`${passwordResetTokens.usedAt} IS NULL`));
      // Token opaco de uso único; apenas seu hash é armazenado no banco.
      const rawToken = crypto.randomBytes(48).toString("hex");
      const tokenHash = hashPasswordResetToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS); // 1 hora
      await db.insert(passwordResetTokens).values({ userId: user.id, token: tokenHash, expiresAt });
      // Não aceitar origem do cliente: evita que um link de reset aponte para domínio malicioso.
      // E sem FRONTEND_URL não se inventa domínio: o fallback antigo apontava para o
      // endereço morto do Manus, e o link chegaria quebrado na caixa de entrada.
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Variável de ambiente FRONTEND_URL não definida: ela é a origem dos links de recuperação de senha e não tem valor padrão.",
        });
      }
      const siteOrigin = frontendUrl.replace(/\/+$/, "");
      const resetUrl = `${siteOrigin}/reset-password?token=${encodeURIComponent(rawToken)}`;
      // Enviar e-mail via Resend
      try {
        const { sendEmail, buildPasswordResetEmail } = await import("../_core/email");
        const { html, text } = buildPasswordResetEmail(user.name || "Membra", resetUrl);
        const emailSent = await sendEmail({
          to: user.email!,
          subject: "Redefina sua senha — MMM",
          html,
          text,
        });
        if (!emailSent) console.error("[PasswordReset] A Resend não aceitou a solicitação de envio.");
      } catch (error) {
        console.error("[PasswordReset] Falha ao enviar e-mail de recuperação:", error);
      }
      return genericResponse;
    }),

  resetPassword: publicProcedure
    .input(z.object({
      token: z.string().min(10),
      newPassword: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const db = await exigirDb();
      const tokenHash = hashPasswordResetToken(input.token);
      // Buscar token válido
      const [resetToken] = await db.select()
        .from(passwordResetTokens)
        .where(and(
          eq(passwordResetTokens.token, tokenHash),
          sql`${passwordResetTokens.usedAt} IS NULL`,
          sql`${passwordResetTokens.expiresAt} > NOW()`
        ))
        .limit(1);
      if (!resetToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Token inválido ou expirado. Solicite um novo link de recuperação." });
      }
      // Atualizar senha
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));
      // Marcar token como usado
      await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, resetToken.id));
      return { success: true };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user) {
      await createAuditLog({ userId: ctx.user.id, action: "LOGOUT", resource: "auth", ipAddress: ctx.req.headers["x-forwarded-for"] as string, userAgent: ctx.req.headers["user-agent"], status: "success", riskLevel: "low" });
    }
    const cookies = ctx.req.headers.cookie;
    if (cookies) {
      const cookieMatch = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
      if (cookieMatch?.[1]) {
        try {
          const jwtPayload = JSON.parse(Buffer.from(cookieMatch[1].split(".")[1], "base64url").toString("utf8"));
          if (jwtPayload?.sessionToken) await invalidateSession(jwtPayload.sessionToken).catch(() => {});
          else await invalidateSession(cookieMatch[1]).catch(() => {});
        } catch { await invalidateSession(cookieMatch[1]).catch(() => {}); }
      }
    }
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
});
