import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 10 — Controle de Privacidade e Níveis de Acesso (Usuário Ouro).
 *
 * Os critérios do cartão, na ordem em que o código os garante:
 * 1. O perfil Ouro existe (users.role) e é quem decide QUEM lê: acervoOuro é
 *    goldProcedure — comum leva FORBIDDEN antes de o banco ser consultado.
 * 2. O acesso só acontece se a DONA autorizou: o filtro nivelVisibilidade =
 *    'ouro' roda no banco a cada leitura, e o termo_acesso_ouro da dona
 *    (padrão da etapa 11) é a segunda porta.
 * 3. Público = só oportunidades: continua na vitrine (etapa 8); o acervo Ouro
 *    não lê canais pessoais (telefone, e-mail, redes, notas) — as colunas nem
 *    são selecionadas.
 * 5. Revogar tira o acesso na hora: as duas portas são predicados por request.
 * (O critério 4, duas contas reais, é o aceite na produção.)
 */

const listAcervoOuro = vi.fn(async () => [{
  contatoRef: "abc123def0", fullName: "Ana Prova", jobTitle: "Diretora", company: "Andina",
  country: "Chile", city: "Santiago", profileTags: ["mineração"], compartilhadoPor: "Dona Um",
  possui: [{ label: "Terras raras", category: null }], procura: [],
}]);
const listVitrineColetiva = vi.fn(async () => []);
vi.mock("./db", () => ({
  createPrivateContact: async () => 7,
  updatePrivateContact: async () => true,
  deletePrivateContact: async () => true,
  listPrivateContacts: async () => ({ data: [], total: 0 }),
  getPrivateContactById: async () => null,
  getDb: async () => null,
  listVitrineColetiva: (...args: unknown[]) => listVitrineColetiva(...(args as [])),
  listAcervoOuro: (...args: unknown[]) => listAcervoOuro(...(args as [])),
}));
vi.mock("./security", () => ({ createAuditLog: async () => {} }));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
vi.mock("./match-service", () => ({
  recalculatePrivateMatches: async () => ({ created: 0, updated: 0, removed: 0, total: 0 }),
  slugifyMatchTag: (v: string) => v.toLowerCase(),
}));

const { networkRouter } = await import("./routers/network");

const ctxComRole = (role: string) => ({
  user: { id: 1, openId: "leitora-1", email: "t@local", role },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
}) as never;

beforeEach(() => {
  listAcervoOuro.mockClear();
});

describe("Etapa 10 — quem lê o acervo é decidido pelo perfil (critério 1)", () => {
  it("conta comum (silver) leva FORBIDDEN e o banco nem é consultado", async () => {
    const rede = networkRouter.createCaller(ctxComRole("silver"));
    await expect(rede.acervoOuro()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listAcervoOuro).not.toHaveBeenCalled();
  });

  it("bronze também fica de fora", async () => {
    const rede = networkRouter.createCaller(ctxComRole("bronze"));
    await expect(rede.acervoOuro()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Status Ouro lê o acervo pelo caminho do banco", async () => {
    const rede = networkRouter.createCaller(ctxComRole("gold"));
    const itens = await rede.acervoOuro();
    expect(itens[0].fullName).toBe("Ana Prova");
    expect(listAcervoOuro).toHaveBeenCalled();
  });

  it("admin e president valem como Ouro (mesma régua do resto do app)", async () => {
    for (const role of ["admin", "president"]) {
      const rede = networkRouter.createCaller(ctxComRole(role));
      await expect(rede.acervoOuro()).resolves.toBeTruthy();
    }
  });
});

describe("Etapa 10 — a autorização da dona mora na consulta (critérios 2 e 5)", () => {
  const fonte = readFileSync(join(__dirname, "db.ts"), "utf8");
  const corpo = fonte.slice(
    fonte.indexOf("export async function listAcervoOuro"),
    fonte.indexOf("Etapa 8 — a vitrine coletiva"),
  );

  it("só contatos que a dona marcou 'ouro', filtrados no banco em tempo de leitura", () => {
    expect(corpo).toContain('eq(privateContacts.nivelVisibilidade, "ouro")');
  });

  it("o termo da dona (termo_acesso_ouro) é a segunda porta, reavaliada por request", () => {
    expect(corpo).toContain('usersComConsentimento(donas.map(dona => dona.id), "termo_acesso_ouro")');
  });

  it("a leitura tem teto e ordem determinística — e o corte final é DEPOIS dos filtros", () => {
    expect(corpo).toContain(".orderBy(desc(privateContacts.updatedAt))");
    expect(corpo).toContain(".limit(400)");
    expect(corpo).toContain(".slice(0, 200)");
  });

  it("a leitura Ouro fica na trilha de auditoria", () => {
    const rota = readFileSync(join(__dirname, "routers", "network.ts"), "utf8");
    expect(rota).toContain('action: "GOLD_ACERVO_READ"');
  });

  it("a referência é opaca e com sal próprio — não correlaciona nem com a vitrine", () => {
    expect(corpo).toContain("acervo-ouro:${ENV.cookieSecret}");
  });
});

describe("Etapa 10 — canais pessoais nunca são lidos pelo acervo (critério 3)", () => {
  const fonte = readFileSync(join(__dirname, "db.ts"), "utf8");
  const corpo = fonte.slice(
    fonte.indexOf("export async function listAcervoOuro"),
    fonte.indexOf("Etapa 8 — a vitrine coletiva"),
  );

  it("telefone, e-mail, redes, foto, cartão e notas ficam fora da consulta", () => {
    for (const proibida of ["phone", "whatsapp", "email", "linkedinUrl", "instagram", "photoUrl", "cardImageUrl", "notes", "cardOcrText", "state"]) {
      expect(corpo).not.toContain(proibida);
    }
  });
});

describe("Etapa 10 — o vocabulário do termo está pronto para o texto da Cris", () => {
  it("o enum do banco e o dos routers conhecem termo_acesso_ouro", () => {
    const schema = readFileSync(join(__dirname, "..", "drizzle", "schema.ts"), "utf8");
    expect(schema).toContain('"termo_acesso_ouro"');
    const migracao = readFileSync(join(__dirname, "..", "drizzle", "0005_termo-acesso-ouro.sql"), "utf8");
    expect(migracao).toContain("'termo_acesso_ouro'");
    expect(migracao).toContain("ALTER TABLE `document_versions`");
    // o dos routers de verdade — consent.ts está mockado NESTE arquivo, então
    // o vocabulário é conferido no fonte
    const consentimento = readFileSync(join(__dirname, "routers", "consent.ts"), "utf8");
    expect(consentimento).toContain('"termo_acesso_ouro",');
  });

  it("o journal das migrações não tem BOM — o boot de produção faz JSON.parse dele", () => {
    const bruto = readFileSync(join(__dirname, "..", "drizzle", "meta", "_journal.json"));
    expect(bruto[0]).toBe(0x7b); // '{' — nunca EF BB BF
    const journal = JSON.parse(bruto.toString("utf8"));
    expect(journal.entries[journal.entries.length - 1].tag).toBe("0005_termo-acesso-ouro");
  });
});

describe("Etapa 10 — interessadas: a guarda 'dona OU Ouro' voltou a decidir", () => {
  const rotas = readFileSync(join(__dirname, "routers", "opportunities.ts"), "utf8");
  const corpo = rotas.slice(rotas.indexOf("getInterests:"), rotas.indexOf("toggleSave:"));

  it("a procedure é protected — a criadora comum vê as interessadas da própria oportunidade", () => {
    expect(corpo).toContain("getInterests: protectedProcedure");
  });

  it("quem não é dona nem Ouro é barrada pela guarda interna (agora viva)", () => {
    expect(corpo).toContain('opp.publishedBy !== ctx.user.id && ctx.user.role !== "admin" && ctx.user.role !== "president" && ctx.user.role !== "gold"');
  });
});
