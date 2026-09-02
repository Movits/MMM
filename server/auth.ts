import bcrypt from "bcryptjs";
import * as jose from "jose";
import { eq } from "drizzle-orm";
import { exigirDb } from "./db";
import { users, sessions } from "../drizzle/schema";
import { checkLoginRateLimit, recordLoginAttempt } from "./security";
import { requireSecret } from "./_core/env";
import crypto from "crypto";

const JWT_SECRET = new TextEncoder().encode(requireSecret("JWT_SECRET"));
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 horas

// ─── Gerar openId único para usuários de email ───────────────
function generateOpenId(): string {
  return "email_" + crypto.randomBytes(16).toString("hex");
}

// ─── Registrar novo usuário ───────────────────────────────────
export async function registerUser(params: {
  name: string;
  email: string;
  password: string;
}) {
  const db = await exigirDb();

  // Verificar se email já existe
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, params.email.toLowerCase().trim()))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("Este e-mail já está cadastrado. Faça login ou use outro e-mail.");
  }

  // Validações básicas
  if (params.password.length < 8) {
    throw new Error("A senha deve ter pelo menos 8 caracteres.");
  }
  if (!params.email.includes("@")) {
    throw new Error("E-mail inválido.");
  }

  // Hash da senha
  const passwordHash = await bcrypt.hash(params.password, 12);
  const openId = generateOpenId();

  // Criar usuário
  const result = await db.insert(users).values({
    openId,
    name: params.name.trim(),
    email: params.email.toLowerCase().trim(),
    passwordHash,
    emailVerified: false,
    loginMethod: "email",
    role: "silver",
    isActive: true,
    isVerified: false,
    onboardingCompleted: false,
    lastSignedIn: new Date(),
  });

  const userId = Number(result[0].insertId);
  return { userId, openId };
}

// ─── Login com email + senha ──────────────────────────────────
export async function loginUser(params: {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}) {
  const db = await exigirDb();

  const safeIp = params.ip ? params.ip.split(",")[0].trim().substring(0, 45) : "unknown";
  const identifier = params.email.toLowerCase().trim();

  // ─── Verificar rate limit de login (brute force protection) ───
  const rateCheck = await checkLoginRateLimit(identifier, safeIp);
  if (!rateCheck.allowed) {
    const blockedUntil = rateCheck.blockedUntil
      ? ` Tente novamente após ${rateCheck.blockedUntil.toLocaleTimeString("pt-BR")}.`
      : " Tente novamente em 30 minutos.";
    throw new Error(`Conta temporariamente bloqueada por excesso de tentativas.${blockedUntil}`);
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, identifier))
    .limit(1);

  if (userRows.length === 0) {
    // Registrar tentativa falha mesmo para e-mails inexistentes (evita timing attack)
    await recordLoginAttempt(identifier, safeIp, false).catch(() => {});
    throw new Error("E-mail ou senha incorretos.");
  }

  const user = userRows[0];

  if (!user.isActive) {
    throw new Error("Esta conta foi desativada. Entre em contato com o suporte.");
  }

  if (!user.passwordHash) {
    throw new Error("Esta conta foi criada com outro método de login. Tente com Google ou outro provedor.");
  }

  const passwordOk = await bcrypt.compare(params.password, user.passwordHash);
  if (!passwordOk) {
    // Registrar tentativa falha no banco
    await recordLoginAttempt(identifier, safeIp, false).catch(() => {});
    const remaining = rateCheck.remainingAttempts - 1;
    const hint = remaining > 0 ? ` (${remaining} tentativa${remaining !== 1 ? "s" : ""} restante${remaining !== 1 ? "s" : ""})` : " Conta será bloqueada na próxima tentativa.";
    throw new Error(`E-mail ou senha incorretos.${hint}`);
  }

  // Login bem-sucedido: limpar tentativas anteriores
  await recordLoginAttempt(identifier, safeIp, true).catch(() => {});

  // Atualizar lastSignedIn
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

  // Criar sessão no banco
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  // Truncar userAgent para caber no campo (text, mas por segurança limitamos a 500 chars)
  const safeUserAgent = params.userAgent ? params.userAgent.substring(0, 500) : null;
  // safeIp já declarado acima (reutilizado aqui para o insert de sessão)

  console.log("[Auth] Criando sessão no banco para userId:", user.id, "token:", sessionToken.substring(0, 8) + "...");
  try {
    await db.insert(sessions).values({
      userId: user.id,
      sessionToken,
      ipAddress: safeIp,
      userAgent: safeUserAgent,
      expiresAt,
      isActive: true,
    });
    console.log("[Auth] Sessão criada com sucesso para userId:", user.id);
  } catch (sessionErr: any) {
    console.error("[Auth] ERRO ao criar sessão no banco:", sessionErr?.message, "| userId:", user.id, "| expiresAt:", expiresAt.toISOString());
    throw new Error("Erro interno ao criar sessão. Tente novamente.");
  }

  // Gerar JWT compatível com sdk.verifySession (campos: openId, appId, name)
  // IMPORTANTE: name deve ser string não-vazia (sdk.verifySession usa isNonEmptyString)
  const safeName = (user.name && user.name.trim().length > 0)
    ? user.name.trim()
    : (user.email ? user.email.split("@")[0] : "usuario");

  const token = await new jose.SignJWT({
    openId: user.openId,                          // campo esperado pelo sdk.verifySession
    appId: process.env.VITE_APP_ID ?? "mmm-os",  // campo esperado pelo sdk.verifySession
    name: safeName,                               // NUNCA vazio — sdk exige isNonEmptyString
    sessionToken,                                  // para validação no banco (validateSessionToken)
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(JWT_SECRET);

  return { token, user, expiresAt };
}

// ─── Invalidar sessão no banco ────────────────────────────────
export async function invalidateSessionByToken(sessionToken: string) {
  const db = await exigirDb();
  await db
    .update(sessions)
    .set({ isActive: false })
    .where(eq(sessions.sessionToken, sessionToken));
}

// Remove campos que jamais podem ir para o navegador. `ctx.user` é a linha
// crua da tabela `users`, e serializá-la inteira em auth.me/profile.get
// expunha o passwordHash de quem estivesse logado.
export function toPublicUser<T extends { passwordHash?: unknown }>(user: T | null | undefined) {
  if (!user) return user ?? null;
  const { passwordHash: _omitido, ...publico } = user as T & { passwordHash?: unknown };
  return publico;
}
