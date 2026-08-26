import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { createAuditLog, createSecurityEvent, checkLoginRateLimit, recordLoginAttempt, createSecureSession } from "../security";

// V-04: Sessão de 8 horas em vez de 1 ano
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      // Buscar usuário para auditoria
      const user = await db.getUserByOpenId(userInfo.openId);
      const ipAddress = (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress;
      const userAgent = req.headers["user-agent"];

      if (user) {
        if (!user.isActive) {
          res.status(403).json({ error: "Esta conta foi desativada. Entre em contato com o suporte." });
          return;
        }

        // Verificar rate limit antes de criar sessão
        const rateCheck = await checkLoginRateLimit(String(user.id), ipAddress || "unknown");
        if (!rateCheck.allowed) {
          await createSecurityEvent(
            user.id,
            "brute_force_attempt",
            "critical",
            ipAddress,
            { description: `Muitas tentativas de login do IP: ${ipAddress}` }
          );
          res.status(429).json({ error: "Muitas tentativas de login. Tente novamente mais tarde." });
          return;
        }

        // Registrar tentativa de login bem-sucedida
        await recordLoginAttempt(String(user.id), ipAddress || "unknown", true);

        // Auditoria de login
        await createAuditLog({
          userId: user.id,
          action: "LOGIN",
          resource: "auth",
          ipAddress,
          userAgent,
          status: "success",
          riskLevel: "low",
        });

        // Detectar acesso de novo dispositivo/localização suspeita
        const isNewDevice = !userAgent || userAgent.length < 10;
        if (isNewDevice) {
          await createSecurityEvent(
            user.id,
            "suspicious_ip",
            "warning",
            ipAddress,
            { description: "Login de dispositivo desconhecido", userAgent }
          );
        }
      }

      // V-04: Sessão de 8 horas (reduzido de 1 ano)
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: SESSION_DURATION_MS,
      });

      // V-04: Registrar sessão no banco para permitir revogação real
      if (user) {
        await createSecureSession(user.id, ipAddress || "unknown", userAgent || "unknown");
      }

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: SESSION_DURATION_MS });

      // Redirecionar para dashboard após login
      res.redirect(302, "/dashboard");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
