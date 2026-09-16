import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Governança (spec da Glenda de 14/09/2026, decisão do Roberto no mesmo dia):
 * o SQL de verdade que as rotas geram, sobre um cliente mysql2 falso que o
 * captura (molde de etapa10-gestao-ouro.test.ts).
 *
 *  1. Cadastro nasce Bronze.
 *  2. A promoção Bronze → Prata é um UPDATE condicional a `role = 'bronze'`:
 *     não passa por cima de Ouro nem de mudança manual feita no meio.
 *  3. Membros por nível (item 12): só contagens, só para quem está logada, e
 *     Ouro soma presidente e admin ("Ouro = Presidente = administradora").
 *     A consulta pública da plataforma não devolve mais esses números (item 1).
 *  4. A Gestão Ouro lista Bronze E Prata numa consulta só: Ouro é adesão à
 *     categoria premium, não degrau depois da Prata (item 8).
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  linhasAfetadas: 1,
  niveis: [] as unknown[][],
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      const sql = config.sql.toLowerCase();
      if (sql.startsWith("update")) return [{ affectedRows: estado.linhasAfetadas }, undefined];
      if (sql.startsWith("insert")) return [{ insertId: 99, affectedRows: 1 }, undefined];
      if (sql.includes("group by `users`.`role`")) return [estado.niveis, []];
      if (/count\(/.test(sql)) return [[[7]], []];
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

// president.ts importa matching.ts (LLM e e-mail); nada daqui o usa.
vi.mock("./routers/matching", () => ({
  notifyHighCompatibilityForOpportunity: async () => ({ notified: 0 }),
}));

const { registerUser } = await import("./auth");
const { promoverBronzeAPrata } = await import("./db");
const { statsRouter, somarMembrosPorNivel } = await import("./routers/stats");
const { presidentRouter } = await import("./routers/president");

const req = { headers: {}, socket: {} };
const res = { cookie: () => {} };
const logada = { user: { id: 3, openId: "u-3", email: "u@local", role: "bronze", name: "Bia" }, req, res } as never;
const anonima = { user: null, req, res } as never;
const presidente = { user: { id: 1, openId: "p-1", email: "p@local", role: "president", name: "Presidente" }, req, res } as never;

beforeEach(() => {
  estado.consultas = [];
  estado.linhasAfetadas = 1;
  estado.niveis = [];
});

describe("cadastro nasce Bronze", () => {
  it("registerUser grava role 'bronze', nunca 'silver'", async () => {
    await registerUser({ name: "Nova Membra", email: "nova@exemplo.com", password: "senha-forte-123" });

    const insercao = estado.consultas.find(c => c.sql.toLowerCase().startsWith("insert into `users`"));
    expect(insercao).toBeDefined();
    expect(insercao!.params).toContain("bronze");
    expect(insercao!.params).not.toContain("silver");
  }, 20_000);
});

describe("promoverBronzeAPrata", () => {
  it("é um UPDATE para 'silver' condicional ao id E a role = 'bronze'", async () => {
    expect(await promoverBronzeAPrata(5)).toBe(true);

    const [update] = estado.consultas;
    expect(update.sql).toContain("update `users` set `role` = ?");
    expect(update.sql).toContain("where (`users`.`id` = ? and `users`.`role` = ?)");
    expect(update.params).toEqual(["silver", 5, "bronze"]);
  });

  it("nenhuma linha casou (já não era Bronze): devolve false", async () => {
    estado.linhasAfetadas = 0;
    expect(await promoverBronzeAPrata(5)).toBe(false);
  });
});

describe("membros por nível (item 12)", () => {
  it("conta por nível numa consulta só, sem coluna de pessoa, e Ouro soma presidente e admin", async () => {
    estado.niveis = [["bronze", 3], ["silver", 25], ["gold", 1], ["president", 2], ["admin", 1]];

    const r = await statsRouter.createCaller(logada).membrosPorNivel();

    expect(r).toEqual({ bronze: 3, silver: 25, gold: 4 });
    expect(estado.consultas).toHaveLength(1);
    const { sql } = estado.consultas[0];
    expect(sql).toContain("group by `users`.`role`");
    for (const pessoal of ["`name`", "`email`", "`openId`", "`country`", "`company`"]) {
      expect(sql, pessoal).not.toContain(pessoal);
    }
  });

  it("outra resposta do banco, outros números: nada cravado", async () => {
    estado.niveis = [["bronze", 40], ["silver", 2]];
    expect(await statsRouter.createCaller(logada).membrosPorNivel()).toEqual({ bronze: 40, silver: 2, gold: 0 });
  });

  it("sem sessão: UNAUTHORIZED, e o banco nem é consultado", async () => {
    await expect(statsRouter.createCaller(anonima).membrosPorNivel()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(estado.consultas).toEqual([]);
  });

  it("a consulta pública da plataforma não devolve mais contagem por nível", async () => {
    const r = await statsRouter.createCaller(anonima).platform();
    expect(Object.keys(r).sort()).toEqual(["connections", "countries", "opportunities", "users"]);
    expect(estado.consultas.map(c => c.sql).join("\n")).not.toContain("`role`");
  });

  it("somarMembrosPorNivel: papel desconhecido não entra, total em texto vira número", () => {
    expect(somarMembrosPorNivel([
      { role: "bronze", total: "2" }, { role: "admin", total: 1 }, { role: "moderadora", total: 50 }, { role: "silver", total: null },
    ])).toEqual({ bronze: 2, silver: 0, gold: 1 });
  });
});

describe("Gestão Ouro lista Bronze e Prata (item 8)", () => {
  const WHERE = "where (`users`.`role` in (?, ?) and (`users`.`name` like ? or `users`.`email` like ?))";

  it("`roles` vira IN na página E no COUNT, com os mesmos parâmetros", async () => {
    const r = await presidentRouter.createCaller(presidente).listAllUsers({ roles: ["bronze", "silver"], search: "ana" });

    const pagina = estado.consultas.find(c => c.sql.includes("from `users`") && !/count\(/i.test(c.sql));
    const contagem = estado.consultas.find(c => c.sql.includes("from `users`") && /count\(/i.test(c.sql));
    expect(pagina!.sql).toContain(WHERE);
    expect(pagina!.params).toEqual(["bronze", "silver", "%ana%", "%ana%", 100]);
    expect(contagem!.sql).toContain(WHERE);
    expect(contagem!.params).toEqual(["bronze", "silver", "%ana%", "%ana%"]);
    expect(r.total).toBe(7);
  });

  it("lista de níveis vazia é recusada (seria 'todo mundo' por engano)", async () => {
    await expect(presidentRouter.createCaller(presidente).listAllUsers({ roles: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(estado.consultas).toEqual([]);
  });

  it("só Ouro (presidente, admin ou gold) consulta: Bronze leva FORBIDDEN", async () => {
    await expect(presidentRouter.createCaller(logada).listAllUsers({ roles: ["bronze", "silver"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
