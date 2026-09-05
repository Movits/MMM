import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Etapa 10 — gestão de Ouro: a busca de membras roda NO BANCO e o total é
 * o COUNT real.
 *
 * `president.listAllUsers` aceitava `search` e o ignorava: a consulta saía
 * `where role = ? order by createdAt desc limit 100`, `total` era o tamanho da
 * página, e o Painel Ouro filtrava em memória sobre as 100 mais recentes. A
 * membra Prata mais antiga que a 100ª não podia receber Ouro nem ser nomeada
 * líder — "Nenhuma membra encontrada", sem erro nenhum.
 *
 * Rota real via createCaller, drizzle de verdade sobre um cliente mysql2 falso
 * que captura o SQL (molde de contextos.test.ts).
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  totalNoBanco: 7,
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      // A página e a contagem saem em paralelo (Promise.all); a resposta é
      // decidida pelo conteúdo para não depender da ordem de chegada.
      const ehContagem = /count\(\*\)/i.test(config.sql);
      return [ehContagem ? [[estado.totalNoBanco]] : [], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

// president.ts importa matching.ts (LLM e e-mail); listAllUsers não o usa.
vi.mock("./routers/matching", () => ({
  notifyHighCompatibilityForOpportunity: async () => ({ notified: 0 }),
}));

const { presidentRouter } = await import("./routers/president");

const ctxPresidente = {
  user: { id: 1, openId: "presidente-1", email: "p@local", role: "president", name: "Presidente" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

const pagina = () => estado.consultas.find(c => c.sql.includes("from `users`") && !/count\(\*\)/i.test(c.sql));
const contagem = () => estado.consultas.find(c => c.sql.includes("from `users`") && /count\(\*\)/i.test(c.sql));

beforeEach(() => { estado.consultas = []; });

// O WHERE inteiro, com a conjunção: papel E (nome OU e-mail). Um `and`
// trocado por `or` passaria por `toContain` de fragmentos soltos.
const WHERE_ESPERADO = "where (`users`.`role` = ? and (`users`.`name` like ? or `users`.`email` like ?))";

describe("Etapa 10 — president.listAllUsers busca no banco", () => {
  it("`search` vira LIKE em nome E e-mail, junto com o papel", async () => {
    const caller = presidentRouter.createCaller(ctxPresidente);
    await caller.listAllUsers({ role: "silver", search: "ana" });

    const consulta = pagina();
    expect(consulta).toBeDefined();
    expect(consulta!.sql).toContain(WHERE_ESPERADO);
    expect(consulta!.sql).toContain("limit ?");
    // Os params exatos e na ordem: o termo vai DUAS vezes (nome e e-mail) e o
    // limite padrão continua 100; o drizzle omite o offset 0.
    expect(consulta!.params).toEqual(["silver", "%ana%", "%ana%", 100]);
  });

  it("o total é o COUNT(*) com as MESMAS condições, não o tamanho da página", async () => {
    const caller = presidentRouter.createCaller(ctxPresidente);
    const r = await caller.listAllUsers({ role: "silver", search: "ana" });

    const conta = contagem();
    expect(conta).toBeDefined();
    expect(conta!.sql).toContain(WHERE_ESPERADO);
    expect(conta!.sql).not.toContain("limit");
    expect(conta!.params).toEqual(["silver", "%ana%", "%ana%"]);
    expect(r.users).toEqual([]);
    expect(r.total).toBe(7); // veio do COUNT; a página está vazia
  });

  it.each([
    ["a_L", "%a\\_L%"],
    ["100%", "%100\\%%"],
    ["c:\\x", "%c:\\\\x%"],
  ])("os curingas do LIKE são escapados no termo: %j vira %j (página e COUNT)", async (busca, esperado) => {
    const caller = presidentRouter.createCaller(ctxPresidente);
    await caller.listAllUsers({ role: "silver", search: busca });

    // Sem o escape, "a_L" casava "abL" e "%" casava todo mundo.
    expect(pagina()!.params).toEqual(["silver", esperado, esperado, 100]);
    expect(contagem()!.params).toEqual(["silver", esperado, esperado]);
  });

  it("sem busca nem papel, nada de LIKE — e o COUNT continua vindo", async () => {
    const caller = presidentRouter.createCaller(ctxPresidente);
    const r = await caller.listAllUsers({});

    expect(pagina()!.sql).not.toContain("like");
    expect(pagina()!.sql).not.toContain("where");
    expect(contagem()).toBeDefined();
    expect(r.total).toBe(7);
  });

  it("a página traz isVerified e onboardingCompleted (o painel já os esperava)", async () => {
    const caller = presidentRouter.createCaller(ctxPresidente);
    await caller.listAllUsers({ role: "silver" });
    expect(pagina()!.sql).toContain("`isVerified`");
    expect(pagina()!.sql).toContain("`onboardingCompleted`");
  });
});
