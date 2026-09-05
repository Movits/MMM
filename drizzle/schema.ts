import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
  bigint,
  index,
  uniqueIndex,
  float,
  tinyint,
} from "drizzle-orm/mysql-core";
import { decimal } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/mysql-core";

/**
 * Coluna JSON que funciona em MySQL e MariaDB.
 *
 * O MariaDB não tem tipo JSON nativo: `json` é apelido de `longtext` com uma
 * checagem, então o driver entrega texto. O MySQL 8 tem o tipo de verdade e
 * entrega objeto. Sem isto, o mesmo código devolve tipos diferentes conforme o
 * motor, e qualquer `.map()` na leitura quebra só num deles.
 */
const jsonCompat = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "json",
  toDriver: valor => JSON.stringify(valor),
  fromDriver: valor => (typeof valor === "string" ? JSON.parse(valor) : valor),
});


// ============================================================
// TABELA PRINCIPAL DE USUÁRIOS
// role: bronze = Nível Bronze (recém-chegada) | silver = Nível Prata | gold = Nível Ouro | admin = moderador | president = presidente Frauen
// ============================================================
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: text("passwordHash"),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  loginMethod: varchar("loginMethod", { length: 64 }).default("email"),
  role: mysqlEnum("role", ["bronze", "silver", "gold", "admin", "president"]).default("bronze").notNull(),
  country: varchar("country", { length: 2 }),
  company: varchar("company", { length: 200 }),
  position: varchar("position", { length: 200 }),
  isActive: boolean("isActive").default(true).notNull(),
  isVerified: boolean("isVerified").default(false).notNull(),
  onboardingCompleted: boolean("onboardingCompleted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

// ============================================================
// PERFIL PROFISSIONAL DO USUÁRIO
// ============================================================
export const userProfiles = mysqlTable("user_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  displayName: varchar("displayName", { length: 100 }),
  bio: text("bio"),
  gender: mysqlEnum("gender", ["male", "female", "prefer_not_to_say"]),
  avatarUrl: text("avatarUrl"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 2 }),
  sectors: jsonCompat("sectors"),        // string[] — setores de atuação
  languages: jsonCompat("languages"),    // string[] — idiomas
  linkedinUrl: text("linkedinUrl"),
  websiteUrl: text("websiteUrl"),
  profileCompleteness: int("profileCompleteness").default(0),

  // --- Novos campos de perfil profissional (regras de negócio v2) ---
  company: varchar("company", { length: 200 }),           // Empresa
  personType: mysqlEnum("personType", ["individual", "legal_entity", "mei"]),
  companySize: mysqlEnum("companySize", ["mei", "micro", "small", "medium", "large"]),
  companyCnpj: varchar("companyCnpj", { length: 18 }),
  jobTitle: varchar("jobTitle", { length: 200 }),          // Cargo
  activityArea: varchar("activityArea", { length: 200 }),  // Área de Atuação
  interestSectors: jsonCompat("interestSectors"),                // string[] — Setores de Interesse
  institutionalNetwork: varchar("institutionalNetwork", { length: 300 }), // Rede Institucional
  currentResources: text("currentResources"),              // Texto livre: o que a usuária tem hoje
  whatIHave: jsonCompat("whatIHave"),    // string[] — ativos/recursos disponíveis
  whatINeed: jsonCompat("whatINeed"),    // string[] — demandas/necessidades

  // --- Campos do sistema de matching (MMM original) ---
  primarySpecialty: varchar("primarySpecialty", { length: 100 }),
  secondarySpecialties: jsonCompat("secondarySpecialties"),
  currentRole: varchar("currentRole", { length: 200 }),
  currentCompany: varchar("currentCompany", { length: 200 }),
  sector: varchar("sector", { length: 100 }),
  seekingTypes: jsonCompat("seekingTypes"),
  businessInterests: jsonCompat("businessInterests"),
  preferredCompanySize: varchar("preferredCompanySize", { length: 50 }),
  openToRemote: boolean("openToRemote").default(false),
  availableForTravel: boolean("availableForTravel").default(false),
  workStyle: varchar("workStyle", { length: 50 }),
  values: jsonCompat("values"),
  incomeRange: varchar("incomeRange", { length: 50 }),
  investmentCapacity: varchar("investmentCapacity", { length: 50 }),
  lookingForInvestment: boolean("lookingForInvestment").default(false),
  investmentAmountSeeking: varchar("investmentAmountSeeking", { length: 50 }),
  experienceYears: int("experienceYears"),
  educationLevel: varchar("educationLevel", { length: 50 }),
  age: int("age"),
  encryptedSensitiveData: text("encryptedSensitiveData"),
  lastAiAnalysisAt: timestamp("lastAiAnalysisAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("profile_userId_idx").on(table.userId),
  countryIdx: index("profile_country_idx").on(table.country),
}));

// ============================================================
// OPORTUNIDADES — CORE DA PLATAFORMA FRAUEN
// type: offer=oferta | demand=demanda | investment=investimento | partnership=parceria | other
// complianceLevel: green/yellow/orange/red (calculado pela IA)
// isConfidential: true = visível apenas para usuários Ouro
// ============================================================
export const opportunities = mysqlTable("opportunities", {
  id: int("id").autoincrement().primaryKey(),
  publishedBy: int("publishedBy").notNull(),   // userId

  title: varchar("title", { length: 300 }).notNull(),
  description: text("description").notNull(),
  type: mysqlEnum("type", [
    "offer",          // oferta de produto/serviço/commodity
    "demand",         // demanda de compra/importação
    "investment",     // projeto de investimento
    "partnership",    // parceria comercial
    "distribution",   // busca de distribuidores/representantes
    "other"
  ]).notNull(),
  sector: varchar("sector", { length: 100 }),
  country: varchar("country", { length: 2 }),
  region: varchar("region", { length: 100 }),  // continente ou região
  tags: jsonCompat("tags"),                           // string[] — palavras-chave

  // Compliance e confiabilidade
  frauenTrustScore: float("frauenTrustScore").default(0),   // 0-100
  complianceLevel: mysqlEnum("complianceLevel", [
    "green", "yellow", "orange", "red", "pending"
  ]).default("pending").notNull(),
  complianceExplanation: text("complianceExplanation"),     // texto da IA explicando a classificação
  suggestedDocuments: jsonCompat("suggestedDocuments"),           // string[] — documentos sugeridos pela IA
  lastComplianceAt: timestamp("lastComplianceAt"),

  // Visibilidade
  isConfidential: boolean("isConfidential").default(false).notNull(),  // true = apenas Ouro
  status: mysqlEnum("status", [
    "draft",     // rascunho
    "pending",   // aguardando moderação
    "active",    // publicada
    "rejected",  // rejeitada pelo admin
    "closed",    // encerrada
    "removed"    // retirada por uma membra Ouro
  ]).default("pending").notNull(),
  moderatedBy: int("moderatedBy"),
  moderationNote: text("moderationNote"),
  moderatedAt: timestamp("moderatedAt"),

  viewCount: int("viewCount").default(0),
  interestCount: int("interestCount").default(0),
  expiresAt: timestamp("expiresAt"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  publishedByIdx: index("opp_publishedBy_idx").on(table.publishedBy),
  typeIdx: index("opp_type_idx").on(table.type),
  statusIdx: index("opp_status_idx").on(table.status),
  sectorIdx: index("opp_sector_idx").on(table.sector),
  countryIdx: index("opp_country_idx").on(table.country),
  complianceIdx: index("opp_compliance_idx").on(table.complianceLevel),
  ftsIdx: index("opp_fts_idx").on(table.frauenTrustScore),
}));

// ============================================================
// DOCUMENTOS ANEXADOS ÀS OPORTUNIDADES
// ============================================================
export const opportunityDocuments = mysqlTable("opportunity_documents", {
  id: int("id").autoincrement().primaryKey(),
  opportunityId: int("opportunityId").notNull(),
  uploadedBy: int("uploadedBy").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  url: text("url").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  isConfidential: boolean("isConfidential").default(false).notNull(),  // true = apenas Ouro
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  opportunityIdx: index("doc_opportunity_idx").on(table.opportunityId),
}));

// ============================================================
// INTERESSES EM OPORTUNIDADES
// Prata pode demonstrar interesse; Ouro vê quem demonstrou
// ============================================================
export const opportunityInterests = mysqlTable("opportunity_interests", {
  id: int("id").autoincrement().primaryKey(),
  opportunityId: int("opportunityId").notNull(),
  userId: int("userId").notNull(),
  message: text("message"),
  status: mysqlEnum("status", ["pending", "viewed", "contacted", "declined"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  opportunityIdx: index("interest_opp_idx").on(table.opportunityId),
  userIdx: index("interest_user_idx").on(table.userId),
}));

// ============================================================
// OPORTUNIDADES SALVAS (BOOKMARKS)
// ============================================================
export const savedOpportunities = mysqlTable("saved_opportunities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  opportunityId: int("opportunityId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("saved_user_idx").on(table.userId),
  oppIdx: index("saved_opp_idx").on(table.opportunityId),
}));

// ============================================================
// MATCHES ENTRE OPORTUNIDADES (IA conecta oportunidades complementares)
// ============================================================
export const opportunityMatches = mysqlTable("opportunity_matches", {
  id: int("id").autoincrement().primaryKey(),
  opportunityAId: int("opportunityAId").notNull(),
  opportunityBId: int("opportunityBId").notNull(),
  score: float("score").notNull(),                // 0-100
  aiExplanation: text("aiExplanation"),           // por que são complementares
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  oppAIdx: index("omatch_oppA_idx").on(table.opportunityAId),
  oppBIdx: index("omatch_oppB_idx").on(table.opportunityBId),
  scoreIdx: index("omatch_score_idx").on(table.score),
}));

// ============================================================
// GRUPOS ESTRATÉGICOS (apenas Ouro)
// ============================================================
export const strategicGroups = mysqlTable("strategic_groups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  createdBy: int("createdBy").notNull(),
  memberIds: jsonCompat("memberIds"),    // number[] — userIds dos membros
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  createdByIdx: index("group_createdBy_idx").on(table.createdBy),
}));

// ============================================================
// MENSAGENS DIRETAS ENTRE USUÁRIOS OURO
// ============================================================
export const directMessages = mysqlTable("direct_messages", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  senderId: int("senderId").notNull(),
  recipientId: int("recipientId"),   // null = mensagem de grupo
  groupId: int("groupId"),
  encryptedContent: text("encryptedContent").notNull(),
  isRead: boolean("isRead").default(false),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  senderIdx: index("dm_sender_idx").on(table.senderId),
  recipientIdx: index("dm_recipient_idx").on(table.recipientId),
  groupIdx: index("dm_group_idx").on(table.groupId),
}));

// ============================================================
// CONCESSÃO DE ACESSO OURO (gerenciado pelos Presidentes)
// ============================================================
export const goldAccessGrants = mysqlTable("gold_access_grants", {
  id: int("id").autoincrement().primaryKey(),
  grantedTo: int("grantedTo").notNull(),    // userId que recebeu acesso Ouro
  grantedBy: int("grantedBy").notNull(),    // userId do presidente que concedeu
  reason: text("reason"),
  revokedAt: timestamp("revokedAt"),
  revokedBy: int("revokedBy"),
  revokeReason: text("revokeReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  grantedToIdx: index("gold_grantedTo_idx").on(table.grantedTo),
  grantedByIdx: index("gold_grantedBy_idx").on(table.grantedBy),
}));

// ============================================================
// NOTIFICAÇÕES DA PLATAFORMA
// ============================================================
export const platformNotifications = mysqlTable("platform_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", [
    "new_match", "interest_received", "gold_granted", "gold_revoked",
    "opportunity_approved", "opportunity_rejected", "new_message",
    "compliance_update", "system"
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  actionUrl: varchar("actionUrl", { length: 500 }),
  isRead: boolean("isRead").default(false),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("pnotif_userId_idx").on(table.userId),
  typeIdx: index("pnotif_type_idx").on(table.type),
}));

// ============================================================
// TABELAS DE SEGURANÇA (MANTIDAS)
// ============================================================
export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  userId: int("userId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  deviceFingerprint: varchar("deviceFingerprint", { length: 64 }),
  isTrustedDevice: boolean("isTrustedDevice").default(false),
  isActive: boolean("isActive").default(true).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("session_userId_idx").on(table.userId),
  tokenIdx: index("session_token_idx").on(table.sessionToken),
}));

export const auditLogs = mysqlTable("audit_logs", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  userId: int("userId"),
  action: varchar("action", { length: 100 }).notNull(),
  resource: varchar("resource", { length: 100 }),
  resourceId: varchar("resourceId", { length: 64 }),
  details: jsonCompat("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  status: mysqlEnum("status", ["success", "failure", "blocked"]).default("success").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high", "critical"]).default("low").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("audit_userId_idx").on(table.userId),
  actionIdx: index("audit_action_idx").on(table.action),
  createdAtIdx: index("audit_createdAt_idx").on(table.createdAt),
}));

export const loginAttempts = mysqlTable("login_attempts", {
  id: int("id").autoincrement().primaryKey(),
  identifier: varchar("identifier", { length: 320 }).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(),
  success: boolean("success").default(false).notNull(),
  blockedUntil: timestamp("blockedUntil"),
  attemptCount: int("attemptCount").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  identifierIdx: index("attempts_identifier_idx").on(table.identifier),
  ipIdx: index("attempts_ip_idx").on(table.ipAddress),
}));

export const securityEvents = mysqlTable("security_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  eventType: mysqlEnum("eventType", [
    "failed_login", "suspicious_ip", "multiple_sessions",
    "brute_force_attempt", "unusual_location", "account_locked",
    "password_reset", "mfa_failed", "data_export", "admin_access",
  ]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  details: jsonCompat("details"),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: int("resolvedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("security_userId_idx").on(table.userId),
  eventTypeIdx: index("security_eventType_idx").on(table.eventType),
}));

export const trustedDevices = mysqlTable("trusted_devices", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  deviceName: varchar("deviceName", { length: 100 }),
  deviceFingerprint: varchar("deviceFingerprint", { length: 64 }).notNull(),
  userAgent: text("userAgent"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("device_userId_idx").on(table.userId),
}));

// ============================================================
// MATCHES ENTRE PERFIS DE USUÁRIOS (sistema original MMM)
// ============================================================
export const matches = mysqlTable("matches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  matchedUserId: int("matchedUserId"),
  overallScore: int("overallScore").default(0).notNull(),
  specialtyScore: int("specialtyScore").default(0),
  objectivesScore: int("objectivesScore").default(0),
  incomeScore: int("incomeScore").default(0),
  locationScore: int("locationScore").default(0),
  valuesScore: int("valuesScore").default(0),
  aiInsight: text("aiInsight"),
  aiGeneratedAt: timestamp("aiGeneratedAt"),
  userSeen: boolean("userSeen").default(false).notNull(),
  userDismissed: boolean("userDismissed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("match_userId_idx").on(table.userId),
  matchedUserIdIdx: index("match_matchedUserId_idx").on(table.matchedUserId),
  scoreIdx: index("match_score_idx").on(table.overallScore),
  // Um match entre duas usuárias é único. Sem isto, cada "Reanalisar matches"
  // reinseria o conjunto inteiro (o insert não tinha upsert e nada no banco
  // segurava a duplicata), e quem tinha sido dispensado voltava como linha nova.
  // A regeneração agora faz upsert contra esta chave.
  matchPairUnq: uniqueIndex("match_user_matched_unq").on(table.userId, table.matchedUserId),
}));

// ============================================================
// CONEXÕES ENTRE USUÁRIOS (pedidos de contato)
// ============================================================
export const connections = mysqlTable("connections", {
  id: int("id").autoincrement().primaryKey(),
  requesterId: int("requesterId").notNull(),
  recipientId: int("recipientId").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "declined", "blocked"]).default("pending").notNull(),
  message: text("message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  requesterIdx: index("conn_requester_idx").on(table.requesterId),
  recipientIdx: index("conn_recipient_idx").on(table.recipientId),
}));

// ============================================================
// RECUPERAÇÃO DE SENHA
// ============================================================
export const passwordResetTokens = mysqlTable("password_reset_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index("prt_token_idx").on(table.token),
  userIdIdx: index("prt_userId_idx").on(table.userId),
}));

/** Registro mínimo para limitar pedidos de recuperação por endereço IP. */
export const passwordResetRequests = mysqlTable("password_reset_requests", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ipAddress: varchar("ip_address", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ipCreatedIdx: index("prr_ip_created_idx").on(table.ipAddress, table.createdAt),
}));

// ============================================================
// CAMPOS EXTRAS DO PERFIL (sistema original MMM)
// Adicionados ao userProfiles via colunas extras para compatibilidade
// ============================================================

// ============================================================
// DEAL ROOM — SALA DE NEGOCIAÇÃO PRIVADA
// Criada quando uma membra demonstra interesse em uma oportunidade
// ============================================================
export const dealRooms = mysqlTable("deal_rooms", {
  id: int("id").autoincrement().primaryKey(),
  opportunityId: int("opportunityId").notNull(),
  ownerId: int("ownerId").notNull(),          // dona da oportunidade
  interestedId: int("interestedId").notNull(), // quem demonstrou interesse
  status: mysqlEnum("status", [
    "awaiting_nda",   // aguardando aceite do NDA por ambas as partes
    "active",         // NDA aceito por ambas — sala ativa
    "closed",         // encerrada
  ]).default("awaiting_nda").notNull(),
  // NDA — aceite digital
  ndaAcceptedByOwner: boolean("ndaAcceptedByOwner").default(false).notNull(),
  ndaAcceptedByOwnerAt: timestamp("ndaAcceptedByOwnerAt"),
  ndaAcceptedByInterested: boolean("ndaAcceptedByInterested").default(false).notNull(),
  ndaAcceptedByInterestedAt: timestamp("ndaAcceptedByInterestedAt"),
  // Metadados
  interestMessage: text("interestMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  opportunityIdx: index("dr_opportunity_idx").on(table.opportunityId),
  ownerIdx: index("dr_owner_idx").on(table.ownerId),
  interestedIdx: index("dr_interested_idx").on(table.interestedId),
}));

// Mensagens do chat privado dentro do Deal Room
export const dealRoomMessages = mysqlTable("deal_room_messages", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  dealRoomId: int("dealRoomId").notNull(),
  senderId: int("senderId").notNull(),
  content: text("content").notNull(),
  isRead: boolean("isRead").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  roomIdx: index("drm_room_idx").on(table.dealRoomId),
  senderIdx: index("drm_sender_idx").on(table.senderId),
}));

// Documentos confidenciais compartilhados dentro do Deal Room
export const dealRoomDocuments = mysqlTable("deal_room_documents", {
  id: int("id").autoincrement().primaryKey(),
  dealRoomId: int("dealRoomId").notNull(),
  uploadedBy: int("uploadedBy").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  url: text("url").notNull(),
  mimeType: varchar("mimeType", { length: 100 }),
  sizeBytes: bigint("sizeBytes", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  roomIdx: index("drd_room_idx").on(table.dealRoomId),
}));

// ============================================================
// BASE PARTICULAR DE CONTATOS (Minha Rede de Relacionamentos)
// Isolamento total por ownerId — RLS obrigatório em todas as queries
// ============================================================
export const privateContacts = mysqlTable("private_contacts", {
  id:           bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  ownerId:      varchar("ownerId", { length: 128 }).notNull(),

  fullName:     varchar("fullName",  { length: 200 }).notNull(),
  photoUrl:     varchar("photoUrl",  { length: 512 }),
  jobTitle:     varchar("jobTitle",  { length: 200 }),
  company:      varchar("company",   { length: 200 }),

  country:      varchar("country",   { length: 100 }),
  state:        varchar("state",     { length: 100 }),
  city:         varchar("city",      { length: 100 }),

  phone:        varchar("phone",     { length: 50 }),
  whatsapp:     varchar("whatsapp",  { length: 50 }),
  email:        varchar("email",     { length: 254 }),

  linkedinUrl:  varchar("linkedinUrl",  { length: 512 }),
  instagram:    varchar("instagram",    { length: 100 }),

  profileTags:  jsonCompat("profileTags").$type<string[]>(),

  // Etapas 8/10 — o nível de visibilidade escolhido pela DONA (privacidade.md):
  // 'privado' (só a dona — o padrão, nada vira público por omissão), 'publico'
  // (o contato entra na vitrine do ecossistema SÓ como oportunidade: país,
  // cidade e o que possui/procura — nenhuma coluna pessoal é sequer lida) e
  // 'ouro' (etapa 10: entra no acervo Ouro, lido apenas por membras com Status
  // Ouro — listAcervoOuro em server/db.ts. Os níveis NÃO são cumulativos:
  // 'publico' expõe só a oportunidade a todas, 'ouro' expõe os campos
  // estratégicos do cartão só a Ouro — pendência nº 2 de decisoes-em-aberto.md).
  // O índice existe porque a vitrine consulta por nível SEM ownerId — é a
  // única leitura legítima que atravessa donas, e sem índice ela viraria um
  // full-scan da tabela inteira do ecossistema a cada visita à tela.
  nivelVisibilidade: varchar("nivel_visibilidade", { length: 10, enum: ["privado", "ouro", "publico"] }).default("privado").notNull(),

  cardImageUrl: varchar("cardImageUrl", { length: 512 }),
  cardOcrText:  text("cardOcrText"),

  notes:        text("notes"),
  // Selo "IA em andamento" na lista da Rede. A coluna sempre existiu no banco
  // (era do Manus) mas não estava declarada aqui — o drizzle descartava a chave
  // nos updates (sobrava UPDATE sem SET, erro de SQL ao iniciar o chat de
  // enriquecimento) e nos selects (o selo nunca aparecia). O `as any` nos
  // chamadores escondia tudo.
  enrichmentStatus: varchar("enrichment_status", { length: 20 }),

  createdAt:    bigint("createdAt", { mode: "number" }).notNull(),
  updatedAt:    bigint("updatedAt", { mode: "number" }).notNull(),
}, (table) => ({
  ownerIdx:        index("pc_owner_idx").on(table.ownerId),
  ownerNameIdx:    index("pc_owner_name_idx").on(table.ownerId, table.fullName),
  ownerCompanyIdx: index("pc_owner_company_idx").on(table.ownerId, table.company),
  ownerCountryIdx: index("pc_owner_country_idx").on(table.ownerId, table.country),
  ownerUpdatedIdx: index("pc_owner_updated_idx").on(table.ownerId, table.updatedAt),
  nivelIdx:        index("pc_nivel_idx").on(table.nivelVisibilidade),
}));

// ============================================================
// TIPOS EXPORTADOS
// ============================================================
// ============================================================
// SIVC — Sistema de Verificação de Identidade e Credenciais
//
// Estas tabelas existiam apenas em SQL escrito à mão dentro de
// server/routers/sivc.ts. Sem definição aqui, a migração gerada não as cria e
// um banco novo sobe com o módulo inteiro quebrado — foi o que apareceu ao
// preparar o deploy. As colunas foram reconstruídas a partir das queries.
//
// Os campos de status usam varchar em vez de mysqlEnum de propósito: os
// valores gravados vêm do OCR e de constantes do router, e um enum
// incompleto rejeitaria a escrita em produção.
// ============================================================

export const sivcVerifications = mysqlTable("sivc_verifications", {
  id:               int("id").autoincrement().primaryKey(),
  userId:           int("userId").notNull(),
  status:           varchar("status", { length: 32 }).default("in_progress").notNull(),
  level:            varchar("level", { length: 32 }),
  overallScore:     int("overallScore").default(0),
  mandatoryPassed:  boolean("mandatoryPassed").default(false),
  consentGrantedAt: timestamp("consentGrantedAt"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("sivc_ver_user_idx").on(table.userId),
}));

export const sivcConsents = mysqlTable("sivc_consents", {
  id:          int("id").autoincrement().primaryKey(),
  userId:      int("userId").notNull(),
  consentType: varchar("consentType", { length: 64 }).notNull(),
  ipAddress:   varchar("ipAddress", { length: 45 }),
  payloadJson: jsonCompat("payloadJson"),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("sivc_con_user_idx").on(table.userId),
}));

// O índice único é obrigatório, não decorativo: o router faz
// INSERT ... ON DUPLICATE KEY UPDATE nesta tripla. Sem ele, cada
// atualização de um campo criaria uma linha nova em vez de sobrescrever.
export const sivcChecks = mysqlTable("sivc_checks", {
  id:              int("id").autoincrement().primaryKey(),
  verificationId:  int("verificationId").notNull(),
  module:          varchar("module", { length: 64 }).notNull(),
  field:           varchar("field", { length: 64 }).notNull(),
  declaredValue:   text("declaredValue"),
  verifiedValue:   text("verifiedValue"),
  status:          varchar("status", { length: 32 }).default("unverified").notNull(),
  confidenceScore: int("confidenceScore").default(0),
  weight:          int("weight").default(1),
  isMandatory:     boolean("isMandatory").default(false),
  source:          varchar("source", { length: 64 }),
  auditLog:        jsonCompat("auditLog"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  checkUnq: uniqueIndex("sivc_chk_unq").on(table.verificationId, table.module, table.field),
}));

export const sivcDocuments = mysqlTable("sivc_documents", {
  id:              int("id").autoincrement().primaryKey(),
  verificationId:  int("verificationId").notNull(),
  userId:          int("userId").notNull(),
  module:          varchar("module", { length: 64 }).notNull(),
  docType:         varchar("docType", { length: 64 }).notNull(),
  fileKey:         varchar("fileKey", { length: 500 }).notNull(),
  url:             text("url"),
  mimeType:        varchar("mimeType", { length: 100 }),
  sizeBytes:       bigint("sizeBytes", { mode: "number" }),
  ocrStatus:       varchar("ocrStatus", { length: 32 }).default("processing").notNull(),
  ocrText:         text("ocrText"),
  extractedData:   jsonCompat("extractedData"),
  confidenceScore: int("confidenceScore").default(0),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  verIdx: index("sivc_doc_ver_idx").on(table.verificationId),
}));

// ============================================================
// GOVERNANÇA — validação da presidência e líderes regionais
// Mesma situação das tabelas do SIVC: só existiam em SQL cru, em
// server/routers/president.ts.
// ============================================================

// Uma validação por oportunidade: o router faz upsert por opportunityId.
export const presidentValidations = mysqlTable("president_validations", {
  id:            int("id").autoincrement().primaryKey(),
  opportunityId: int("opportunityId").notNull(),
  validatedBy:   int("validatedBy").notNull(),
  status:        varchar("status", { length: 32 }).notNull(),
  note:          text("note"),
  createdAt:     timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  oppUnq: uniqueIndex("pres_val_opp_unq").on(table.opportunityId),
}));

export const nationalLeaders = mysqlTable("national_leaders", {
  id:           int("id").autoincrement().primaryKey(),
  userId:       int("userId").notNull(),
  nominatedBy:  int("nominatedBy").notNull(),
  region:       varchar("region", { length: 120 }).notNull(),
  specialty:    varchar("specialty", { length: 200 }),
  isActive:     boolean("isActive").default(true).notNull(),
  revokedAt:    timestamp("revokedAt"),
  revokedBy:    int("revokedBy"),
  revokeReason: text("revokeReason"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  activeIdx: index("nat_lead_active_idx").on(table.isActive),
  userIdx:   index("nat_lead_user_idx").on(table.userId),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type InsertUserProfile = typeof userProfiles.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type InsertOpportunity = typeof opportunities.$inferInsert;
export type OpportunityDocument = typeof opportunityDocuments.$inferSelect;
export type OpportunityInterest = typeof opportunityInterests.$inferSelect;
export type SavedOpportunity = typeof savedOpportunities.$inferSelect;
export type OpportunityMatch = typeof opportunityMatches.$inferSelect;
export type StrategicGroup = typeof strategicGroups.$inferSelect;
export type DirectMessage = typeof directMessages.$inferSelect;
export type GoldAccessGrant = typeof goldAccessGrants.$inferSelect;
export type PlatformNotification = typeof platformNotifications.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type DealRoom = typeof dealRooms.$inferSelect;
export type DealRoomMessage = typeof dealRoomMessages.$inferSelect;
export type DealRoomDocument = typeof dealRoomDocuments.$inferSelect;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type PrivateContact = typeof privateContacts.$inferSelect;
export type InsertPrivateContact = typeof privateContacts.$inferInsert;

// ============================================================
// MÓDULO DE CONTEXTOS (Onde e Como Conheceu) — Etapa 3
// ============================================================
export const contextTypes = mysqlTable("context_types", {
  id:         varchar("id", { length: 36 }).primaryKey(),
  name:       varchar("name", { length: 80 }).notNull(),
  slug:       varchar("slug", { length: 80 }).notNull(),
  iconName:   varchar("icon_name", { length: 50 }),
  colorToken: varchar("color_token", { length: 30 }),
  sortOrder:  int("sort_order").default(0).notNull(),
  isActive:   boolean("is_active").default(true).notNull(),
  createdAt:  bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:  bigint("updated_at", { mode: "number" }).notNull(),
});

export const contexts = mysqlTable("contexts", {
  id:            varchar("id", { length: 36 }).primaryKey(),
  ownerId:       varchar("owner_id", { length: 128 }),  // NULL = global
  contextTypeId: varchar("context_type_id", { length: 36 }),
  name:          varchar("name", { length: 100 }).notNull(),
  description:   text("description"),
  eventDate:     varchar("event_date", { length: 20 }),  // DATE stored as string
  city:          varchar("city", { length: 100 }),
  country:       varchar("country", { length: 100 }),
  notes:         text("notes"),
  isCustom:      boolean("is_custom").default(false).notNull(),
  visibility:    varchar("visibility", { length: 10 }).default("private").notNull(),
  createdAt:     bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:     bigint("updated_at", { mode: "number" }).notNull(),
});

export const contactContexts = mysqlTable("contact_contexts", {
  id:               varchar("id", { length: 36 }).primaryKey(),
  ownerId:          varchar("owner_id", { length: 128 }).notNull(),
  contactId:        bigint("contact_id", { mode: "number" }).notNull(),
  contextId:        varchar("context_id", { length: 36 }).notNull(),
  eventDate:        varchar("event_date", { length: 20 }),
  city:             varchar("city", { length: 100 }),
  country:          varchar("country", { length: 100 }),
  notes:            varchar("notes", { length: 1000 }),
  relationshipType: varchar("relationship_type", { length: 20 }).default("profissional").notNull(),
  visibility:       varchar("visibility", { length: 10 }).default("private").notNull(),
  createdAt:        bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:        bigint("updated_at", { mode: "number" }).notNull(),
});

export const contextParticipants = mysqlTable("context_participants", {
  id:                 varchar("id", { length: 36 }).primaryKey(),
  ownerId:            varchar("owner_id", { length: 128 }).notNull(),
  contextId:          varchar("context_id", { length: 36 }).notNull(),
  name:               varchar("name", { length: 200 }).notNull(),
  company:            varchar("company", { length: 200 }),
  role:               varchar("role", { length: 200 }),
  notes:              varchar("notes", { length: 500 }),
  convertedContactId: bigint("converted_contact_id", { mode: "number" }),
  createdAt:          bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:          bigint("updated_at", { mode: "number" }).notNull(),
});

export const contextMedia = mysqlTable("context_media", {
  id:            varchar("id", { length: 36 }).primaryKey(),
  ownerId:       varchar("owner_id", { length: 128 }).notNull(),
  contextId:     varchar("context_id", { length: 36 }).notNull(),
  storagePath:   varchar("storage_path", { length: 512 }).notNull(),
  fileType:      varchar("file_type", { length: 50 }).notNull(),
  fileSize:      bigint("file_size", { mode: "number" }).notNull(),
  originalName:  varchar("original_name", { length: 255 }).notNull(),
  caption:       varchar("caption", { length: 255 }),
  thumbnailPath: varchar("thumbnail_path", { length: 512 }),
  sortOrder:     int("sort_order").default(0).notNull(),
  uploadedBy:    varchar("uploaded_by", { length: 128 }).notNull(),
  createdAt:     bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:     bigint("updated_at", { mode: "number" }).notNull(),
});

// Tipos exportados — Contextos
export type ContextType = typeof contextTypes.$inferSelect;
export type Context = typeof contexts.$inferSelect;
export type ContactContext = typeof contactContexts.$inferSelect;
export type ContextParticipant = typeof contextParticipants.$inferSelect;
export type ContextMedia = typeof contextMedia.$inferSelect;

// ============================================================
// MÓDULO DE ENRIQUECIMENTO COM IA — Etapa 4
// ============================================================
export const enrichmentSessions = mysqlTable("enrichment_sessions", {
  id:                varchar("id", { length: 36 }).primaryKey(),
  ownerId:           varchar("owner_id", { length: 128 }).notNull(),
  contactId:         bigint("contact_id", { mode: "number" }).notNull(),
  status:            varchar("status", { length: 20 }).default("active").notNull(),
  questionsAnswered: int("questions_answered").default(0).notNull(),
  questionsSkipped:  int("questions_skipped").default(0).notNull(),
  summary:           text("summary"),
  lastActivityAt:    bigint("last_activity_at", { mode: "number" }).notNull(),
  completedAt:       bigint("completed_at", { mode: "number" }),
  createdAt:         bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:         bigint("updated_at", { mode: "number" }).notNull(),
});

export const enrichmentMessages = mysqlTable("enrichment_messages", {
  id:         varchar("id", { length: 36 }).primaryKey(),
  sessionId:  varchar("session_id", { length: 36 }).notNull(),
  ownerId:    varchar("owner_id", { length: 128 }).notNull(),
  role:       varchar("role", { length: 10 }).notNull(),
  content:    text("content").notNull(),
  metadata:   jsonCompat("metadata"),
  tokenCount: int("token_count"),
  createdAt:  bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:  bigint("updated_at", { mode: "number" }).notNull(),
});

export const enrichmentSuggestions = mysqlTable("enrichment_suggestions", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  sessionId:      varchar("session_id", { length: 36 }).notNull(),
  messageId:      varchar("message_id", { length: 36 }).notNull(),
  ownerId:        varchar("owner_id", { length: 128 }).notNull(),
  contactId:      bigint("contact_id", { mode: "number" }).notNull(),
  fieldType:      varchar("field_type", { length: 30 }).notNull(),
  suggestedValue: text("suggested_value").notNull(),
  appliedValue:   text("applied_value"),
  tagId:          varchar("tag_id", { length: 36 }),
  tagIsNew:       boolean("tag_is_new").default(false).notNull(),
  confidence:     decimal("confidence", { precision: 4, scale: 3 }).default("0.000").notNull(),
  status:         varchar("status", { length: 20 }).default("pending").notNull(),
  actionedAt:     bigint("actioned_at", { mode: "number" }),
  actionedBy:     varchar("actioned_by", { length: 20 }),
  // O que "Desfazer" precisa para reverter o que a confirmação gravou: o valor
  // anterior do campo, o id da tag inserida, a linha de nota acrescentada...
  // Gravado no mesmo UPDATE que marca `applied`; nulo nas sugestões aplicadas
  // antes do recurso existir (essas não têm como ser revertidas).
  undoSnapshot:   jsonCompat("undo_snapshot"),
  createdAt:      bigint("created_at", { mode: "number" }).notNull(),
  updatedAt:      bigint("updated_at", { mode: "number" }).notNull(),
});

// ============================================================
// ASSISTENTE DE REUNIÕES — Etapa 5
// Isolamento obrigatório por ownerId em todas as consultas.
// ============================================================
export const meetings = mysqlTable("meetings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  contactId: bigint("contact_id", { mode: "number" }),
  contextId: varchar("context_id", { length: 36 }),
  status: mysqlEnum("status", ["draft", "recording", "processing", "ready", "failed", "deleted"]).default("draft").notNull(),
  consentGranted: boolean("consent_granted").default(false).notNull(),
  consentAt: bigint("consent_at", { mode: "number" }),
  language: varchar("language", { length: 12 }).default("pt").notNull(),
  processingError: text("processing_error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerCreatedIdx: index("meetings_owner_created_idx").on(table.ownerId, table.createdAt),
  ownerStatusIdx: index("meetings_owner_status_idx").on(table.ownerId, table.status),
}));

export const meetingRecordings = mysqlTable("meeting_recordings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  meetingId: varchar("meeting_id", { length: 36 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  storageKey: varchar("storage_key", { length: 512 }).notNull(),
  storageUrl: varchar("storage_url", { length: 512 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  durationSeconds: int("duration_seconds").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => ({
  meetingIdx: index("meeting_recordings_meeting_idx").on(table.meetingId),
  ownerExpiresIdx: index("meeting_recordings_owner_expires_idx").on(table.ownerId, table.expiresAt),
}));

export const meetingTranscripts = mysqlTable("meeting_transcripts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  meetingId: varchar("meeting_id", { length: 36 }).notNull().unique(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  transcript: text("transcript").notNull(),
  segments: jsonCompat("segments"),
  language: varchar("language", { length: 12 }),
  durationSeconds: int("duration_seconds"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerMeetingIdx: index("meeting_transcripts_owner_meeting_idx").on(table.ownerId, table.meetingId),
}));

export const meetingTranscriptTranslations = mysqlTable("meeting_transcript_translations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  meetingId: varchar("meeting_id", { length: 36 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  language: varchar("language", { length: 12 }).notNull(),
  translatedText: text("translated_text").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerMeetingLanguageIdx: uniqueIndex("meeting_transcript_translations_owner_meeting_language_idx").on(table.ownerId, table.meetingId, table.language),
}));

export const meetingEntities = mysqlTable("meeting_entities", {
  id: varchar("id", { length: 36 }).primaryKey(),
  meetingId: varchar("meeting_id", { length: 36 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  value: text("value").notNull(),
  normalizedValue: varchar("normalized_value", { length: 500 }),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).default("0.000").notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "ignored"]).default("pending").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerMeetingIdx: index("meeting_entities_owner_meeting_idx").on(table.ownerId, table.meetingId),
  statusIdx: index("meeting_entities_status_idx").on(table.ownerId, table.status),
}));

export const meetingContactSuggestions = mysqlTable("meeting_contact_suggestions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  meetingId: varchar("meeting_id", { length: 36 }).notNull(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  existingContactId: bigint("existing_contact_id", { mode: "number" }),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  jobTitle: varchar("job_title", { length: 200 }),
  company: varchar("company", { length: 200 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  sourceEntityIds: jsonCompat("source_entity_ids"),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).default("0.000").notNull(),
  status: mysqlEnum("status", ["pending", "created", "linked", "ignored"]).default("pending").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerMeetingIdx: index("meeting_contact_suggestions_owner_meeting_idx").on(table.ownerId, table.meetingId),
  statusIdx: index("meeting_contact_suggestions_status_idx").on(table.ownerId, table.status),
}));

// ============================================================
// MEMÓRIA INTELIGENTE — Etapa 6
// Vetores ficam em JSON para compatibilidade com MySQL. A similaridade é
// calculada exclusivamente em memória após filtrar por ownerId.
// ============================================================
export const memoryDocuments = mysqlTable("memory_documents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceId: varchar("source_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 300 }).notNull(),
  content: text("content").notNull(),
  metadata: jsonCompat("metadata"),
  embedding: jsonCompat("embedding").$type<number[]>(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  indexedAt: bigint("indexed_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerSourceIdx: index("memory_documents_owner_source_idx").on(table.ownerId, table.sourceType, table.sourceId),
  ownerIndexedIdx: index("memory_documents_owner_indexed_idx").on(table.ownerId, table.indexedAt),
}));

// ============================================================
// MATCH INTELIGENTE — Etapa 7
// Cruzamentos sempre privados entre contatos da mesma ownerId.
// ============================================================
export const contactAssets = mysqlTable("contact_assets", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  contactId: bigint("contact_id", { mode: "number" }).notNull(),
  tagSlug: varchar("tag_slug", { length: 160 }).notNull(),
  tagLabel: varchar("tag_label", { length: 200 }).notNull(),
  category: varchar("category", { length: 120 }),
  description: text("description"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerContactIdx: index("contact_assets_owner_contact_idx").on(table.ownerId, table.contactId),
  ownerSlugIdx: index("contact_assets_owner_slug_idx").on(table.ownerId, table.tagSlug),
  ownerCategoryIdx: index("contact_assets_owner_category_idx").on(table.ownerId, table.category),
}));

export const contactNeeds = mysqlTable("contact_needs", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  contactId: bigint("contact_id", { mode: "number" }).notNull(),
  tagSlug: varchar("tag_slug", { length: 160 }).notNull(),
  tagLabel: varchar("tag_label", { length: 200 }).notNull(),
  category: varchar("category", { length: 120 }),
  description: text("description"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerContactIdx: index("contact_needs_owner_contact_idx").on(table.ownerId, table.contactId),
  ownerSlugIdx: index("contact_needs_owner_slug_idx").on(table.ownerId, table.tagSlug),
  ownerCategoryIdx: index("contact_needs_owner_category_idx").on(table.ownerId, table.category),
}));

export const aiMatchSuggestions = mysqlTable("ai_match_suggestions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 128 }).notNull(),
  contactAId: bigint("contact_a_id", { mode: "number" }).notNull(),
  contactBId: bigint("contact_b_id", { mode: "number" }).notNull(),
  pairLowContactId: bigint("pair_low_contact_id", { mode: "number" }).notNull(),
  pairHighContactId: bigint("pair_high_contact_id", { mode: "number" }).notNull(),
  matchScore: int("match_score").notNull(),
  // "mutual" é o par que se completa nos dois sentidos: cada contato tem o que o
  // outro procura. É a conexão mais forte que o cruzamento sabe encontrar.
  matchType: mysqlEnum("match_type", ["mutual", "exact", "category", "semantic"]).notNull(),
  matchedAssets: jsonCompat("matched_assets").$type<Array<{ slug: string; label: string }>>().notNull(),
  matchedNeeds: jsonCompat("matched_needs").$type<Array<{ slug: string; label: string }>>().notNull(),
  reasonText: text("reason_text").notNull(),
  status: mysqlEnum("status", ["pending", "viewed", "accepted", "dismissed"]).default("pending").notNull(),
  notifiedAt: bigint("notified_at", { mode: "number" }),
  viewedAt: bigint("viewed_at", { mode: "number" }),
  acceptedAt: bigint("accepted_at", { mode: "number" }),
  dismissedAt: bigint("dismissed_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => ({
  ownerStatusScoreIdx: index("ai_match_owner_status_score_idx").on(table.ownerId, table.status, table.matchScore),
  ownerPairIdx: uniqueIndex("ai_match_owner_pair_unique_idx").on(table.ownerId, table.pairLowContactId, table.pairHighContactId),
  contactAIdx: index("ai_match_contact_a_idx").on(table.contactAId),
  contactBIdx: index("ai_match_contact_b_idx").on(table.contactBId),
}));

// Tipos exportados — Enriquecimento
export type EnrichmentSession = typeof enrichmentSessions.$inferSelect;
export type EnrichmentMessage = typeof enrichmentMessages.$inferSelect;
export type EnrichmentSuggestion = typeof enrichmentSuggestions.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingRecording = typeof meetingRecordings.$inferSelect;
export type MeetingTranscript = typeof meetingTranscripts.$inferSelect;
export type MeetingTranscriptTranslation = typeof meetingTranscriptTranslations.$inferSelect;
export type MeetingEntity = typeof meetingEntities.$inferSelect;
export type MeetingContactSuggestion = typeof meetingContactSuggestions.$inferSelect;
export type MemoryDocument = typeof memoryDocuments.$inferSelect;
export type ContactAsset = typeof contactAssets.$inferSelect;
export type ContactNeed = typeof contactNeeds.$inferSelect;
export type AiMatchSuggestion = typeof aiMatchSuggestions.$inferSelect;
export type SivcVerification = typeof sivcVerifications.$inferSelect;
export type SivcConsent = typeof sivcConsents.$inferSelect;
export type SivcCheck = typeof sivcChecks.$inferSelect;
export type SivcDocument = typeof sivcDocuments.$inferSelect;
export type PresidentValidation = typeof presidentValidations.$inferSelect;
export type NationalLeader = typeof nationalLeaders.$inferSelect;

// ============================================================
// CONSENTIMENTO E DOCUMENTOS — etapa 11, etapa 13 e ajuste A11
// ============================================================
// Versionar o documento é o que transforma consentimento em prova: "fulana
// aceitou" sem versão não diz o que ela aceitou. Por isso o texto vive aqui,
// e não no código — o texto jurídico entra como uma linha nova quando ficar
// pronto, sem exigir deploy.
export const documentVersions = mysqlTable("document_versions", {
  id:          varchar("id", { length: 36 }).primaryKey(),
  type:        mysqlEnum("type", [
                 "termo_smart_match",
                 "acordo_intermediacao",
                 "contrato_comissao",
                 "termo_gravacao",
                 // Etapa 10: o termo pelo qual a DONA autoriza que membras Ouro
                 // vejam os contatos que ela marcar como compartilhados. Sem
                 // versão publicada (o texto jurídico é da Cris), a regra da
                 // etapa 11 vale: não há o que consentir e a leitura libera.
                 "termo_acesso_ouro",
               ]).notNull(),
  version:     int("version").notNull(),
  text:        text("text").notNull(),
  publishedAt: timestamp("publishedAt").defaultNow().notNull(),
  isCurrent:   boolean("isCurrent").default(false).notNull(),
  // No máximo uma versão vigente por tipo. O Postgres faria com índice parcial;
  // no MySQL a coluna gerada resolve: vale o tipo enquanto vigente e NULL depois,
  // e NULLs não colidem em índice único.
  currentType: varchar("currentType", { length: 32 }).generatedAlwaysAs(
                 sql`(CASE WHEN \`isCurrent\` THEN \`type\` ELSE NULL END)`,
                 { mode: "virtual" },
               ),
}, (table) => ({
  typeVersionUnique: uniqueIndex("doc_ver_type_version_unique").on(table.type, table.version),
  currentUnique:     uniqueIndex("doc_ver_current_unique").on(table.currentType),
}));

// Revogar nunca apaga a linha: preenche revokedAt. A consulta do Smart Match
// avalia a condição na hora, então revogar tem efeito imediato, sem rotina de
// limpeza.
export const consents = mysqlTable("consents", {
  id:                int("id").autoincrement().primaryKey(),
  userId:            int("userId").notNull(),
  documentVersionId: varchar("documentVersionId", { length: 36 }).notNull(),
  grantedAt:         timestamp("grantedAt").defaultNow().notNull(),
  revokedAt:         timestamp("revokedAt"),
  ipAddress:         varchar("ipAddress", { length: 45 }),
  userAgent:         text("userAgent"),
  // No máximo UM consentimento ativo por par (usuária, versão). Mesmo truque da
  // coluna gerada usado acima: vale a chave enquanto não revogado e vira NULL
  // depois, e NULLs não colidem em índice único.
  //
  // Um `UNIQUE (userId, documentVersionId)` simples seria errado: proibiria
  // revogar e aceitar de novo, que é um fluxo legítimo e previsto no termo.
  activeKey:         varchar("activeKey", { length: 80 }).generatedAlwaysAs(
                       sql`(CASE WHEN \`revokedAt\` IS NULL THEN CONCAT(\`userId\`, ':', \`documentVersionId\`) ELSE NULL END)`,
                       { mode: "virtual" },
                     ),
}, (table) => ({
  userIdx:     index("consent_user_idx").on(table.userId),
  documentIdx: index("consent_document_idx").on(table.documentVersionId),
  activeUnique: uniqueIndex("consent_active_unique").on(table.activeKey),
}));

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type Consent = typeof consents.$inferSelect;
