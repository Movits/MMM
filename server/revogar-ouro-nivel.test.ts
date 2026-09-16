import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { userProfiles } from "../drizzle/schema";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Revogar o Ouro devolve a pessoa ao nível que o PERFIL sustenta (Governança,
 * 14/09/2026: "Prata vem pela qualidade do perfil"). Com a Gestão Ouro
 * concedendo Ouro também a Bronze, gravar 'silver' sempre transformava um
 * cadastro sem bio e sem "O que preciso" em Membra Prata na revogação.
 *
 * O SQL de verdade que a função gera, sobre um cliente mysql2 falso (molde de
 * governanca-niveis.test.ts). O perfil volta como ARRAY na ordem das colunas
 * (o drizzle pede `rowsAsArray`; objeto viraria tudo undefined e o teste
 * passaria sem ler nada).
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  perfil: null as Record<string, unknown> | null,
  auditorias: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const { getTableColumns: colunasDe } = await import("drizzle-orm");
  const { userProfiles: tabelaDePerfis } = await import("../drizzle/schema");
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      const sql = config.sql.toLowerCase();
      if (sql.startsWith("update")) return [{ affectedRows: 1 }, undefined];
      if (sql.startsWith("insert")) return [{ insertId: 99, affectedRows: 1 }, undefined];
      if (sql.includes("from `user_profiles`")) {
        if (!estado.perfil) return [[], []];
        const linha = Object.keys(colunasDe(tabelaDePerfis)).map(chave => estado.perfil![chave] ?? null);
        return [[linha], []];
      }
      return [[], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

vi.mock("./security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./security")>()),
  createAuditLog: async (dados: Record<string, unknown>) => { estado.auditorias.push(dados); },
}));

// president.ts importa matching.ts (LLM e e-mail); nada daqui o usa.
vi.mock("./routers/matching", () => ({
  notifyHighCompatibilityForOpportunity: async () => ({ notified: 0 }),
}));

const { revokeGoldAccess } = await import("./db");
const { presidentRouter } = await import("./routers/president");

const req = { headers: {}, socket: {} };
const res = { cookie: () => {} };
const presidente = { user: { id: 1, openId: "p-1", email: "p@local", role: "president", name: "Presidente" }, req, res } as never;

const PERFIL_QUALIFICADO = {
  id: 40,
  userId: 5,
  displayName: "Ana Souza",
  city: "Lisboa",
  activityArea: "Comércio exterior",
  bio: "Advogada tributarista, atendo empresas familiares que exportam café para a Europa.",
  whatIHave: JSON.stringify(["canais_comerciais"]),
  whatINeed: JSON.stringify(["fornecedores"]),
};

/** O UPDATE de `users` (o outro é o de gold_access_grants). */
const updateDoNivel = () => estado.consultas.find(c => c.sql.toLowerCase().startsWith("update `users`"));

beforeEach(() => {
  estado.consultas = [];
  estado.perfil = null;
  estado.auditorias = [];
});

describe("revokeGoldAccess grava o nível que o perfil sustenta", () => {
  it("a linha falsa tem uma posição por coluna de user_profiles (senão o teste não leria nada)", () => {
    expect(Object.keys(getTableColumns(userProfiles))).toContain("whatINeed");
  });

  it("perfil qualificado: volta a Prata", async () => {
    estado.perfil = PERFIL_QUALIFICADO;

    expect(await revokeGoldAccess(5, 1, "motivo da revogação")).toBe("silver");

    const update = updateDoNivel();
    expect(update!.sql).toContain("update `users` set `role` = ?");
    expect(update!.params).toEqual(["silver", 5]);
  });

  it("cadastro novo sem perfil (Bronze que recebeu Ouro): volta a Bronze, não a Prata", async () => {
    estado.perfil = null;

    expect(await revokeGoldAccess(5, 1, "motivo da revogação")).toBe("bronze");
    expect(updateDoNivel()!.params).toEqual(["bronze", 5]);
  });

  it("perfil sem bio e sem O que preciso: Bronze", async () => {
    estado.perfil = { ...PERFIL_QUALIFICADO, bio: null, whatINeed: JSON.stringify([]) };

    expect(await revokeGoldAccess(5, 1, "motivo da revogação")).toBe("bronze");
    expect(updateDoNivel()!.params).toEqual(["bronze", 5]);
  });

  it("o perfil lido é o da pessoa revogada, e a concessão é fechada antes", async () => {
    estado.perfil = PERFIL_QUALIFICADO;
    await revokeGoldAccess(5, 1, "motivo da revogação");

    const ordem = estado.consultas.map(c => c.sql.toLowerCase().split(" ").slice(0, 3).join(" "));
    expect(ordem[0]).toBe("update `gold_access_grants` set");
    const leitura = estado.consultas.find(c => c.sql.includes("from `user_profiles`"))!;
    expect(leitura.params[0]).toBe(5);
    expect(estado.consultas.indexOf(leitura)).toBeLessThan(estado.consultas.indexOf(updateDoNivel()!));
  });
});

describe("president.revokeGold devolve e audita o nível de volta", () => {
  it.each([
    [PERFIL_QUALIFICADO, "silver"],
    [null, "bronze"],
  ] as const)("perfil %#: novoNivel = %s na resposta e na auditoria", async (perfil, esperado) => {
    estado.perfil = perfil;

    const r = await presidentRouter.createCaller(presidente).revokeGold({ userId: 5, reason: "motivo da revogação" });

    expect(r).toEqual({ success: true, novoNivel: esperado });
    const auditoria = estado.auditorias.find(a => a.action === "PRESIDENT_REVOKE_GOLD");
    expect(auditoria?.details).toEqual({ reason: "motivo da revogação", newRole: esperado });
    expect(updateDoNivel()!.params).toEqual([esperado, 5]);
  });
});
