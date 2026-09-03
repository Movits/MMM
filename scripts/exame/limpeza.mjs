// Plano de limpeza do exame de produção (scripts/checar-producao.mjs), declarado
// como DADOS para o teste conferir contra drizzle/schema.ts e para a leitora saber
// exatamente o que sai do banco.
//
// Regras:
// - Cada par é (tabela, coluna) com o nome NO BANCO, não a propriedade TypeScript:
//   `private_contacts.ownerId` é camelCase enquanto as irmãs da rede particular
//   (contexts, contact_assets, ai_match_suggestions...) usam `owner_id`. Um nome
//   errado aqui não dá erro de sintaxe no MySQL: dá "Unknown column" que o exame
//   antigo engolia, ou zero linhas apagadas em silêncio.
// - Não há FOREIGN KEY em nenhuma das 50 tabelas, então nenhuma ordem é obrigatória
//   e nada cascateia: o que não estiver listado aqui vira órfão para sempre.
// - Chaves: "openId" (varchar, módulo da rede particular), "id" (int, módulo
//   institucional), "email" (login_attempts guarda o e-mail em `identifier`) e
//   "opp" (id da oportunidade que o exame cria).
// - Ação: "apagar" para linhas de AUTORIA da conta QA (dona, remetente, publicadora);
//   "alertar" para colunas em que a QA aparece como ator secundário em registro
//   alheio (moderadora, concedente, revogadora). Nessas, a linha é de outra pessoa e
//   o exame nunca deveria ter chegado nela: contar e avisar, não apagar.
// - Este módulo é PURO: não importa mysql2, dotenv nem node:fs, não lê process.env
//   e não tem efeito de topo. Quem abre conexão é só checar-producao.mjs.

export const CHAVES = ["openId", "id", "email", "opp"];

export const ACOES_DE_AUDITORIA_PRESERVADAS = ["GOLD_ACERVO_READ", "REVOKED_SESSION_ACCESS_ATTEMPT"];

/** Um par por coluna; a ordem é a ordem de execução. */
export const PLANO_DE_LIMPEZA = [
  // ── rede particular: chave openId (varchar) ─────────────────────────────
  { tabela: "ai_match_suggestions", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "contact_assets", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "contact_needs", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "memory_documents", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meeting_contact_suggestions", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meeting_entities", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meeting_transcript_translations", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meeting_transcripts", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meeting_recordings", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "meetings", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "enrichment_suggestions", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "enrichment_messages", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "enrichment_sessions", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "context_media", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "context_media", coluna: "uploaded_by", chave: "openId", acao: "apagar" },
  { tabela: "context_participants", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "contact_contexts", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "contexts", coluna: "owner_id", chave: "openId", acao: "apagar" },
  { tabela: "private_contacts", coluna: "ownerId", chave: "openId", acao: "apagar" },

  // ── oportunidade do exame: chave opp ────────────────────────────────────
  { tabela: "president_validations", coluna: "opportunityId", chave: "opp", acao: "apagar" },
  { tabela: "opportunity_documents", coluna: "opportunityId", chave: "opp", acao: "apagar" },
  // Interesse ou sala aberta por conta REAL na oportunidade do exame: humano decide.
  // `excetoSe` tira da contagem as linhas cuja dona principal é a própria QA (essas
  // saem na passada de apagar); só sobra o que é de terceiros de verdade.
  { tabela: "opportunity_interests", coluna: "opportunityId", chave: "opp", acao: "alertar", excetoSe: { coluna: "userId", chave: "id" } },
  { tabela: "saved_opportunities", coluna: "opportunityId", chave: "opp", acao: "alertar", excetoSe: { coluna: "userId", chave: "id" } },
  { tabela: "deal_rooms", coluna: "opportunityId", chave: "opp", acao: "alertar", excetoSe: { coluna: "interestedId", chave: "id" } },

  // ── módulo institucional: chave id (int) ────────────────────────────────
  { tabela: "consents", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "sivc_documents", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "sivc_consents", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "sivc_verifications", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "national_leaders", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "national_leaders", coluna: "nominatedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "userId", chave: "id" } },
  { tabela: "national_leaders", coluna: "revokedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "userId", chave: "id" } },
  { tabela: "president_validations", coluna: "validatedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "opportunityId", chave: "opp" } },
  { tabela: "deal_room_documents", coluna: "uploadedBy", chave: "id", acao: "apagar" },
  { tabela: "deal_room_messages", coluna: "senderId", chave: "id", acao: "apagar" },
  // Sala de negociação: só sai quando as DUAS pontas são QA. A sala que uma membra
  // REAL abre na oportunidade do exame tem ownerId = QA presidente (dealRoom.ts grava
  // ownerId = opp.publishedBy) e não pode cair no DELETE: ela é alertada pelo par
  // deal_rooms.opportunityId acima e fica para decisão humana.
  { tabela: "deal_rooms", coluna: "ownerId", chave: "id", acao: "apagar", filtroChave: { coluna: "interestedId", chave: "id" } },
  { tabela: "deal_rooms", coluna: "interestedId", chave: "id", acao: "apagar", filtroChave: { coluna: "ownerId", chave: "id" } },
  { tabela: "connections", coluna: "requesterId", chave: "id", acao: "apagar" },
  { tabela: "connections", coluna: "recipientId", chave: "id", acao: "apagar" },
  { tabela: "matches", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "matches", coluna: "matchedUserId", chave: "id", acao: "apagar" },
  { tabela: "password_reset_tokens", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "trusted_devices", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "security_events", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "security_events", coluna: "resolvedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "userId", chave: "id" } },
  { tabela: "sessions", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "platform_notifications", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "direct_messages", coluna: "senderId", chave: "id", acao: "apagar" },
  { tabela: "direct_messages", coluna: "recipientId", chave: "id", acao: "apagar" },
  { tabela: "saved_opportunities", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "opportunity_interests", coluna: "userId", chave: "id", acao: "apagar" },
  { tabela: "opportunity_documents", coluna: "uploadedBy", chave: "id", acao: "apagar" },
  { tabela: "opportunities", coluna: "publishedBy", chave: "id", acao: "apagar" },
  { tabela: "opportunities", coluna: "moderatedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "publishedBy", chave: "id" } },
  { tabela: "strategic_groups", coluna: "createdBy", chave: "id", acao: "apagar" },
  { tabela: "gold_access_grants", coluna: "grantedTo", chave: "id", acao: "apagar" },
  { tabela: "gold_access_grants", coluna: "grantedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "grantedTo", chave: "id" } },
  { tabela: "gold_access_grants", coluna: "revokedBy", chave: "id", acao: "alertar", excetoSe: { coluna: "grantedTo", chave: "id" } },
  { tabela: "user_profiles", coluna: "userId", chave: "id", acao: "apagar" },
  // Trilha de auditoria: sai o ruído do exame (LOGIN, OPPORTUNITY_CREATE...), ficam
  // as leituras do acervo Ouro e as tentativas com sessão revogada (decisão do
  // Roberto em 02/09/2026): respondem "quem viu meus contatos" mesmo para conta
  // encerrada. Nunca UPDATE aqui: a tabela é imutável por desenho.
  {
    tabela: "audit_logs", coluna: "userId", chave: "id", acao: "apagar",
    filtroExtra: "`action` NOT IN (" + ACOES_DE_AUDITORIA_PRESERVADAS.map(() => "?").join(", ") + ")",
    paramsExtra: ACOES_DE_AUDITORIA_PRESERVADAS,
  },

  // ── login_attempts guarda o e-mail em minúsculas, não o id ──────────────
  { tabela: "login_attempts", coluna: "identifier", chave: "email", acao: "apagar" },
];

/**
 * Pares (tabela, coluna) de usuária que existem no schema e ficam de fora do plano
 * de propósito. O teste exige justificativa escrita para cada um.
 */
export const EXCECOES = [
  { tabela: "strategic_groups", coluna: "memberIds", motivo: "array JSON de ids; o exame não cria nem entra em grupos, e um DELETE por coluna não se aplica" },
  { tabela: "audit_logs", coluna: "userId", motivo: "coberta pelo plano com filtro que preserva GOLD_ACERVO_READ e REVOKED_SESSION_ACCESS_ATTEMPT (ver ACOES_DE_AUDITORIA_PRESERVADAS)", cobertaComFiltro: true },
];

/** Colunas do schema que apontam para usuária; o teste deriva os pares a partir delas. */
export const COLUNAS_DE_USUARIA = /^(userId|ownerId|owner_id|grantedTo|grantedBy|revokedBy|senderId|recipientId|interestedId|publishedBy|moderatedBy|uploadedBy|uploaded_by|validatedBy|resolvedBy|createdBy|nominatedBy|matchedUserId|identifier|requesterId|memberIds)$/;

function placeholders(valores) {
  return valores.map(() => "?").join(", ");
}

/**
 * Monta os comandos da limpeza para as contas e a oportunidade do exame.
 * Devolve [{ descricao, acao, sql, params }], na ordem de execução; não executa nada.
 *
 * - ids: users.id das contas QA; openIds: users.openId; emails: users.email;
 *   oppIds: ids das oportunidades criadas pelo exame.
 * - `users` vem por último e exige as duas chaves (id E openId com prefixo qa_exame),
 *   para um id errado nunca apagar conta de gente.
 */
export function planejarLimpeza({ ids = [], openIds = [], emails = [], oppIds = [], prefixoQa = "qa_exame" } = {}) {
  const valoresPor = { id: ids, openId: openIds, email: emails.map(e => e.toLowerCase()), opp: oppIds };
  const comandos = [];

  for (const par of PLANO_DE_LIMPEZA) {
    const valores = valoresPor[par.chave];
    if (!valores || !valores.length) continue;
    const where = ["`" + par.coluna + "` IN (" + placeholders(valores) + ")"];
    const params = [...valores];
    if (par.filtroExtra) {
      where.push(par.filtroExtra);
      params.push(...(par.paramsExtra || []));
    }
    if (par.filtroChave) {
      // Segunda coluna que também precisa ser QA (ex.: as duas pontas da sala).
      const outros = valoresPor[par.filtroChave.chave];
      if (!outros || !outros.length) continue;
      where.push("`" + par.filtroChave.coluna + "` IN (" + placeholders(outros) + ")");
      params.push(...outros);
    }
    if (par.excetoSe) {
      // Linha cuja dona principal é QA não é "de terceiros": sai na passada de apagar.
      const proprios = valoresPor[par.excetoSe.chave];
      if (proprios && proprios.length) {
        where.push("`" + par.excetoSe.coluna + "` NOT IN (" + placeholders(proprios) + ")");
        params.push(...proprios);
      }
    }
    const verbo = par.acao === "apagar" ? "DELETE FROM" : "SELECT COUNT(*) AS n FROM";
    comandos.push({
      descricao: `${par.tabela}.${par.coluna} (${par.chave})`,
      acao: par.acao,
      sql: `${verbo} \`${par.tabela}\` WHERE ${where.join(" AND ")}`,
      params,
    });
  }

  // Notificações que a oportunidade do exame gerou em contas REAIS (alerta de
  // compatibilidade e aprovação): a chave é a URL da oportunidade, não a usuária.
  if (oppIds.length) {
    comandos.push({
      descricao: "platform_notifications.actionUrl (opp)",
      acao: "apagar",
      sql: "DELETE FROM `platform_notifications` WHERE `actionUrl` IN (" + placeholders(oppIds) + ")",
      params: oppIds.map(id => `/opportunities/${id}`),
    });
    // Só as publicadas pela QA, ou órfãs (publicadora já apagada por uma execução
    // anterior que morreu no meio). Nunca a de uma conta real com o mesmo título.
    const autoria = ids.length
      ? "(`publishedBy` IN (" + placeholders(ids) + ") OR `publishedBy` NOT IN (SELECT `id` FROM `users`))"
      : "`publishedBy` NOT IN (SELECT `id` FROM `users`)";
    comandos.push({
      descricao: "opportunities.id (opp, só as publicadas pela QA ou órfãs)",
      acao: "apagar",
      sql: "DELETE FROM `opportunities` WHERE `id` IN (" + placeholders(oppIds) + ") AND " + autoria,
      params: [...oppIds, ...ids],
    });
  }

  if (ids.length) {
    comandos.push({
      descricao: "users.id (só openId com prefixo do exame)",
      acao: "apagar",
      sql: "DELETE FROM `users` WHERE `id` IN (" + placeholders(ids) + ") AND `openId` LIKE ?",
      params: [...ids, `${prefixoQa}%`],
    });
  }

  return comandos;
}

/**
 * Comandos da faxina de ABERTURA que não dependem de id: chaves duráveis que
 * sobrevivem à morte do processo anterior. O corpo da notificação começa com
 * aspas + título da oportunidade (opportunities.ts e matching.ts montam assim).
 */
export function planejarFaxinaDuravel({ tituloDaOportunidade }) {
  return [
    {
      descricao: "platform_notifications.body (título do exame)",
      acao: "apagar",
      sql: "DELETE FROM `platform_notifications` WHERE `body` LIKE ?",
      params: [`"${tituloDaOportunidade}%`],
    },
    {
      descricao: "security_events brute_force sem usuária (identifier do exame)",
      acao: "apagar",
      sql: "DELETE FROM `security_events` WHERE `userId` IS NULL AND `eventType` = 'brute_force_attempt' AND JSON_UNQUOTE(JSON_EXTRACT(`details`, '$.identifier')) LIKE ?",
      params: ["%@exame.invalid"],
    },
  ];
}
