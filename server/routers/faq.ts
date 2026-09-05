import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getRequestIp } from "../password-reset-security";

// O ask é público e cada chamada custa uma requisição de LLM. Sem um teto
// próprio, qualquer visitante anônimo podia disparar até o limite global de
// 100 req/min contra a conta do provedor. Janela deslizante em memória:
// suficiente para a instância única do Render.
const FAQ_LIMIT = 5;
const FAQ_WINDOW_MS = 60_000;
const faqCalls = new Map<string, number[]>();

function assertFaqRate(ip: string) {
  const now = Date.now();
  const recent = (faqCalls.get(ip) ?? []).filter(t => now - t < FAQ_WINDOW_MS);
  if (recent.length >= FAQ_LIMIT) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas perguntas em sequência. Aguarde um minuto e tente de novo." });
  }
  recent.push(now);
  faqCalls.set(ip, recent);
  if (faqCalls.size > 5000) faqCalls.clear();
}

// ============================================================
// FAQ COM IA
// ============================================================
export const faqRouter = router({
  ask: publicProcedure
    .input(z.object({ question: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      assertFaqRate(getRequestIp(ctx.req.headers["x-forwarded-for"], ctx.req.socket?.remoteAddress));
      const systemPrompt = `Você é a assistente virtual da plataforma MMM — uma rede exclusiva para mulheres empreendedoras e líderes de negócios. Responda perguntas sobre a plataforma de forma clara, amigável e concisa (máximo 3 parágrafos curtos).

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
