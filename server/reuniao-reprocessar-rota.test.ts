import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * meetings.reprocess e as travas vizinhas, no router. O serviço é dublado; o
 * que ele faz está em reuniao-reprocessar.test.ts. Aqui se prova:
 *
 * - a rota devolve { status: 'processing' } sem esperar o trabalho, com o
 *   openId da dona, e grava auditoria sem conteúdo de reunião;
 * - as recusas do serviço chegam com o código que a tela traduz;
 * - o teto de 3 pedidos aceitos a cada 10 minutos por dona, sem contar recusas;
 * - submitRecording numa reunião que já recebeu áudio dá CONFLICT;
 * - decidir sobre sugestão ou entidade com a reunião em 'processing' dá
 *   CONFLICT, sem criar contato nem atualizar nada.
 */

const iniciarReprocessamento = vi.fn();
const processMeetingRecording = vi.fn();
const createAuditLog = vi.fn(async () => {});
const createPrivateContact = vi.fn(async () => 99);

const banco = {
  entidade: null as Record<string, unknown> | null,
  sugestao: null as Record<string, unknown> | null,
  statusDaReuniao: "ready",
  atualizacoes: [] as Array<{ tabela: unknown; valores: Record<string, unknown> }>,
  leituras: [] as Array<{ tabela: unknown; sql: string; params: unknown[] }>,
};

const schema = await import("../drizzle/schema");
// O WHERE de cada leitura, renderizado pelo dialeto do MySQL: prova QUAL reunião
// a trava das decisões consultou (a da sugestão ou da entidade, e da dona).
const dialeto = new MySqlDialect();
vi.mock("./db", () => ({
  getDb: async () => null,
  exigirDb: async () => ({
    select: () => ({ from: (tabela: unknown) => ({ where: (condicao?: SQL) => {
      const { sql, params } = condicao ? dialeto.sqlToQuery(condicao) : { sql: "", params: [] as unknown[] };
      banco.leituras.push({ tabela, sql, params });
      const linhas = tabela === schema.meetingEntities ? (banco.entidade ? [banco.entidade] : [])
        : tabela === schema.meetingContactSuggestions ? (banco.sugestao ? [banco.sugestao] : [])
          : tabela === schema.meetings ? [{ status: banco.statusDaReuniao }]
            : [];
      return { limit: async () => linhas };
    } }) }),
    update: (tabela: unknown) => ({ set: (valores: Record<string, unknown>) => ({ where: async () => {
      banco.atualizacoes.push({ tabela, valores });
      return [{ affectedRows: 1 }];
    } }) }),
  }),
  createPrivateContact: (...args: unknown[]) => createPrivateContact(...(args as [])),
}));
vi.mock("./security", async importOriginal => ({
  ...await importOriginal<typeof import("./security")>(),
  createAuditLog: (...args: unknown[]) => createAuditLog(...(args as [])),
}));
vi.mock("./meeting-service", async importOriginal => ({
  ...await importOriginal<typeof import("./meeting-service")>(),
  iniciarReprocessamento: (...args: unknown[]) => iniciarReprocessamento(...(args as [])),
  processMeetingRecording: (...args: unknown[]) => processMeetingRecording(...(args as [])),
}));

const { meetingsRouter, esquecerTentativasDeReprocesso, MENSAGEM_REUNIAO_PROCESSANDO } = await import("./routers/meetings");
const { ReprocessamentoRecusado, ReuniaoForaDoEstado, ReuniaoTomadaPorOutraExecucao } = await import("./meeting-service");

const ID = "8b1f6a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const contexto = (openId: string) => ({
  user: { id: 7, openId, email: `${openId}@local`, role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;
const rota = (openId = "dona-1") => meetingsRouter.createCaller(contexto(openId));
// O trabalho em segundo plano nunca termina aqui: a rota não pode esperá-lo.
const aceito = () => ({ trabalho: new Promise<void>(() => {}) });
const leiturasDaReuniao = () => banco.leituras.filter(leitura => leitura.tabela === schema.meetings).map(({ sql, params }) => ({ sql, params }));
const REUNIAO_DA_DONA = (meetingId: string) => ({ sql: "(`meetings`.`id` = ? and `meetings`.`owner_id` = ?)", params: [meetingId, "dona-1"] });

beforeEach(() => {
  esquecerTentativasDeReprocesso();
  iniciarReprocessamento.mockReset();
  iniciarReprocessamento.mockImplementation(async () => aceito());
  processMeetingRecording.mockReset();
  createAuditLog.mockClear();
  createPrivateContact.mockClear();
  banco.entidade = { meetingId: "reuniao-da-entidade" };
  banco.sugestao = { id: ID, meetingId: "reuniao-da-sugestao", fullName: "Ana Souza", jobTitle: null, company: null, phone: null, email: null };
  banco.statusDaReuniao = "ready";
  banco.atualizacoes = [];
  banco.leituras = [];
});
afterEach(() => { vi.useRealTimers(); });

describe("meetings.reprocess — devolve logo e registra", () => {
  it("devolve { status: 'processing' } sem esperar o trabalho, pedindo pelo openId da dona", async () => {
    await expect(rota().reprocess({ meetingId: ID })).resolves.toEqual({ status: "processing" });
    expect(iniciarReprocessamento).toHaveBeenCalledWith("dona-1", ID);
  });

  it("auditoria com a ação e o id da reunião, sem nenhum conteúdo dela", async () => {
    await rota().reprocess({ meetingId: ID });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog.mock.calls[0]).toEqual([{
      userId: 7, action: "MEETING_REPROCESS_REQUESTED", resource: "meetings", resourceId: ID, status: "success", riskLevel: "low",
    }]);
  });

  it("meetingId que não é uuid: BAD_REQUEST, sem chegar ao serviço", async () => {
    await expect(rota().reprocess({ meetingId: "reuniao-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(iniciarReprocessamento).not.toHaveBeenCalled();
  });

  it("não recebe arquivo: fica fora do parser de 15 MB", () => {
    const fonte = readFileSync(join(__dirname, "_core", "corpo-grande-para-uploads.ts"), "utf8");
    expect(fonte).not.toContain("meetings.reprocess");
  });
});

describe("meetings.reprocess — recusas com o código que a tela traduz", () => {
  it.each(["NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"] as const)("%s do serviço vira TRPCError com o mesmo código e a mesma frase, sem auditoria", async codigo => {
    iniciarReprocessamento.mockRejectedValue(new ReprocessamentoRecusado(codigo, `frase de ${codigo}`));
    await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: codigo, message: `frase de ${codigo}` });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("qualquer outro erro sai como erro do servidor", async () => {
    iniciarReprocessamento.mockRejectedValue(new Error("falha inesperada"));
    await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("meetings.reprocess — teto de 3 pedidos aceitos a cada 10 minutos por dona", () => {
  it("o 4º pedido dá TOO_MANY_REQUESTS sem chegar ao serviço; outra dona passa", async () => {
    for (let i = 0; i < 3; i++) await rota().reprocess({ meetingId: ID });
    await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(iniciarReprocessamento).toHaveBeenCalledTimes(3);
    await expect(rota("outra-dona").reprocess({ meetingId: ID })).resolves.toEqual({ status: "processing" });
  });

  it("uma rajada simultânea (lote tRPC, várias abas) não fura o teto: só 3 pedidos chegam ao serviço", async () => {
    let liberar!: () => void;
    const portao = new Promise<void>(resolver => { liberar = resolver; });
    iniciarReprocessamento.mockImplementation(async () => { await portao; return aceito(); });

    const pedidos = Array.from({ length: 6 }, () =>
      rota().reprocess({ meetingId: ID }).then(() => "aceito", (erro: { code?: string }) => erro.code));
    // Todos os pedidos chegam ao ponto de espera antes de o serviço responder:
    // conferir e registrar depois do await deixaria os 6 passarem.
    await new Promise(resolver => setTimeout(resolver, 20));
    expect(iniciarReprocessamento).toHaveBeenCalledTimes(3);

    liberar();
    const resultados = await Promise.all(pedidos);
    expect(resultados.filter(resultado => resultado === "aceito")).toHaveLength(3);
    expect(resultados.filter(resultado => resultado === "TOO_MANY_REQUESTS")).toHaveLength(3);
  });

  it("erro inesperado do serviço também devolve a vaga", async () => {
    iniciarReprocessamento.mockRejectedValue(new Error("banco fora do ar"));
    for (let i = 0; i < 4; i++) await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    iniciarReprocessamento.mockImplementation(async () => aceito());
    await expect(rota().reprocess({ meetingId: ID })).resolves.toEqual({ status: "processing" });
  });

  it("recusas não contam", async () => {
    iniciarReprocessamento.mockRejectedValue(new ReprocessamentoRecusado("CONFLICT", "x"));
    for (let i = 0; i < 5; i++) await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: "CONFLICT" });
    iniciarReprocessamento.mockImplementation(async () => aceito());
    await expect(rota().reprocess({ meetingId: ID })).resolves.toEqual({ status: "processing" });
  });

  it("passados 10 minutos, a janela libera", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
    for (let i = 0; i < 3; i++) await rota().reprocess({ meetingId: ID });
    await expect(rota().reprocess({ meetingId: ID })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    vi.setSystemTime(new Date("2026-09-14T12:10:00.001Z"));
    await expect(rota().reprocess({ meetingId: ID })).resolves.toEqual({ status: "processing" });
  });
});

describe("meetings.submitRecording — reunião que já recebeu áudio", () => {
  it.each([
    ["ReuniaoForaDoEstado", () => new ReuniaoForaDoEstado()],
    ["ReuniaoTomadaPorOutraExecucao", () => new ReuniaoTomadaPorOutraExecucao()],
  ])("%s vira CONFLICT com a frase do serviço", async (_nome, criar) => {
    const erro = criar();
    processMeetingRecording.mockRejectedValue(erro);
    await expect(rota().submitRecording({
      meetingId: ID, audioBase64: "A".repeat(40), mimeType: "audio/webm", durationSeconds: 30, language: "pt",
    })).rejects.toMatchObject({ code: "CONFLICT", message: erro.message });
  });
});

describe("decisões durante o reprocessamento", () => {
  it("criar contato de uma sugestão com a reunião em 'processing': CONFLICT, nenhum contato criado, nada atualizado", async () => {
    banco.statusDaReuniao = "processing";
    await expect(rota().decideContactSuggestion({ suggestionId: ID, action: "create" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: MENSAGEM_REUNIAO_PROCESSANDO });
    expect(createPrivateContact).not.toHaveBeenCalled();
    expect(banco.atualizacoes).toEqual([]);
    // a reunião consultada é a DA sugestão, e da dona
    expect(leiturasDaReuniao()).toEqual([REUNIAO_DA_DONA("reuniao-da-sugestao")]);
  });

  it("com a reunião pronta, criar contato segue como antes", async () => {
    await expect(rota().decideContactSuggestion({ suggestionId: ID, action: "create" })).resolves.toMatchObject({ success: true, contactId: 99 });
    expect(createPrivateContact).toHaveBeenCalledTimes(1);
  });

  it("decidir entidade com a reunião em 'processing': CONFLICT, sem UPDATE", async () => {
    banco.statusDaReuniao = "processing";
    await expect(rota().decideEntity({ entityId: ID, status: "confirmed" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(banco.atualizacoes).toEqual([]);
    // a reunião consultada é a DA entidade, e da dona
    expect(leiturasDaReuniao()).toEqual([REUNIAO_DA_DONA("reuniao-da-entidade")]);
  });

  it("entidade de outra dona ou inexistente: NOT_FOUND", async () => {
    banco.entidade = null;
    await expect(rota().decideEntity({ entityId: ID, status: "ignored" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(banco.atualizacoes).toEqual([]);
  });

  it("reunião com falha (tentativa parcial): decidir continua possível", async () => {
    banco.statusDaReuniao = "failed";
    await expect(rota().decideEntity({ entityId: ID, status: "confirmed" })).resolves.toEqual({ success: true });
    expect(banco.atualizacoes).toHaveLength(1);
  });
});
