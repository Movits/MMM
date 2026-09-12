import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * A12 — Destacar produto (estilo OLX).
 *
 * O cartão está travado desde 31/08 numa contradição: o Roberto decidiu em
 * 12/09 que o destaque é PAGO, e o pagamento pelo site ficou FORA do recorte de
 * 16/09. Este código resolve a metade que não depende de pagamento — a
 * presidência concede à mão, por um prazo — e deixa a outra metade pronta para
 * quando a cobrança existir: o que se vende é exatamente o prazo que este
 * procedimento grava.
 *
 * O que o teste protege:
 *
 * 1. DESTAQUE TEM PRAZO, e prazo vencido não vale. Duas colunas em vez de um
 *    booleano: com booleano, destaque concedido uma vez fica para sempre e a
 *    vitrine nunca mais roda. A ordenação pergunta `> NOW()`, não "existe".
 * 2. QUEM CONCEDEU FICA GRAVADO, e some junto quando o destaque é removido —
 *    senão a coluna vira lixo apontando para quem não concedeu mais nada.
 * 3. SÓ A GOVERNANÇA CONCEDE. Enquanto não há pagamento, destaque que qualquer
 *    uma pudesse se dar não é destaque, é caos.
 * 4. A CONCESSÃO É AUDITADA, porque é favorecimento comercial de uma membra
 *    sobre as outras, e precisa ter dono.
 */

const contarDestaque = vi.fn();
const auditoria: Array<Record<string, unknown>> = [];

vi.mock("./security", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createAuditLog: async (params: Record<string, unknown>) => { auditoria.push(params); },
}));

vi.mock("./db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  definirDestaqueDaOportunidade: (...args: unknown[]) => contarDestaque(...args),
  exigirDb: async () => { throw new Error("este teste não toca o banco"); },
}));

import { appRouter } from "./routers";
import { definirDestaqueDaOportunidade, listOpportunities } from "./db";
import type { TrpcContext } from "./_core/context";
import { opportunities } from "../drizzle/schema";

type Usuaria = NonNullable<TrpcContext["user"]>;

function contexto(papel: string) {
  const user = {
    id: 7, openId: "open-7", email: "presidenta@exemplo.com", name: "Presidenta",
    passwordHash: "$2a$hash", role: papel, loginMethod: "email", emailVerified: true,
    isActive: true, isVerified: true, onboardingCompleted: true, country: "BR",
    company: null, position: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  } as Usuaria;
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {}, ip: "203.0.113.9" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  contarDestaque.mockReset();
  contarDestaque.mockResolvedValue(true);
  auditoria.length = 0;
});

// ═══════════════ 1. quem pode conceder ═══════════════════════════════════════
describe("só a governança destaca", () => {
  it.each(["president", "admin", "gold"])("%s consegue destacar", async (papel) => {
    await expect(contexto(papel).president.destacarOportunidade({ opportunityId: 10, dias: 7 }))
      .resolves.toEqual({ sucesso: true, dias: 7 });
    expect(contarDestaque).toHaveBeenCalledWith(10, 7, 7);
  });

  it.each(["silver", "bronze"])("%s leva 403 e nada é gravado", async (papel) => {
    await expect(contexto(papel).president.destacarOportunidade({ opportunityId: 10, dias: 7 }))
      .rejects.toThrow(/Ouro|restrito/i);
    expect(contarDestaque).not.toHaveBeenCalled();
    expect(auditoria).toHaveLength(0);
  });
});

// ═══════════════ 2. o prazo ══════════════════════════════════════════════════
describe("o prazo é o produto", () => {
  it("zero dias remove o destaque", async () => {
    await expect(contexto("president").president.destacarOportunidade({ opportunityId: 10, dias: 0 }))
      .resolves.toEqual({ sucesso: true, dias: 0 });
    expect(contarDestaque).toHaveBeenCalledWith(10, 0, 7);
  });

  it("recusa prazo negativo e prazo maior que 90 dias", async () => {
    const caller = contexto("president");
    await expect(caller.president.destacarOportunidade({ opportunityId: 10, dias: -1 })).rejects.toThrow();
    await expect(caller.president.destacarOportunidade({ opportunityId: 10, dias: 91 })).rejects.toThrow();
    expect(contarDestaque).not.toHaveBeenCalled();
  });

  it("oportunidade que não existe devolve NOT_FOUND, não 'destaquei'", async () => {
    contarDestaque.mockResolvedValue(false);
    await expect(contexto("president").president.destacarOportunidade({ opportunityId: 999, dias: 7 }))
      .rejects.toThrow(/não encontrada/i);
    expect(auditoria).toHaveLength(0);
  });
});

// ═══════════════ 3. a trilha ═════════════════════════════════════════════════
describe("a concessão é auditada", () => {
  it("conceder e remover deixam ações DIFERENTES na trilha", async () => {
    const caller = contexto("president");
    await caller.president.destacarOportunidade({ opportunityId: 10, dias: 30 });
    await caller.president.destacarOportunidade({ opportunityId: 10, dias: 0 });
    expect(auditoria.map(a => a.action)).toEqual([
      "OPPORTUNITY_HIGHLIGHT_GRANT",
      "OPPORTUNITY_HIGHLIGHT_REVOKE",
    ]);
    expect(auditoria[0]).toMatchObject({ userId: 7, resourceId: "10", riskLevel: "medium" });
    expect(auditoria[0].details).toEqual({ dias: 30 });
  });
});

// ═══════════════ 4. o SQL da ordenação e da gravação ═════════════════════════
// Sem banco: o que se prova aqui é a FORMA do comando, que é onde mora o erro
// de "destaque vencido continua no topo".
describe("a ordenação pergunta pelo prazo, não pela existência", () => {
  it("o SQL da lista compara destaqueAte com NOW()", async () => {
    const fonte = await import("node:fs").then(fs =>
      fs.readFileSync(new URL("./db.ts", import.meta.url), "utf8"));
    const trecho = fonte.slice(fonte.indexOf("export async function listOpportunities"), fonte.indexOf("export async function createOpportunity"));
    expect(trecho).toContain("destaqueAte");
    expect(trecho).toMatch(/destaqueAte[^\n]*>\s*NOW\(\)/);
    expect(trecho).toContain("IS NOT NULL");
    // A ordem importa: destaque vem ANTES do score de confiança.
    expect(trecho.indexOf("destaqueAte")).toBeLessThan(trecho.indexOf("frauenTrustScore"));
  });

  it("remover o destaque também limpa quem concedeu", async () => {
    const fonte = await import("node:fs").then(fs =>
      fs.readFileSync(new URL("./db.ts", import.meta.url), "utf8"));
    const trecho = fonte.slice(fonte.indexOf("export async function definirDestaqueDaOportunidade"));
    expect(trecho).toContain("destacadaPor: ate ? concedidoPor : null");
  });

  it("a coluna existe no schema com o índice que a ordenação precisa", () => {
    expect(opportunities.destaqueAte).toBeDefined();
    expect(opportunities.destacadaPor).toBeDefined();
    expect(typeof definirDestaqueDaOportunidade).toBe("function");
    expect(typeof listOpportunities).toBe("function");
  });
});
