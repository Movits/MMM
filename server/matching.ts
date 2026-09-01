import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";
import { requireSecret } from "./_core/env";
import {
  userProfiles, users, matches,
  type UserProfile,
} from "../drizzle/schema";
import { eq, ne, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { hasValidConsent, usersComConsentimento } from "./routers/consent";

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
    // O perfil estratégico (etapa 2): sem estes dois campos aqui, a dimensão de
    // complementaridade recebia undefined para `myProfile` e ficava sempre
    // neutra. O trio de investimento tinha o mesmo problema e vai junto.
    whatIHave: userProfiles.whatIHave,
    whatINeed: userProfiles.whatINeed,
    investmentCapacity: userProfiles.investmentCapacity,
    lookingForInvestment: userProfiles.lookingForInvestment,
    investmentAmountSeeking: userProfiles.investmentAmountSeeking,
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

// O onboarding grava o SETOR como o rótulo traduzido (o select envia s.label),
// então o banco tem "Saúde", "Health & Healthtechs", "Salud & Healthtechs"...
// conforme o idioma de quem preencheu. Esta tabela traduz o gravado — rótulo em
// pt/en/es, com ou sem acento, ou a própria chave — para a chave canônica de
// onboarding.sectors, que é o idioma da adjacência. Rótulo desconhecido segue
// em minúsculas: dois iguais ainda casam entre si.
const SECTOR_LABEL_PARA_CHAVE: Record<string, string> = {
  // pt-BR
  "agronegocio": "agribusiness", "construcao civil": "construction",
  "educacao": "education", "energia, agua & gas": "energy",
  "entretenimento & midia": "entertainment", "financeiro & fintechs": "financial",
  "governo & setor publico": "government", "industria & manufatura": "industry",
  "logistica & transporte": "logistics", "saude": "health",
  "tecnologia & software": "technology", "telecomunicacoes": "telecom",
  "turismo & hospitalidade": "tourism", "varejo & consumo": "retail",
  // en
  "agribusiness": "agribusiness", "construction": "construction",
  "education": "education", "energy & utilities": "energy",
  "entertainment & media": "entertainment", "financial & fintechs": "financial",
  "government & public sector": "government", "industry & manufacturing": "industry",
  "logistics & transport": "logistics", "health & healthtechs": "health",
  "technology & saas": "technology", "telecommunications": "telecom",
  "tourism & hospitality": "tourism", "retail & consumer": "retail",
  // es
  "agronegocios": "agribusiness", "construccion": "construction",
  "educacion": "education",
  "energia & utilities": "energy", "entretenimiento & medios": "entertainment",
  "financiero & fintechs": "financial", "gobierno & sector publico": "government",
  "industria & manufactura": "industry", "salud & healthtechs": "health",
  "tecnologia & saas": "technology", "telecomunicaciones": "telecom",
  "turismo & hospitalidad": "tourism", "retail & consumo": "retail",
  // Os outros 7 idiomas do app ainda gravam rótulos próprios; dois iguais
  // seguem casando entre si pelo fallback, e o conserto definitivo é o
  // onboarding passar a gravar a CHAVE (tarefa "adaptar às chaves canônicas").
};

export function chaveDoSetor(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const bruto = valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!bruto) return null;
  return SECTOR_LABEL_PARA_CHAVE[bruto] ?? bruto;
}

// Adjacência entre setores, no vocabulário canônico do onboarding.
const SECTOR_ADJACENCY: Record<string, string[]> = {
  agribusiness: ["logistics", "industry", "retail"],
  industry: ["logistics", "energy", "construction", "agribusiness"],
  technology: ["financial", "education", "health", "telecom", "entertainment"],
  financial: ["technology", "retail", "construction"],
  health: ["technology", "education"],
  energy: ["industry", "construction"],
  education: ["technology", "entertainment"],
  retail: ["logistics", "agribusiness", "technology"],
  logistics: ["industry", "agribusiness", "retail"],
  construction: ["industry", "energy", "government"],
  telecom: ["technology", "entertainment"],
  tourism: ["entertainment", "retail"],
  entertainment: ["telecom", "education", "tourism"],
  government: ["construction", "energy", "health"],
};

// O que cada ativo ("o que possui") satisfaz nas necessidades ("o que procura").
// Os dois campos vêm de listas diferentes no onboarding (WHAT_I_HAVE_OPTIONS /
// WHAT_I_NEED_OPTIONS) e só compartilham 3 ids, então a ponte é explícita. Ids
// desconhecidos simplesmente não cobrem nada — degrada suave, nunca quebra.
// Espelha o formato do SECTOR_ADJACENCY, logo acima.
const HAVE_SATISFIES_NEED: Record<string, string[]> = {
  industria: ["fornecedores", "compradores"],
  fazenda: ["fornecedores", "compradores"],
  commodities: ["fornecedores", "compradores"],
  laboratorio: ["fornecedores", "consultoria", "parceiros"],
  tecnologia: ["tecnologia", "consultoria"],
  investidores: ["investidores", "financiamento", "parceiros"],
  acesso_governamental: ["licencas", "consultoria", "parceiros"],
  licencas: ["licencas", "consultoria"],
  imoveis: ["fornecedores", "parceiros"],
  logistica: ["distribuidores", "fornecedores"],
  canais_comerciais: ["distribuidores", "compradores"],
};

/** Quantas necessidades de `need` algum ativo de `have` satisfaz. */
function coversNeeds(have: string[], need: string[]): number {
  return need.filter(n => have.some(h => h === n || HAVE_SATISFIES_NEED[h]?.includes(n))).length;
}

// ─── Calculate compatibility score between two profiles ──────
export function calculateCompatibilityScore(
  a: UserProfile,
  b: UserProfile
): {
  overall: number;
  specialty: number;
  objectives: number;
  complementarity: number;
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

  // Sector score — same sector = potential synergy; adjacent sectors = moderate.
  // A adjacência fala o vocabulário CANÔNICO do onboarding (as chaves de
  // onboarding.sectors); a comparação normaliza o que estiver gravado antes.
  // A tabela anterior usava um vocabulário que não existe no app (agriculture,
  // fintech, healthcare...) — nenhum valor gravado casava com ela, e os 20% de
  // peso do setor eram letra morta.
  let sectorScore = 30; // default: different sectors
  const setorA = chaveDoSetor(a.sector);
  const setorB = chaveDoSetor(b.sector);
  if (setorA && setorB) {
    if (setorA === setorB) {
      sectorScore = 70; // same sector: synergy but also competition
    } else {
      const adjacent = SECTOR_ADJACENCY[setorA] || [];
      sectorScore = adjacent.includes(setorB) ? 55 : 30;
    }
  }

  // Complementaridade estratégica (etapa 2) — o coração do match.
  //
  // O sinal certo NÃO é as duas quererem a mesma coisa (isso é concorrência, o
  // mesmo erro que a regra da direção da etapa 11 corrigiu), e sim uma TER o que
  // a outra PROCURA. Como "o que possui" e "o que procura" usam vocabulários
  // diferentes (só 3 ids coincidem), a interseção crua não serve: é preciso um
  // mapa curado do que um ativo satisfaz — no espírito da lista controlada da
  // arquitetura, e espelhando o SECTOR_ADJACENCY acima.
  const aHave = (a.whatIHave as string[]) || [], aNeed = (a.whatINeed as string[]) || [];
  const bHave = (b.whatIHave as string[]) || [], bNeed = (b.whatINeed as string[]) || [];
  const aCoversB = coversNeeds(aHave, bNeed);   // ativos de A atendem necessidades de B
  const bCoversA = coversNeeds(bHave, aNeed);   // ativos de B atendem necessidades de A
  const totalCoverage = aCoversB + bCoversA;
  let complementarityScore: number;
  if (aHave.length + aNeed.length === 0 || bHave.length + bNeed.length === 0) {
    complementarityScore = 50;                                            // sem perfil estratégico → neutro
  } else if (aCoversB > 0 && bCoversA > 0) {
    complementarityScore = Math.min(100, 75 + 10 * (totalCoverage - 2));  // mútuo: cada uma tem o que a outra precisa
  } else if (totalCoverage > 0) {
    complementarityScore = Math.min(70, 45 + 15 * totalCoverage);         // uma via
  } else {
    complementarityScore = 20;                                           // tem dado, sem encaixe: sem sinergia ou concorrência
  }

  // Mantido para compat com o tipo de retorno e a coluna objectivesScore, mas
  // com peso ZERO no overall — medir overlap de seekingTypes premiava querer a
  // mesma coisa. A complementaridade tomou o lugar dele.
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
  // complementaridade (30%) + sector (20%) + investment (20%) + specialty (15%)
  //   + values (10%) + location (5%). Os 30% eram de `objectives`, que media
  //   overlap de objetivo (concorrência); passaram para a complementaridade,
  //   que é o que a etapa 2 promete. `objectives` continua no retorno com peso 0.
  const overall = Math.round(
    complementarityScore * 0.30 +
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
    complementarity: Math.round(complementarityScore),
    sector: Math.round(sectorScore),
    investment: Math.round(investmentScore),
    location: Math.round(locationScore),
    values: Math.round(valuesScore),
  };
}

// Desde a migração para chaves canônicas (migrar-rotulos-para-chaves), busca e
// valores ficam gravados como strategic_partner, innovation etc. — e era assim,
// cru, que entravam no prompt e voltavam citados no texto que a usuária lê.
// Estes mapas devolvem o rótulo humano; chave desconhecida passa como veio.
const ROTULO_DE_BUSCA: Record<string, string> = {
  strategic_partner: "Sócia estratégica", investor: "Investidora", mentor: "Mentora",
  team: "Equipe/Talentos", job: "Emprego/Projeto", be_mentor: "Quer também mentorar",
};
const ROTULO_DE_VALOR: Record<string, string> = {
  innovation: "Inovação", social_impact: "Impacto social", autonomy: "Autonomia",
  fast_growth: "Crescimento rápido", stability: "Estabilidade", purpose: "Propósito",
  collaboration: "Colaboração", results: "Resultados", diversity: "Diversidade",
  transparency: "Transparência", sustainability: "Sustentabilidade",
  technical_excellence: "Excelência técnica",
};
const rotular = (valores: unknown, mapa: Record<string, string>) =>
  ((valores as string[]) || []).map(valor => mapa[valor] ?? valor).join(", ");

// ─── Generate AI insight for a match ─────────────────────────
export async function generateMatchInsight(
  profileA: UserProfile,
  profileB: UserProfile,
  scores: ReturnType<typeof calculateCompatibilityScore>
): Promise<string | null> {
  try {
    const prompt = `Você é um assistente de matchmaking profissional. Analise a compatibilidade entre dois perfis e escreva um insight conciso (2-3 frases) explicando POR QUE eles são compatíveis e QUAL oportunidade específica podem criar juntos.

Perfil A:
- Especialidade: ${profileA.primarySpecialty}
- Busca: ${rotular(profileA.seekingTypes, ROTULO_DE_BUSCA)}
- Setor: ${profileA.sector}
- Valores: ${rotular(profileA.values, ROTULO_DE_VALOR)}
- Localização: ${profileA.city}, ${profileA.country}

Perfil B:
- Especialidade: ${profileB.primarySpecialty}
- Busca: ${rotular(profileB.seekingTypes, ROTULO_DE_BUSCA)}
- Setor: ${profileB.sector}
- Valores: ${rotular(profileB.values, ROTULO_DE_VALOR)}
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
    // Falhou ou veio vazio: null, e NUNCA um texto de enchimento. O chamador
    // grava o que vier daqui — um enchimento gravado contava como "insight já
    // existe" e impedia para sempre a geração do texto de verdade.
    return (typeof content === "string" && content.trim()) ? content : null;
  } catch {
    return null;
  }
}

// Enchimentos da versão anterior que ficaram gravados no banco: para o reuso,
// valem como "sem insight" — senão quem os recebeu nunca ganharia o texto real.
const INSIGHTS_DE_ENCHIMENTO = new Set([
  "Perfis com alta compatibilidade estratégica identificada.",
  "Perfis complementares com potencial de parceria estratégica.",
]);

// Teto de insights de IA por rodada: o texto é um luxo, o score é o produto.
// Sem teto, uma rodada com 50 candidatas acima de 70 disparava 50 chamadas ao
// LLM em sequência — mais que o dia inteiro de cota do plano gratuito, num
// clique. O insight já gravado é reaproveitado e nunca sobrescrito por null.
const INSIGHTS_POR_RODADA = 3;

// ─── Generate matches for a user ─────────────────────────────
export async function generateMatchesForUser(userId: number): Promise<number> {
  const myProfile = await getUserProfile(userId);
  if (!myProfile) return 0;

  // Etapa 11: cruzar perfis estratégicos (o que tem / o que precisa) é
  // cruzamento, e cruzamento exige o termo aceito — dos DOIS lados. O mesmo
  // hasValidConsent do cruzamento privado: sem termo publicado, libera.
  if (!(await hasValidConsent(userId, "termo_smart_match"))) return 0;

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
    whatIHave: userProfiles.whatIHave,
    whatINeed: userProfiles.whatINeed,
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
    // encryptedSensitiveData fica FORA de propósito: o cofre não participa do
    // score e não pode passear por candidatas, logs ou prompts.
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

  // O outro lado da etapa 11: só cruza o dado de quem também autorizou.
  const autorizadas = await usersComConsentimento(candidates.map(candidate => candidate.userId as number), "termo_smart_match");

  // Insights já gravados: reaproveitar em vez de regenerar — cada um custou uma
  // chamada da cota diária do LLM.
  const existentes = await db.select({ matchedUserId: matches.matchedUserId, aiInsight: matches.aiInsight })
    .from(matches)
    .where(eq(matches.userId, userId));
  const insightExistente = new Map(existentes.map(linha => [linha.matchedUserId, linha.aiInsight]));

  let matchesCreated = 0;
  let insightsGerados = 0;

  for (const candidate of candidates) {
    if (!autorizadas.has(candidate.userId as number)) continue;
    const scores = calculateCompatibilityScore(myProfile as UserProfile, candidate as UserProfile);

    // Only create matches with score >= 40
    if (scores.overall < 40) continue;

    // Insight de IA só para os melhores, só quando ainda não existe um DE
    // VERDADE (enchimento antigo não conta), e no máximo INSIGHTS_POR_RODADA
    // por rodada — cota é finita e o score não depende dele.
    let aiInsight: string | null = null;
    const guardado = insightExistente.get(candidate.userId as number);
    const temInsightReal = !!guardado && !INSIGHTS_DE_ENCHIMENTO.has(guardado);
    if (scores.overall >= 70 && !temInsightReal && insightsGerados < INSIGHTS_POR_RODADA) {
      aiInsight = await generateMatchInsight(myProfile as UserProfile, candidate as UserProfile, scores);
      insightsGerados += 1;
    }

    // Upsert contra a chave única (userId, matchedUserId): re-analisar atualiza o
    // score de quem já existe em vez de duplicar. O `set` de propósito NÃO toca
    // userSeen, userDismissed nem createdAt — é o que preserva a decisão da
    // usuária, e o que impede um dispensado de voltar como linha nova. E só toca
    // aiInsight quando gerou um agora: null não apaga o texto que já custou cota.
    const scoreValues = {
      overallScore: scores.overall,
      specialtyScore: scores.specialty,
      objectivesScore: scores.objectives,
      incomeScore: scores.investment,
      locationScore: scores.location,
      valuesScore: scores.values,
    };
    const comInsight = aiInsight ? { ...scoreValues, aiInsight, aiGeneratedAt: new Date() } : scoreValues;
    await db.insert(matches)
      .values({ userId, matchedUserId: candidate.userId as number, ...comInsight })
      .onDuplicateKeyUpdate({ set: comInsight });

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

  // Etapa 11 também na LEITURA: revogar o termo esconde na hora o que já tinha
  // sido cruzado — dos dois lados. A linha gravada fica (histórico), mas não
  // aparece nem para quem revogou nem citando quem revogou.
  if (!(await hasValidConsent(userId, "termo_smart_match"))) return [];

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

  const ids = userMatches.map(match => match.matchedUserId).filter((id): id is number => id !== null);
  const comTermo = await usersComConsentimento(ids, "termo_smart_match");
  return userMatches.filter(match => match.matchedUserId !== null && comTermo.has(match.matchedUserId));
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
