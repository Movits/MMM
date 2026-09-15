import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * "Criar o contexto X?" — acompanhamento da revisão da PR #88.
 *
 * A PR #88 parou de criar contexto a partir da resposta livre do chat; faltava
 * a outra metade: oferecer a criação e só criar com o sim explícito da dona.
 *
 * O que se trava aqui:
 *  - contextoParaOferecer: só oferece para "como se conheceram" aplicado que
 *    NÃO casou com contexto nenhum, e só com nome que cabe na coluna;
 *  - criarContextoOferecido: cria o contexto e o vínculo uma vez, reusa o
 *    contexto se alguém o criou no meio, e grava no retrato uma marca própria —
 *    nunca `contextoCriado: true`, que é a marca do defeito antigo usada pelo
 *    script de limpeza;
 *  - nada é criado quando a sugestão não está mais em condição de oferta.
 *
 * Mesmo padrão de contextos.test.ts: drizzle de verdade sobre um cliente mysql2
 * falso que captura o SQL.
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

const { contextoParaOferecer, LIMITE_DO_NOME_DE_CONTEXTO } = await import("./contexto-oferecido");
const { criarContextoOferecido } = await import("./db");

const DONA = "dona-1";
const sqlDe = (trecho: string) => estado.consultas.find(c => c.sql.includes(trecho));
const escritas = () => estado.consultas.filter(c => /^(insert|update|delete)/.test(c.sql));

const retratoSemContexto = { kind: "how_met", linhaDeNota: "Como se conheceram: Feira de Milão", contextoId: null, contextoCriado: false, vinculoId: null };

// A sugestão como getEnrichmentSuggestion a lê: as 17 colunas na ordem do schema.
function linhaDaSugestao(extra: { fieldType?: string; status?: string; appliedValue?: string | null; undoSnapshot?: unknown } = {}) {
  const s = { fieldType: "how_met", status: "applied", appliedValue: "Feira de Milão", undoSnapshot: retratoSemContexto, ...extra };
  return [
    "sug-1", "sessao-1", "msg-1", DONA, 42, s.fieldType, s.appliedValue ?? "", s.appliedValue, null, 0, "0.900",
    s.status, 1000, "user", s.undoSnapshot === null ? null : JSON.stringify(s.undoSnapshot), 1000, 1000,
  ];
}

beforeEach(() => {
  estado.consultas = [];
  estado.respostas = [];
});

describe("contextoParaOferecer — quando o chat pergunta 'Criar o contexto X?'", () => {
  const base = { fieldType: "how_met", status: "applied", appliedValue: "Feira de Milão", undoSnapshot: retratoSemContexto };

  it("resposta aplicada que não casou com contexto nenhum: oferece o nome", () => {
    expect(contextoParaOferecer(base)).toBe("Feira de Milão");
  });

  it("resposta que casou com contexto existente (contextoId no retrato): não oferece", () => {
    expect(contextoParaOferecer({ ...base, undoSnapshot: { ...retratoSemContexto, contextoId: "ctx-1", vinculoId: "vinc-1" } })).toBeNull();
  });

  it("retrato antigo do defeito (contextoCriado true, com id): não oferece", () => {
    expect(contextoParaOferecer({ ...base, undoSnapshot: { ...retratoSemContexto, contextoId: "ctx-velho", contextoCriado: true } })).toBeNull();
  });

  it("outro campo, sugestão pendente ou ignorada, ou sem retrato: não oferece", () => {
    expect(contextoParaOferecer({ ...base, fieldType: "company" })).toBeNull();
    expect(contextoParaOferecer({ ...base, status: "pending" })).toBeNull();
    expect(contextoParaOferecer({ ...base, status: "ignored" })).toBeNull();
    expect(contextoParaOferecer({ ...base, undoSnapshot: null })).toBeNull();
    expect(contextoParaOferecer(null)).toBeNull();
  });

  it("espaços sobrando saem; nome vazio não é oferecido", () => {
    expect(contextoParaOferecer({ ...base, appliedValue: "  Feira   de Milão " })).toBe("Feira de Milão");
    expect(contextoParaOferecer({ ...base, appliedValue: "   " })).toBeNull();
  });

  it("nome que não cabe na coluna não é oferecido (nada de cortar a frase)", () => {
    expect(contextoParaOferecer({ ...base, appliedValue: "x".repeat(LIMITE_DO_NOME_DE_CONTEXTO) })).toHaveLength(LIMITE_DO_NOME_DE_CONTEXTO);
    expect(contextoParaOferecer({ ...base, appliedValue: "x".repeat(LIMITE_DO_NOME_DE_CONTEXTO + 1) })).toBeNull();
  });
});

describe("criarContextoOferecido — só depois do sim da dona", () => {
  it("confirmação: cria o contexto e o vínculo uma vez, e o retrato ganha a marca própria (nunca contextoCriado)", async () => {
    estado.respostas = [
      [linhaDaSugestao()], // a sugestão
      [[42]],              // contato vivo
      [],                  // nenhum contexto com esse nome
      [],                  // insert do contexto
      [],                  // nenhum vínculo
      [],                  // insert do vínculo
      [],                  // update do retrato
    ];

    const r = await criarContextoOferecido("sug-1", DONA);

    expect(r).toMatchObject({ resultado: "criado", nome: "Feira de Milão" });
    const insertContexto = estado.consultas.filter(c => c.sql.startsWith("insert into `contexts`"));
    expect(insertContexto).toHaveLength(1);
    expect(insertContexto[0].params).toEqual(expect.arrayContaining([DONA, "Feira de Milão"]));
    const insertVinculo = estado.consultas.filter(c => c.sql.startsWith("insert into `contact_contexts`"));
    expect(insertVinculo).toHaveLength(1);
    expect(insertVinculo[0].params).toEqual(expect.arrayContaining([DONA, 42]));

    const update = sqlDe("update `enrichment_suggestions`")!;
    const retrato = JSON.parse(String(update.params.find(p => typeof p === "string" && p.includes("how_met"))));
    expect(retrato).toMatchObject({ kind: "how_met", contextoCriado: false, contextoCriadoPelaDona: true });
    expect(retrato.contextoId).toEqual(expect.any(String));
    expect(retrato.vinculoId).toEqual(expect.any(String));
    // O UPDATE só pega a sugestão da dona que continua aplicada.
    expect(update.params).toEqual(expect.arrayContaining(["sug-1", DONA, "applied"]));
  });

  it("contexto criado no meio (outra aba): reusa o existente, só vincula, e não marca como criado pela dona", async () => {
    estado.respostas = [
      [linhaDaSugestao()],
      [[42]],
      [["ctx-existente", "feira de milao", DONA]], // alguém criou enquanto a pergunta estava na tela
      [],                                          // nenhum vínculo
      [],                                          // insert do vínculo
      [],                                          // update do retrato
    ];

    const r = await criarContextoOferecido("sug-1", DONA);

    expect(r).toMatchObject({ resultado: "ja_existia", contextoId: "ctx-existente" });
    expect(sqlDe("insert into `contexts`")).toBeUndefined();
    expect(sqlDe("insert into `contact_contexts`")!.params).toContain("ctx-existente");
    const update = sqlDe("update `enrichment_suggestions`")!;
    const retrato = JSON.parse(String(update.params.find(p => typeof p === "string" && p.includes("how_met"))));
    expect(retrato).toMatchObject({ contextoId: "ctx-existente", contextoCriado: false, contextoCriadoPelaDona: false });
  });

  it("sugestão que não existe (ou é de outra dona): nada é gravado", async () => {
    estado.respostas = [[]];
    expect(await criarContextoOferecido("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(escritas()).toHaveLength(0);
  });

  it("oferta já aceita antes (contextoId no retrato): nada é criado de novo", async () => {
    estado.respostas = [[linhaDaSugestao({ undoSnapshot: { ...retratoSemContexto, contextoId: "ctx-1", vinculoId: "vinc-1" } })]];
    expect(await criarContextoOferecido("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(escritas()).toHaveLength(0);
  });

  it("sugestão desfeita (status undone): nada é criado", async () => {
    estado.respostas = [[linhaDaSugestao({ status: "undone" })]];
    expect(await criarContextoOferecido("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(escritas()).toHaveLength(0);
  });

  it("contato apagado depois da resposta: nada é criado", async () => {
    estado.respostas = [[linhaDaSugestao()], []];
    expect(await criarContextoOferecido("sug-1", DONA)).toEqual({ resultado: "indisponivel" });
    expect(escritas()).toHaveLength(0);
  });
});
