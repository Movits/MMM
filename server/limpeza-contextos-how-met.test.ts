import { describe, expect, it, beforeEach, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Limpeza dos contextos criados pelo fluxo antigo do chat de enriquecimento
 * ("como vocês se conheceram" sem contexto correspondente inventava um novo —
 * corrigido na PR #88 (que fechou a issue #29), ver server/db.ts e
 * server/limpeza-contextos-how-met.ts).
 *
 * Fonte da verdade é sempre enrichment_suggestions.undo_snapshot
 * (kind "how_met", contextoCriado true, contextoId presente) — nunca o nome
 * do contexto. Mesmo padrão de mock dos outros testes do módulo: drizzle real
 * sobre um cliente mysql2 falso, respostas em fila na ordem das consultas.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  respostas: [] as unknown[],
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      return [estado.respostas.shift() ?? [], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { limparContextosHowMet } = await import("./limpeza-contextos-how-met");
const { getDb } = await import("./db");

const sqlDe = (trecho: string) => estado.consultas.find(c => c.sql.includes(trecho));
const todasDe = (trecho: string) => estado.consultas.filter(c => c.sql.includes(trecho));

const DONA = "dona-1";

// Linha de enrichment_suggestions no select parcial {id, ownerId, undoSnapshot}.
const linhaSugestao = (id: string, ownerId: string, undoSnapshot: unknown) => [id, ownerId, undoSnapshot];

// Linha de contexts no select parcial {id, ownerId, isCustom, name, createdAt}.
const linhaContexto = (id: string, ownerId: string, isCustom: boolean, nome: string, criadoEm = 1000) =>
  [id, ownerId, isCustom ? 1 : 0, nome, criadoEm];

const snapshotBug = (contextoId: string | null, vinculoId: string | null = "vinc-1") => ({
  kind: "how_met" as const,
  linhaDeNota: null,
  contextoId,
  contextoCriado: true,
  vinculoId,
});

beforeEach(() => {
  estado.consultas = [];
  estado.respostas = [];
});

async function db() {
  return (await getDb())!;
}

describe("identificação — só o undo_snapshot decide, nunca o nome/texto", () => {
  it("contexto criado pelo bug, sem uso posterior: candidato apto (dry-run não apaga nada)", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))], // enrichment_suggestions
      [linhaContexto("ctx-1", DONA, true, "Fomos apresentadas por uma amiga em comum")], // contexts
      [["vinc-1"]],  // contact_contexts (o vínculo do próprio snapshot)
      [],            // context_participants
      [],            // context_media
      [],            // meetings
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.snapshotsAnalisados).toBe(1);
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0]).toMatchObject({ contextId: "ctx-1", vinculoId: "vinc-1", ownerId: DONA });
    expect(r.revisaoManual).toHaveLength(0);
    // dry-run nunca escreve
    expect(estado.consultas.some(c => c.sql.startsWith("delete") || c.sql.startsWith("update"))).toBe(false);
  });

  it("contexto legítimo (snapshot de outro kind): nunca vira candidato, contexts nunca é consultado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, { kind: "nota", linhaDeNota: "Relacionamento: profissional" })],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(0);
    expect(sqlDe("from `contexts`")).toBeUndefined();
  });

  it("contextoCriado = false: não remove — nem chega a consultar o contexto", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", null))], // aqui vamos forçar false abaixo
    ];
    // reconstruindo com contextoCriado false explicitamente
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, { kind: "how_met", linhaDeNota: null, contextoId: "ctx-1", contextoCriado: false, vinculoId: null })],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(sqlDe("from `contexts`")).toBeUndefined();
  });

  it("kind diferente de how_met (ex.: campo): não remove", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, { kind: "campo", coluna: "phone", anterior: null, aplicado: "11 90000-0000" })],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(sqlDe("from `contexts`")).toBeUndefined();
  });

  it("snapshot sem contextoId: não exclui nada automaticamente", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug(null))],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.candidatosBrutos).toBe(0);
    expect(sqlDe("from `contexts`")).toBeUndefined();
  });

  it("contexto já inexistente: conta como já ausente e a execução continua sem erro", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-fantasma"))],
      [], // select em contexts não acha nada
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.jaAusentes).toBe(1);
    expect(r.candidatos).toHaveLength(0);
    expect(r.erros).toHaveLength(0);
  });
});

describe("proteção contra falso positivo — qualquer dúvida vai para revisão manual, nunca é apagado", () => {
  it("mais de um vínculo no contexto: pode estar em uso legítimo além do bug — revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"], ["vinc-2"]], // dois vínculos
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(1);
    expect(r.revisaoManual[0].contextId).toBe("ctx-1");
    expect(r.revisaoManual[0].motivo).toMatch(/vínculos/);
  });

  it("um vínculo, mas diferente do vinculoId do snapshot: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-outro"]],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(1);
    expect(r.revisaoManual[0].motivo).toMatch(/não é o vínculo registrado/);
  });

  it("contexto com participante cadastrado: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"]],
      [["part-1"]], // participante
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/participante/);
  });

  it("contexto com mídia anexada: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"]],
      [],
      [["media-1"]], // mídia
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/mídia/);
  });

  it("contexto referenciado por reunião (meetings.context_id): revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"]],
      [],
      [],
      [["reuniao-1"]], // reunião
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/reunião/);
  });

  it("dono do contexto diferente do dono da sugestão: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", "outra-dona", true, "Encontro")],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/dono/);
  });

  it("contexto não é isCustom (catálogo global): revisão manual — nunca mexe no catálogo", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, false, "Encontro")],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/isCustom/);
  });
});

describe("execução real — apaga só o que passou em todas as checagens, na ordem certa", () => {
  it("apaga primeiro o vínculo, depois o contexto, com os WHEREs certos", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"]],
      [],
      [],
      [],
      { affectedRows: 1 }, // delete contact_contexts
      { affectedRows: 1 }, // delete contexts
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toEqual(["ctx-1"]);
    expect(r.erros).toHaveLength(0);

    const delVinculo = sqlDe("delete from `contact_contexts`");
    const delContexto = sqlDe("delete from `contexts`");
    expect(delVinculo).toBeDefined();
    expect(delContexto).toBeDefined();
    expect(delVinculo!.params).toEqual(expect.arrayContaining(["vinc-1", "ctx-1"]));
    expect(delContexto!.params).toEqual(expect.arrayContaining(["ctx-1", DONA, true]));
    // Mutante "apaga o contexto antes do vínculo": o vínculo tem que sair primeiro.
    expect(estado.consultas.indexOf(delVinculo!)).toBeLessThan(estado.consultas.indexOf(delContexto!));
  });

  it("candidato sem vínculo (vinculoId null no snapshot): não tenta apagar contact_contexts", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", null))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [], // nenhum vínculo encontrado (compatível com vinculoId null)
      [],
      [],
      [],
      { affectedRows: 1 }, // delete contexts
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toEqual(["ctx-1"]);
    expect(sqlDe("delete from `contact_contexts`")).toBeUndefined();
  });

  it("execução repetida: contexto já removido não gera erro nem nova exclusão (idempotente)", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [], // segunda rodada: contexto já não existe mais
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.jaAusentes).toBe(1);
    expect(r.removidos).toHaveLength(0);
    expect(r.erros).toHaveLength(0);
    expect(estado.consultas.some(c => c.sql.startsWith("delete"))).toBe(false);
  });

  it("revisão manual nunca é apagada, nem em modo executar", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"], ["vinc-2"]], // dois vínculos → revisão manual
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.revisaoManual).toHaveLength(1);
    expect(r.removidos).toHaveLength(0);
    expect(estado.consultas.some(c => c.sql.startsWith("delete"))).toBe(false);
  });

  it("DELETE não afeta linha (remoção concorrente): registrado como ignorado, não como erro", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true, "Encontro")],
      [["vinc-1"]],
      [],
      [],
      [],
      { affectedRows: 1 }, // delete contact_contexts
      { affectedRows: 0 }, // delete contexts não pegou linha (já foi apagado por outra execução)
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toHaveLength(0);
    expect(r.erros).toHaveLength(0);
    expect(r.ignoradosNaExecucao).toHaveLength(1);
    expect(r.ignoradosNaExecucao[0].contextId).toBe("ctx-1");
  });
});
