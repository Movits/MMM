import type { Request, Response } from "express";
import { sdk, type AuthenticatedUser } from "./sdk";

/**
 * Sessão de cron dos endpoints `/api/scheduled/*` (limpeza de sessões, de
 * gravações vencidas, reuniões interrompidas).
 *
 * Duas respostas distintas, de propósito:
 *  - sem sessão válida (cookie ausente, vencido ou assinado com outro segredo)
 *    é 401 — antes, `sdk.authenticateRequest` lançava dentro do try genérico
 *    do endpoint e a chamada anônima virava 500 "Invalid session cookie", o
 *    que um agendador externo leria como "o servidor quebrou", não "estou sem
 *    credencial";
 *  - sessão de usuária comum é 403: a rota é só de cron.
 *
 * Devolve `null` quando já respondeu; o endpoint só segue com a sessão.
 * Nenhum agendador externo está configurado desde a saída do Manus (era a
 * plataforma quem disparava estas rotas); elas ficam prontas para quando houver.
 */
export async function autenticarCron(req: Request, res: Response): Promise<AuthenticatedUser | null> {
  let user: AuthenticatedUser;
  try {
    user = await sdk.authenticateRequest(req);
  } catch (erro) {
    console.warn("[Cron] chamada sem sessão válida em", req.url, "—", erro instanceof Error ? erro.message : erro);
    res.status(401).json({ error: "Sessão de cron ausente ou inválida." });
    return null;
  }
  if (!user.isCron) {
    res.status(403).json({ error: "cron-only endpoint" });
    return null;
  }
  return user;
}
