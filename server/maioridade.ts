import { TRPCError } from "@trpc/server";
import { auditLogs } from "../drizzle/schema";
import { exigirDb } from "./db";
import type { TermoGeralAceito } from "./termo-geral-de-uso";
import { IDADE_MINIMA, MENSAGEM_MAIORIDADE_NAO_DECLARADA } from "../shared/maioridade";

/**
 * Declaração de maioridade na conclusão do cadastro (cláusula 3.4 do Termo
 * Geral de Uso; regra e mensagens em shared/maioridade.ts).
 *
 * A trava é do servidor pelo mesmo motivo do Termo Geral
 * (server/termo-geral-de-uso.ts): a caixa da tela não prova nada, e quem chama
 * `profile.completeOnboarding` direto pularia a declaração. Sem ela o cadastro
 * não conclui e nada é gravado — e cadastro não concluído não usa a plataforma
 * (server/cadastro-concluido.ts).
 *
 * Contas que JÁ concluíram o cadastro não são afetadas: a declaração é exigida
 * só por `completeOnboarding`, e nem `exigirCadastroConcluido` nem
 * `profile.update` passam a olhar para ela. Ninguém é trancado de novo.
 */

/** Ação gravada em `audit_logs` quando o cadastro conclui com a declaração. */
export const ACAO_MAIORIDADE_DECLARADA = "AGE_MAJORITY_DECLARED";

/**
 * `true` e nada mais. Ausente ou `false` é BAD_REQUEST com mensagem em
 * português: um `z.literal(true)` no input devolveria o erro do zod, que chega
 * ao toast do Onboarding como JSON cru e em inglês (a mesma razão de os tetos
 * do Número de Cadastro Empresarial não serem `.max()`, em routers/profile.ts).
 */
export function exigirDeclaracaoDeMaioridade(declaraMaioridade: boolean | undefined): void {
  if (declaraMaioridade !== true) {
    throw new TRPCError({ code: "BAD_REQUEST", message: MENSAGEM_MAIORIDADE_NAO_DECLARADA });
  }
}

/**
 * Onde a declaração fica registrada: em `audit_logs`, com IP, user-agent e a
 * versão do Termo Geral cuja cláusula 3.4 ela atende.
 *
 * Por que não no `consents`, ao lado do aceite do Termo: a tabela não tem
 * coluna para isso (um aceite é usuária × versão do documento, com IP,
 * user-agent e hash do texto), e acrescentar uma pede migração, que esta
 * mudança não faz. A trilha de auditoria já guarda o que precisa ser provado,
 * sem tocar no schema. Se um dia a declaração virar coluna, é migração nova.
 *
 * A gravação é DIRETA e LANÇA se falhar — não passa pelo `createAuditLog`, que
 * engole o erro. `completeOnboarding` chama isto ANTES de gravar o perfil e de
 * marcar `onboardingCompleted`: sem a linha, o cadastro não conclui e nada é
 * gravado. Assim toda conta que conclui daqui em diante tem a prova. O inverso
 * não vale e não precisa valer: se a linha entra e uma escrita seguinte falha, a
 * conta fica sem concluir com a linha gravada — a pessoa declarou de fato, e a
 * nova tentativa grava outra linha.
 */
export async function registrarDeclaracaoDeMaioridade(params: {
  userId: number;
  termo: TermoGeralAceito;
  ipAddress: string;
  userAgent: string | undefined;
}): Promise<void> {
  const db = await exigirDb();
  await db.insert(auditLogs).values({
    userId: params.userId,
    action: ACAO_MAIORIDADE_DECLARADA,
    resource: "users",
    resourceId: String(params.userId),
    details: {
      idadeMinima: IDADE_MINIMA,
      termoGeralVersaoId: params.termo.id,
      termoGeralVersao: params.termo.version,
      clausula: "3.4",
    },
    // Os mesmos cortes do createAuditLog (server/security.ts): a coluna de IP
    // tem 45 caracteres, e o user-agent é cortado em 500.
    ipAddress: params.ipAddress.split(",")[0].trim().substring(0, 45),
    userAgent: params.userAgent ? params.userAgent.substring(0, 500) : null,
    status: "success",
    riskLevel: "low",
  });
}
