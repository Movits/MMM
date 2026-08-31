import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { requireSecret } from "./_core/env";
import {
  userProfiles, users, matches,
  type UserProfile,
} from "../drizzle/schema";
import { eq, ne, and, desc } from "drizzle-orm";
import crypto from "crypto";

// ─── Encryption helpers (for sensitive data) ─────────────────
const VAULT_KEY = process.env.VAULT_ENCRYPTION_KEY || requireSecret("JWT_SECRET");

function encryptSensitive(data: object): string {
  const key = crypto.createHash("sha256").update(VAULT_KEY).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decryptSensitive(encrypted: string): object {
  try {
    const [ivHex, dataHex] = encrypted.split(":");
    const key = crypto.createHash("sha256").update(VAULT_KEY).digest();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return {};
  }
}

// ─── Save or update user profile ─────────────────────────────
export async function saveUserProfile(userId: number, data: Partial<UserProfile> & {
  sensitiveData?: Record<string, unknown>;
}) {
  const { sensitiveData, ...profileData } = data;

  const encryptedSensitiveData = sensitiveData
    ? encryptSensitive(sensitiveData)
    : undefined;

  // Calculate completeness
  const fields = [
    profileData.displayName, profileData.city, profileData.primarySpecialty,
    profileData.sector, profileData.seekingTypes, profileData.incomeRange,
    profileData.workStyle, profileData.bio, profileData.experienceYears,
    profileData.values,
  ];
  const filled = fields.filter(f => f !== null && f !== undefined && f !== "" && !(Array.isArray(f) && f.length === 0)).length;
  const profileCompleteness = Math.round((filled / fields.length) * 100);

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const existing = await db.select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(userProfiles)
      .set({
        ...profileData,
        ...(encryptedSensitiveData ? { encryptedSensitiveData } : {}),
        profileCompleteness,
      })
      .where(eq(userProfiles.userId, userId));
  } else {
    await db.insert(userProfiles).values({
      userId,
      ...profileData,
      ...(encryptedSensitiveData ? { encryptedSensitiveData } : {}),
      profileCompleteness,
    } as typeof userProfiles.$inferInsert);
  }

  // Mark onboarding as completed if completeness >= 70
  if (profileCompleteness >= 70) {
    await db.update(users)
      .set({ onboardingCompleted: true })
      .where(eq(users.id, userId));
  }

  return { profileCompleteness };
}

// ─── Get user profile (safe, no sensitive data) ──────────────
export async function getUserProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const [profile] = await db.select({
    id: userProfiles.id,
    userId: userProfiles.userId,
    displayName: userProfiles.displayName,
    age: userProfiles.age,
    city: userProfiles.city,
    country: userProfiles.country,
    avatarUrl: userProfiles.avatarUrl,
    bio: userProfiles.bio,
    primarySpecialty: userProfiles.primarySpecialty,
    secondarySpecialties: userProfiles.secondarySpecialties,
    experienceYears: userProfiles.experienceYears,
    educationLevel: userProfiles.educationLevel,
    currentRole: userProfiles.currentRole,
    currentCompany: userProfiles.currentCompany,
    sector: userProfiles.sector,
    seekingTypes: userProfiles.seekingTypes,
    businessInterests: userProfiles.businessInterests,
    preferredCompanySize: userProfiles.preferredCompanySize,
    openToRemote: userProfiles.openToRemote,
    availableForTravel: userProfiles.availableForTravel,
    workStyle: userProfiles.workStyle,
    languages: userProfiles.languages,
    values: userProfiles.values,
    profileCompleteness: userProfiles.profileCompleteness,
    lastAiAnalysisAt: userProfiles.lastAiAnalysisAt,
    // NOTE: encryptedSensitiveData is intentionally excluded
  }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);

  return profile || null;
}

// ─── Calculate compatibility score between two profiles ──────
export function calculateCompatibilityScore(
  a: UserProfile,
  b: UserProfile
): {
  overall: number;
  specialty: number;
  objectives: number;
  sector: number;
  investment: number;
  location: number;
  values: number;
} {
  // Specialty score — complementary specialties score higher than identical
  let specialtyScore = 0;
  if (a.primarySpecialty && b.primarySpecialty) {
    if (a.primarySpecialty === b.primarySpecialty) {
      specialtyScore = 60; // Same specialty = moderate (may be competition)
    } else {
      const aSecondary = (a.secondarySpecialties as string[]) || [];
      const bSecondary = (b.secondarySpecialties as string[]) || [];
      const overlap = aSecondary.filter(s => bSecondary.includes(s) || s === b.primarySpecialty).length;
      specialtyScore = Math.min(100, 40 + overlap * 20);
    }
  }

  // Sector score — same sector = potential synergy; adjacent sectors = moderate
  const SECTOR_ADJACENCY: Record<string, string[]> = {
    agriculture: ["food", "sustainability", "logistics"],
    technology: ["fintech", "education", "media", "healthcare"],
    fintech: ["technology", "finance", "real_estate"],
    healthcare: ["pharma", "technology", "wellness"],
    fashion: ["retail", "luxury", "sustainability"],
    energy: ["sustainability", "infrastructure", "technology"],
    education: ["technology", "media"],
    retail: ["ecommerce", "fashion", "logistics"],
    media: ["technology", "education", "entertainment"],
    tourism: ["hospitality", "wellness", "luxury"],
  };
  let sectorScore = 30; // default: different sectors
  if (a.sector && b.sector) {
    if (a.sector === b.sector) {
      sectorScore = 70; // same sector: synergy but also competition
    } else {
      const adjacent = SECTOR_ADJACENCY[a.sector] || [];
      sectorScore = adjacent.includes(b.sector) ? 55 : 30;
    }
  }

  // Objectives score — complementarity is key
  const aSeeks = (a.seekingTypes as string[]) || [];
  const bSeeks = (b.seekingTypes as string[]) || [];
  const seekingOverlap = aSeeks.filter(s => bSeeks.includes(s)).length;
  const objectivesScore = Math.min(100, seekingOverlap * 25 + (seekingOverlap > 0 ? 25 : 0));

  // Investment compatibility — investor + seeker = perfect; both investors = low
  const investCapacityRanks: Record<string, number> = {
    none: 0, under_10k: 1, "10k_50k": 2, "50k_200k": 3, "200k_plus": 4,
  };
  const investAmountRanks: Record<string, number> = {
    none: 0, under_50k: 1, "50k_200k": 2, "200k_1m": 3, "1m_plus": 4,
  };
  let investmentScore = 50;
  const aCapacity = investCapacityRanks[a.investmentCapacity as string] ?? 2;
  const bCapacity = investCapacityRanks[b.investmentCapacity as string] ?? 2;
  const aSeeking = investAmountRanks[a.investmentAmountSeeking as string] ?? 0;
  const bSeeking = investAmountRanks[b.investmentAmountSeeking as string] ?? 0;
  if (a.lookingForInvestment && !b.lookingForInvestment && bCapacity >= aSeeking) {
    investmentScore = 90; // A seeks investment, B can provide it
  } else if (!a.lookingForInvestment && b.lookingForInvestment && aCapacity >= bSeeking) {
    investmentScore = 90; // B seeks investment, A can provide it
  } else if (!a.lookingForInvestment && !b.lookingForInvestment) {
    investmentScore = 60; // Both have capacity — potential co-investment
  } else if (a.lookingForInvestment && b.lookingForInvestment) {
    investmentScore = 20; // Both seeking investment — low compatibility
  }

  // Location score
  let locationScore = 50;
  if (a.country && b.country) {
    if (a.country === b.country) {
      locationScore = a.city === b.city ? 100 : 75;
    } else {
      locationScore = (a.openToRemote && b.openToRemote) ? 60 : 30;
    }
  }

  // Values score
  const aValues = (a.values as string[]) || [];
  const bValues = (b.values as string[]) || [];
  const valuesOverlap = aValues.filter(v => bValues.includes(v)).length;
  const valuesScore = aValues.length > 0 && bValues.length > 0
    ? Math.min(100, (valuesOverlap / Math.max(aValues.length, bValues.length)) * 100 + 20)
    : 50;

  // Weighted overall score
  // objectives (30%) + sector (20%) + investment (20%) + specialty (15%) + values (10%) + location (5%)
  const overall = Math.round(
    objectivesScore * 0.30 +
    sectorScore * 0.20 +
    investmentScore * 0.20 +
    specialtyScore * 0.15 +
    valuesScore * 0.10 +
    locationScore * 0.05
  );

  return {
    overall,
    specialty: Math.round(specialtyScore),
    objectives: Math.round(objectivesScore),
    sector: Math.round(sectorScore),
    investment: Math.round(investmentScore),
    location: Math.round(locationScore),
    values: Math.round(valuesScore),
  };
}

// ─── Generate AI insight for a match ─────────────────────────
export async function generateMatchInsight(
  profileA: UserProfile,
  profileB: UserProfile,
  scores: ReturnType<typeof calculateCompatibilityScore>
): Promise<string> {
  try {
    const prompt = `Você é um assistente de matchmaking profissional. Analise a compatibilidade entre dois perfis e escreva um insight conciso (2-3 frases) explicando POR QUE eles são compatíveis e QUAL oportunidade específica podem criar juntos.

Perfil A:
- Especialidade: ${profileA.primarySpecialty}
- Busca: ${(profileA.seekingTypes as string[])?.join(", ")}
- Setor: ${profileA.sector}
- Valores: ${(profileA.values as string[])?.join(", ")}
- Localização: ${profileA.city}, ${profileA.country}

Perfil B:
- Especialidade: ${profileB.primarySpecialty}
- Busca: ${(profileB.seekingTypes as string[])?.join(", ")}
- Setor: ${profileB.sector}
- Valores: ${(profileB.values as string[])?.join(", ")}
- Localização: ${profileB.city}, ${profileB.country}

Score de compatibilidade: ${scores.overall}%
- Objetivos: ${scores.objectives}%
- Especialidade: ${scores.specialty}%
- Valores: ${scores.values}%

Escreva o insight em português, de forma direta e motivadora. Máximo 150 palavras.`;

    const response = await invokeLLM({
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices?.[0]?.message?.content;
    return (typeof content === "string" ? content : null) || "Perfis com alta compatibilidade estratégica identificada.";
  } catch {
    return "Perfis complementares com potencial de parceria estratégica.";
  }
}

// ─── Generate matches for a user ─────────────────────────────
export async function generateMatchesForUser(userId: number): Promise<number> {
  const myProfile = await getUserProfile(userId);
  if (!myProfile) return 0;

  // Todas as outras usuárias ativas. NÃO se exclui quem já casou: a regeneração
  // re-scora todo mundo e grava por upsert contra a chave única
  // (userId, matchedUserId). Antes havia aqui uma subconsulta de "já casei" com
  // `ne(matchedUserId, null)` — que em SQL é sempre falso, devolvia zero linhas,
  // e o insert puro duplicava o conjunto inteiro a cada clique.
  const db = await getDb();
  if (!db) return 0;

  const candidates = await db.select({
    userId: userProfiles.userId,
    id: userProfiles.id,
    displayName: userProfiles.displayName,
    age: userProfiles.age,
    city: userProfiles.city,
    country: userProfiles.country,
    avatarUrl: userProfiles.avatarUrl,
    bio: userProfiles.bio,
    primarySpecialty: userProfiles.primarySpecialty,
    secondarySpecialties: userProfiles.secondarySpecialties,
    experienceYears: userProfiles.experienceYears,
    educationLevel: userProfiles.educationLevel,
    currentRole: userProfiles.currentRole,
    currentCompany: userProfiles.currentCompany,
    sector: userProfiles.sector,
    seekingTypes: userProfiles.seekingTypes,
    businessInterests: userProfiles.businessInterests,
    preferredCompanySize: userProfiles.preferredCompanySize,
    openToRemote: userProfiles.openToRemote,
    availableForTravel: userProfiles.availableForTravel,
    incomeRange: userProfiles.incomeRange,
    investmentCapacity: userProfiles.investmentCapacity,
    lookingForInvestment: userProfiles.lookingForInvestment,
    investmentAmountSeeking: userProfiles.investmentAmountSeeking,
    workStyle: userProfiles.workStyle,
    languages: userProfiles.languages,
    values: userProfiles.values,
    profileCompleteness: userProfiles.profileCompleteness,
    lastAiAnalysisAt: userProfiles.lastAiAnalysisAt,
    encryptedSensitiveData: userProfiles.encryptedSensitiveData,
    createdAt: userProfiles.createdAt,
    updatedAt: userProfiles.updatedAt,
  })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(and(
      ne(userProfiles.userId, userId),
      eq(users.isActive, true),
    ))
    .limit(50);

  let matchesCreated = 0;

  for (const candidate of candidates) {
    const scores = calculateCompatibilityScore(myProfile as UserProfile, candidate as UserProfile);

    // Only create matches with score >= 40
    if (scores.overall < 40) continue;

    // Generate AI insight for top matches (score >= 70)
    let aiInsight: string | null = null;
    if (scores.overall >= 70) {
      aiInsight = await generateMatchInsight(myProfile as UserProfile, candidate as UserProfile, scores);
    }

    // Upsert contra a chave única (userId, matchedUserId): re-analisar atualiza o
    // score de quem já existe em vez de duplicar. O `set` de propósito NÃO toca
    // userSeen, userDismissed nem createdAt — é o que preserva a decisão da
    // usuária, e o que impede um dispensado de voltar como linha nova.
    const scoreValues = {
      overallScore: scores.overall,
      specialtyScore: scores.specialty,
      objectivesScore: scores.objectives,
      incomeScore: scores.investment,
      locationScore: scores.location,
      valuesScore: scores.values,
      aiInsight,
      aiGeneratedAt: aiInsight ? new Date() : null,
    };
    await db.insert(matches)
      .values({ userId, matchedUserId: candidate.userId as number, ...scoreValues })
      .onDuplicateKeyUpdate({ set: scoreValues });

    matchesCreated++;
  }

  // Update lastAiAnalysisAt
  await (await getDb())?.update(userProfiles)
    .set({ lastAiAnalysisAt: new Date() })
    .where(eq(userProfiles.userId, userId));

  return matchesCreated;
}

// ─── Get matches for a user ───────────────────────────────────
export async function getMatchesForUser(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];

  const userMatches = await db.select({
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
    // Profile fields
    displayName: userProfiles.displayName,
    city: userProfiles.city,
    country: userProfiles.country,
    avatarUrl: userProfiles.avatarUrl,
    bio: userProfiles.bio,
    primarySpecialty: userProfiles.primarySpecialty,
    currentRole: userProfiles.currentRole,
    currentCompany: userProfiles.currentCompany,
    sector: userProfiles.sector,
    seekingTypes: userProfiles.seekingTypes,
    values: userProfiles.values,
    profileCompleteness: userProfiles.profileCompleteness,
  })
    .from(matches)
    .innerJoin(userProfiles, eq(userProfiles.userId, matches.matchedUserId))
    .where(and(
      eq(matches.userId, userId),
      eq(matches.userDismissed, false),
    ))
    .orderBy(desc(matches.overallScore))
    .limit(limit);

  return userMatches;
}

// ─── Dismiss a match ─────────────────────────────────────────
export async function dismissMatch(userId: number, matchId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(matches)
    .set({ userDismissed: true })
    .where(and(eq(matches.id, matchId), eq(matches.userId, userId)));
}

// ─── Mark match as seen ───────────────────────────────────────
export async function markMatchSeen(userId: number, matchId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(matches)
    .set({ userSeen: true })
    .where(and(eq(matches.id, matchId), eq(matches.userId, userId)));
}

// ─── Get match stats for dashboard ───────────────────────────
export async function getMatchStats(userId: number) {
  const db = await getDb();
  if (!db) return { total: 0, unseen: 0, highScore: 0, avgScore: 0, distribution: [0,0,0,0,0] };

  const allMatches = await db.select({
    overallScore: matches.overallScore,
    userSeen: matches.userSeen,
    userDismissed: matches.userDismissed,
  })
    .from(matches)
    .where(eq(matches.userId, userId));

  const total = allMatches.length;
  type MatchRow = { overallScore: number; userSeen: boolean | null; userDismissed: boolean | null };
  const unseen = allMatches.filter((m: MatchRow) => !m.userSeen && !m.userDismissed).length;
  const highScore = allMatches.filter((m: MatchRow) => (m.overallScore ?? 0) >= 80 && !m.userDismissed).length;
  const avgScore = total > 0
    ? Math.round(allMatches.reduce((sum: number, m: MatchRow) => sum + (m.overallScore ?? 0), 0) / total)
    : 0;

  // Score distribution for histogram
  const distribution = [0, 0, 0, 0, 0]; // 0-20, 20-40, 40-60, 60-80, 80-100
  (allMatches as MatchRow[]).forEach((m: MatchRow) => {
    const bucket = Math.min(4, Math.floor((m.overallScore ?? 0) / 20));
    distribution[bucket]++;
  });

  return { total, unseen, highScore, avgScore, distribution };
}
