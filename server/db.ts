import { and, eq, desc, like, or, ne, notInArray, sql, isNull } from "drizzle-orm";
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
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
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
  else if (user.openId === ENV.ownerOpenId) { values.role = 'president'; updateSet.role = 'president'; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  // Não filtrar por isActive aqui: filtrar causava loop de login para contas reativadas.
  // A recusa de conta desativada é feita em sdk.authenticateRequest, no callback OAuth e em loginUser.
  const result = await db.select().from(users)
    .where(eq(users.openId, openId)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data as any).where(eq(users.id, id));
}

// ─── User Profiles ────────────────────────────────────────────
export async function getUserProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUserProfile(userId: number, data: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserProfile(userId);
  if (existing) {
    await db.update(userProfiles).set({ ...data, updatedAt: new Date() } as any).where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({ userId, ...data } as any);
  }
}

// ─── Opportunities ────────────────────────────────────────────
export async function getOpportunityById(id: number) {
  const db = await getDb();
  if (!db) return null;
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
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  conditions.push(eq(opportunities.status, (filters.status ?? "active") as any));
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(opportunities).values(data as any);
  return (result[0] as any).insertId as number;
}

export async function updateOpportunity(id: number, data: Partial<typeof opportunities.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(opportunities).set(data as any).where(eq(opportunities.id, id));
}

// ─── Documents ────────────────────────────────────────────────
export async function getDocumentsByOpportunity(opportunityId: number, includeConfidential = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [eq(opportunityDocuments.opportunityId, opportunityId)];
  if (!includeConfidential) conditions.push(eq(opportunityDocuments.isConfidential, false));
  return db.select().from(opportunityDocuments).where(and(...conditions));
}

export async function addDocument(data: typeof opportunityDocuments.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(opportunityDocuments).values(data);
  return (result[0] as any).insertId as number;
}

// ─── Interests ────────────────────────────────────────────────
export async function expressInterest(opportunityId: number, userId: number, message?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) return [];
  return db.select({ opportunity: opportunities })
    .from(savedOpportunities)
    .innerJoin(opportunities, eq(opportunities.id, savedOpportunities.opportunityId))
    .where(eq(savedOpportunities.userId, userId))
    .orderBy(desc(savedOpportunities.createdAt));
}

// ─── Gold Access ──────────────────────────────────────────────
export async function grantGoldAccess(grantedTo: number, grantedBy: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Usar Drizzle ORM diretamente com os campos do schema
  await db.insert(goldAccessGrants).values({
    grantedTo,
    grantedBy,
    reason: reason ?? null,
  });
  await db.update(users).set({ role: "gold" }).where(eq(users.id, grantedTo));
}

export async function revokeGoldAccess(grantedTo: number, revokedBy: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(goldAccessGrants)
    .set({ revokedAt: new Date(), revokedBy, revokeReason: reason })
    .where(and(eq(goldAccessGrants.grantedTo, grantedTo)));
  await db.update(users).set({ role: "silver" }).where(eq(users.id, grantedTo));
}

// ─── Sessions ────────────────────────────────────────────────
export async function createSession(data: typeof sessions.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(sessions).values(data);
}

export async function getSession(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.sessionToken, token), eq(sessions.isActive, true))).limit(1);
  return rows[0] ?? null;
}

export async function invalidateSession(token: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(sessions).set({ isActive: false }).where(eq(sessions.sessionToken, token));
}

export async function invalidateAllUserSessions(userId: number) {
  const db = await getDb();
  if (!db) return;
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
    const db = await getDb();
    if (!db) return;
    await db.insert(auditLogs).values({
      ...data,
      status: data.status ?? "success",
      riskLevel: data.riskLevel ?? "low",
    });
  } catch { /* audit failures never crash the app */ }
}

// ─── Login Attempts ──────────────────────────────────────────
export async function checkLoginRateLimit(identifier: string, ip: string): Promise<{ blocked: boolean; blockedUntil?: Date }> {
  const db = await getDb();
  if (!db) return { blocked: false };
  const rows = await db.select().from(loginAttempts)
    .where(and(eq(loginAttempts.identifier, identifier), eq(loginAttempts.ipAddress, ip))).limit(1);
  const record = rows[0];
  if (!record) return { blocked: false };
  if (record.blockedUntil && record.blockedUntil > new Date()) return { blocked: true, blockedUntil: record.blockedUntil };
  return { blocked: false };
}

export async function recordLoginAttempt(identifier: string, ip: string, success: boolean) {
  const db = await getDb();
  if (!db) return;
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
  const db = await getDb();
  if (!db) return;
  await db.insert(platformNotifications).values(data);
}

export async function getNotifications(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(platformNotifications)
    .where(eq(platformNotifications.userId, userId))
    .orderBy(desc(platformNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(platformNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(platformNotifications.userId, userId), eq(platformNotifications.isRead, false)));
}

// ─── Admin ────────────────────────────────────────────────────
export async function listUsers(filters: { role?: string; search?: string; limit?: number; offset?: number }) {
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) return;
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
  const db = await getDb();
  if (!db) return [];
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.requesterId, requesterId), eq(connections.recipientId, recipientId)))
    .limit(1);
  if (existing.length > 0) return { alreadyExists: true };
  await db.insert(connections).values({ requesterId, recipientId, message });
  return { alreadyExists: false };
}

export async function respondToConnection(connectionId: number, userId: number, accept: boolean) {
  const db = await getDb();
  if (!db) return;
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db
    .delete(privateContacts)
    .where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
  return (result as any).affectedRows > 0;
}

// ─── Contextos (Onde e Como Conheceu) ─────────────────────────────────────────

export async function listContextTypes(): Promise<ContextType[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contextTypes).where(eq(contextTypes.isActive, true)).orderBy(contextTypes.sortOrder);
}

export async function listContexts(
  ownerId: string,
  opts: { q?: string; typeSlug?: string; year?: number; country?: string; page?: number; limit?: number }
): Promise<{ data: (Context & { typeName?: string; typeColor?: string; contactCount: number })[]; total: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
      contactCount: countMap[r.ctx.id] ?? 0,
    })),
    total: Number(countRow?.count ?? 0),
  };
}

export async function createContext(
  ownerId: string,
  data: Omit<typeof contexts.$inferInsert, "id" | "ownerId" | "createdAt" | "updatedAt" | "isCustom">
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contexts).values({ ...data, id, ownerId, isCustom: true, createdAt: now, updatedAt: now });
  return id;
}

export async function getContextById(ownerId: string, contextId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({ ctx: contexts, typeName: contextTypes.name, typeColor: contextTypes.colorToken, typeSlug: contextTypes.slug, typeIcon: contextTypes.iconName })
    .from(contexts)
    .leftJoin(contextTypes, eq(contexts.contextTypeId, contextTypes.id))
    .where(and(eq(contexts.id, contextId), drizzleOr(eq(contexts.ownerId, ownerId), isNull(contexts.ownerId))))
    .limit(1);
  if (!row) return null;

  const links = await db.select().from(contactContexts)
    .where(and(eq(contactContexts.contextId, contextId), eq(contactContexts.ownerId, ownerId)));
  const participants = await db.select().from(contextParticipants)
    .where(and(eq(contextParticipants.contextId, contextId), eq(contextParticipants.ownerId, ownerId)));
  const media = await db.select().from(contextMedia)
    .where(and(eq(contextMedia.contextId, contextId), eq(contextMedia.ownerId, ownerId)))
    .orderBy(contextMedia.sortOrder, contextMedia.createdAt);

  return { ...row.ctx, typeName: row.typeName, typeColor: row.typeColor, typeSlug: row.typeSlug, typeIcon: row.typeIcon, links, participants, media };
}

export async function updateContext(ownerId: string, contextId: string, data: Partial<typeof contexts.$inferInsert>): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [r] = await db.update(contexts)
    .set({ ...data, updatedAt: Date.now() })
    .where(and(eq(contexts.id, contextId), eq(contexts.ownerId, ownerId), eq(contexts.isCustom, true)));
  return (r as any).affectedRows > 0;
}

export async function deleteContext(ownerId: string, contextId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [r] = await db.delete(contexts)
    .where(and(eq(contexts.id, contextId), eq(contexts.ownerId, ownerId)));
  return (r as any).affectedRows > 0;
}

export async function linkContactToContext(
  ownerId: string,
  data: { contactId: number; contextId: string; eventDate?: string; city?: string; country?: string; notes?: string; relationshipType?: string }
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [r] = await db.delete(contactContexts)
    .where(and(eq(contactContexts.id, linkId), eq(contactContexts.ownerId, ownerId)));
  return (r as any).affectedRows > 0;
}

export async function addContextParticipant(
  ownerId: string,
  data: { contextId: string; name: string; company?: string; role?: string; notes?: string }
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(contextParticipants).values({ id, ownerId, ...data, createdAt: now, updatedAt: now });
  return id;
}

// ─── Enriquecimento com IA (Etapa 4) ──────────────────────────────────────────

export async function getActiveEnrichmentSession(ownerId: string, contactId: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(enrichmentSessions)
    .where(and(eq(enrichmentSessions.ownerId, ownerId), eq(enrichmentSessions.contactId, contactId), eq(enrichmentSessions.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function getEnrichmentSessionById(sessionId: string, ownerId: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(enrichmentSessions)
    .where(and(eq(enrichmentSessions.id, sessionId), eq(enrichmentSessions.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

/** Avança exatamente uma etapa do roteiro. Retorna null quando a sessão não estiver ativa. */
export async function advanceEnrichmentSession(sessionId: string, ownerId: string, skipped = false) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(enrichmentSessions).values({ id, ownerId, contactId, status: "active", questionsAnswered: 0, questionsSkipped: 0, lastActivityAt: now, createdAt: now, updatedAt: now });
  // Atualizar enrichment_status no contato
  await db.update(privateContacts).set({ enrichmentStatus: "active" } as any).where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId)));
  return id;
}

export async function getEnrichmentMessages(sessionId: string, ownerId: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(enrichmentMessages)
    .where(and(eq(enrichmentMessages.sessionId, sessionId), eq(enrichmentMessages.ownerId, ownerId)))
    .orderBy(desc(enrichmentMessages.createdAt))
    .limit(limit);
}

export async function saveEnrichmentMessage(data: {
  sessionId: string; ownerId: string; role: string; content: string; metadata?: unknown; tokenCount?: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.id, id), eq(enrichmentSuggestions.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function applyEnrichmentSuggestion(id: string, ownerId: string, editedValue?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sug = await getEnrichmentSuggestion(id, ownerId);
  if (!sug || sug.status !== "pending") return false;
  const finalValue = editedValue ?? sug.suggestedValue;
  const now = Date.now();
  const newStatus = editedValue ? "edited" : "confirmed";
  await db.update(enrichmentSuggestions).set({ status: "applied", appliedValue: finalValue, actionedAt: now, actionedBy: "user", updatedAt: now }).where(eq(enrichmentSuggestions.id, id));
  // Aplicar ao contato conforme field_type
  const fieldMap: Record<string, string> = {
    phone: "phone", whatsapp: "whatsapp", email: "email",
    company: "company", job_title: "jobTitle", city: "city",
    country: "country", linkedin_url: "linkedinUrl", instagram_handle: "instagramHandle",
  };
  const dbField = fieldMap[sug.fieldType];
  if (dbField) {
    await db.update(privateContacts).set({ [dbField]: finalValue, updatedAt: now } as any)
      .where(and(eq(privateContacts.id, sug.contactId), eq(privateContacts.ownerId, ownerId)));
  }
  return true;
}

export async function ignoreEnrichmentSuggestion(id: string, ownerId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = Date.now();
  const [r] = await db.update(enrichmentSuggestions)
    .set({ status: "ignored", actionedAt: now, actionedBy: "user", updatedAt: now })
    .where(and(eq(enrichmentSuggestions.id, id), eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.status, "pending")));
  return (r as any).affectedRows > 0;
}

export async function completeEnrichmentSession(sessionId: string, ownerId: string, summary: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
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
      await db.update(privateContacts).set({ enrichmentStatus: "completed" } as any)
        .where(and(eq(privateContacts.id, sess.contactId), eq(privateContacts.ownerId, ownerId)));
    }
  }
  return (r as any).affectedRows > 0;
}

export async function getEnrichmentHistory(ownerId: string, contactId: number, limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return { data: [], total: 0 };
  const rows = await db.select().from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.contactId, contactId), sql`${enrichmentSuggestions.status} IN ('applied', 'ignored', 'undone')`))
    .orderBy(desc(enrichmentSuggestions.createdAt))
    .limit(limit).offset(offset);
  const [c] = await db.select({ count: sql<number>`COUNT(*)` }).from(enrichmentSuggestions)
    .where(and(eq(enrichmentSuggestions.ownerId, ownerId), eq(enrichmentSuggestions.contactId, contactId), sql`${enrichmentSuggestions.status} IN ('applied', 'ignored', 'undone')`));
  return { data: rows, total: Number(c?.count ?? 0) };
}
