import { describe, expect, it, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { aplicarRespostaAoContato } from "./db";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O contrato de aplicarRespostaAoContato: cada resposta do chat de
 * enriquecimento tem um destino de verdade, e a função diz a verdade sobre ter
 * gravado ou não.
 *
 * Existe por causa de um defeito que passou meses invisível: a versão anterior
 * marcava a sugestão como "applied" e jogava fora as respostas de assets,
 * needs, how_met e relationship_type — justamente o que alimenta o Cruzamento
 * Inteligente. 18 respostas confirmadas se perderam sem um erro sequer.
 *
 * Mesmo padrão dos testes do consentimento: drizzle de verdade sobre um cliente
 * mysql2 falso que captura o SQL. Sabotagem no destino muda o SQL e quebra.
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

const db = drizzle(clienteFalso) as never as Parameters<typeof aplicarRespostaAoContato>[0];

const sqlDe = (trecho: string) => consultas.find(c => c.sql.includes(trecho));

describe("Enriquecimento — cada resposta chega ao seu destino", () => {
  beforeEach(() => { consultas = []; respostas = []; });

  it("'o que possui' vira linha em contact_assets, com slug e rótulo", async () => {
    respostas = [[], []]; // não existe ainda; insert
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "Fábrica de calçados", 1000);

    expect(gravou).toBe(true);
    const insert = sqlDe("insert into `contact_assets`");
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("fabrica-de-calcados");
    expect(insert!.params).toContain("Fábrica de calçados");
    expect(insert!.params).toContain("dona-1");
    expect(insert!.params).toContain(42);
  });

  it("'o que procura' vira linha em contact_needs", async () => {
    respostas = [[], []];
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "needs", "investidores", 1000);

    expect(gravou).toBe(true);
    expect(sqlDe("insert into `contact_needs`")).toBeDefined();
    expect(sqlDe("insert into `contact_assets`")).toBeUndefined();
  });

  it("confirmar duas vezes não duplica: o item existente barra o insert", async () => {
    // A base real tinha "fabrica" confirmada CINCO vezes no mesmo contato.
    respostas = [[[7]]]; // o select de existência devolve uma linha
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "fabrica", 1000);

    expect(gravou).toBe(false);
    expect(consultas.some(c => c.sql.startsWith("insert"))).toBe(false);
  });

  it("a busca de duplicata é pelo slug, do dono e do contato certos", async () => {
    respostas = [[], []];
    await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "FÁBRICA", 1000);

    const busca = sqlDe("select `id` from `contact_assets`");
    expect(busca).toBeDefined();
    expect(busca!.sql).toContain("`owner_id` = ?");
    expect(busca!.sql).toContain("`contact_id` = ?");
    expect(busca!.sql).toContain("`tag_slug` = ?");
    expect(busca!.params).toEqual(expect.arrayContaining(["dona-1", 42, "fabrica"]));
  });

  it("'como se conheceram' entra nas anotações do contato, uma vez só", async () => {
    respostas = [[[null]]]; // notes atual: null
    const gravou = await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Em um evento", 1000);

    expect(gravou).toBe(true);
    const update = sqlDe("update `private_contacts`");
    expect(update).toBeDefined();
    expect(String(update!.params[0])).toContain("Como se conheceram: Em um evento");

    // segunda vez: a linha já está lá
    consultas = []; respostas = [[["Como se conheceram: Em um evento"]]];
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "how_met", "Em um evento", 1000)).toBe(false);
    expect(sqlDe("update `private_contacts`")).toBeUndefined();
  });

  it("instagram vai para a coluna que existe", async () => {
    // O mapa antigo apontava para `instagramHandle`, coluna inexistente — a
    // primeira sugestão de instagram confirmada teria quebrado em produção.
    respostas = [[]];
    await aplicarRespostaAoContato(db, "dona-1", 42, "instagram_handle", "@empresa", 1000);

    const update = sqlDe("update `private_contacts`");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("`instagram` = ?");
  });

  it("tipo sem destino lança em vez de fingir sucesso", async () => {
    await expect(aplicarRespostaAoContato(db, "dona-1", 42, "tipo_invenido", "x", 1000))
      .rejects.toThrow(/sem destino/);
  });

  it("valor vazio não grava nada e diz que não gravou", async () => {
    expect(await aplicarRespostaAoContato(db, "dona-1", 42, "assets", "   ", 1000)).toBe(false);
    expect(consultas).toHaveLength(0);
  });
});
