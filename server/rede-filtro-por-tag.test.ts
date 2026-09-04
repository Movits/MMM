import { describe, expect, it, beforeEach, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Base Particular (etapa 1) — o filtro por tag de perfil roda NA CONSULTA.
 *
 * Auditoria de 04/09: listPrivateContacts lia a página (LIMIT/OFFSET) e só
 * depois filtrava a tag em memória, e o COUNT ignorava a tag. Com 25 contatos
 * e 3 "Diplomata" entre os menos recentes, o chip mostrava "Nenhum contato
 * encontrado" ao lado de "25 contatos encontrados / Página 1 de 2".
 *
 * Mesmo padrão de contextos.test.ts: drizzle de verdade sobre um cliente
 * mysql2 falso que captura o SQL — o que se prova é a consulta.
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

const { listPrivateContacts } = await import("./db");

const consultaDaPagina = () => estado.consultas.find(c => c.sql.includes("limit ?"));
const consultaDoTotal = () => estado.consultas.find(c => /count\(\*\)/i.test(c.sql));

describe("Rede — filtro por tag é da consulta, e o total respeita o filtro", () => {
  beforeEach(() => { estado.consultas = []; estado.respostas = []; });

  it("com tag, a página E o total levam JSON_CONTAINS com a tag como parâmetro", async () => {
    estado.respostas = [[], [[3]]];
    const r = await listPrivateContacts("dona-1", { tag: "Diplomata", page: 1, limit: 20 });

    expect(r.total).toBe(3);
    const pagina = consultaDaPagina();
    const total = consultaDoTotal();
    expect(pagina).toBeDefined();
    expect(total).toBeDefined();
    for (const consulta of [pagina!, total!]) {
      // CONVERT USING utf8mb4: no MariaDB a coluna json é texto no charset da
      // tabela e o JSON_CONTAINS compara bytes — sem isto, tag com acento
      // ("Saúde") nunca casaria numa tabela latin1.
      expect(consulta.sql).toContain("JSON_CONTAINS(CONVERT(`private_contacts`.`profileTags` USING utf8mb4), JSON_QUOTE(?))");
      // dona SEMPRE, e a tag como parâmetro (nunca interpolada)
      expect(consulta.params).toEqual(expect.arrayContaining(["dona-1", "Diplomata"]));
      expect(consulta.sql).not.toContain("Diplomata");
    }
    // a página tem LIMIT (o drizzle omite OFFSET 0); o total não
    expect(pagina!.sql).toContain("limit ?");
    expect(pagina!.params).toEqual(expect.arrayContaining([20]));
    expect(total!.sql).not.toContain("limit");
  });

  it("a página 2 leva OFFSET junto com a tag — quem estava na página 2 aparece lá, não some", async () => {
    estado.respostas = [[], [[25]]];
    const r = await listPrivateContacts("dona-1", { tag: "Diplomata", page: 2, limit: 20 });

    expect(r.total).toBe(25);
    const pagina = consultaDaPagina();
    expect(pagina!.sql).toContain("JSON_CONTAINS(");
    expect(pagina!.params).toEqual(expect.arrayContaining(["Diplomata", 20, 20]));
  });

  it("sem tag, nenhuma das duas consultas menciona JSON_CONTAINS", async () => {
    estado.respostas = [[], [[7]]];
    const r = await listPrivateContacts("dona-1", { page: 1, limit: 20 });

    expect(r.total).toBe(7);
    for (const consulta of estado.consultas) expect(consulta.sql).not.toContain("JSON_CONTAINS");
  });

  it("a dona continua no WHERE das duas consultas mesmo com tag e busca livre", async () => {
    estado.respostas = [[], [[1]]];
    await listPrivateContacts("dona-1", { q: "Ana", tag: "Diplomata", country: "Brasil" });

    for (const consulta of [consultaDaPagina()!, consultaDoTotal()!]) {
      expect(consulta.sql).toContain("`private_contacts`.`ownerId` = ?");
      expect(consulta.params[0]).toBe("dona-1");
    }
  });
});
