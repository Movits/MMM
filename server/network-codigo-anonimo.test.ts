import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
process.env.DATABASE_URL ??= "mysql://teste:teste@localhost/teste";

/**
 * Meu Network Inteligente — o ID anônimo do contato (spec da Glenda de 14/09,
 * item 13: "NW-7F29A4"). Drizzle de verdade sobre um cliente mysql2 falso que
 * captura cada comando (molde de network-inteligente.test.ts).
 *
 * O que se trava:
 * 1. O formato do exemplo: NW- e seis hexadecimais maiúsculos, aleatório.
 * 2. Colisão do índice único grava de novo com OUTRO código; outro erro sobe.
 * 3. O contato nasce com o código (createPrivateContact).
 * 4. O preenchimento dos contatos antigos é da dona e não troca código dado:
 *    owner_id E codigo_anonimo IS NULL no WHERE de cada UPDATE.
 */

const estado = vi.hoisted(() => ({
  consultas: [] as { sql: string; params: unknown[] }[],
  respostas: {} as Record<string, unknown[][]>,
  falhasDeInsert: [] as unknown[],
}));

vi.mock("drizzle-orm/mysql2", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm/mysql2")>();
  const clienteFalso = {
    query: async (config: { sql: string }, params: unknown[] = []) => {
      estado.consultas.push({ sql: config.sql, params });
      if (/^\s*insert/i.test(config.sql)) {
        const falha = estado.falhasDeInsert.shift();
        if (falha) throw falha;
        return [{ affectedRows: 1, insertId: 77 }, []];
      }
      if (/^\s*(update|delete)/i.test(config.sql)) return [{ affectedRows: 1 }, []];
      const tabela = /from `([a-z_]+)`/i.exec(config.sql)?.[1] ?? "";
      return [estado.respostas[tabela] ?? [], []];
    },
  } as never;
  return {
    ...original,
    drizzle: ((entrada: unknown) =>
      typeof entrada === "string" ? original.drizzle(clienteFalso) : original.drizzle(entrada as never)) as typeof original.drizzle,
  };
});

const { gerarCodigoAnonimo, FORMATO_DO_CODIGO, comCodigoAnonimo, ehColisaoDeChave, garantirCodigosAnonimos } = await import("./network-codigo-anonimo");
const { createPrivateContact } = await import("./db");

const colisao = () => Object.assign(new Error("Duplicate entry 'NW-AAAAAA' for key 'pc_codigo_anonimo_unique'"), { code: "ER_DUP_ENTRY", errno: 1062 });

beforeEach(() => {
  estado.consultas = [];
  estado.respostas = {};
  estado.falhasDeInsert = [];
});

describe("ID anônimo — formato e aleatoriedade", () => {
  it("segue o exemplo da spec: NW- e seis hexadecimais maiúsculos", () => {
    for (let i = 0; i < 50; i += 1) expect(gerarCodigoAnonimo()).toMatch(FORMATO_DO_CODIGO);
    expect(FORMATO_DO_CODIGO.test("NW-7F29A4")).toBe(true);
  });

  it("não é derivado de nada previsível: 200 códigos seguidos quase nunca se repetem", () => {
    const codigos = new Set(Array.from({ length: 200 }, () => gerarCodigoAnonimo()));
    expect(codigos.size).toBeGreaterThan(195);
  });
});

describe("ID anônimo — colisão do índice único", () => {
  it("reconhece ER_DUP_ENTRY também embrulhado em `cause` (DrizzleQueryError)", () => {
    expect(ehColisaoDeChave(new Error("x", { cause: colisao() }))).toBe(true);
    expect(ehColisaoDeChave(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("colidiu: grava de novo com OUTRO código", async () => {
    const tentados: string[] = [];
    let chamadas = 0;
    const resultado = await comCodigoAnonimo(async codigo => {
      tentados.push(codigo);
      chamadas += 1;
      if (chamadas === 1) throw colisao();
      return "gravado";
    });
    expect(resultado).toBe("gravado");
    expect(tentados).toHaveLength(2);
    expect(tentados[0]).not.toBe(tentados[1]);
  });

  it("outro erro (banco fora) sobe na hora, sem tentar de novo", async () => {
    const gravar = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    await expect(comCodigoAnonimo(gravar)).rejects.toThrow("ECONNREFUSED");
    expect(gravar).toHaveBeenCalledTimes(1);
  });
});

describe("ID anônimo — o contato nasce com ele", () => {
  it("createPrivateContact grava codigo_anonimo no formato; colisão refaz o INSERT com código novo", async () => {
    estado.falhasDeInsert = [colisao()];
    const id = await createPrivateContact("dona-1", { fullName: "Maria Silva" });
    expect(id).toBe(77);
    const inserts = estado.consultas.filter(c => /^\s*insert into `private_contacts`/i.test(c.sql));
    expect(inserts).toHaveLength(2);
    const codigos = inserts.map(c => c.params.find(p => typeof p === "string" && FORMATO_DO_CODIGO.test(p)));
    expect(codigos[0]).toMatch(FORMATO_DO_CODIGO);
    expect(codigos[1]).toMatch(FORMATO_DO_CODIGO);
    expect(codigos[0]).not.toBe(codigos[1]);
  });
});

describe("ID anônimo — contatos antigos", () => {
  it("só lê e só atualiza contatos DESTA dona sem código, e nunca troca um código já dado", async () => {
    estado.respostas.private_contacts = [[11], [12]];
    const preenchidos = await garantirCodigosAnonimos("dona-1");
    expect(preenchidos).toBe(2);

    const [leitura] = estado.consultas.filter(c => /^\s*select/i.test(c.sql));
    expect(leitura.sql).toContain("`private_contacts`.`ownerId` = ?");
    expect(leitura.sql).toContain("`private_contacts`.`codigo_anonimo` is null");
    expect(leitura.params).toContain("dona-1");

    const updates = estado.consultas.filter(c => /^\s*update `private_contacts`/i.test(c.sql));
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.sql).toContain("`private_contacts`.`ownerId` = ?");
      expect(update.sql).toContain("`private_contacts`.`codigo_anonimo` is null");
      // nem updatedAt: dar o código não é edição da dona e não reordena a lista
      expect(update.sql).not.toContain("`updatedAt`");
      expect(update.params[0]).toMatch(FORMATO_DO_CODIGO);
    }
  });
});
