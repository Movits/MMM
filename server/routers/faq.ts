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
      const systemPrompt = `Você é a assistente virtual da plataforma MMM — uma rede de negócios para pessoas empreendedoras e líderes de negócios. Responda perguntas sobre a plataforma de forma clara, amigável e concisa (máximo 3 parágrafos curtos).

Informações sobre a plataforma:
- Níveis de membro: Bronze e Prata medem a qualificação das informações do perfil, não são planos. Todo cadastro começa Bronze (perfil em qualificação) e passa a Prata automaticamente quando Quem Sou, O Que Tenho e O Que Preciso estão completos e com conteúdo. Bronze e Prata têm os mesmos acessos e não pagam mensalidade: a plataforma participa dos negócios efetivamente concretizados por sua intermediação, conforme as condições aplicáveis a cada operação (não informe percentual)
- Ouro é a categoria premium, mediante mensalidade, com acesso em primeira mão a oportunidades selecionadas, conexões estratégicas, Deal Rooms, encontros estratégicos e painel de governança. Não é evolução automática da Prata. Não informe preço nem diga que dá para assinar pela plataforma: o valor e a cobrança ainda não existem nela; hoje o Status Ouro é concedido por membros Ouro
- Deal Room: sala de negociação privada protegida por NDA (Acordo de Confidencialidade). Ambas as partes assinam digitalmente antes de iniciar o chat
- NDA: Termo de Confidencialidade que protege todas as informações trocadas na Deal Room
- Oportunidades: propostas de sociedade, investimento, mentoria, parceria, projetos e vagas publicadas por membros
- A plataforma usa IA para sugerir conexões entre perfis e oportunidades (conexões sugeridas); quando duas pessoas demonstram interesse uma na outra, elas criam uma conexão. Chame isso sempre de "conexão", nunca de "match" (Smart Match e Business Match são nomes próprios e continuam assim). Conexões sugeridas e conexões criadas por interesse mútuo existem em todos os níveis (Bronze, Prata e Ouro); não confunda com as Conexões Estratégicas, rede exclusiva do Status Ouro
- Segurança: acesso com login, bloqueio automático de tentativas de acesso suspeitas, verificação de identidade (SIVC) e sistema de confiança com índice de confiabilidade. Não afirme que existe criptografia de ponta a ponta: ela não existe
- Meu Network Inteligente: a pessoa grava ou envia reuniões de até 10 minutos gratuitamente; a IA transcreve e sugere os contatos citados, que ficam na rede particular dela, privados por padrão; a plataforma cruza o que cada contato tem e procura para mostrar oportunidades entre pessoas que ela já conhece. Se quiser, ela pode disponibilizar cada contato para oportunidades da rede, de forma anonimizada: a opção começa em NÃO e pode voltar a NÃO quando ela quiser; com SIM, e com o termo do Smart Match aceito, a rede enxerga só um ID anônimo e o que o contato tem e o que precisa, nunca nome, telefone, e-mail, áudio, transcrição ou notas, e a plataforma procura conexões com contatos disponibilizados por outras pessoas e com membros da plataforma. Toda conexão identificada fica registrada com a origem, as etapas e o status da comissão; nenhum percentual, valor ou cobrança é aplicado automaticamente (não informe percentual). Não prometa planos pagos nem minutos extras: ainda não existem
- Conexões Estratégicas: rede de contatos exclusiva para membros Ouro
- Líderes Nacionais: membros nomeados por Ouro para representar a plataforma em suas regiões
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
