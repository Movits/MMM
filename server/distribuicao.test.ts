import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Distribuidor do Smart Match, parte 1: o PODER.
 *
 * O distribuidor é a pessoa real que confere cada pedido de interesse antes de
 * encaminhá-lo. O poder mora em `users.isDistributor` e é um poder da CONTA, não
 * um nível: Ouro, presidente e admin sem a flag levam 403 na procedure do
 * distribuidor, e uma Prata com a flag passa. Quem concede e revoga é o Painel
 * Ouro (`distribuicao.conceder/revogar`), com auditoria de risco alto e aviso
 * no sino da pessoa. Conceder duas vezes não grava nada duas vezes.
 *
 * `./db` vira um dublê por função (molde de etapa13-trilha-de-aceite.test.ts):
 * registra cada chamada com os argumentos para o teste dizer o que NÃO pode
 * ter acontecido (banco nem consultado; nada gravado no caminho idempotente).
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as { fn: string; args: unknown[] }[],
  usuarias: {} as Record<number, { id: number; name: string | null; isDistributor: boolean }>,
  distribuidores: [] as unknown[],
  auditorias: [] as Record<string, unknown>[],
  sinoForaDoAr: false,
}));

vi.mock("./db", () => new Proxy({}, {
  has: () => true,
  get: (_alvo, prop) => {
    if (typeof prop === "symbol" || prop === "then" || prop === "default") return undefined;
    return async (...args: unknown[]) => {
      estado.chamadas.push({ fn: String(prop), args });
      if (prop === "getUserById") return estado.usuarias[args[0] as number] ?? null;
      if (prop === "listarDistribuidores") return estado.distribuidores;
      if (prop === "createNotification" && estado.sinoForaDoAr) throw new Error("sino fora do ar");
      return undefined;
    };
  },
}));
vi.mock("./security", () => ({
  createAuditLog: async (params: Record<string, unknown>) => { estado.auditorias.push(params); },
}));

const { distribuicaoRouter } = await import("./routers/distribuicao");
const { distribuidorProcedure, presidentProcedure } = await import("./routers/_procedures");
const { router } = await import("./_core/trpc");

// Um consumidor mínimo da procedure: a fila de análise chega na parte 2, e a
// régua de acesso precisa ser provada já.
const routerDeProva = router({
  fila: distribuidorProcedure.query(async () => {
    estado.chamadas.push({ fn: "consulta-da-fila", args: [] });
    return "fila";
  }),
  presidencia: presidentProcedure.query(async () => "ok"),
});

const ctx = (user: Record<string, unknown>) => ({
  user: { id: 1, openId: "conta-1", email: "t@local", name: "Conta", ...user },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

const chamadas = (fn: string) => estado.chamadas.filter(c => c.fn === fn);

beforeEach(() => {
  estado.chamadas = [];
  estado.auditorias = [];
  estado.distribuidores = [];
  estado.sinoForaDoAr = false;
  estado.usuarias = {
    7: { id: 7, name: "Dora Distribuidora", isDistributor: false },
    8: { id: 8, name: "Dina Já-Distribui", isDistributor: true },
  };
});

describe("distribuidorProcedure — o poder é da conta, não do nível", () => {
  it.each(["gold", "president", "admin"])("%s SEM a flag leva FORBIDDEN e o banco nem é consultado", async (role) => {
    const caller = routerDeProva.createCaller(ctx({ role, isDistributor: false }));
    await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chamadas("consulta-da-fila")).toEqual([]);
    expect(estado.chamadas).toEqual([]);
  });

  it("flag ausente (linha antiga, sem a coluna) conta como sem poder", async () => {
    const caller = routerDeProva.createCaller(ctx({ role: "president" }));
    await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("só `true` de verdade passa: a string ou o número 1 não valem", async () => {
    for (const valor of ["true", 1]) {
      const caller = routerDeProva.createCaller(ctx({ role: "silver", isDistributor: valor }));
      await expect(caller.fila()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it.each(["bronze", "silver", "gold"])("%s COM a flag passa", async (role) => {
    const caller = routerDeProva.createCaller(ctx({ role, isDistributor: true }));
    await expect(caller.fila()).resolves.toBe("fila");
  });

  it("a flag NÃO abre a presidência: Prata distribuidora continua fora de presidentProcedure", async () => {
    const caller = routerDeProva.createCaller(ctx({ role: "silver", isDistributor: true }));
    await expect(caller.presidencia()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sem sessão: UNAUTHORIZED antes de olhar a flag", async () => {
    const caller = routerDeProva.createCaller({ user: null, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never);
    await expect(caller.fila()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("distribuicao.listar / conceder / revogar — só Ouro, presidente ou admin", () => {
  it.each(["bronze", "silver"])("%s (mesmo distribuidora) leva FORBIDDEN nas três, sem tocar o banco", async (role) => {
    const caller = distribuicaoRouter.createCaller(ctx({ role, isDistributor: true }));
    await expect(caller.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.conceder({ userId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.revogar({ userId: 8, reason: "motivo com dez letras" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(estado.chamadas).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it.each(["gold", "president", "admin"])("%s lista quem distribui pelo helper do banco", async (role) => {
    estado.distribuidores = [{ id: 8, name: "Dina Já-Distribui", email: "dina@local", role: "silver", isActive: true }];
    const caller = distribuicaoRouter.createCaller(ctx({ role }));
    await expect(caller.listar()).resolves.toEqual(estado.distribuidores);
    expect(chamadas("listarDistribuidores")).toHaveLength(1);
  });
});

describe("distribuicao.conceder", () => {
  it("liga a flag, audita DISTRIBUTOR_GRANTED com risco alto e avisa a pessoa no sino", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ id: 1, role: "president" }));
    await expect(caller.conceder({ userId: 7, reason: "Primeira distribuidora" })).resolves.toEqual({ success: true });

    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[7, true]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 1, action: "DISTRIBUTOR_GRANTED", resource: "users", resourceId: "7",
      details: { reason: "Primeira distribuidora" }, status: "success", riskLevel: "high",
    })]);
    const [aviso] = chamadas("createNotification").map(c => c.args[0] as Record<string, unknown>);
    expect(aviso).toMatchObject({ userId: 7, type: "system", actionUrl: "/president" });
    expect(String(aviso.title)).toMatch(/distribuidor/i);
    expect(String(aviso.body)).toMatch(/Painel Ouro/);
  });

  it("é idempotente: quem já tem o poder não gera gravação, auditoria nem aviso", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "gold" }));
    await expect(caller.conceder({ userId: 8 })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(chamadas("createNotification")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("conta inexistente → NOT_FOUND, nada gravado", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "admin" }));
    await expect(caller.conceder({ userId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("a falha do sino não desfaz a concessão nem a auditoria", async () => {
    estado.sinoForaDoAr = true;
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.conceder({ userId: 7 })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[7, true]]);
    expect(estado.auditorias.map(a => a.action)).toEqual(["DISTRIBUTOR_GRANTED"]);
  });
});

describe("distribuicao.revogar", () => {
  it("exige motivo com pelo menos 10 caracteres (validação antes do banco)", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.revogar({ userId: 8, reason: "curto" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(estado.chamadas).toEqual([]);
  });

  it("desliga a flag, audita DISTRIBUTOR_REVOKED com o motivo e avisa a pessoa", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ id: 3, role: "admin" }));
    await expect(caller.revogar({ userId: 8, reason: "Saiu da equipe de distribuição" })).resolves.toEqual({ success: true });

    expect(chamadas("definirPoderDeDistribuicao").map(c => c.args)).toEqual([[8, false]]);
    expect(estado.auditorias).toEqual([expect.objectContaining({
      userId: 3, action: "DISTRIBUTOR_REVOKED", resource: "users", resourceId: "8",
      details: { reason: "Saiu da equipe de distribuição" }, riskLevel: "high",
    })]);
    const [aviso] = chamadas("createNotification").map(c => c.args[0] as Record<string, unknown>);
    expect(aviso).toMatchObject({ userId: 8, type: "system" });
    expect(String(aviso.body)).toContain("Saiu da equipe de distribuição");
  });

  it("é idempotente: revogar de quem não tem o poder não grava nem audita", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await expect(caller.revogar({ userId: 7, reason: "motivo com dez letras" })).resolves.toEqual({ success: true });
    expect(chamadas("definirPoderDeDistribuicao")).toEqual([]);
    expect(estado.auditorias).toEqual([]);
  });

  it("revogar NÃO mexe no nível: nenhuma chamada a revokeGoldAccess ou grantGoldAccess", async () => {
    const caller = distribuicaoRouter.createCaller(ctx({ role: "president" }));
    await caller.revogar({ userId: 8, reason: "motivo com dez letras" });
    expect(chamadas("revokeGoldAccess")).toEqual([]);
    expect(chamadas("grantGoldAccess")).toEqual([]);
  });
});

// ─── Pinos de fonte: a régua não pode voltar a ser "por nível" em silêncio ────
describe("pinos de fonte", () => {
  const procedures = readFileSync(new URL("./routers/_procedures.ts", import.meta.url), "utf8");
  const blocoDistribuidor = procedures.slice(procedures.indexOf("export const distribuidorProcedure"));

  it("distribuidorProcedure decide por `ctx.user.isDistributor !== true` e não menciona `role`", () => {
    expect(blocoDistribuidor).toContain("ctx.user.isDistributor !== true");
    expect(blocoDistribuidor).not.toMatch(/\brole\b/);
  });

  it("o router está registrado como `distribuicao` no appRouter", () => {
    const routers = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
    expect(routers).toContain("distribuicao: distribuicaoRouter");
  });

  it("o schema tem `users.isDistributor` boolean, padrão false e obrigatório", () => {
    const schema = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
    expect(schema).toContain('isDistributor: boolean("isDistributor").default(false).notNull()');
  });

  it("a migração 0010 adiciona a coluna com o mesmo padrão", () => {
    const migracao = readFileSync(new URL("../drizzle/0010_poder-de-distribuicao.sql", import.meta.url), "utf8");
    expect(migracao.trim()).toBe("ALTER TABLE `users` ADD `isDistributor` boolean DEFAULT false NOT NULL;");
  });
});
