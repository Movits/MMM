/**
 * MMM OS - Módulo de Segurança Corporativa (Cofre Digital)
 * Camada de segurança de nível bancário com:
 * - Criptografia AES-256-GCM
 * - Rate limiting e proteção contra brute force
 * - Logs de auditoria imutáveis
 * - Detecção de atividades suspeitas
 * - Controle de acesso baseado em funções (RBAC)
 */

import crypto from "crypto";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getDb } from "./db";
import { requireSecret } from "./_core/env";
import {
  auditLogs,
  loginAttempts,
  securityEvents,
  platformNotifications,
  sessions,
  users,
  trustedDevices,
} from "../drizzle/schema";

// ============================================================
// CONFIGURAÇÕES DE SEGURANÇA
// ============================================================
const SECURITY_CONFIG = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  ENCRYPTION_ALGORITHM: "aes-256-gcm",
  HASH_ALGORITHM: "sha256",
  SALT_ROUNDS: 12,
};

// V-08: Chave de criptografia SEPARADA do JWT_SECRET
// Usa VAULT_ENCRYPTION_KEY dedicada; se não definida, deriva de JWT_SECRET + salt fixo
// para manter compatibilidade com dados existentes
function getEncryptionKey(): Buffer {
  const vaultKey = process.env.VAULT_ENCRYPTION_KEY;
  if (vaultKey && vaultKey.length >= 32) {
    return crypto.createHash("sha256").update(vaultKey).digest();
  }
  // Fallback: deriva do JWT_SECRET com salt dedicado ao vault (diferente do uso de sessão)
  const secret = requireSecret("JWT_SECRET");
  return crypto.createHash("sha256").update(secret + ":vault-encryption-salt-v1").digest();
}

// ============================================================
// CRIPTOGRAFIA AES-256-GCM
// ============================================================
export function encryptData(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SECURITY_CONFIG.ENCRYPTION_ALGORITHM, key, iv) as crypto.CipherGCM;

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:encryptedData
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptData(encryptedText: string): string {
  try {
    const key = getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(":");

    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(SECURITY_CONFIG.ENCRYPTION_ALGORITHM, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new Error("Falha na descriptografia: dados corrompidos ou chave inválida");
  }
}

export function hashData(data: string): string {
  return crypto.createHash(SECURITY_CONFIG.HASH_ALGORITHM).update(data).digest("hex");
}

// ============================================================
// RATE LIMITING E PROTEÇÃO CONTRA BRUTE FORCE
// ============================================================
export async function checkLoginRateLimit(
  identifier: string,
  ipAddress: string
): Promise<{ allowed: boolean; remainingAttempts: number; blockedUntil?: Date }> {
  const db = await getDb();
  if (!db) return { allowed: true, remainingAttempts: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS };

  const windowStart = new Date(Date.now() - 60 * 60 * 1000); // Última hora

  const existing = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.ipAddress, ipAddress),
        gte(loginAttempts.updatedAt, windowStart)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return { allowed: true, remainingAttempts: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS };
  }

  const attempt = existing[0];

  // Verificar se está bloqueado
  if (attempt.blockedUntil && attempt.blockedUntil > new Date()) {
    return {
      allowed: false,
      remainingAttempts: 0,
      blockedUntil: attempt.blockedUntil,
    };
  }

  const remaining = Math.max(0, SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS - attempt.attemptCount);
  return { allowed: remaining > 0, remainingAttempts: remaining };
}

export async function recordLoginAttempt(
  identifier: string,
  ipAddress: string,
  success: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const windowStart = new Date(Date.now() - 60 * 60 * 1000);

  const existing = await db
    .select()
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        eq(loginAttempts.ipAddress, ipAddress),
        gte(loginAttempts.updatedAt, windowStart)
      )
    )
    .limit(1);

  if (success) {
    // Limpar tentativas após login bem-sucedido
    if (existing.length > 0) {
      await db.delete(loginAttempts).where(eq(loginAttempts.id, existing[0].id));
    }
    return;
  }

  if (existing.length === 0) {
    await db.insert(loginAttempts).values({
      identifier,
      ipAddress,
      success: false,
      attemptCount: 1,
    });
  } else {
    const newCount = existing[0].attemptCount + 1;
    const shouldBlock = newCount >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS;
    const blockedUntil = shouldBlock
      ? new Date(Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION_MINUTES * 60 * 1000)
      : null;

    await db
      .update(loginAttempts)
      .set({
        attemptCount: newCount,
        blockedUntil: blockedUntil ?? undefined,
      })
      .where(eq(loginAttempts.id, existing[0].id));

    // Registrar evento de segurança se bloqueado
    if (shouldBlock) {
      await createSecurityEvent(null, "brute_force_attempt", "critical", ipAddress, {
        identifier,
        attemptCount: newCount,
      });
    }
  }
}

// ============================================================
// LOGS DE AUDITORIA IMUTÁVEIS
// ============================================================
export async function createAuditLog(params: {
  userId?: number | null;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status?: "success" | "failure" | "blocked";
  riskLevel?: "low" | "medium" | "high" | "critical";
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2...)
    // Take only the first (real client IP) and truncate to 45 chars max (IPv6 max = 39 chars)
    const rawIp = params.ipAddress ?? null;
    const cleanIp = rawIp ? rawIp.split(',')[0].trim().substring(0, 45) : null;

    // Truncate userAgent to 500 chars to avoid oversized text payloads
    const cleanUa = params.userAgent ? params.userAgent.substring(0, 500) : null;

    await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      action: params.action,
      resource: params.resource ?? null,
      resourceId: params.resourceId ?? null,
      details: params.details ?? null,
      ipAddress: cleanIp,
      userAgent: cleanUa,
      status: params.status ?? "success",
      riskLevel: params.riskLevel ?? "low",
    });
  } catch {
    // Audit log failures must never crash the application
  }
}

// ============================================================
// EVENTOS DE SEGURANÇA
// ============================================================
export async function createSecurityEvent(
  userId: number | null,
  eventType: "failed_login" | "suspicious_ip" | "multiple_sessions" | "brute_force_attempt" | "unusual_location" | "account_locked" | "password_reset" | "mfa_failed" | "data_export" | "admin_access",
  severity: "info" | "warning" | "critical",
  ipAddress?: string,
  details?: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.insert(securityEvents).values({
    userId,
    eventType,
    severity,
    ipAddress: ipAddress ?? null,
    details: details ?? null,
    resolved: false,
  });

  // Notificações de segurança crítica só para eventos realmente graves
  // (não para múltiplas sessões, que é comum em testes e uso normal)
  const criticalEventsToNotify = ["brute_force_attempt", "account_locked"];
  if (userId && severity === "critical" && criticalEventsToNotify.includes(eventType)) {
    await db.insert(platformNotifications).values({
      userId,
      type: "system",
      title: "⚠️ Alerta de Segurança",
      body: `Detectamos atividade suspeita na sua conta: ${eventType.replace(/_/g, " ")}. Se não foi você, altere sua senha imediatamente.`,
    });
  }
}

// ============================================================
// COFRE DIGITAL (STUB — migrado para userProfiles na plataforma FRAUEN)
// Mantido para compatibilidade com routers.ts existentes
// ============================================================
export async function saveToVault(
  userId: number,
  sensitiveData: Record<string, unknown>
): Promise<void> {
  // Vault migrado para userProfiles — dados são salvos via upsertUserProfile
  await createAuditLog({
    userId,
    action: "VAULT_UPDATE",
    resource: "user_profile",
    resourceId: String(userId),
    status: "success",
    riskLevel: "low",
  });
}

export async function getFromVault(userId: number): Promise<Record<string, unknown> | null> {
  // Vault migrado para userProfiles — retorna null para compatibilidade
  return null;
}

// ============================================================
// GERENCIAMENTO DE SESSÕES SEGURAS
// ============================================================
export async function validateSession(sessionToken: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionToken, sessionToken),
        eq(sessions.isActive, true),
        gte(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (result.length === 0) return null;

  // Atualizar última atividade
  await db
    .update(sessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(sessions.id, result[0].id));

  return result[0].userId;
}

export async function invalidateSession(sessionToken: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(sessions)
    .set({ isActive: false })
    .where(eq(sessions.sessionToken, sessionToken));
}

// ============================================================
// QUERIES PARA PAINEL ADMINISTRATIVO
// ============================================================
export async function getAuditLogs(limit = 50, offset = 0, userId?: number) {
  const db = await getDb();
  if (!db) return [];

  const query = db
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      userName: users.name,
      action: auditLogs.action,
      resource: auditLogs.resource,
      status: auditLogs.status,
      riskLevel: auditLogs.riskLevel,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  if (userId !== undefined) {
    return db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: users.name,
        action: auditLogs.action,
        resource: auditLogs.resource,
        status: auditLogs.status,
        riskLevel: auditLogs.riskLevel,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  return query;
}

export async function getSecurityEvents(resolved = false, limit = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: securityEvents.id,
      userId: securityEvents.userId,
      userName: users.name,
      eventType: securityEvents.eventType,
      severity: securityEvents.severity,
      ipAddress: securityEvents.ipAddress,
      resolved: securityEvents.resolved,
      createdAt: securityEvents.createdAt,
    })
    .from(securityEvents)
    .leftJoin(users, eq(securityEvents.userId, users.id))
    .where(eq(securityEvents.resolved, resolved))
    .orderBy(desc(securityEvents.createdAt))
    .limit(limit);
}

export async function getSecurityStats() {
  const db = await getDb();
  if (!db) return null;

  const [totalUsers] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [activeSessionsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(and(eq(sessions.isActive, true), gte(sessions.expiresAt, new Date())));
  const [unresolvedEvents] = await db
    .select({ count: sql<number>`count(*)` })
    .from(securityEvents)
    .where(eq(securityEvents.resolved, false));
  const [todayLogs] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogs)
    .where(gte(auditLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));

  return {
    totalUsers: totalUsers?.count ?? 0,
    activeSessions: activeSessionsCount?.count ?? 0,
    unresolvedSecurityEvents: unresolvedEvents?.count ?? 0,
    todayAuditLogs: todayLogs?.count ?? 0,
  };
}

export async function getUserSecurityNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(platformNotifications)
    .where(and(eq(platformNotifications.userId, userId), eq(platformNotifications.isRead, false)))
    .orderBy(desc(platformNotifications.createdAt))
    .limit(10);
}

// V-02: markNotificationRead com verificação de ownership (IDOR fix)
export async function markNotificationRead(notificationId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Só atualiza se a notificação pertence ao usuário solicitante
  await db
    .update(platformNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(platformNotifications.id, notificationId), eq(platformNotifications.userId, userId)));
}

export async function resolveSecurityEvent(eventId: number, resolvedBy: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(securityEvents)
    .set({ resolved: true, resolvedAt: new Date(), resolvedBy })
    .where(eq(securityEvents.id, eventId));
}

export async function getUserActiveSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.isActive, true),
        gte(sessions.expiresAt, new Date())
      )
    )
    .orderBy(desc(sessions.lastActivityAt));
}

export async function getAllUsers(limit = 100, offset = 0) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      isVerified: users.isVerified,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);
}

// ============================================================
// DETECÇÃO DE ANOMALIAS DE SESSÃO
// ============================================================

/**
 * Detecta anomalias na sessão atual comparando IP e User-Agent
 * com as sessões ativas do usuário. Gera alertas automáticos
 * quando detecta acesso de localização ou dispositivo diferente.
 */
export async function detectSessionAnomaly(
  userId: number,
  currentIp: string,
  currentUserAgent: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Buscar sessões ativas recentes do usuário (últimas 24h)
  const recentSessions = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.isActive, true),
        gte(sessions.lastActivityAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
    .orderBy(desc(sessions.lastActivityAt))
    .limit(10);

  if (recentSessions.length === 0) return;

  // Verificar se o IP atual é diferente de todos os IPs recentes
  const knownIps = new Set(recentSessions.map(s => s.ipAddress).filter(Boolean));
  const isNewIp = currentIp !== "unknown" && !knownIps.has(currentIp);

  // Verificar se o User-Agent atual é diferente dos recentes
  const currentUaFingerprint = hashData(currentUserAgent);
  const knownFingerprints = new Set(recentSessions.map(s => s.deviceFingerprint).filter(Boolean));
  const isNewDevice = !knownFingerprints.has(currentUaFingerprint);

  // Contar sessões simultâneas ativas
  const activeSessions = recentSessions.length;

  // Alertar sobre novo IP (possível acesso de localização diferente)
  if (isNewIp && recentSessions.length > 0) {
    await createSecurityEvent(
      userId,
      "suspicious_ip",
      "warning",
      currentIp,
      {
        newIp: currentIp,
        knownIps: Array.from(knownIps),
        message: "Acesso detectado de endereço IP diferente dos registros anteriores",
      }
    ).catch(() => {});
  }

  // Alertar sobre múltiplas sessões simultâneas apenas em volume muito alto
  // (threshold elevado para não gerar alertas em uso normal ou testes)
  if (activeSessions >= 10) {
    await createSecurityEvent(
      userId,
      "multiple_sessions",
      activeSessions >= 20 ? "critical" : "warning",
      currentIp,
      {
        activeSessions,
        message: `${activeSessions} sessões simultâneas detectadas`,
      }
    ).catch(() => {});
  }

  // Alertar sobre novo dispositivo com IP diferente (alta suspeita)
  if (isNewIp && isNewDevice && recentSessions.length > 0) {
    await createAuditLog({
      userId,
      action: "SUSPICIOUS_ACCESS",
      resource: "session",
      ipAddress: currentIp,
      userAgent: currentUserAgent,
      status: "failure",
      riskLevel: "high",
      details: {
        reason: "Novo IP e novo dispositivo detectados simultaneamente",
        knownIpsCount: knownIps.size,
      },
    }).catch(() => {});
  }
}

// ============================================================
// LIMPEZA DE SESSÕES EXPIRADAS
// ============================================================

/**
 * Remove sessões expiradas do banco de dados.
 * Deve ser chamado periodicamente (ex: job diário).
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .update(sessions)
    .set({ isActive: false })
    .where(
      and(
        eq(sessions.isActive, true),
        sql`${sessions.expiresAt} < NOW()`
      )
    );

  return (result as any)[0]?.affectedRows ?? 0;
}

// ============================================================
// REVOGAÇÃO DE TODAS AS SESSÕES DO USUÁRIO
// ============================================================

/**
 * Revoga todas as sessões ativas de um usuário.
 * Usado em caso de comprometimento de conta ou logout forçado pelo admin.
 */
export async function revokeAllUserSessions(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(sessions)
    .set({ isActive: false })
    .where(eq(sessions.userId, userId));
}

// ============================================================
// BLOQUEIO DE CONTA
// ============================================================

/**
 * Bloqueia uma conta de usuário e revoga todas as suas sessões.
 * Registra o evento de segurança correspondente.
 */
export async function lockUserAccount(
  targetUserId: number,
  adminId: number,
  reason: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Desativar conta
  await db
    .update(users)
    .set({ isActive: false })
    .where(eq(users.id, targetUserId));

  // Revogar todas as sessões
  await revokeAllUserSessions(targetUserId);

  // Registrar no log de auditoria
  await createAuditLog({
    userId: adminId,
    action: "ACCOUNT_LOCKED",
    resource: "user",
    resourceId: String(targetUserId),
    status: "success",
    riskLevel: "high",
    details: { reason, targetUserId },
  });

  // Criar evento de segurança
  await createSecurityEvent(
    targetUserId,
    "account_locked",
    "critical",
    undefined,
    { reason, lockedBy: adminId }
  );
}

// ============================================================
// VALIDAÇÃO REAL DE SESSÃO NO BANCO (V-CRITICAL)
// Verifica se o token de sessão ainda está ativo no banco.
// Chamado dentro de sdk.authenticateRequest para revogação real.
// ============================================================

/**
 * Valida o token de sessão JWT contra o banco de dados.
 * Retorna o userId se a sessão está ativa e não expirou.
 * Retorna null se a sessão foi revogada, expirou ou não existe.
 */
export async function validateSessionToken(sessionToken: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null; // Fail open se DB indisponível (não bloqueia)

  const result = await db
    .select({ userId: sessions.userId, isActive: sessions.isActive, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.sessionToken, sessionToken))
    .limit(1);

  if (result.length === 0) return null;

  const session = result[0];
  if (!session.isActive) return null;
  if (session.expiresAt && session.expiresAt < new Date()) {
    // Marcar como inativa para limpeza futura
    await db.update(sessions).set({ isActive: false }).where(eq(sessions.sessionToken, sessionToken));
    return null;
  }

  // Atualizar lastActivityAt
  await db.update(sessions).set({ lastActivityAt: new Date() }).where(eq(sessions.sessionToken, sessionToken));

  return session.userId;
}

// ============================================================
// BLOQUEIO AUTOMÁTICO POR THRESHOLD DE EVENTOS CRÍTICOS
// ============================================================

const AUTO_LOCK_THRESHOLD = 20; // Número de eventos críticos para bloqueio automático (aumentado para evitar falsos positivos)
const AUTO_LOCK_WINDOW_MINUTES = 60; // Janela de tempo para contagem

/**
 * Verifica se um usuário deve ser bloqueado automaticamente
 * com base no número de eventos críticos recentes.
 * Se o threshold for atingido, bloqueia a conta automaticamente.
 */
export async function checkAutoLockThreshold(userId: number, ipAddress?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const windowStart = new Date(Date.now() - AUTO_LOCK_WINDOW_MINUTES * 60 * 1000);

  const criticalEvents = await db
    .select({ id: securityEvents.id })
    .from(securityEvents)
    .where(
      and(
        eq(securityEvents.userId, userId),
        eq(securityEvents.severity, "critical"),
        gte(securityEvents.createdAt, windowStart)
      )
    );

  if (criticalEvents.length < AUTO_LOCK_THRESHOLD) return false;

  // Verificar se a conta já está inativa (já bloqueada)
  const userResult = await db.select({ isActive: users.isActive, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!userResult[0]?.isActive) return true; // Já bloqueada

  // Isentar contas Presidente e Admin do bloqueio automático
  if (userResult[0]?.role === 'president' || userResult[0]?.role === 'admin') {
    return false;
  }

  // Bloquear automaticamente
  await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
  await revokeAllUserSessions(userId);

  // Registrar evento e log
  await createSecurityEvent(
    userId,
    "account_locked",
    "critical",
    ipAddress,
    {
      reason: `Bloqueio automático: ${criticalEvents.length} eventos críticos em ${AUTO_LOCK_WINDOW_MINUTES} minutos`,
      autoLocked: true,
      threshold: AUTO_LOCK_THRESHOLD,
    }
  ).catch(() => {});

  await createAuditLog({
    userId: null,
    action: "AUTO_LOCK_ACCOUNT",
    resource: "user",
    resourceId: String(userId),
    status: "success",
    riskLevel: "critical",
    ipAddress,
    details: {
      reason: "Threshold automático de eventos críticos atingido",
      criticalEventsCount: criticalEvents.length,
      windowMinutes: AUTO_LOCK_WINDOW_MINUTES,
    },
  }).catch(() => {});

  return true;
}
