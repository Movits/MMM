// server/matching.ts resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O alerta "⚡ Nova oportunidade N% compatível" (notifyHighCompatibilityForOpportunity)
 * depois da revisão de 15/09:
 *   - a procedure `matching.checkAndNotifyHighCompatibility` saiu do router: era
 *     um protectedProcedure sem checagem de quem pedia, e qualquer conta logada
 *     disparava em laço a leitura de 200 perfis, a chamada ao LLM e as mesmas
 *     notificações. O único gatilho é a aprovação da moderação;
 *   - um aviso por (usuária, oportunidade): quem já foi avisada daquela
 *     oportunidade sai antes do LLM, então a reaprovação não repete o aviso nem
 *     gasta cota.
 * Banco em memória: as notificações criadas voltam na consulta de deduplicação,
 * que é traduzida no SQL real (MySqlDialect) para o teste afirmar sobre o WHERE.
 */

vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

type Notificacao = { userId: number; type: string; actionUrl?: string | null };
const notificacoes: Notificacao[] = [];
const createNotification = vi.fn(async (dados: Notificacao) => { notificacoes.push(dados); });

const { platformNotifications, opportunities, userProfiles } = await import("../drizzle/schema");
const { MySqlDialect } = await import("drizzle-orm/mysql-core");
const dialeto = new MySqlDialect();

let oportunidade: Record<string, unknown> | null = null;
let perfis: Array<Record<string, unknown>> = [];
const consultasDeAviso: Array<{ sql: string; params: unknown[] }> = [];

function cadeiaDeSelect() {
  let tabela: unknown;
  let condicao: unknown;
  const cadeia: Record<string, unknown> = {};
  cadeia.from = (t: unknown) => { tabela = t; return cadeia; };
  cadeia.where = (c: unknown) => { condicao = c; return cadeia; };
  for (const metodo of ["innerJoin", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
  (cadeia as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const responder = () => {
      if (tabela === opportunities) return oportunidade ? [oportunidade] : [];
      if (tabela === userProfiles) return perfis;
      if (tabela === platformNotifications) {
        const { sql, params } = dialeto.sqlToQuery(condicao as never);
        consultasDeAviso.push({ sql, params });
        // A consulta é `type = ? and actionUrl = ? and userId in (...)`: o SQL é conferido no teste.
        const [tipo, url, ...ids] = params;
        return notificacoes
          .filter(n => n.type === tipo && n.actionUrl === url && ids.includes(n.userId))
          .map(n => ({ userId: n.userId }));
      }
      throw new Error("tabela inesperada no dublê");
    };
    return Promise.resolve().then(responder).then(resolve, reject);
  };
  return cadeia;
}
const fakeDb = { select: () => cadeiaDeSelect() };
vi.mock("./db", () => ({
  getDb: async () => fakeDb as never,
  exigirDb: async () => fakeDb as never,
  createNotification: (...args: unknown[]) => createNotification(...(args as [Notificacao])),
}));

const { matchingRouter, notifyHighCompatibilityForOpportunity } = await import("./routers/matching");

const respostaDaIA = (corpo: unknown) => ({ choices: [{ message: { content: JSON.stringify(corpo) } }] });
const perfilComRede = (userId: number) => ({
  userId, role: "silver", whatIHave: ["Rede de distribuição na África"], whatINeed: [], sector: "Logística",
  seekingTypes: [], interestSectors: [], activityArea: null, lookingForInvestment: false, primarySpecialty: null,
});
/** O modelo aprova todo perfil que recebeu, com um tipo que não passa pelo portão de serviço. */
const aprovarTodos = () => invokeLLM.mockImplementation(async (pedido: { messages: Array<{ role: string; content: string }> }) => {
  const usuario = pedido.messages.find(m => m.role === "user")!.content;
  const quantos = usuario.split("\n").filter(l => /^\[\d+\] userId:/.test(l)).length;
  return respostaDaIA({ alerts: Array.from({ length: quantos }, (_, index) => ({ index, score: 90, tipoDaOferta: "conexao", necessidadeExpressa: "" })) });
});
const perfisNoPrompt = (chamada: number) => {
  const pedido = invokeLLM.mock.calls[chamada][0] as { messages: Array<{ role: string; content: string }> };
  return [...pedido.messages.find(m => m.role === "user")!.content.matchAll(/userId:(\d+)/g)].map(m => Number(m[1]));
};

beforeEach(() => {
  invokeLLM.mockReset();
  createNotification.mockClear();
  notificacoes.length = 0;
  consultasDeAviso.length = 0;
  oportunidade = { id: 11, title: "Distribuidor para a África", sector: "Farmacêutico", type: "demand", tags: [], description: "Indústria farmacêutica busca distribuidor para expansão na África", status: "active", publishedBy: 9, isConfidential: false };
  perfis = [perfilComRede(2), perfilComRede(3)];
});

describe("matching.checkAndNotifyHighCompatibility — fora do router", () => {
  it("o router de matching não expõe mais o disparo do alerta a quem está logada", () => {
    const procedimentos = Object.keys((matchingRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(procedimentos).toEqual(["getRecommendedOpportunities"]);
  });
});

describe("notifyHighCompatibilityForOpportunity — um aviso por (usuária, oportunidade)", () => {
  it("a segunda aprovação da mesma oportunidade não repete o aviso nem chama o LLM", async () => {
    aprovarTodos();

    expect(await notifyHighCompatibilityForOpportunity(11)).toEqual({ notified: 2 });
    expect(await notifyHighCompatibilityForOpportunity(11)).toEqual({ notified: 0 });

    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(notificacoes.map(n => [n.userId, n.type, n.actionUrl])).toEqual([
      [2, "new_match", "/opportunities/11"],
      [3, "new_match", "/opportunities/11"],
    ]);
  });

  it("quem já foi avisada sai do prompt; quem ainda não foi é avisada", async () => {
    notificacoes.push({ userId: 2, type: "new_match", actionUrl: "/opportunities/11" });
    aprovarTodos();

    const r = await notifyHighCompatibilityForOpportunity(11);

    expect(r).toEqual({ notified: 1 });
    expect(perfisNoPrompt(0)).toEqual([3]);
    expect(createNotification.mock.calls.map(c => c[0].userId)).toEqual([3]);
  });

  it("a deduplicação olha o tipo, a oportunidade e as destinatárias: aviso de outra oportunidade ou de outro tipo não conta", async () => {
    notificacoes.push(
      { userId: 2, type: "new_match", actionUrl: "/opportunities/12" },
      { userId: 3, type: "opportunity_approved", actionUrl: "/opportunities/11" },
    );
    aprovarTodos();

    const r = await notifyHighCompatibilityForOpportunity(11);

    expect(r).toEqual({ notified: 2 });
    expect(perfisNoPrompt(0)).toEqual([2, 3]);
    expect(consultasDeAviso).toHaveLength(1);
    expect(consultasDeAviso[0].sql).toBe("(`platform_notifications`.`type` = ? and `platform_notifications`.`actionUrl` = ? and `platform_notifications`.`userId` in (?, ?))");
    expect(consultasDeAviso[0].params).toEqual(["new_match", "/opportunities/11", 2, 3]);
  });

  it("sem perfil autorizado a deduplicação nem consulta o banco (e o inArray nunca recebe lista vazia)", async () => {
    perfis = [];

    expect(await notifyHighCompatibilityForOpportunity(11)).toEqual({ notified: 0 });

    expect(consultasDeAviso).toHaveLength(0);
    expect(invokeLLM).not.toHaveBeenCalled();
  });
});
