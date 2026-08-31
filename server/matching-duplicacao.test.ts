import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { matches } from "../drizzle/schema";

/**
 * A garantia estrutural contra a duplicação de match.
 *
 * O bug: "Reanalisar matches" duplicava o conjunto inteiro a cada clique e
 * ressuscitava dispensados, porque nada no banco segurava a duplicata e o insert
 * era puro. O índice único é o que torna a duplicata impossível — mesmo que
 * alguém volte o upsert para insert puro, o banco recusa a segunda linha do par.
 * Mesmo papel do consent_active_unique na etapa 11.
 *
 * A prova de que a regeneração é GRACIOSA (upsert atualiza em vez de estourar, e
 * preserva o dispensado) está no teste de integração, que fala com o banco real.
 */
describe("Match — a duplicação é impossível no banco", () => {
  it("a tabela matches tem índice único em (userId, matchedUserId)", () => {
    const unicos = getTableConfig(matches).indexes.filter(i => i.config.unique).map(i => i.config.name);
    expect(unicos).toContain("match_user_matched_unq");
  });
});
