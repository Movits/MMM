import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

// ============================================================
// FAQ COM IA
// ============================================================
export const faqRouter = router({
  ask: publicProcedure
    .input(z.object({ question: z.string().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const systemPrompt = `Você é a assistente virtual da plataforma MMM OS — uma rede exclusiva para mulheres empreendedoras e líderes de negócios. Responda perguntas sobre a plataforma de forma clara, amigável e concisa (máximo 3 parágrafos curtos).

Informações sobre a plataforma:
- Níveis de membro: Bronze (acesso a oportunidades), Prata (acesso a oportunidades, mais validado), Ouro (acesso total — oportunidades, conexões estratégicas, Deal Rooms, painel de governança)
- Ouro é o nível mais alto e é concedido por membras Ouro existentes
- Deal Room: sala de negociação privada protegida por NDA (Acordo de Confidencialidade). Ambas as partes assinam digitalmente antes de iniciar o chat
- NDA: Termo de Confidencialidade que protege todas as informações trocadas na Deal Room
- Oportunidades: propostas de sociedade, investimento, mentoria, parceria, projetos e vagas publicadas por membras
- A plataforma usa IA para fazer match entre perfis e oportunidades
- Segurança: criptografia de ponta a ponta, verificação de identidade (SIVC), sistema de confiança com índice de confiabilidade
- Conexões Estratégicas: rede de contatos exclusiva para membras Ouro
- Líderes Nacionais: membras nomeadas por Ouro para representar a plataforma em suas regiões
- Plataforma disponível em 10 idiomas

Responda sempre em português do Brasil, de forma acolhedora e profissional. Seja direta e objetiva.`;
      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.question },
        ],
      });
      const answer = response.choices?.[0]?.message?.content || "Desculpe, não consegui processar sua pergunta. Tente novamente em instantes.";
      return { answer };
    }),
});
