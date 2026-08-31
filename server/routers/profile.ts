import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { isValidCnpj, normalizeCnpj } from "../../shared/business-registration";
import { getDb, getUserProfile, upsertUserProfile } from "../db";
import { users, userProfiles } from "../../drizzle/schema";
import { toPublicUser } from "../auth";

// ============================================================
// PERFIL DO USUÁRIO
// ============================================================

// Aceita "meusite.com.br" e completa o protocolo. Antes, z.string().url()
// puro rejeitava a mutation INTEIRA quando a usuária colava a URL sem
// https:// — nenhum campo era salvo e o erro saía como zod cru.
const urlFlexivel = z.preprocess(
  v => (typeof v === "string" && v.trim() && !/^https?:\/\//i.test(v.trim()) ? "https://" + v.trim() : v),
  z.string().url("Informe uma URL válida (ex.: https://seusite.com.br)").optional().or(z.literal(""))
);

export const profileRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getUserProfile(ctx.user.id);
    return { user: toPublicUser(ctx.user), profile };
  }),

 update: protectedProcedure
   .input(z.object({
     displayName: z.string().min(2).max(100).optional(),
     bio: z.string().max(1000).optional(),
     city: z.string().max(100).optional(),
     country: z.string().length(2).optional(),
     sectors: z.array(z.string()).optional(),
     languages: z.array(z.string()).optional(),
     linkedinUrl: urlFlexivel,
     websiteUrl: urlFlexivel,
     avatarUrl: z.string().optional(),
     company: z.string().max(200).optional(),
     position: z.string().max(200).optional(),
     personType: z.enum(["individual", "legal_entity", "mei"]).optional(),
     companySize: z.enum(["mei", "micro", "small", "medium", "large"]).optional(),
     companyCnpj: z.string().max(18).optional(),
     gender: z.enum(["male", "female", "prefer_not_to_say"]).optional(),
     // Novos campos v2
     jobTitle: z.string().max(200).optional(),
     activityArea: z.string().max(200).optional(),
     interestSectors: z.array(z.string()).optional(),
     institutionalNetwork: z.string().max(300).optional(),
      currentResources: z.string().max(2000).optional(),
     whatIHave: z.array(z.string()).optional(),
      whatINeed: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.companyCnpj && !isValidCnpj(input.companyCnpj)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um CNPJ válido." });
      }
      // Quem se declara MEI ou pessoa jurídica tem CNPJ por definição (A7).
      if ((input.personType === "mei" || input.personType === "legal_entity") && !input.companyCnpj) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o CNPJ: ele é obrigatório para MEI e pessoa jurídica." });
      }
      // `position` é coluna de users, não de user_profiles — mandá-la ao
      // upsert derrubava o UPDATE inteiro com "Unknown column".
      const { position: _position, ...updateData } = input;
      const businessData = updateData.personType === "individual"
        ? { ...updateData, companySize: null, companyCnpj: null }
        : { ...updateData, companyCnpj: updateData.companyCnpj ? normalizeCnpj(updateData.companyCnpj) : undefined };
      await upsertUserProfile(ctx.user.id, businessData);
      // Atualizar company/position na tabela users também
      const db = await getDb();
      if (db && (input.company !== undefined || input.position !== undefined)) {
        const updateData: any = {};
        if (input.company !== undefined) updateData.company = input.company;
        if (input.position !== undefined) updateData.position = input.position;
        if (input.country !== undefined) updateData.country = input.country;
        await db.update(users).set(updateData).where(eq(users.id, ctx.user.id));
      }
      return { success: true };
    }),

 completeOnboarding: protectedProcedure
   .input(z.object({
     displayName: z.string().min(2).max(100),
     bio: z.string().max(1000).optional(),
     city: z.string().max(100),
     country: z.string().length(2).default("BR"),
     sectors: z.array(z.string()).min(1).max(5).optional(),
     languages: z.array(z.string()).default([]),
     linkedinUrl: z.string().optional(),
     company: z.string().max(200).optional(),
     position: z.string().max(200).optional(),
     personType: z.enum(["individual", "legal_entity", "mei"]).optional(),
     companySize: z.enum(["mei", "micro", "small", "medium", "large"]).optional(),
     companyCnpj: z.string().max(18).optional(),
     gender: z.enum(["male", "female", "prefer_not_to_say"]).optional(),
     // Campos do sistema de matching
     age: z.number().int().min(16).max(120).optional(),
     primarySpecialty: z.string().max(100).optional(),
     secondarySpecialties: z.array(z.string().min(1).max(100)).optional(),
     experienceYears: z.number().int().min(0).max(60).optional(),
     educationLevel: z.string().max(50).optional(),
     currentRole: z.string().max(200).optional(),
     currentCompany: z.string().max(200).optional(),
     sector: z.string().max(100).optional(),
     seekingTypes: z.array(z.string()).optional(),
     businessInterests: z.array(z.string()).optional(),
     preferredCompanySize: z.string().max(50).optional(),
     openToRemote: z.boolean().optional(),
     availableForTravel: z.boolean().optional(),
     incomeRange: z.string().max(50).optional(),
     investmentCapacity: z.enum(["none", "under_10k", "10k_50k", "50k_200k", "200k_plus"]).optional(),
     lookingForInvestment: z.boolean().optional(),
     workStyle: z.string().max(50).optional(),
     values: z.array(z.string()).max(4).optional(),
     // Novos campos v2
     jobTitle: z.string().max(200).optional(),
     activityArea: z.string().max(200).optional(),
     interestSectors: z.array(z.string()).optional(),
     institutionalNetwork: z.string().max(300).optional(),
      currentResources: z.string().max(2000).optional(),
     whatIHave: z.array(z.string()).optional(),
      whatINeed: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.companyCnpj && !isValidCnpj(input.companyCnpj)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um CNPJ válido." });
      }
      if ((input.personType === "mei" || input.personType === "legal_entity") && !input.companyCnpj) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o CNPJ: ele é obrigatório para MEI e pessoa jurídica." });
      }
      const { company, position, jobTitle, activityArea, interestSectors, institutionalNetwork, currentResources, whatIHave, whatINeed, personType, companySize, companyCnpj, ...profileData } = input;
      await upsertUserProfile(ctx.user.id, profileData);
      const db = await getDb();
      if (db) {
        await db.update(users).set({
          onboardingCompleted: true,
          company: company,
          position: position,
          country: input.country,
        }).where(eq(users.id, ctx.user.id));
        // Salvar campos v2 no user_profiles
        const profileUpdates: Record<string, unknown> = {};
        if (jobTitle !== undefined) profileUpdates.jobTitle = jobTitle;
        if (activityArea !== undefined) profileUpdates.activityArea = activityArea;
        if (currentResources !== undefined) profileUpdates.currentResources = currentResources;
        if (personType !== undefined) profileUpdates.personType = personType;
        if (personType === "individual") {
          profileUpdates.companySize = null;
          profileUpdates.companyCnpj = null;
        } else {
          if (companySize !== undefined) profileUpdates.companySize = companySize;
          if (companyCnpj !== undefined) profileUpdates.companyCnpj = companyCnpj ? normalizeCnpj(companyCnpj) : null;
        }
        if (institutionalNetwork !== undefined) profileUpdates.institutionalNetwork = institutionalNetwork;
        // Colunas json — o Drizzle serializa; passar já stringificado gravaria JSON duplo
        if (interestSectors !== undefined) profileUpdates.interestSectors = interestSectors;
        if (whatIHave !== undefined) profileUpdates.whatIHave = whatIHave;
        if (whatINeed !== undefined) profileUpdates.whatINeed = whatINeed;
        if (Object.keys(profileUpdates).length > 0) {
          await db.update(userProfiles).set(profileUpdates as any).where(eq(userProfiles.userId, ctx.user.id));
        }
      }
      // Gerar matches automaticamente após onboarding
      try {
        const { generateMatchesForUser } = await import("../matching");
        await generateMatchesForUser(ctx.user.id);
      } catch (e) { console.warn("[Onboarding] Match generation failed:", e); }
      return { success: true };
    }),
});
