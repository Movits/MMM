import { describe, expect, it, beforeEach, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * getPendingEnrichmentSuggestions — a consulta, não o mock.
 *
 * Os testes do router simulam esta função; aqui ela roda de verdade sobre um
 * cliente mysql2 falso que captura o SQL (padrão de contextos.test.ts), porque
 * o que se prova é o escopo: sessão E dona E status pendente, da mais nova
 * para a mais velha. Tirar a dona do WHERE passaria em todos os outros testes.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  respostas: [] as unknown[][],
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

const { getPendingEnrichmentSuggestions } = await import("./db");

describe("getPendingEnrichmentSuggestions — sessão, dona e status no WHERE", () => {
  beforeEach(() => { estado.consultas = []; estado.respostas = [[]]; });

  it("filtra por sessão E dona E status pendente, da mais nova para a mais velha, sem LIMIT", async () => {
    await getPendingEnrichmentSuggestions("sessao-1", "dona-1");

    const busca = estado.consultas.find(c => c.sql.includes("from `enrichment_suggestions`"));
    expect(busca).toBeDefined();
    // A cadeia inteira com `and`: um `or` no lugar de qualquer `and` (ou a dona
    // fora) devolveria sugestões de outra dona ou de outra sessão.
    expect(busca!.sql).toContain(
      "`enrichment_suggestions`.`session_id` = ? and `enrichment_suggestions`.`owner_id` = ? and `enrichment_suggestions`.`status` = ?",
    );
    expect(busca!.params).toEqual(["sessao-1", "dona-1", "pending"]);
    expect(busca!.sql).toContain("order by `enrichment_suggestions`.`created_at` desc");
    // Todas as pendentes: é o router que separa a da etapa atual das órfãs.
    expect(busca!.sql).not.toContain("limit");
  });
});
