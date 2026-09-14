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
      // Controle de transação fica registrado, mas não consome a fila.
      if (/^(begin|commit|rollback)$/.test(config.sql)) return [[], []];
      const resposta = estado.respostas.shift() ?? [];
      // Um Error na fila simula a consulta falhando no driver.
      if (resposta instanceof Error) throw resposta;
      return [resposta, []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { limparContextosHowMet, decidirModo, alvoDoBanco } = await import("./limpeza-contextos-how-met");
const { getDb } = await import("./db");

const sqlDe = (trecho: string) => estado.consultas.find(c => c.sql.includes(trecho));
const ordemDasConsultas = () => estado.consultas.map(c => c.sql);

const DONA = "dona-1";

// Linha de enrichment_suggestions no select parcial {id, ownerId, undoSnapshot}.
const linhaSugestao = (id: string, ownerId: string, undoSnapshot: unknown) => [id, ownerId, undoSnapshot];

// Linha de contexts no select parcial {id, ownerId, isCustom, createdAt, intocado} — sem o nome.
// `intocado` é o `case when` que o banco avalia (1 = a forma que o defeito gravava).
const linhaContexto = (id: string, ownerId: string, isCustom: boolean, criadoEm = 1000, intocado = true) =>
  [id, ownerId, isCustom ? 1 : 0, criadoEm, intocado ? 1 : 0];

// Linha de contact_contexts no select parcial {id, intocado}.
const linhaVinculo = (id: string, intocado = true) => [id, intocado ? 1 : 0];

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
      [linhaContexto("ctx-1", DONA, true)], // contexts
      [linhaVinculo("vinc-1")],  // contact_contexts (o vínculo do próprio snapshot)
      [],            // context_participants
      [],            // context_media
      [],            // meetings
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.snapshotsAnalisados).toBe(1);
    expect(r.candidatos).toHaveLength(1);
    expect(r.candidatos[0]).toMatchObject({ contextId: "ctx-1", vinculoId: "vinc-1", ownerId: DONA });
    expect(r.revisaoManual).toHaveLength(0);
    // dry-run nunca escreve, nem abre transação
    expect(estado.consultas.some(c => c.sql.startsWith("delete") || c.sql.startsWith("update"))).toBe(false);
    expect(ordemDasConsultas()).not.toContain("begin");
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

describe("o relatório não carrega o texto do contexto", () => {
  it("o nome (a frase livre da resposta) nem é lido do banco nem aparece no resultado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    const selectContexto = sqlDe("from `contexts`")!;
    expect(selectContexto.sql).not.toContain("`name`");
    expect(Object.keys(r.candidatos[0])).not.toContain("nome");

    // A edição é lida como 0/1 calculado no banco: os campos de texto livre só
    // aparecem dentro de "is null", nunca como coluna devolvida ao script.
    const selectVinculo = sqlDe("from `contact_contexts`")!;
    for (const [consulta, tabela] of [[selectContexto, "contexts"], [selectVinculo, "contact_contexts"]] as const) {
      expect(consulta.sql).toMatch(/case when \(.+\) then 1 else 0 end from/);
      const semTestesDeNulo = consulta.sql.replace(new RegExp(`\`${tabela}\`\\.\`\\w+\` is null`, "g"), "");
      for (const coluna of ["description", "event_date", "city", "country", "notes"]) {
        expect(semTestesDeNulo).not.toContain(`\`${coluna}\``);
      }
    }
  });
});

describe("proteção contra falso positivo — qualquer dúvida vai para revisão manual, nunca é apagado", () => {
  it("mais de um vínculo no contexto: pode estar em uso legítimo além do bug — revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1"), linhaVinculo("vinc-2")], // dois vínculos
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
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-outro")],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(1);
    expect(r.revisaoManual[0].motivo).toMatch(/não é o vínculo registrado/);
  });

  it("contexto com participante cadastrado: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [["part-1"]], // participante
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/participante/);
  });

  it("contexto com mídia anexada: revisão manual", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
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
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
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
      [linhaContexto("ctx-1", "outra-dona", true)],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/dono/);
  });

  it("contexto não é isCustom (catálogo global): revisão manual — nunca mexe no catálogo", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1"))],
      [linhaContexto("ctx-1", DONA, false)],
    ];

    const r = await limparContextosHowMet(await db(), "dry_run");

    expect(r.candidatos).toHaveLength(0);
    expect(r.revisaoManual[0].motivo).toMatch(/isCustom/);
  });

  it("contexto editado pela dona depois de criado (a Linha do Tempo muda updated_at): revisão manual, nem em executar é apagado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true, 1000, false)], // o case when do banco deu 0
      // O resto da fila é o de um candidato apto: sem a checagem de edição, seria apagado.
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
      { affectedRows: 1 },
      { affectedRows: 1 },
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.candidatos).toHaveLength(0);
    expect(r.removidos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(1);
    expect(r.revisaoManual[0]).toMatchObject({ contextId: "ctx-1", sugestaoId: "sug-1" });
    expect(r.revisaoManual[0].motivo).toMatch(/contexto editado/);
    expect(estado.consultas.some(c => c.sql.startsWith("delete"))).toBe(false);
  });

  it("vínculo do snapshot editado (ligar o mesmo contato de novo grava data, cidade ou notas): revisão manual, nem em executar é apagado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1", false)], // é o vínculo do snapshot, mas o case when do banco deu 0
      [],
      [],
      [],
      { affectedRows: 1 },
      { affectedRows: 1 },
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.candidatos).toHaveLength(0);
    expect(r.removidos).toHaveLength(0);
    expect(r.revisaoManual).toHaveLength(1);
    expect(r.revisaoManual[0]).toMatchObject({ contextId: "ctx-1", sugestaoId: "sug-1" });
    expect(r.revisaoManual[0].motivo).toMatch(/vínculo do snapshot editado/);
    expect(estado.consultas.some(c => c.sql.startsWith("delete"))).toBe(false);
  });
});

describe("execução real — checagem de uso e exclusão na mesma instrução, dentro de transação", () => {
  it("o DELETE do contexto repete a checagem de uso; o vínculo sai depois; tudo entre begin e commit", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
      { affectedRows: 1 }, // delete contexts (com os NOT EXISTS)
      { affectedRows: 1 }, // delete contact_contexts
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toEqual(["ctx-1"]);
    expect(r.erros).toHaveLength(0);

    const delContexto = sqlDe("delete from `contexts`")!;
    const delVinculo = sqlDe("delete from `contact_contexts`")!;
    expect(delContexto).toBeDefined();
    expect(delVinculo).toBeDefined();

    // A checagem de uso está DENTRO do DELETE: um NOT EXISTS por tabela que
    // denuncia uso, e o vínculo do snapshot é o único tolerado (id <> vinc-1).
    expect(delContexto.sql.match(/not exists/g)).toHaveLength(4);
    for (const tabela of ["contact_contexts", "context_participants", "context_media", "meetings"]) {
      expect(delContexto.sql).toContain(`from \`${tabela}\``);
    }
    expect(delContexto.params).toEqual(["ctx-1", DONA, true, "ctx-1", "vinc-1", "ctx-1", "ctx-1", "ctx-1"]);
    expect(delVinculo.params).toEqual(["vinc-1", "ctx-1"]);

    const ordem = ordemDasConsultas();
    const iBegin = ordem.indexOf("begin");
    const iContexto = estado.consultas.indexOf(delContexto);
    const iVinculo = estado.consultas.indexOf(delVinculo);
    const iCommit = ordem.indexOf("commit");
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iBegin).toBeLessThan(iContexto);
    expect(iContexto).toBeLessThan(iVinculo);
    expect(iVinculo).toBeLessThan(iCommit);
    expect(ordem).not.toContain("rollback");
  });

  it("o DELETE repete a checagem de edição: só apaga o contexto intocado, e o vínculo do snapshot só é tolerado enquanto intocado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
      { affectedRows: 1 },
      { affectedRows: 1 },
    ];

    await limparContextosHowMet(await db(), "executar");

    const delContexto = sqlDe("delete from `contexts`")!.sql;
    const intocado = (tabela: string, colunas: string[]) =>
      `(\`${tabela}\`.\`updated_at\` = \`${tabela}\`.\`created_at\`` +
      colunas.map(c => ` and \`${tabela}\`.\`${c}\` is null`).join("") + ")";
    const contextoIntocado = intocado("contexts", ["context_type_id", "description", "event_date", "city", "country", "notes"]);
    const vinculoIntocado = intocado("contact_contexts", ["event_date", "city", "country", "notes"]);

    // A forma intocada do contexto vale para a própria linha apagada, fora dos NOT EXISTS.
    expect(delContexto).toContain(contextoIntocado);
    expect(delContexto.indexOf(contextoIntocado)).toBeLessThan(delContexto.indexOf("not exists"));
    // Vínculo diferente do snapshot, ou o do snapshot já editado, impede a exclusão.
    expect(delContexto).toContain(`(\`contact_contexts\`.\`id\` <> ? or not ${vinculoIntocado})`);
  });

  it("candidato sem vínculo (vinculoId null no snapshot): QUALQUER vínculo impede, e contact_contexts não é apagado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", null))],
      [linhaContexto("ctx-1", DONA, true)],
      [], // nenhum vínculo encontrado (compatível com vinculoId null)
      [],
      [],
      [],
      { affectedRows: 1 }, // delete contexts
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toEqual(["ctx-1"]);
    expect(sqlDe("delete from `contact_contexts`")).toBeUndefined();
    // sem o "id <> ?": nenhum vínculo é tolerado
    expect(sqlDe("delete from `contexts`")!.params).toEqual(["ctx-1", DONA, true, "ctx-1", "ctx-1", "ctx-1", "ctx-1"]);
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
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1"), linhaVinculo("vinc-2")], // dois vínculos → revisão manual
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.revisaoManual).toHaveLength(1);
    expect(r.removidos).toHaveLength(0);
    expect(estado.consultas.some(c => c.sql.startsWith("delete"))).toBe(false);
  });

  it("DELETE do contexto não pega linha (sumiu ou ganhou uso depois da investigação): o vínculo não é tocado, fica como ignorado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
      { affectedRows: 0 }, // a dona vinculou alguém no meio: o NOT EXISTS barrou
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toHaveLength(0);
    expect(r.erros).toHaveLength(0);
    expect(r.ignoradosNaExecucao).toHaveLength(1);
    expect(r.ignoradosNaExecucao[0].contextId).toBe("ctx-1");
    expect(r.ignoradosNaExecucao[0].motivo).toMatch(/uso/);
    expect(sqlDe("delete from `contact_contexts`")).toBeUndefined();
  });

  it("falha ao apagar o vínculo depois do contexto: rollback, nada conta como removido, o erro é relatado", async () => {
    estado.respostas = [
      [linhaSugestao("sug-1", DONA, snapshotBug("ctx-1", "vinc-1"))],
      [linhaContexto("ctx-1", DONA, true)],
      [linhaVinculo("vinc-1")],
      [],
      [],
      [],
      { affectedRows: 1 },            // delete contexts
      new Error("conexão perdida"),   // delete contact_contexts falha
    ];

    const r = await limparContextosHowMet(await db(), "executar");

    expect(r.removidos).toHaveLength(0);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].contextId).toBe("ctx-1");
    const ordem = ordemDasConsultas();
    expect(ordem).toContain("rollback");
    expect(ordem).not.toContain("commit");
  });
});

describe("trava da execução real (decidirModo)", () => {
  const URL_BANCO = "mysql://usuaria:s3nh4-secreta@banco.exemplo.test:3306/mmm";
  const ALVO = "banco.exemplo.test:3306/mmm";

  it("o alvo sai sem usuário nem senha", () => {
    expect(alvoDoBanco(URL_BANCO)).toBe(ALVO);
    expect(alvoDoBanco("mysql://u:p@localhost/mmm_local")).toBe("localhost/mmm_local");
  });

  it("sem --executar é sempre dry-run", () => {
    expect(decidirModo([], URL_BANCO)).toEqual({ modo: "dry_run", alvo: ALVO });
  });

  it("--confirmar-banco sozinho não liga a execução", () => {
    expect(decidirModo([`--confirmar-banco=${ALVO}`], URL_BANCO)).toEqual({ modo: "dry_run", alvo: ALVO });
  });

  it("--executar sem confirmação: recusa, e a recusa não vaza usuário nem senha", () => {
    const d = decidirModo(["--executar"], URL_BANCO);
    expect(d).toHaveProperty("recusa");
    expect(JSON.stringify(d)).not.toContain("s3nh4-secreta");
    expect(JSON.stringify(d)).not.toContain("usuaria");
  });

  it("--executar confirmando OUTRO banco: recusa", () => {
    const d = decidirModo(["--executar", "--confirmar-banco=localhost:3306/mmm"], URL_BANCO);
    expect(d).toHaveProperty("recusa");
  });

  it("--executar confirmando só o host, sem o banco: recusa", () => {
    const d = decidirModo(["--executar", "--confirmar-banco=banco.exemplo.test:3306"], URL_BANCO);
    expect(d).toHaveProperty("recusa");
  });

  it("--executar com a confirmação exata do alvo: executa", () => {
    expect(decidirModo(["--executar", `--confirmar-banco=${ALVO}`], URL_BANCO)).toEqual({ modo: "executar", alvo: ALVO });
  });

  it("sem DATABASE_URL, URL inválida ou sem nome de banco: recusa, mesmo sem --executar", () => {
    expect(decidirModo([], undefined)).toHaveProperty("recusa");
    expect(decidirModo([], "nao-e-url")).toHaveProperty("recusa");
    expect(decidirModo(["--executar", "--confirmar-banco=host/"], "mysql://u:p@host")).toHaveProperty("recusa");
  });
});
