import { describe, expect, it, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { consents } from "../drizzle/schema";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Estes testes existem porque a versão anterior deles não valia nada.
 *
 * O mock antigo era `where: vi.fn(() => dbFalso)`: aceitava a condição e a
 * jogava fora. A resposta vinha de uma fila, na ordem das chamadas, de modo que
 * o filtro podia ser qualquer coisa — ou não existir. Teste de mutação provou
 * o estrago: apagando `isNull(revokedAt)`, apagando o filtro de usuária ou
 * apagando o filtro de versão, 4 das 5 sabotagens passavam VERDES.
 *
 * A correção é não mockar o drizzle. Aqui roda o drizzle de verdade sobre um
 * cliente mysql2 falso que captura o SQL gerado. O filtro deixa de ser
 * decorativo: some do código, some do SQL, e a asserção quebra.
 */

type Consulta = { sql: string; params: unknown[] };

let consultas: Consulta[] = [];
let respostas: unknown[][] = [];

const clienteFalso = {
  query: async (config: { sql: string }, params: unknown[] = []) => {
    consultas.push({ sql: config.sql, params });
    return [respostas.shift() ?? [], []];
  },
} as never;

const bancoDeVerdade = drizzle(clienteFalso);

vi.mock("./db", () => ({
  getDb: vi.fn(),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

const { hasValidConsent, BancoIndisponivel } = await import("./routers/consent");
const { getDb } = await import("./db");

// O drizzle pede `rowsAsArray`, então a linha falsa precisa ser um ARRAY, na
// ordem das colunas selecionadas. Devolvendo objeto, todo campo vira undefined
// e o teste passa sem ter lido nada — foi o que aconteceu na primeira versão
// deste arquivo, e é o mesmo gênero de erro que ele existe para pegar.
const DOCUMENTO_VIGENTE = [["doc-1"]];
const ACEITE_ATIVO = [[10]];

/** A segunda consulta é a que decide: a primeira só acha a versão vigente. */
const consultaDoConsentimento = () => consultas[1];

describe("Etapa 11 — a consulta que decide o acesso ao Smart Match", () => {
  beforeEach(() => {
    consultas = [];
    respostas = [];
    vi.mocked(getDb).mockResolvedValue(bancoDeVerdade as never);
  });

  it("procura o documento vigente daquele tipo, e não um documento qualquer", async () => {
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];
    await hasValidConsent(1, "termo_smart_match");

    expect(consultas[0].sql).toContain("`document_versions`");
    expect(consultas[0].sql).toContain("`type` = ?");
    expect(consultas[0].sql).toContain("`isCurrent` = ?");
    expect(consultas[0].params).toContain("termo_smart_match");
  });

  it("exige que o consentimento seja DAQUELA usuária", async () => {
    // Sem este filtro, o aceite de qualquer pessoa liberaria todo mundo.
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];
    await hasValidConsent(4242, "termo_smart_match");

    expect(consultaDoConsentimento().sql).toContain("`consents`.`userId` = ?");
    expect(consultaDoConsentimento().params).toContain(4242);
  });

  it("exige que o consentimento seja DA VERSÃO vigente", async () => {
    // Sem este filtro, quem aceitou a versão 1 seguiria liberado na versão 2 —
    // e o termo novo nunca chegaria a ser apresentado a ninguém.
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];
    await hasValidConsent(1, "termo_smart_match");

    expect(consultaDoConsentimento().sql).toContain("`consents`.`documentVersionId` = ?");
    expect(consultaDoConsentimento().params).toContain("doc-1");
  });

  it("exige que o consentimento NÃO esteja revogado", async () => {
    // É este filtro que faz revogar ter efeito imediato. Sem ele, revogar não
    // desliga nada e a linha revogada continua liberando o cruzamento.
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];
    await hasValidConsent(1, "termo_smart_match");

    expect(consultaDoConsentimento().sql).toContain("`consents`.`revokedAt` is null");
  });

  it("as três condições valem JUNTAS, não alternadas", async () => {
    // `or` no lugar de `and` satisfaria cada asserção acima isoladamente.
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];
    await hasValidConsent(1, "termo_smart_match");

    const sql = consultaDoConsentimento().sql;
    expect(sql).toMatch(/userId` = \? and .*documentVersionId` = \? and .*revokedAt` is null/);
    expect(sql).not.toContain(" or ");
  });
});

describe("Etapa 11 — as respostas de hasValidConsent", () => {
  beforeEach(() => {
    consultas = [];
    respostas = [];
    vi.mocked(getDb).mockResolvedValue(bancoDeVerdade as never);
  });

  it("libera enquanto não existe termo publicado", async () => {
    // Enquanto o texto jurídico não fica pronto, exigir aceite desligaria o
    // recurso de todo mundo. Sem documento vigente, não há o que consentir.
    respostas = [[]];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(true);
    expect(consultas).toHaveLength(1); // nem chega a perguntar pelo consentimento
  });

  it("barra quando há termo vigente e nenhum aceite", async () => {
    respostas = [DOCUMENTO_VIGENTE, []];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(false);
  });

  it("libera com aceite ativo na versão vigente", async () => {
    respostas = [DOCUMENTO_VIGENTE, ACEITE_ATIVO];

    expect(await hasValidConsent(1, "termo_smart_match")).toBe(true);
  });

  it("barra quando o banco está fora do ar, em vez de liberar por engano", async () => {
    // O erro anterior morava aqui: banco indisponível devolvia null, null era
    // lido como "não há documento publicado", e "não há documento" libera. Uma
    // queda do banco abria o cruzamento para todo mundo.
    vi.mocked(getDb).mockResolvedValue(null as never);

    await expect(hasValidConsent(1, "termo_smart_match")).rejects.toThrow(BancoIndisponivel);
    expect(consultas).toHaveLength(0);
  });
});

describe("Etapa 11 — a unicidade que o código não consegue garantir sozinho", () => {
  it("o schema declara o índice único do consentimento ativo", () => {
    // Entre a conferência e o insert de `accept` cabe outra requisição: dois
    // cliques simultâneos gravavam duas linhas. Só uma restrição do banco
    // resolve corrida. Medido com 10 inserções concorrentes: 1 grava, 9 são
    // recusadas pelo índice.
    const unicos = getTableConfig(consents).indexes.filter(i => i.config.unique).map(i => i.config.name);
    expect(unicos).toContain("consent_active_unique");
  });

  it("a chave da unicidade some quando o consentimento é revogado", () => {
    // É o que preserva revogar-e-aceitar-de-novo. Um UNIQUE simples sobre
    // (userId, documentVersionId) proibiria esse fluxo, que o termo promete.
    const coluna = getTableConfig(consents).columns.find(c => c.name === "activeKey");
    expect(coluna).toBeDefined();
    const expressao = JSON.stringify(coluna?.generated?.as);
    expect(expressao).toContain("revokedAt");
    expect(expressao).toContain("IS NULL");
    expect(expressao).toContain("documentVersionId");
  });
});
