import { and, eq, desc, like, or, ne, notInArray, inArray, sql, isNull } from "drizzle-orm";
const drizzleOr = or;
import { drizzle } from "drizzle-orm/mysql2";
import {
  users, userProfiles, opportunities, opportunityDocuments,
  opportunityInterests, savedOpportunities, opportunityMatches,
  goldAccessGrants, platformNotifications, sessions, auditLogs,
  loginAttempts, strategicGroups, directMessages,
  matches, connections,
  type InsertUser,
  privateContacts,
  type PrivateContact,
  type InsertPrivateContact,
  contextTypes, contexts, contactContexts, contextParticipants, contextMedia,
  type Context, type ContextType, type ContactContext, type ContextParticipant, type ContextMedia,
  enrichmentSessions, enrichmentMessages, enrichmentSuggestions,
  type EnrichmentSession, type EnrichmentMessage, type EnrichmentSuggestion,
  contactAssets, contactNeeds, aiMatchSuggestions,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import nodeCrypto from "node:crypto";
import { slugifyMatchTag } from "./match-service";
import { BancoIndisponivel } from "./banco-indisponivel";

let _db: ReturnType<typeof drizzle> | null = null;

// Devolve null SÓ quando não há DATABASE_URL. drizzle(url) cria um pool do
// mysql2 sem abrir conexão nenhuma: com a variável definida, isto nunca falha,
// e a queda real do banco aparece na PRIMEIRA QUERY, como erro do driver
// (ECONNREFUSED, ETIMEDOUT, PROTOCOL_CONNECTION_LOST...) dentro de um
// DrizzleQueryError. Quem reconhece esse caso é ehErroDeBancoIndisponivel
// (server/banco-indisponivel.ts), não este null.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to create the pool:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * O banco, ou BancoIndisponivel. É o que todo helper deste arquivo usa: banco
 * fora do ar é ERRO, não "sem dados". Antes cada helper fazia `if (!db) return
 * []` (ou null, ou false), e uma queda do banco aparecia na tela como lista
 * vazia, perfil inexistente, contato apagado.
 *
 * Só cobre a conexão NÃO CONFIGURADA (dev e teste sem DATABASE_URL). Em
 * produção a queda chega como erro do driver na query seguinte, e é o
 * middleware de server/_core/trpc.ts, via ehErroDeBancoIndisponivel, que
 * traduz os dois casos para a usuária com a mesma frase.
 *
 * getDb() continua devolvendo null para quem precisa decidir sozinho o que
 * fazer sem banco. Hoje são só stats.platform e system.health, que degradam
 * de propósito para não derrubar a página inicial.
 */
export async function exigirDb() {
  const db = await getDb();
  if (!db) throw new BancoIndisponivel();
  return db;
}

// ─── Users ────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await exigirDb();
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => {
    const value = user[field];
    if (value === undefined) return;
    values[field] = value ?? null;
    updateSet[field] = value ?? null;
  });
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await exigirDb();
  // Não filtrar por isActive aqui: filtrar causava loop de login para contas reativadas.
  // A recusa de conta desativada é feita em sdk.authenticateRequest e em loginUser.
  const result = await db.select().from(users)
    .where(eq(users.openId, openId)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserById(id: number) {
  const db = await exigirDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const db = await exigirDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await exigirDb();
  await db.update(users).set(data as any).where(eq(users.id, id));
}

// ─── User Profiles ────────────────────────────────────────────
export async function getUserProfile(userId: number) {
  const db = await exigirDb();
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

// Os mesmos 10 campos da antiga saveUserProfile (matching.ts), que ficou órfã
// quando o onboarding passou a usar este upsert — desde então o Dashboard
// mostrava "0% Perfil completo" para todo mundo.
export function computeProfileCompleteness(profile: Record<string, unknown> | null | undefined) {
  if (!profile) return 0;
  const fields = [
    profile.displayName, profile.city, profile.primarySpecialty,
    profile.sector, profile.seekingTypes, profile.incomeRange,
    profile.workStyle, profile.bio, profile.experienceYears,
    profile.values,
  ];
  const filled = fields.filter(f => f !== null && f !== undefined && f !== "" && !(Array.isArray(f) && f.length === 0)).length;
  return Math.round((filled / fields.length) * 100);
}

export async function upsertUserProfile(userId: number, data: Record<string, unknown>) {
  const db = await exigirDb();
  const existing = await getUserProfile(userId);
  if (existing) {
    await db.update(userProfiles).set({ ...data, updatedAt: new Date() } as any).where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({ userId, ...data } as any);
  }
  const atual = await getUserProfile(userId);
  const completeness = computeProfileCompleteness(atual as Record<string, unknown> | null);
  if (atual && (atual as any).profileCompleteness !== completeness) {
    await db.update(userProfiles).set({ profileCompleteness: completeness } as any).where(eq(userProfiles.userId, userId));
  }
}

// ─── Opportunities ────────────────────────────────────────────
export async function getOpportunityById(id: number) {
  const db = await exigirDb();
  const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listOpportunities(filters: {
  type?: string;
  sector?: string;
  country?: string;
  complianceLevel?: string;
  isConfidential?: boolean;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Quem está olhando a lista. Presente, a autora também vê as próprias
   *  oportunidades ainda em análise ("pending") — sem isso, publicar parecia
   *  engolir a oportunidade, porque a lista só mostrava as ativas. */
  viewerUserId?: number;
}) {
  const db = await exigirDb();
  const conditions: any[] = [];
  if (filters.status === undefined && filters.viewerUserId !== undefined) {
    conditions.push(
      or(
        eq(opportunities.status, "active"),
        and(eq(opportunities.status, "pending"), eq(opportunities.publishedBy, filters.viewerUserId)),
      ),
    );
  } else {
    conditions.push(eq(opportunities.status, (filters.status ?? "active") as any));
  }
  if (filters.type) conditions.push(eq(opportunities.type, filters.type as any));
  if (filters.sector) conditions.push(eq(opportunities.sector, filters.sector));
  if (filters.country) conditions.push(eq(opportunities.country, filters.country));
  if (filters.complianceLevel) conditions.push(eq(opportunities.complianceLevel, filters.complianceLevel as any));
  if (filters.isConfidential !== undefined) conditions.push(eq(opportunities.isConfidential, filters.isConfidential));
  if (filters.search) conditions.push(like(opportunities.title, `%${filters.search}%`));
  return db.select().from(opportunities)
    .where(and(...conditions))
    .orderBy(desc(opportunities.frauenTrustScore), desc(opportunities.createdAt))
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);
}

export async function createOpportunity(data: Omit<typeof opportunities.$inferInsert, "id">) {
  const db = await exigirDb();
  const result = await db.insert(opportunities).values(data as any);
  return (result[0] as any).insertId as number;
}

export async function updateOpportunity(id: number, data: Partial<typeof opportunities.$inferInsert>) {
  const db = await exigirDb();
  await db.update(opportunities).set(data as any).where(eq(opportunities.id, id));
}

// ─── Documents ────────────────────────────────────────────────
export async function getDocumentsByOpportunity(opportunityId: number, includeConfidential = false) {
  const db = await exigirDb();
  const conditions: any[] = [eq(opportunityDocuments.opportunityId, opportunityId)];
  if (!includeConfidential) conditions.push(eq(opportunityDocuments.isConfidential, false));
  return db.select().from(opportunityDocuments).where(and(...conditions));
}

export async function addDocument(data: typeof opportunityDocuments.$inferInsert) {
  const db = await exigirDb();
  const result = await db.insert(opportunityDocuments).values(data);
  return (result[0] as any).insertId as number;
}

// ─── Interests ────────────────────────────────────────────────
export async function expressInterest(opportunityId: number, userId: number, message?: string) {
  const db = await exigirDb();
  const existing = await db.select({ id: opportunityInterests.id })
    .from(opportunityInterests)
    .where(and(eq(opportunityInterests.opportunityId, opportunityId), eq(opportunityInterests.userId, userId)))
    .limit(1);
  if (existing.length > 0) return { alreadyExists: true };
  await db.insert(opportunityInterests).values({ opportunityId, userId, message });
  const opp = await getOpportunityById(opportunityId);
  if (opp) await db.update(opportunities).set({ interestCount: (opp.interestCount ?? 0) + 1 }).where(eq(opportunities.id, opportunityId));
  return { alreadyExists: false };
}

export async function getInterestsByOpportunity(opportunityId: number) {
  const db = await exigirDb();
  return db.select({
    id: opportunityInterests.id,
    userId: opportunityInterests.userId,
    message: opportunityInterests.message,
    status: opportunityInterests.status,
    createdAt: opportunityInterests.createdAt,
    name: users.name,
    company: users.company,
    country: users.country,
  })
    .from(opportunityInterests)
    .innerJoin(users, eq(users.id, opportunityInterests.userId))
    .where(eq(opportunityInterests.opportunityId, opportunityId))
    .orderBy(desc(opportunityInterests.createdAt));
}

// ─── Saved ────────────────────────────────────────────────────
export async function toggleSaveOpportunity(userId: number, opportunityId: number) {
  const db = await exigirDb();
  const existing = await db.select({ id: savedOpportunities.id })
    .from(savedOpportunities)
    .where(and(eq(savedOpportunities.userId, userId), eq(savedOpportunities.opportunityId, opportunityId)))
    .limit(1);
  if (existing.length > 0) {
    await db.delete(savedOpportunities).where(and(eq(savedOpportunities.userId, userId), eq(savedOpportunities.opportunityId, opportunityId)));
    return { saved: false };
  }
  await db.insert(savedOpportunities).values({ userId, opportunityId });
  return { saved: true };
}

export async function getSavedOpportunities(userId: number) {
  const db = await exigirDb();
  return db.select({ opportunity: opportunities })
    .from(savedOpportunities)
    .innerJoin(opportunities, eq(opportunities.id, savedOpportunities.opportunityId))
    .where(eq(savedOpportunities.userId, userId))
    .orderBy(desc(savedOpportunities.createdAt));
}

// ─── Gold Access ──────────────────────────────────────────────
export async function grantGoldAccess(grantedTo: number, grantedBy: number, reason?: string) {
  const db = await exigirDb();
  // Usar Drizzle ORM diretamente com os campos do schema
  await db.insert(goldAccessGrants).values({
    grantedTo,
    grantedBy,
    reason: reason ?? null,
  });
  await db.update(users).set({ role: "gold" }).where(eq(users.id, grantedTo));
}

export async function revokeGoldAccess(grantedTo: number, revokedBy: number, reason?: string) {
  const db = await exigirDb();
  await db.update(goldAccessGrants)
    .set({ revokedAt: new Date(), revokedBy, revokeReason: reason })
    .where(and(eq(goldAccessGrants.grantedTo, grantedTo)));
  await db.update(users).set({ role: "silver" }).where(eq(users.id, grantedTo));
}

// ─── Sessions ────────────────────────────────────────────────
export async function createSession(data: typeof sessions.$inferInsert) {
  const db = await exigirDb();
  await db.insert(sessions).values(data);
}

export async function getSession(token: string) {
  const db = await exigirDb();
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.sessionToken, token), eq(sessions.isActive, true))).limit(1);
  return rows[0] ?? null;
}

export async function invalidateSession(token: string) {
  const db = await exigirDb();
  await db.update(sessions).set({ isActive: false }).where(eq(sessions.sessionToken, token));
}

export async function invalidateAllUserSessions(userId: number) {
  const db = await exigirDb();
  await db.update(sessions).set({ isActive: false }).where(eq(sessions.userId, userId));
}

// ─── Audit Logs ──────────────────────────────────────────────
export async function logAudit(data: {
  userId?: number;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  status?: "success" | "failure" | "blocked";
  riskLevel?: "low" | "medium" | "high" | "critical";
}) {
  try {
    const db = await exigirDb();
    await db.insert(auditLogs).values({
      ...data,
      status: data.status ?? "success",
      riskLevel: data.riskLevel ?? "low",
    });
  } catch { /* audit failures never crash the app */ }
}

// ─── Login Attempts ──────────────────────────────────────────
export async function checkLoginRateLimit(identifier: string, ip: string): Promise<{ blocked: boolean; blockedUntil?: Date }> {
  const db = await exigirDb();
  const rows = await db.select().from(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.ipAddress, ip))).limit(1);
  const record = rows[0];
  if (!record) return { blocked: false };
  if (record.blockedUntil && record.blockedUntil > new Date()) return { blocked: true, blockedUntil: record.blockedUntil };
  return { blocked: false };
}

export async function recordLoginAttempt(identifier: string, ip: string, success: boolean) {
  const db = await exigirDb();
  const rows = await db.select().from(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.ipAddress, ip))).limit(1);
  const record = rows[0];
  if (success) {
    if (record) await db.delete(loginAttempts).where(eq(loginAttempts.id, record.id));
    return;
  }
  if (!record) {
    await db.insert(loginAttempts).values({ identifier, ipAddress: ip, success: false, attemptCount: 1 });
    return;
  }
  const newCount = (record.attemptCount ?? 0) + 1;
  const blockedUntil = newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : undefined;
  await db.update(loginAttempts)
    .set({ attemptCount: newCount, blockedUntil: blockedUntil ?? record.blockedUntil, success: false })
    .where(eq(loginAttempts.id, record.id));
}

// ─── Notifications ────────────────────────────────────────────
export async function createNotification(data: typeof platformNotifications.$inferInsert) {
  const db = await exigirDb();
  await db.insert(platformNotifications).values(data);
}

export async function getNotifications(userId: number, limit = 20) {
  const db = await exigirDb();
  return db.select().from(platformNotifications)
    .where(eq(platformNotifications.userId, userId))
    .orderBy(desc(platformNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationsRead(userId: number) {
  const db = await exigirDb();
  await db.update(platformNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(platformNotifications.userId, userId), eq(platformNotifications.isRead, false)));
}

// ─── Admin ────────────────────────────────────────────────────
export async function listUsers(filters: { role?: string; search?: string; limit?: number; offset?: number }) {
  const db = await exigirDb();
  const conditions: any[] = [];
  if (filters.role) conditions.push(eq(users.role, filters.role as any));
  if (filters.search) conditions.push(or(like(users.name, `%${filters.search}%`), like(users.email, `%${filters.search}%`)));
  return db.select({
    id: users.id, name: users.name, email: users.email, role: users.role,
    country: users.country, company: users.company, isActive: users.isActive,
    createdAt: users.createdAt, lastSignedIn: users.lastSignedIn,
  }).from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

export async function getAuditLogs(filters: { userId?: number; action?: string; limit?: number; offset?: number }) {
  const db = await exigirDb();
  const conditions: any[] = [];
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
  return db.select().from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);
}

// ─── Matches (sistema original MMM) ────────────────────────────────────────────────
export async function getMatchesForUser(userId: number, limit = 20) {
  const db = await exigirDb();
  return db.select({
    matchId: matches.id,
    matchedUserId: matches.matchedUserId,
    overallScore: matches.overallScore,
    specialtyScore: matches.specialtyScore,
    objectivesScore: matches.objectivesScore,
    incomeScore: matches.incomeScore,
    locationScore: matches.locationScore,
    valuesScore: matches.valuesScore,
    aiInsight: matches.aiInsight,
    userSeen: matches.userSeen,
    userDismissed: matches.userDismissed,
    createdAt: matches.createdAt,
    displayName: userProfiles.displayName,
    avatarUrl: userProfiles.avatarUrl,
    bio: userProfiles.bio,
    city: userProfiles.city,
    country: userProfiles.country,
    sectors: userProfiles.sectors,
    profileCompleteness: userProfiles.profileCompleteness,
    userName: users.name,
    userCompany: users.company,
    userPosition: users.position,
    // Campos de matching
    primarySpecialty: userProfiles.primarySpecialty,
    currentRole: userProfiles.currentRole,
    currentCompany: userProfiles.currentCompany,
    seekingTypes: userProfiles.seekingTypes,
    businessInterests: userProfiles.businessInterests,
    values: userProfiles.values,
    sector: userProfiles.sector,
    experienceYears: userProfiles.experienceYears,
    workStyle: userProfiles.workStyle,
  })
    .from(matches)
    .innerJoin(userProfiles, eq(userProfiles.userId, matches.matchedUserId!))
    .innerJoin(users, eq(users.id, matches.matchedUserId!))
    .where(and(eq(matches.userId, userId), eq(matches.userDismissed, false)))
    .orderBy(desc(matches.overallScore))
    .limit(limit);
}

export async function dismissMatch(userId: number, matchId: number) {
  const db = await exigirDb();
  await db.update(matches)
    .set({ userDismissed: true })
    .where(and(eq(matches.id, matchId), eq(matches.userId, userId)));
}

export async function regenerateMatches(userId: number): Promise<number> {
  const { generateMatchesForUser } = await import("./matching");
  return generateMatchesForUser(userId);
}

// ─── Connections ────────────────────────────────────────────────────────────────
export async function getConnectionsForUser(userId: number) {
  const db = await exigirDb();
  return db.select({
    id: connections.id,
    requesterId: connections.requesterId,
    recipientId: connections.recipientId,
    status: connections.status,
    message: connections.message,
    createdAt: connections.createdAt,
    displayName: userProfiles.displayName,
    avatarUrl: userProfiles.avatarUrl,
    city: userProfiles.city,
    sectors: userProfiles.sectors,
    userName: users.name,
    userCompany: users.company,
    primarySpecialty: userProfiles.primarySpecialty,
  })
    .from(connections)
    .innerJoin(userProfiles, sql`${userProfiles.userId} = CASE WHEN ${connections.requesterId} = ${userId} THEN ${connections.recipientId} ELSE ${connections.requesterId} END`)
    .innerJoin(users, sql`${users.id} = CASE WHEN ${connections.requesterId} = ${userId} THEN ${connections.recipientId} ELSE ${connections.requesterId} END`)
    .where(or(eq(connections.requesterId, userId), eq(connections.recipientId, userId)))
    .orderBy(desc(connections.createdAt))
    .limit(50);
}

export async function sendConnectionRequest(requesterId: number, recipientId: number, message?: string) {
  const db = await exigirDb();
  const existing = await db.select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.requesterId, requesterId), eq(connections.recipientId, recipientId)))
    .limit(1);
  if (existing.length > 0) return { alreadyExists: true };
  await db.insert(connections).values({ requesterId, recipientId, message });
  return { alreadyExists: false };
}

export async function respondToConnection(connectionId: number, userId: number, accept: boolean) {
  const db = await exigirDb();
  await db.update(connections)
    .set({ status: accept ? "accepted" : "declined" })
    .where(and(eq(connections.id, connectionId), eq(connections.recipientId, userId)));
}

// ─── Private Contacts (Minha Rede de Relacionamentos) ─────────────────────────
// TODOS os helpers aplicam RLS: WHERE ownerId = :ownerId obrigatório

export async function createPrivateContact(
  ownerId: string,
  data: Omit<InsertPrivateContact, "id" | "ownerId" | "createdAt" | "updatedAt">
): Promise<number> {
  const db = await exigirDb();
  const now = Date.now();
  const [result] = await db.insert(privateContacts).values({
    ...data,
    ownerId,
    createdAt: now,
    updatedAt: now,
  });
  return (result as any).insertId as number;
}

export async function listPrivateContacts(
  ownerId: string,
  opts: { q?: string; tag?: string; country?: string; page?: number; limit?: number }
): Promise<{ data: PrivateContact[]; total: number }> {
  const db = await exigirDb();
  const { q, tag, country, page = 1, limit = 20 } = opts;
  const offset = (page - 1) * limit;

  // Condições base — RLS sempre presente
  const conditions = [eq(privateContacts.ownerId, ownerId)];
  if (q) {
    conditions.push(
      or(
        like(privateContacts.fullName, `%${q}%`),
        like(privateContacts.company, `%${q}%`),
        like(privateContacts.jobTitle, `%${q}%`)
      )!
    );
  }
  if (country) conditions.push(eq(privateContacts.country, country));

  const rows = await db
    .select()
    .from(privateContacts)
    .where(and(...conditions))
    .orderBy(desc(privateContacts.updatedAt))
    .limit(limit)
    .offset(offset);

  // Filtro de tag em memória (JSON array)
  const filtered = tag
    ? rows.filter(r => Array.isArray(r.profileTags) && r.profileTags.includes(tag))
    : rows;

  // Count total (sem paginação)
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(privateContacts)
    .where(and(...conditions));

  return { data: filtered, total: Number(countRow?.count ?? 0) };
}

export async function getPrivateContactById(
  ownerId: string,
  contactId: number
): Promise<PrivateContact | null> {
  const db = await exigirDb();
  const [row] = await db
    .select()
    .from(privateContacts)
    .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function updatePrivateContact(
  ownerId: string,
  contactId: number,
  data: Partial<Omit<InsertPrivateContact, "id" | "ownerId" | "createdAt">>
): Promise<boolean> {
  const db = await exigirDb();
  const [result] = await db
    .update(privateContacts)
    .set({ ...data, updatedAt: Date.now() })
    .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
  return (result as any).affectedRows > 0;
}

export async function deletePrivateContact(
  ownerId: string,
  contactId: number
): Promise<boolean> {
  const db = await exigirDb();
  const [result] = await db
    .delete(privateContacts)
    .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
  const apagou = (result as any).affectedRows > 0;
  // Contato apagado leva o rastro junto: sem isto, os "possui/procura" dele
  // continuavam alimentando o cruzamento para sempre, e a sugestão sobrevivia
  // apontando para um contato que não existe ("Contato A" fantasma na tela).
  // Não há FK/cascade no banco (colunas bigint sem references), então é aqui.
  if (apagou) {
    await db.delete(contactAssets)
      .where(and(eq(contactAssets.ownerId, ownerId), eq(contactAssets.contactId, contactId)));
    await db.delete(contactNeeds)
      .where(and(eq(contactNeeds.ownerId, ownerId), eq(contactNeeds.contactId, contactId)));
    await db.delete(aiMatchSuggestions)
      .where(and(
        eq(aiMatchSuggestions.ownerId, ownerId),
        drizzleOr(
          eq(aiMatchSuggestions.pairLowContactId, contactId),
          eq(aiMatchSuggestions.pairHighContactId, contactId),
        ),
      ));
  }
  return apagou;
}

/**
 * Etapa 10 — a parte pura do filtro de autorização da dona, separada para os
 * testes executarem de verdade (não só lerem o fonte): contato de dona órfã
 * (conta apagada) sai; contato de dona sem o termo vigente sai.
 */
export function filtrarAcervoPorAutorizacao<T extends { ownerId: string }>(
  compartilhados: T[],
  donaPorOpenId: Map<string, { id: number }>,
  autorizadas: Set<number>,
): T[] {
  return compartilhados.filter(contato => {
    const dona = donaPorOpenId.get(contato.ownerId);
    return dona !== undefined && autorizadas.has(dona.id);
  });
}

/**
 * Etapa 10 — o acervo Ouro: os contatos que as donas marcaram como
 * "Compartilhado com Usuários Ouro" (nivelVisibilidade = 'ouro').
 *
 * Duas autorizações se encontram aqui, e as duas são reavaliadas A CADA
 * requisição, no banco — revogar qualquer uma tira o acesso na hora:
 *  1. A da dona, por contato: o filtro por nível roda em tempo de leitura;
 *     voltar o contato para 'privado' o remove na requisição seguinte.
 *  2. A da dona, pela plataforma: o termo_acesso_ouro (padrão da etapa 11 —
 *     sem versão publicada não há o que consentir e a leitura libera; texto
 *     jurídico com a Cris). Revogar o termo esconde a base inteira da dona.
 * (Quem PODE ler é decidido na rota: goldProcedure, só Status Ouro.)
 *
 * A projeção segue o cartão da etapa 10: nome, empresa e cargo, segmento
 * (tags do perfil), local e possui/procura — e NADA de telefone, whatsapp,
 * e-mail, redes, foto, cartão ou notas: sem mecanismo de "dados pessoais
 * disponibilizados" campo a campo, os canais pessoais ficam de fora. Os
 * níveis não são cumulativos: 'publico' mora na vitrine, não aqui.
 */
export async function listAcervoOuro() {
  const db = await exigirDb();
  // Ordem determinística (mais recentes primeiro) e folga de leitura: o corte
  // final de 200 acontece DEPOIS dos filtros de dona/termo, senão linhas que
  // serão descartadas consumiriam o teto e material autorizado sumiria ao
  // acaso. A folga de 2x mantém a consulta limitada — o acervo é uma tela.
  const compartilhados = await db
    .select({
      id: privateContacts.id,
      fullName: privateContacts.fullName,
      jobTitle: privateContacts.jobTitle,
      company: privateContacts.company,
      country: privateContacts.country,
      city: privateContacts.city,
      profileTags: privateContacts.profileTags,
      ownerId: privateContacts.ownerId,
    })
    .from(privateContacts)
    .where(eq(privateContacts.nivelVisibilidade, "ouro"))
    .orderBy(desc(privateContacts.updatedAt))
    .limit(400);
  if (!compartilhados.length) return [];

  const donasOpenIds = Array.from(new Set(compartilhados.map(contato => contato.ownerId)));
  const donas = await db
    .select({ id: users.id, openId: users.openId, name: users.name })
    .from(users)
    .where(inArray(users.openId, donasOpenIds));
  // Import dinâmico: consent.ts importa exigirDb daqui; estático viraria ciclo.
  const { usersComConsentimento } = await import("./routers/consent");
  const autorizadas = await usersComConsentimento(donas.map(dona => dona.id), "termo_acesso_ouro");
  const donaPorOpenId = new Map(donas.map(dona => [dona.openId, dona]));
  const visiveis = filtrarAcervoPorAutorizacao(compartilhados, donaPorOpenId, autorizadas).slice(0, 200);
  if (!visiveis.length) return [];

  const ids = visiveis.map(contato => contato.id);
  const [possuiTudo, procuraTudo] = await Promise.all([
    db.select({ contactId: contactAssets.contactId, label: contactAssets.tagLabel, category: contactAssets.category })
      .from(contactAssets).where(inArray(contactAssets.contactId, ids)),
    db.select({ contactId: contactNeeds.contactId, label: contactNeeds.tagLabel, category: contactNeeds.category })
      .from(contactNeeds).where(inArray(contactNeeds.contactId, ids)),
  ]);
  // Referência opaca com sal PRÓPRIO: nem correlaciona com o id sequencial,
  // nem com a referência que o mesmo contato teria na vitrine coletiva.
  const referenciaOpaca = (id: number) =>
    nodeCrypto.createHash("sha256").update(`acervo-ouro:${ENV.cookieSecret}:${id}`).digest("hex").slice(0, 10);
  return visiveis.map(contato => ({
    contatoRef: referenciaOpaca(contato.id),
    fullName: contato.fullName,
    jobTitle: contato.jobTitle,
    company: contato.company,
    country: contato.country,
    city: contato.city,
    profileTags: contato.profileTags ?? [],
    compartilhadoPor: donaPorOpenId.get(contato.ownerId)?.name ?? null,
    possui: possuiTudo.filter(item => item.contactId === contato.id).map(({ label, category }) => ({ label, category })),
    procura: procuraTudo.filter(item => item.contactId === contato.id).map(({ label, category }) => ({ label, category })),
  }));
}

/**
 * Etapa 8 — a vitrine coletiva do ecossistema.
 *
 * O escopo é explícito: de um contato público "não pode aparecer os dados
 * pessoais do contato, só as oportunidades". Não basta filtrar linhas — as
 * colunas pessoais (nome, empresa, cargo, telefone, whatsapp, email, linkedin,
 * instagram, foto, cartão) NEM SÃO SELECIONADAS aqui, seguindo a projeção de
 * privacidade.md. Sai só: uma referência opaca, país, cidade e o que o contato
 * possui/procura. O filtro por nível roda no banco a cada leitura, então
 * voltar para 'privado' remove da vitrine na requisição seguinte.
 */
export async function listVitrineColetiva() {
  const db = await exigirDb();
  // Teto de leitura: a vitrine é uma tela, não uma exportação. Sem o limite,
  // cada visita carregaria o ecossistema inteiro.
  const publicos = await db
    .select({ id: privateContacts.id, country: privateContacts.country, city: privateContacts.city })
    .from(privateContacts)
    .where(eq(privateContacts.nivelVisibilidade, "publico"))
    .limit(200);
  if (!publicos.length) return [];
  const ids = publicos.map(publico => publico.id);
  const [possui, procura] = await Promise.all([
    db.select({ contactId: contactAssets.contactId, label: contactAssets.tagLabel, category: contactAssets.category })
      .from(contactAssets).where(inArray(contactAssets.contactId, ids)),
    db.select({ contactId: contactNeeds.contactId, label: contactNeeds.tagLabel, category: contactNeeds.category })
      .from(contactNeeds).where(inArray(contactNeeds.contactId, ids)),
  ]);
  // A referência precisa ser OPACA de verdade: o id sequencial da tabela conta
  // quantos contatos existem e permite correlação com qualquer outro endpoint
  // que um dia exponha ids. Um hash com sal de servidor identifica o item na
  // tela sem entregar nada — e continua estável entre leituras.
  const referenciaOpaca = (id: number) =>
    nodeCrypto.createHash("sha256").update(`vitrine:${ENV.cookieSecret}:${id}`).digest("hex").slice(0, 10);
  return publicos.map(publico => ({
    contatoRef: referenciaOpaca(publico.id),
    country: publico.country,
    city: publico.city,
    possui: possui.filter(item => item.contactId === publico.id).map(({ label, category }) => ({ label, category })),
    procura: procura.filter(item => item.contactId === publico.id).map(({ label, category }) => ({ label, category })),
  }));
}

// ─── Contextos (Onde e Como Conheceu) ─────────────────────────────────────────

export async function listContextTypes(): Promise<ContextType[]> {
  const db = await exigirDb();
  return db.select().from(contextTypes).where(eq(contextTypes.isActive, true)).orderBy(contextTypes.sortOrder);
}

export async function listContexts(
  ownerId: string,
  opts: { q?: string; typeSlug?: string; year?: number; country?: string; page?: number; limit?: number }
): Promise<{ data: (Context & { typeName?: string; typeColor?: string; typeSlug?: string; contactCount: number })[]; total: number }> {
  const db = await exigirDb();
  const { q, typeSlug, year, country, page = 1, limit = 20 } = opts;
  const offset = (page - 1) * limit;

  // Buscar contextos do usuário + globais
  const rows = await db
    .select({
      ctx: contexts,
      typeName: contextTypes.name,
      typeColor: contextTypes.colorToken,
      typeSlug: contextTypes.slug,
    })
    .from(contexts)
    .leftJoin(contextTypes, eq(contexts.contextTypeId, contextTypes.id))
    .where(
      and(
        drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId)),
        typeSlug ? eq(contextTypes.slug, typeSlug) : undefined,
        country ? like(contexts.country, `%${country}%`) : undefined,
        q ? drizzleOr(like(contexts.name, `%${q}%`), like(contexts.notes, `%${q}%`)) : undefined,
      )
    )
    .orderBy(desc(contexts.createdAt))
    .limit(limit)
    .offset(offset);

  // Contar contatos por contexto
  const contextIds = rows.map(r => r.ctx.id);
  const countMap: Record<string, number> = {};
  if (contextIds.length > 0) {
    for (const ctxId of contextIds) {
      const [c] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(contactContexts)
        .where(and(eq(contactContexts.contextId, ctxId), eq(contactContexts.ownerId, ownerId)));
      countMap[ctxId] = Number(c?.count ?? 0);
    }
  }

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contexts)
    .leftJoin(contextTypes, eq(contexts.contextTypeId, contextTypes.id))
    .where(
      and(
        drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId)),
        typeSlug ? eq(contextTypes.slug, typeSlug) : undefined,
        country ? like(contexts.country, `%${country}%`) : undefined,
        q ? drizzleOr(like(contexts.name, `%${q}%`), like(contexts.notes, `%${q}%`)) : undefined,
      )
    );

  return {
    data: rows.map(r => ({
      ...r.ctx,
      typeName: r.typeName ?? undefined,
      typeColor: r.typeColor ?? undefined,
      // Sem o slug a tela não acha o ícone do tipo e — pior — o formulário de
      // edição abre com o tipo vazio e salvar apaga o tipo do contexto.
      typeSlug: r.typeSlug ?? undefined,
      contactCount: countMap[r.ctx.id] ?? 0,
    })),
    total: Number(countRow?.count ?? 0),
  };
}

export async function createContext(
  ownerId: string,
  data: Omit<typeof contexts.$inferInsert, "id" | "ownerId" | "createdAt" | "updatedAt" | "isCustom">
): Promise<string> {
  const db = await exigirDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contexts).values({ ...data, id, ownerId, isCustom: true, createdAt: now, updatedAt: now });
  return id;
}

export async function getContextById(ownerId: string, contextId: string) {
  const db = await exigirDb();
  const [row] = await db
    .select({ ctx: contexts, typeName: contextTypes.name, typeColor: contextTypes.colorToken, typeSlug: contextTypes.slug, typeIcon: contextTypes.iconName })
    .from(contexts)
    .leftJoin(contextTypes, eq(contexts.contextTypeId, contextTypes.id))
    .where(and(eq(contexts.id, contextId), drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId))))
    .limit(1);
  if (!row) return null;

  const links = await db.select().from(contactContexts)
    .where(and(eq(contactContexts.contextId, contextId), eq(contactContexts.ownerId, ownerId)));
  // O nome de quem foi vinculado — sem ele a tela mostrava "Contato #42".
  const idsVinculados = Array.from(new Set(links.map(l => l.contactId)));
  const nomes = idsVinculados.length
    ? await db.select({ id: privateContacts.id, fullName: privateContacts.fullName }).from(privateContacts)
        .where(and(eq(privateContacts.ownerId, ownerId), inArray(privateContacts.id, idsVinculados)))
    : [];
  const nomePorContato = new Map(nomes.map(n => [n.id, n.fullName]));
  const participants = await db.select().from(contextParticipants)
    .where(and(eq(contextParticipants.contextId, contextId), eq(contextParticipants.ownerId, ownerId)));
  const media = await db.select().from(contextMedia)
    .where(and(eq(contextMedia.contextId, contextId), eq(contextMedia.ownerId, ownerId)))
    .orderBy(contextMedia.sortOrder, contextMedia.createdAt);

  return {
    ...row.ctx, typeName: row.typeName, typeColor: row.typeColor, typeSlug: row.typeSlug, typeIcon: row.typeIcon,
    links: links.map(l => ({ ...l, contactName: nomePorContato.get(l.contactId) ?? null })),
    participants, media,
  };
}

export async function updateContext(ownerId: string, contextId: string, data: Partial<typeof contexts.$inferInsert>): Promise<boolean> {
  const db = await exigirDb();
  const [r] = await db.update(contexts)
    .set({ ...data, updatedAt: Date.now() })
    .where(and(eq(contexts.id, contextId), eq(contexts.ownerId, ownerId), eq(contexts.isCustom, true)));
  return (r as any).affectedRows > 0;
}

export async function deleteContext(ownerId: string, contextId: string): Promise<boolean> {
  const db = await exigirDb();
  // Os registros de anexos saem junto: não há FK/cascade no schema herdado, e
  // linha de mídia órfã esconderia arquivo que continua existindo no bucket.
  await db.delete(contextMedia)
    .where(and(eq(contextMedia.contextId, contextId), eq(contextMedia.ownerId, ownerId)));
  const [r] = await db.delete(contexts)
    .where(and(eq(contexts.id, contextId), eq(contexts.ownerId, ownerId)));
  return (r as any).affectedRows > 0;
}

export async function listContextMediaByContext(ownerId: string, contextId: string) {
  const db = await exigirDb();
  return db.select().from(contextMedia)
    .where(and(eq(contextMedia.contextId, contextId), eq(contextMedia.ownerId, ownerId)));
}

export async function linkContactToContext(
  ownerId: string,
  data: { contactId: number; contextId: string; eventDate?: string; city?: string; country?: string; notes?: string; relationshipType?: string }
): Promise<string> {
  const db = await exigirDb();
  // Vincular duas vezes não duplica: o vínculo existente é atualizado com o
  // que veio preenchido e devolvido. Jogar fora o que a usuária digitou (data,
  // cidade, notas) com um toast de sucesso seria mentir para ela.
  const [jaExiste] = await db.select({ id: contactContexts.id }).from(contactContexts)
    .where(and(
      eq(contactContexts.ownerId, ownerId),
      eq(contactContexts.contactId, data.contactId),
      eq(contactContexts.contextId, data.contextId),
    ))
    .limit(1);
  if (jaExiste) {
    const atualiza: Record<string, unknown> = {};
    if (data.eventDate) atualiza.eventDate = data.eventDate;
    if (data.city) atualiza.city = data.city;
    if (data.country) atualiza.country = data.country;
    if (data.notes) atualiza.notes = data.notes;
    if (data.relationshipType) atualiza.relationshipType = data.relationshipType;
    if (Object.keys(atualiza).length > 0) {
      await db.update(contactContexts).set({ ...atualiza, updatedAt: Date.now() })
        .where(and(eq(contactContexts.id, jaExiste.id), eq(contactContexts.ownerId, ownerId)));
    }
    return jaExiste.id;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contactContexts).values({
    id, ownerId,
    contactId: data.contactId,
    contextId: data.contextId,
    eventDate: data.eventDate ?? null,
    city: data.city ?? null,
    country: data.country ?? null,
    notes: data.notes ?? null,
    relationshipType: data.relationshipType ?? "profissional",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function unlinkContactFromContext(ownerId: string, linkId: string): Promise<boolean> {
  const db = await exigirDb();
  const [r] = await db.delete(contactContexts)
    .where(and(eq(contactContexts.id, linkId), eq(contactContexts.ownerId, ownerId)));
  return (r as any).affectedRows > 0;
}

/** Os contextos em que um contato apareceu — é o que o perfil do contato exibe. */
export async function listContextsByContact(ownerId: string, contactId: number) {
  const db = await exigirDb();
  const rows = await db
    .select({
      link: contactContexts,
      ctxName: contexts.name,
      typeName: contextTypes.name,
      typeColor: contextTypes.colorToken,
      typeSlug: contextTypes.slug,
    })
    .from(contactContexts)
    .innerJoin(contexts, eq(contactContexts.contextId, contexts.id))
    .leftJoin(contextTypes, eq(contexts.contextTypeId, contextTypes.id))
    .where(and(eq(contactContexts.ownerId, ownerId), eq(contactContexts.contactId, contactId)))
    .orderBy(desc(contactContexts.createdAt));
  return rows.map(r => ({
    linkId: r.link.id,
    contextId: r.link.contextId,
    name: r.ctxName,
    eventDate: r.link.eventDate,
    city: r.link.city,
    country: r.link.country,
    relationshipType: r.link.relationshipType,
    typeName: r.typeName ?? undefined,
    typeColor: r.typeColor ?? undefined,
    typeSlug: r.typeSlug ?? undefined,
  }));
}

export async function addContextParticipant(
  ownerId: string,
  data: { contextId: string; name: string; company?: string; role?: string; notes?: string }
): Promise<string> {
  const db = await exigirDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contextParticipants).values({ id, ownerId, ...data, createdAt: now, updatedAt: now });
  return id;
}

// ─── Mídia de contextos (fotos e documentos do encontro) ──────────────────────

/** O contexto está visível para esta dona? (dela mesma, ou do catálogo global) */
export async function contextIsVisible(ownerId: string, contextId: string): Promise<boolean> {
  const db = await exigirDb();
  const [row] = await db.select({ id: contexts.id }).from(contexts)
    .where(and(eq(contexts.id, contextId), drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId))))
    .limit(1);
  return Boolean(row);
}

export async function addContextMedia(
  ownerId: string,
  data: {
    contextId: string; storagePath: string; fileType: string; fileSize: number;
    originalName: string; caption?: string | null;
  }
): Promise<string> {
  const db = await exigirDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contextMedia).values({
    id, ownerId,
    contextId: data.contextId,
    storagePath: data.storagePath,
    fileType: data.fileType,
    fileSize: data.fileSize,
    originalName: data.originalName,
    caption: data.caption ?? null,
    uploadedBy: ownerId,
    createdAt: now, updatedAt: now,
  });
  return id;
}

export async function getContextMediaById(ownerId: string, mediaId: string) {
  const db = await exigirDb();
  const [row] = await db.select().from(contextMedia)
    .where(and(eq(contextMedia.id, mediaId), eq(contextMedia.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function deleteContextMedia(ownerId: string, mediaId: string): Promise<boolean> {
  const db = await exigirDb();
  const [r] = await db.delete(contextMedia)
    .where(and(eq(contextMedia.id, mediaId), eq(contextMedia.ownerId, ownerId)));
  return (r as any).affectedRows > 0;
}

// ─── Enriquecimento com IA (Etapa 4) ──────────────────────────────────────────

export async function getActiveEnrichmentSession(ownerId: string, contactId: number) {
  const db = await exigirDb();
  const [row] = await db.select().from(enrichmentSessions)
    .where(and(eq(enrichmentSessions.ownerId, ownerId), eq(enrichmentSessions.contactId, contactId), eq(enrichmentSessions.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function getEnrichmentSessionById(sessionId: string, ownerId: string) {
  const db = await exigirDb();
  const [row] = await db.select().from(enrichmentSessions)
    .where(and(eq(enrichmentSessions.id, sessionId), eq(enrichmentSessions.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

/** Avança exatamente uma etapa do roteiro. Retorna null quando a sessão não estiver ativa. */
export async function advanceEnrichmentSession(sessionId: string, ownerId: string, skipped = false) {
  const db = await exigirDb();
  const session = await getEnrichmentSessionById(sessionId, ownerId);
  if (!session || session.status !== "active") return null;

  const now = Date.now();
  const questionsAnswered = (session.questionsAnswered ?? 0) + 1;
  const questionsSkipped = (session.questionsSkipped ?? 0) + (skipped ? 1 : 0);
  await db.update(enrichmentSessions)
    .set({ questionsAnswered, questionsSkipped, lastActivityAt: now, updatedAt: now })
    .where(and(eq(enrichmentSessions.id, sessionId), eq(enrichmentSessions.ownerId, ownerId), eq(enrichmentSessions.status, "active")));

  return { ...session, questionsAnswered, questionsSkipped };
}

export async function createEnrichmentSession(ownerId: string, contactId: number): Promise<string> {
  const db = await exigirDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(enrichmentSessions).values({ id, ownerId, contactId, status: "active", questionsAnswered: 0, questionsSkipped: 0, lastActivityAt: now, createdAt: now, updatedAt: now });
  // Atualizar enrichment_status no contato
  await db.update(privateContacts).set({ enrichmentStatus: "active" }).where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
  return id;
}

export async function getEnrichmentMessages(sessionId: string, ownerId: string, limit = 10) {
  const db = await exigirDb();
  return db.select().from(enrichmentMessages)
    .where(and(eq(enrichmentMessages.sessionId, sessionId), eq(enrichmentMessages.ownerId, ownerId)))
    .orderBy(desc(enrichmentMessages.createdAt))
    .limit(limit);
}

export async function saveEnrichmentMessage(data: {
  sessionId: string; ownerId: string; role: string; content: string; metadata?: unknown; tokenCount?: number;
}): Promise<string> {
  const db = await exigirDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(enrichmentMessages).values({ id, sessionId: data.sessionId, ownerId: data.ownerId, role: data.role, content: data.content, metadata: data.metadata ?? null, tokenCount: data.tokenCount ?? null, createdAt: now, updatedAt: now });
  // Atualizar last_activity_at da sessão
  await db.update(enrichmentSessions).set({ lastActivityAt: now, updatedAt: now }).where(eq(enrichmentSessions.id, data.sessionId));
  return id;
}

export async function saveEnrichmentSuggestions(suggestions: Array<{
  sessionId: string; messageId: string; ownerId: string; contactId: number;
  fieldType: string; suggestedValue: string; confidence: number; tagIsNew?: boolean; tagId?: string;
}>): Promise<string[]> {
  const db = await exigirDb();
  const ids: string[] = [];
  const now = Date.now();
  for (const s of suggestions) {
    const id = crypto.randomUUID();
    await db.insert(enrichmentSuggestions).values({ id, sessionId: s.sessionId, messageId: s.messageId, ownerId: s.ownerId, contactId: s.contactId, fieldType: s.fieldType, suggestedValue: s.suggestedValue, confidence: String(s.confidence), status: "pending", tagIsNew: s.tagIsNew ?? false, tagId: s.tagId ?? null, createdAt: now, updatedAt: now });
    ids.push(id);
  }
  return ids;
}

export async function getEnrichmentSuggestion(id: string, ownerId: string) {
  const db = await exigirDb();
  const [row] = await db.select().from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.id, id), eq(enrichmentSuggestions.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

/**
 * Grava no contato a resposta que a usuária confirmou no chat de enriquecimento.
 *
 * Cada tipo de resposta tem um destino, e "assets" e "needs" são os que mais
 * importam: caem em contact_assets/contact_needs, que é de onde o Cruzamento
 * Inteligente lê. É isto que torna o chat o caminho automático de alimentar o
 * match — a pessoa conversa, e o possui/procura do contato se preenche sozinho.
 *
 * A versão anterior deste código marcava tudo como "applied" e só gravava os
 * campos simples de perfil (telefone, empresa...). assets, needs, how_met e
 * relationship_type não estavam no mapa e eram jogados fora em silêncio — 18
 * respostas confirmadas se perderam assim, e scripts/recuperar-enriquecimento.mjs
 * existe para reaplicá-las. A ordem também importava e estava errada: o status
 * virava "applied" ANTES de qualquer escrita, então uma falha na escrita deixava
 * a sugestão mentindo que foi aplicada. Agora grava primeiro, marca depois.
 */
export async function applyEnrichmentSuggestion(id: string, ownerId: string, editedValue?: string): Promise<boolean> {
  const db = await exigirDb();
  const sug = await getEnrichmentSuggestion(id, ownerId);
  if (!sug || sug.status !== "pending") return false;
  const finalValue = (editedValue ?? sug.suggestedValue).trim();
  const now = Date.now();

  await aplicarRespostaAoContato(db, ownerId, sug.contactId, sug.fieldType, finalValue, now);

  await db.update(enrichmentSuggestions).set({ status: "applied", appliedValue: finalValue, actionedAt: now, actionedBy: "user", updatedAt: now }).where(eq(enrichmentSuggestions.id, id));
  return true;
}

/**
 * O destino de cada resposta. Devolve true quando gravou e false quando não
 * havia nada a fazer (valor vazio, item já existente, linha já anotada) — é o
 * que deixa o script de recuperação relatar a verdade em vez de contar de novo
 * o que já estava lá. Exportada porque o script replays as respostas antigas
 * por aqui — mesmo caminho, mesma de-duplicação.
 */
export async function aplicarRespostaAoContato(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  ownerId: string,
  contactId: number,
  fieldType: string,
  valor: string,
  now: number,
): Promise<boolean> {
  if (!valor || !valor.trim()) return false;

  // Contato apagado no meio da conversa não pode voltar a existir em pedaços:
  // sem esta guarda, a resposta confirmada depois da exclusão recriava
  // possui/procura órfãos — combustível novo para match fantasma.
  const [contatoVivo] = await db.select({ id: privateContacts.id }).from(privateContacts)
    .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)))
    .limit(1);
  if (!contatoVivo) return false;

  // ── campos simples do perfil do contato ────────────────────────────────────
  const fieldMap: Record<string, string> = {
    phone: "phone", whatsapp: "whatsapp", email: "email",
    company: "company", job_title: "jobTitle", city: "city",
    country: "country", linkedin_url: "linkedinUrl",
    // A coluna chama-se `instagram`; o mapa antigo apontava para uma coluna
    // inexistente e a primeira sugestão de instagram confirmada quebraria aqui.
    instagram_handle: "instagram",
  };
  const dbField = fieldMap[fieldType];
  if (dbField) {
    await db.update(privateContacts).set({ [dbField]: valor, updatedAt: now } as any)
      .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
    return true;
  }

  // ── o que o contato possui / procura: o combustível do cruzamento ──────────
  if (fieldType === "assets" || fieldType === "needs") {
    const tabela = fieldType === "assets" ? contactAssets : contactNeeds;
    const slug = slugifyMatchTag(valor);
    if (!slug) return false;
    // Confirmar duas vezes a mesma resposta não pode duplicar o item — as
    // sugestões antigas têm repetição real ("fabrica" cinco vezes no mesmo
    // contato) e o script de recuperação passa por aqui.
    const [existente] = await db.select({ id: tabela.id }).from(tabela)
      .where(and(eq(tabela.ownerId, ownerId), eq(tabela.contactId, contactId), eq(tabela.tagSlug, slug)))
      .limit(1);
    if (existente) return false;
    await db.insert(tabela).values({
      ownerId, contactId, tagSlug: slug, tagLabel: valor, createdAt: now, updatedAt: now,
    });
    return true;
  }

  // ── como se conheceram: anotação + contexto de verdade (etapa 5) ───────────
  if (fieldType === "how_met") {
    const linha = `Como se conheceram: ${valor}`;
    const [contato] = await db.select({ notes: privateContacts.notes }).from(privateContacts)
      .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)))
      .limit(1);
    if (!contato) return false;

    let gravouNota = false;
    if (!contato.notes?.includes(linha)) {
      const notas = contato.notes ? `${contato.notes}
${linha}` : linha;
      await db.update(privateContacts).set({ notes: notas, updatedAt: now })
        .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
      gravouNota = true;
    }

    // O critério da etapa 4 pede a resposta LIGADA ao contexto da etapa 5, não
    // só anotada. A resposta vira (ou reusa) um contexto com esse nome e o
    // contato entra em contact_contexts — que é de onde a tela de contextos e
    // as buscas leem. Nota e vínculo têm dedução separada de propósito: as
    // respostas antigas recuperadas só têm a nota, e reprocessá-las por aqui
    // (scripts/recuperar-enriquecimento.ts) completa o vínculo que faltou.
    const nomeContexto = valor.slice(0, 100);
    // Reusa também os contextos do catálogo global (ownerId null) — senão uma
    // resposta como "CPHI" criaria um contexto privado homônimo e a lista
    // mostraria o nome duas vezes. Havendo os dois, o da própria dona vence.
    const [ctxExistente] = await db.select({ id: contexts.id }).from(contexts)
      .where(and(
        drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId)),
        eq(contexts.name, nomeContexto),
      ))
      .orderBy(desc(contexts.ownerId))
      .limit(1);
    let idContexto = ctxExistente?.id;
    if (!idContexto) {
      idContexto = crypto.randomUUID();
      await db.insert(contexts).values({
        id: idContexto, ownerId, contextTypeId: null, name: nomeContexto,
        isCustom: true, visibility: "private", createdAt: now, updatedAt: now,
      });
    }
    const [vinculoExistente] = await db.select({ id: contactContexts.id }).from(contactContexts)
      .where(and(
        eq(contactContexts.ownerId, ownerId),
        eq(contactContexts.contactId, contactId),
        eq(contactContexts.contextId, idContexto),
      ))
      .limit(1);
    let gravouVinculo = false;
    if (!vinculoExistente) {
      await db.insert(contactContexts).values({
        id: crypto.randomUUID(), ownerId, contactId, contextId: idContexto,
        relationshipType: "profissional", visibility: "private", createdAt: now, updatedAt: now,
      });
      gravouVinculo = true;
    }
    return gravouNota || gravouVinculo;
  }

  // ── tipo de relacionamento: vai para as anotações do contato ───────────────
  if (fieldType === "relationship_type") {
    const linha = `Relacionamento: ${valor}`;
    const [contato] = await db.select({ notes: privateContacts.notes }).from(privateContacts)
      .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)))
      .limit(1);
    if (!contato || contato.notes?.includes(linha)) return false;
    const notas = contato.notes ? `${contato.notes}
${linha}` : linha;
    await db.update(privateContacts).set({ notes: notas, updatedAt: now })
      .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
    return true;
  }

  // Tipo desconhecido: não há onde gravar, e fingir que gravou é o defeito que
  // este código existe para não repetir.
  throw new Error(`Tipo de resposta sem destino: ${fieldType}`);
}

export async function ignoreEnrichmentSuggestion(id: string, ownerId: string): Promise<boolean> {
  const db = await exigirDb();
  const now = Date.now();
  const [r] = await db.update(enrichmentSuggestions)
    .set({ status: "ignored", actionedAt: now, actionedBy: "user", updatedAt: now })
    .where(and(eq(enrichmentSuggestions.id, id), eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.status, "pending")));
  return (r as any).affectedRows > 0;
}

export async function completeEnrichmentSession(sessionId: string, ownerId: string, summary: string): Promise<boolean> {
  const db = await exigirDb();
  const session = await getEnrichmentSessionById(sessionId, ownerId);
  if (!session) return false;
  // Encerramento idempotente: uma sessão já concluída não gera efeitos colaterais nem mensagens extras.
  if (session.status === "completed") return true;
  if (session.status !== "active") return false;
  const now = Date.now();
  const [r] = await db.update(enrichmentSessions)
    .set({ status: "completed", summary, completedAt: now, updatedAt: now })
    .where(and(eq(enrichmentSessions.id, sessionId), eq(enrichmentSessions.ownerId, ownerId), eq(enrichmentSessions.status, "active")));
  if ((r as any).affectedRows > 0) {
    // Atualizar status no contato
    const [sess] = await db.select().from(enrichmentSessions).where(eq(enrichmentSessions.id, sessionId)).limit(1);
    if (sess) {
      await db.update(privateContacts).set({ enrichmentStatus: "completed" })
        .where(and(eq(privateContacts.id, sess.contactId), eq(privateContacts.ownerId, ownerId)));
    }
  }
  return (r as any).affectedRows > 0;
}

export async function getEnrichmentHistory(ownerId: string, contactId: number, limit = 20, offset = 0) {
  const db = await exigirDb();
  const rows = await db.select().from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.contactId, contactId), sql`${enrichmentSuggestions.status} IN ('applied', 'ignored', 'undone')`))
    .orderBy(desc(enrichmentSuggestions.createdAt))
    .limit(limit).offset(offset);
  const [c] = await db.select({ count: sql<number>`COUNT(*)` }).from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.contactId, contactId), sql`${enrichmentSuggestions.status} IN ('applied', 'ignored', 'undone')`));
  return { data: rows, total: Number(c?.count ?? 0) };
}
