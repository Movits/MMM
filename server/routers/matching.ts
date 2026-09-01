import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb, createNotification } from "../db";
import { opportunities, userProfiles } from "../../drizzle/schema";
import { usersComConsentimento } from "./consent";

// ============================================================
// MOTOR DE IA DE MATCHMAKING SEMÂNTICO
// ============================================================
export const matchingRouter = router({
  // Retorna oportunidades recomendadas para o usuário logado com score de compatibilidade
  getRecommendedOpportunities: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, ctx.user.id)).limit(1);
    if (!profile) return [];

    const activeOpps = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.status, "active"), sql`${opportunities.publishedBy} != ${ctx.user.id}`))
      .orderBy(desc(opportunities.createdAt))
      .limit(50);

    if (activeOpps.length === 0) return [];

    const userContext = [
      profile.bio ? `Bio: ${profile.bio}` : "",
      profile.activityArea ? `Área de atuação: ${profile.activityArea}` : "",
      profile.primarySpecialty ? `Especialidade: ${profile.primarySpecialty}` : "",
      profile.sector ? `Setor: ${profile.sector}` : "",
      profile.whatIHave ? `O que tenho: ${JSON.stringify(profile.whatIHave)}` : "",
      profile.whatINeed ? `O que preciso: ${JSON.stringify(profile.whatINeed)}` : "",
      profile.seekingTypes ? `Buscando: ${JSON.stringify(profile.seekingTypes)}` : "",
      profile.interestSectors ? `Setores de interesse: ${JSON.stringify(profile.interestSectors)}` : "",
      profile.country ? `País: ${profile.country}` : "",
    ].filter(Boolean).join("\n");

    const oppsContext = activeOpps.map((opp, i) =>
      `[${i}] ID:${opp.id} Título:"${opp.title}" Setor:${opp.sector || "N/A"} Tipo:${opp.type} Tags:${JSON.stringify(opp.tags || [])} Descrição:"${(opp.description || "").substring(0, 200)}"`
    ).join("\n");

    const aiResp = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é o motor de matchmaking semântico da plataforma MMM OS. Analise o perfil da usuária e as oportunidades disponíveis. Retorne um JSON com os índices das oportunidades mais compatíveis e o score de compatibilidade (0-100) para cada uma. Considere sinônimos, setores relacionados, necessidades implícitas e sinergia entre "O que tenho" e "O que preciso". Retorne apenas as oportunidades com score >= 40. Máximo de 10 resultados.`,
        },
        {
          role: "user",
          content: `PERFIL DA USUÁRIA:\n${userContext}\n\nOPORTUNIDADES DISPONÍVEIS:\n${oppsContext}\n\nRetorne JSON no formato: {"matches": [{"index": 0, "score": 95, "reason": "Explicação curta em português"}]}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "matchmaking_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer" },
                    score: { type: "integer" },
                    reason: { type: "string" },
                  },
                  required: ["index", "score", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["matches"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = aiResp.choices[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : "{}";
    let parsed: { matches: { index: number; score: number; reason: string }[] } = { matches: [] };
    try { parsed = JSON.parse(content); } catch { parsed = { matches: [] }; }

    return parsed.matches
      .filter((m) => m.index >= 0 && m.index < activeOpps.length && m.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((m) => ({
        ...activeOpps[m.index],
        compatibilityScore: m.score,
        compatibilityReason: m.reason,
      }));
  }),

  // Disparar alertas para nova oportunidade publicada com alta compatibilidade (>= 80%)
  checkAndNotifyHighCompatibility: protectedProcedure
    .input(z.object({ opportunityId: z.number() }))
    .mutation(async ({ input }) => notifyHighCompatibilityForOpportunity(input.opportunityId)),
});

// Fora do router para a aprovação da moderação também disparar os alertas: a
// versão anterior só rodava no create, condicionada a status "active" — que o
// create nunca produz (toda oportunidade nasce "pending").
export async function notifyHighCompatibilityForOpportunity(opportunityId: number) {
  {
      const db = await getDb();
      if (!db) return { notified: 0 };

      const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunityId)).limit(1);
      if (!opp || opp.status !== "active") return { notified: 0 };

      const todos = await db
        .select({
          userId: userProfiles.userId,
          whatIHave: userProfiles.whatIHave,
          whatINeed: userProfiles.whatINeed,
          sector: userProfiles.sector,
          seekingTypes: userProfiles.seekingTypes,
          interestSectors: userProfiles.interestSectors,
          activityArea: userProfiles.activityArea,
        })
        .from(userProfiles)
        .where(sql`${userProfiles.userId} != ${opp.publishedBy}`)
        .limit(200);

      // Etapa 11: o alerta cruza "tenho/preciso" dos perfis com a oportunidade
      // e manda tudo ao LLM — isso é cruzamento, e dado de quem não aceitou o
      // termo não entra nem no prompt.
      const comTermo = await usersComConsentimento(todos.map(perfil => perfil.userId), "termo_smart_match");
      const profiles = todos.filter(perfil => comTermo.has(perfil.userId));
      // Ninguém autorizado = ninguém para alertar. Chamar o LLM com a lista
      // vazia seria um no-op garantido queimando uma chamada da cota do dia.
      if (!profiles.length) return { notified: 0 };

      const oppContext = `Título: "${opp.title}" | Setor: ${opp.sector || "N/A"} | Tipo: ${opp.type} | Tags: ${JSON.stringify(opp.tags || [])} | Descrição: "${(opp.description || "").substring(0, 300)}"`;
      // "tenho" entra junto com "preciso": uma oportunidade que BUSCA algo casa
      // com quem OFERECE esse algo. Antes só "preciso" ia ao alerta, então quem
      // poderia suprir a oportunidade nunca era avisada — metade do cruzamento.
      const profilesContext = profiles.map((p, i) =>
        `[${i}] userId:${p.userId} setor:${p.sector || "N/A"} tenho:${JSON.stringify(p.whatIHave || [])} preciso:${JSON.stringify(p.whatINeed || [])} interesse:${JSON.stringify(p.interestSectors || [])}`
      ).join("\n");

      const aiResp = await invokeLLM({
        messages: [
          { role: "system", content: "Você é o motor de alertas do MMM OS. Analise uma oportunidade e os perfis de usuárias para identificar quem tem alta compatibilidade (>= 80%). Retorne apenas os índices dos perfis compatíveis com score >= 80." },
          { role: "user", content: `OPORTUNIDADE:\n${oppContext}\n\nPERFIS:\n${profilesContext}\n\nRetorne JSON: {"alerts": [{"index": 0, "score": 85}]}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "alert_result",
            strict: true,
            schema: {
              type: "object",
              properties: {
                alerts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { index: { type: "integer" }, score: { type: "integer" } },
                    required: ["index", "score"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["alerts"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent2 = aiResp.choices[0]?.message?.content;
      const content = typeof rawContent2 === "string" ? rawContent2 : "{}";
      let parsed: { alerts: { index: number; score: number }[] } = { alerts: [] };
      try { parsed = JSON.parse(content); } catch { parsed = { alerts: [] }; }

      let notified = 0;
      for (const alert of parsed.alerts) {
        if (alert.index < 0 || alert.index >= profiles.length || alert.score < 80) continue;
        const targetUserId = profiles[alert.index].userId;
        await createNotification({
          userId: targetUserId,
          type: "new_match",
          title: `⚡ Nova oportunidade ${alert.score}% compatível com você!`,
          body: `"${opp.title}" foi publicada e tem alta compatibilidade com seu perfil. Confira agora!`,
          actionUrl: `/opportunities/${opp.id}`,
          isRead: false,
        });
        notified++;
      }
      return { notified };
  }
}
