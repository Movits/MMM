import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Etapa 4 — "Desfazer" no Histórico IA reverte de verdade.
 *
 * A reverificação de 04/09 achou o botão sem onClick e nenhum procedimento de
 * desfazer no servidor: a usuária via um controle que prometia reverter o que
 * a IA gravou e o clique era silencioso. O conserto guarda, na confirmação, o
 * retrato do que a escrita vai cobrir (enrichment_suggestions.undo_snapshot)
 * e o desfazer usa esse retrato — sem nunca apagar o que a dona fez depois.
 *
 * Drizzle de verdade sobre um cliente mysql2 falso que responde pelo CONTEÚDO
 * de cada consulta e captura o SQL: o que se prova aqui é o SQL que sai
 * (owner_id em todo WHERE, o UPDATE certo, o DELETE só quando devido), não o
 * retorno de um dublê.
 */

type Consulta = { sql: string; params: unknown[] };

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  /** Linha atual de enrichment_suggestions, na ordem das colunas do schema. */
  sugestao: null as unknown[] | null,
  telefoneAtual: "11 90000-0000" as string | null,
  notasAtuais: null as string | null,
  tagJaExiste: false,
  linhasMarcadas: 1,
  sessao: null as unknown[] | null,
  linhasDaSessao: 1,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      const sql = config.sql;
      if (sql.startsWith("insert into `contact_")) return [{ affectedRows: 1, insertId: 99 }, []];
      if (sql.startsWith("insert")) return [{ affectedRows: 1 }, []];
      if (sql.startsWith("delete")) return [{ affectedRows: 1 }, []];
      if (sql.startsWith("update `enrichment_suggestions`")) return [{ affectedRows: estado.linhasMarcadas }, []];
      if (sql.startsWith("update `enrichment_sessions`")) return [{ affectedRows: estado.linhasDaSessao }, []];
      if (sql.startsWith("update")) return [{ affectedRows: 1 }, []];
      if (sql.includes("from `enrichment_suggestions`")) return [estado.sugestao ? [estado.sugestao] : [], []];
      if (sql.includes("from `enrichment_sessions`")) return [estado.sessao ? [estado.sessao] : [], []];
      if (/^select `phone` from `private_contacts`/.test(sql)) return [[[estado.telefoneAtual]], []];
      if (/^select `notes` from `private_contacts`/.test(sql)) return [[[estado.notasAtuais]], []];
      if (/^select `id` from `private_contacts`/.test(sql)) return [[[42]], []];
      if (/^select `id` from `contact_(assets|needs)`/.test(sql)) return [estado.tagJaExiste ? [[7]] : [], []];
      if (sql.includes("from `contexts`")) return [[], []];
      if (sql.includes("from `contact_contexts`")) return [[], []];
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const db = await import("./db");

const DONA = "dona-1";
// id, session_id, message_id, owner_id, contact_id, field_type, suggested_value,
// applied_value, tag_id, tag_is_new, confidence, status, actioned_at,
// actioned_by, undo_snapshot, created_at, updated_at
const linhaDeSugestao = (campos: { fieldType: string; suggestedValue: string; status: string; appliedValue?: string | null; undoSnapshot?: unknown }) => [
  "sug-1", "sessao-1", "msg-ia", DONA, 42, campos.fieldType, campos.suggestedValue,
  campos.appliedValue ?? null, null, 0, "0.900", campos.status, null, null,
  campos.undoSnapshot ?? null, 1000, 1000,
];

const consultas = () => estado.consultas as Consulta[];
// private_contacts nasceu com colunas camelCase (`ownerId`); as tabelas da
// etapa 4 em diante usam snake_case (`owner_id`). Os dois são a dona no WHERE.
const COM_DONA = /`(owner_id|ownerId)` = \?/;
const sqlDe = (trecho: string | RegExp) => consultas().find(c => typeof trecho === "string" ? c.sql.includes(trecho) : trecho.test(c.sql));
const todasDe = (trecho: string | RegExp) => consultas().filter(c => typeof trecho === "string" ? c.sql.includes(trecho) : trecho.test(c.sql));
const snapshotGravado = () => {
  const marcacao = sqlDe("update `enrichment_suggestions`");
  expect(marcacao, "o UPDATE que marca applied").toBeDefined();
  expect(marcacao!.sql).toContain("`undo_snapshot` = ?");
  const bruto = marcacao!.params.find(p => typeof p === "string" && p.startsWith("{\"kind\""));
  expect(bruto, "o snapshot vai no mesmo UPDATE").toBeDefined();
  return JSON.parse(bruto as string);
};

beforeEach(() => {
  estado.consultas = [];
  estado.sugestao = null;
  estado.telefoneAtual = "11 90000-0000";
  estado.notasAtuais = null;
  estado.tagJaExiste = false;
  estado.linhasMarcadas = 1;
  estado.sessao = null;
  estado.linhasDaSessao = 1;
});

describe("confirmar guarda o retrato do que vai cobrir, por tipo de destino", () => {
  it("campo simples: lê o telefone atual ANTES do UPDATE e grava anterior/aplicado com o applied", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "phone", suggestedValue: "11 99999-8888", status: "pending" });

    expect(await db.applyEnrichmentSuggestion("sug-1", DONA)).toBe(true);

    const leitura = consultas().findIndex(c => /^select `phone` from `private_contacts`/.test(c.sql));
    const escrita = consultas().findIndex(c => c.sql.startsWith("update `private_contacts`"));
    // Mutante "ler depois de gravar": o anterior seria o valor recém-aplicado.
    expect(leitura).toBeGreaterThan(-1);
    expect(leitura).toBeLessThan(escrita);
    expect(consultas()[leitura].sql).toMatch(COM_DONA);

    expect(snapshotGravado()).toEqual({ kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" });
    const marcacao = sqlDe("update `enrichment_suggestions`")!;
    expect(marcacao.sql).toContain("`status` = ?");
    expect(marcacao.params).toContain("applied");
    expect(marcacao.sql).toMatch(COM_DONA);
  });

  it("possui/procura inserido: guarda a tabela, o id da linha nova e inseriu=true", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "assets", suggestedValue: "Mina de lítio", status: "pending" });

    await db.applyEnrichmentSuggestion("sug-1", DONA);

    expect(sqlDe("insert into `contact_assets`")).toBeDefined();
    expect(snapshotGravado()).toEqual({ kind: "tag", tabela: "contact_assets", inseriu: true, linhaId: 99, slug: "mina-de-litio", rotulo: "Mina de lítio" });
  });

  it("possui/procura que já existia: inseriu=false (desfazer não pode apagar o que já estava lá)", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "needs", suggestedValue: "investidores", status: "pending" });
    estado.tagJaExiste = true;

    await db.applyEnrichmentSuggestion("sug-1", DONA);

    expect(sqlDe("insert into `contact_needs`")).toBeUndefined();
    expect(snapshotGravado()).toEqual({ kind: "tag", tabela: "contact_needs", inseriu: false, linhaId: 7, slug: "investidores", rotulo: "investidores" });
  });

  it("como se conheceram: guarda a linha de nota, o contexto (criado) e o id do vínculo", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "how_met", suggestedValue: "Em um evento", status: "pending" });
    estado.notasAtuais = "Nota antiga";

    await db.applyEnrichmentSuggestion("sug-1", DONA);

    const snapshot = snapshotGravado();
    expect(snapshot).toMatchObject({ kind: "how_met", linhaDeNota: "Como se conheceram: Em um evento", contextoCriado: true });
    expect(typeof snapshot.contextoId).toBe("string");
    expect(typeof snapshot.vinculoId).toBe("string");
    // O id guardado é o mesmo que foi para o INSERT do vínculo.
    expect(sqlDe("insert into `contact_contexts`")!.params).toContain(snapshot.vinculoId);
  });

  it("relacionamento: guarda a linha acrescentada às anotações", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "relationship_type", suggestedValue: "profissional", status: "pending" });

    await db.applyEnrichmentSuggestion("sug-1", DONA);

    expect(snapshotGravado()).toEqual({ kind: "nota", linhaDeNota: "Relacionamento: profissional" });
  });

  it("marca 'applied' só se AINDA estava pendente: a 2ª confirmação concorrente do mesmo cartão não regrava o retrato", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "phone", suggestedValue: "11 99999-8888", status: "pending" });

    expect(await db.applyEnrichmentSuggestion("sug-1", DONA)).toBe(true);

    // SET status = 'applied' ... WHERE id AND owner_id AND status = 'pending'.
    const marcacao = sqlDe("update `enrichment_suggestions`")!;
    expect(marcacao.sql).toMatch(/where .*`status` = \?/);
    expect(marcacao.params).toContain("pending");
    expect(marcacao.params.indexOf("applied")).toBeLessThan(marcacao.params.indexOf("pending"));

    // A outra aba também leu 'pending' e também escreveu no contato, mas o
    // UPDATE dela não pega linha: sem retrato novo (que seria "anterior = o
    // valor já aplicado") por cima do bom, e o router responde NOT_FOUND.
    // Mutante "só id + owner_id no WHERE": affectedRows seria 1 e viria true.
    estado.consultas = [];
    estado.linhasMarcadas = 0;
    expect(await db.applyEnrichmentSuggestion("sug-1", DONA)).toBe(false);
  });
});

describe("desfazer reverte pelo retrato — e só o que a confirmação gravou", () => {
  it("campo com o valor ainda igual ao aplicado volta ao anterior, com owner_id no WHERE", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied", appliedValue: "11 99999-8888",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" },
    });
    estado.telefoneAtual = "11 99999-8888";

    const r = await db.undoEnrichmentSuggestion("sug-1", DONA);

    expect(r).toEqual({ resultado: "desfeita", kind: "campo", fieldType: "phone", reverted: true, motivo: null });
    const reversao = sqlDe("update `private_contacts`");
    expect(reversao).toBeDefined();
    expect(reversao!.sql).toContain("`phone` = ?");
    expect(reversao!.params[0]).toBe("11 90000-0000");
    expect(reversao!.sql).toMatch(COM_DONA);
    expect(reversao!.params).toContain(DONA);

    const marcacao = sqlDe("update `enrichment_suggestions`")!;
    expect(marcacao.params).toContain("undone");
    expect(marcacao.sql).toContain("`status` = ?"); // ... where status = 'applied'
    expect(marcacao.params).toContain("applied");
    expect(marcacao.sql).toMatch(COM_DONA);
  });

  it("campo que a dona alterou depois NÃO é tocado: marca undone e diz reverted=false", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied", appliedValue: "11 99999-8888",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" },
    });
    estado.telefoneAtual = "11 97777-6666"; // editado à mão depois da confirmação

    const r = await db.undoEnrichmentSuggestion("sug-1", DONA);

    // Mutante "reverte sempre": apagaria a edição da dona.
    expect(sqlDe("update `private_contacts`")).toBeUndefined();
    expect(r).toMatchObject({ resultado: "desfeita", reverted: false, motivo: "valor_alterado_depois" });
    expect(sqlDe("update `enrichment_suggestions`")!.params).toContain("undone");
  });

  it("tag que esta confirmação inseriu é apagada pelo id, da dona e do contato", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "assets", suggestedValue: "Mina de lítio", status: "applied",
      undoSnapshot: { kind: "tag", tabela: "contact_assets", inseriu: true, linhaId: 99, slug: "mina-de-litio", rotulo: "Mina de lítio" },
    });

    const r = await db.undoEnrichmentSuggestion("sug-1", DONA);

    expect(r).toMatchObject({ resultado: "desfeita", kind: "tag", reverted: true });
    const remocao = sqlDe("delete from `contact_assets`");
    expect(remocao).toBeDefined();
    expect(remocao!.sql).toContain("`id` = ?");
    expect(remocao!.sql).toMatch(COM_DONA);
    expect(remocao!.sql).toContain("`contact_id` = ?");
    expect(remocao!.params).toEqual(expect.arrayContaining([99, DONA, 42]));
  });

  it("tag que já existia antes fica: nenhum DELETE", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "needs", suggestedValue: "investidores", status: "applied",
      undoSnapshot: { kind: "tag", tabela: "contact_needs", inseriu: false, linhaId: 7, slug: "investidores", rotulo: "investidores" },
    });

    const r = await db.undoEnrichmentSuggestion("sug-1", DONA);

    expect(r).toMatchObject({ resultado: "desfeita", kind: "tag" });
    expect(consultas().some(c => c.sql.startsWith("delete"))).toBe(false);
    expect(sqlDe("update `enrichment_suggestions`")!.params).toContain("undone");
  });

  it("como se conheceram: tira só a linha da nota e o vínculo; o contexto fica", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "how_met", suggestedValue: "Em um evento", status: "applied",
      undoSnapshot: { kind: "how_met", linhaDeNota: "Como se conheceram: Em um evento", contextoId: "ctx-1", contextoCriado: true, vinculoId: "vinc-1" },
    });
    estado.notasAtuais = "Nota antiga\nComo se conheceram: Em um evento\nOutra nota";

    const r = await db.undoEnrichmentSuggestion("sug-1", DONA);

    expect(r).toMatchObject({ resultado: "desfeita", kind: "how_met", reverted: true });
    const nota = sqlDe("update `private_contacts`");
    expect(nota).toBeDefined();
    expect(nota!.params[0]).toBe("Nota antiga\nOutra nota");
    expect(nota!.sql).toMatch(COM_DONA);

    const vinculo = sqlDe("delete from `contact_contexts`");
    expect(vinculo).toBeDefined();
    expect(vinculo!.sql).toContain("`id` = ?");
    expect(vinculo!.sql).toMatch(COM_DONA);
    expect(vinculo!.params).toEqual(expect.arrayContaining(["vinc-1", DONA]));
    // Mutante "apaga o contexto também": ele pode ter ganhado outros contatos e anexos.
    expect(sqlDe("delete from `contexts`")).toBeUndefined();
  });

  it("nota já apagada à mão: nada a regravar, mas a sugestão vira undone", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "relationship_type", suggestedValue: "profissional", status: "applied",
      undoSnapshot: { kind: "nota", linhaDeNota: "Relacionamento: profissional" },
    });
    estado.notasAtuais = "Só a nota da dona";

    await db.undoEnrichmentSuggestion("sug-1", DONA);

    expect(sqlDe("update `private_contacts`")).toBeUndefined();
    expect(sqlDe("update `enrichment_suggestions`")!.params).toContain("undone");
  });

  it("ignorada não se desfaz: 'indisponivel', sem tocar em nada", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "phone", suggestedValue: "11 99999-8888", status: "ignored" });

    expect(await db.undoEnrichmentSuggestion("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(consultas().some(c => c.sql.startsWith("update") || c.sql.startsWith("delete"))).toBe(false);
  });

  it("ignorada COM retrato (estado que não nasce hoje) continua 'indisponivel': a guarda é o status, não o retrato", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "ignored",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" },
    });
    estado.telefoneAtual = "11 99999-8888";

    // Mutante "tirar `sug.status !== 'applied'` da guarda": reverteria o
    // telefone de uma sugestão que nunca foi aplicada.
    expect(await db.undoEnrichmentSuggestion("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(consultas().some(c => c.sql.startsWith("update") || c.sql.startsWith("delete"))).toBe(false);
  });

  it("já desfeita, com retrato e o telefone ainda igual ao aplicado: 'ja_desfeita', sem reverter de novo nem remarcar", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "undone", appliedValue: "11 99999-8888",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" },
    });
    // A dona voltou a digitar o mesmo telefone depois de desfazer: o valor
    // atual bate com o aplicado, e sem a guarda o desfazer o apagaria de novo.
    estado.telefoneAtual = "11 99999-8888";

    expect(await db.undoEnrichmentSuggestion("sug-1", DONA)).toEqual({ resultado: "ja_desfeita" });
    expect(sqlDe("update `private_contacts`")).toBeUndefined();
    expect(consultas().some(c => c.sql.startsWith("update") || c.sql.startsWith("delete"))).toBe(false);
  });

  it("aplicada antes de o recurso existir (sem snapshot): 'indisponivel'", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied", appliedValue: "11 99999-8888" });

    expect(await db.undoEnrichmentSuggestion("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(consultas().some(c => c.sql.startsWith("update") || c.sql.startsWith("delete"))).toBe(false);
  });

  it("sugestão de outra dona (ou inexistente): 'nao_encontrada' — a busca é pela dona", async () => {
    expect(await db.undoEnrichmentSuggestion("sug-alheia", DONA)).toEqual({ resultado: "nao_encontrada" });
    const busca = sqlDe("from `enrichment_suggestions`")!;
    expect(busca.sql).toMatch(COM_DONA);
    expect(busca.params).toContain(DONA);
  });

  it("outra aba desfez primeiro (UPDATE não pega linha): 'ja_desfeita'", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied", appliedValue: "11 99999-8888",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: null, aplicado: "11 99999-8888" },
    });
    estado.telefoneAtual = "11 99999-8888";
    estado.linhasMarcadas = 0;

    expect(await db.undoEnrichmentSuggestion("sug-1", DONA)).toEqual({ resultado: "ja_desfeita" });
  });

  it("privacidade é regra de consulta: todo WHERE do desfazer leva owner_id", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "how_met", suggestedValue: "Em um evento", status: "applied",
      undoSnapshot: { kind: "how_met", linhaDeNota: "Como se conheceram: Em um evento", contextoId: "ctx-1", contextoCriado: false, vinculoId: "vinc-1" },
    });
    estado.notasAtuais = "Como se conheceram: Em um evento";

    await db.undoEnrichmentSuggestion("sug-1", DONA);

    const comWhere = todasDe(" where ");
    expect(comWhere.length).toBeGreaterThanOrEqual(4);
    for (const c of comWhere) expect(c.sql, c.sql).toMatch(COM_DONA);
  });
});

describe("histórico e avanço do roteiro", () => {
  it("getEnrichmentHistory diz se dá para desfazer e NÃO devolve o retrato", async () => {
    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied", appliedValue: "11 99999-8888",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: "11 90000-0000", aplicado: "11 99999-8888" },
    });

    const { data } = await db.getEnrichmentHistory(DONA, 42, 30, 0);

    expect(data).toHaveLength(1);
    expect(data[0].podeDesfazer).toBe(true);
    // O valor anterior do telefone é dado do contato; a tela só precisa do sim/não.
    expect("undoSnapshot" in data[0]).toBe(false);
    expect(JSON.stringify(data)).not.toContain("11 90000-0000");
  });

  it("aplicada sem snapshot ou já desfeita: podeDesfazer=false", async () => {
    estado.sugestao = linhaDeSugestao({ fieldType: "phone", suggestedValue: "11 99999-8888", status: "applied" });
    expect((await db.getEnrichmentHistory(DONA, 42)).data[0].podeDesfazer).toBe(false);

    estado.sugestao = linhaDeSugestao({
      fieldType: "phone", suggestedValue: "11 99999-8888", status: "undone",
      undoSnapshot: { kind: "campo", coluna: "phone", anterior: null, aplicado: "11 99999-8888" },
    });
    expect((await db.getEnrichmentHistory(DONA, 42)).data[0].podeDesfazer).toBe(false);
  });

  it("advanceEnrichmentSession avança a etapa que o CHAMADOR leu, sem reler a sessão: duas abas não avançam duas vezes", async () => {
    // Nenhuma sessão no banco falso de propósito: se o avanço reler a sessão,
    // encontra nada e devolve null — e o teste cai na primeira asserção.
    estado.sessao = null;

    const avancou = await db.advanceEnrichmentSession("sessao-1", DONA, 2);

    expect(avancou).toEqual({ questionsAnswered: 3 });
    // Mutante "reler antes do UPDATE" (a versão que fazia 2 → 4 com duas abas):
    // haveria um SELECT da sessão aqui.
    expect(sqlDe("from `enrichment_sessions`")).toBeUndefined();
    const update = sqlDe("update `enrichment_sessions`")!;
    // SET questions_answered = 3 ... WHERE id AND owner_id AND status = 'active' AND questions_answered = 2.
    expect(update.sql).toMatch(/where .*`questions_answered` = \?/);
    expect(update.params).toEqual(expect.arrayContaining([3, "sessao-1", DONA, "active", 2]));
    expect(update.params.indexOf(3)).toBeLessThan(update.params.indexOf(2));
    // Sem pular, o contador de puladas não é tocado.
    expect(update.sql).not.toContain("`questions_skipped`");

    estado.consultas = [];
    estado.linhasDaSessao = 0; // a outra aba já avançou: o WHERE não bate
    expect(await db.advanceEnrichmentSession("sessao-1", DONA, 2)).toBeNull();
  });

  it("pular a etapa ('não sei' / ignorar o último cartão) incrementa questions_skipped no próprio UPDATE, sem ler antes", async () => {
    await db.advanceEnrichmentSession("sessao-1", DONA, 1, true);

    expect(sqlDe("from `enrichment_sessions`")).toBeUndefined();
    const update = sqlDe("update `enrichment_sessions`")!;
    expect(update.sql).toMatch(/`questions_skipped` = [^,]*`questions_skipped` \+ 1/);
    expect(update.params).toEqual(expect.arrayContaining([2, 1]));
  });
});
