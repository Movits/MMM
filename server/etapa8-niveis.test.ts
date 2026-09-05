import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Etapa 8 — os três níveis de visibilidade e a convivência privado × coletivo.
 *
 * 1. O nível é escolha da dona: nasce 'privado' por padrão, muda a qualquer
 *    momento pelo update, e a vitrine só enxerga 'publico'.
 * 2. A projeção pública não SELECIONA colunas pessoais — a tela nunca é a
 *    última linha de defesa (privacidade.md).
 * 3. A trava de leitura da etapa 11 mora no caminho VIVO (profileMatches): a
 *    versão anterior estava numa função que nenhum router chamava.
 * 4. Oportunidade confidencial não vaza pelo segundo caminho de consulta
 *    (getRecommendedOpportunities).
 */

const createPrivateContact = vi.fn(async () => 7);
const updatePrivateContact = vi.fn(async () => true);
// O que getPrivateContactById devolve "antes" de um delete: é dali que o
// router tira photoUrl/cardImageUrl para decidir o que sai do bucket.
let contatoExistente: Record<string, unknown> | null = null;
// Outro contato da dona ainda usa a imagem? Decide se o objeto sai do bucket.
const imagemUsadaPorOutroContato = vi.fn(async () => false);
const listVitrineColetiva = vi.fn(async () => [{ contatoRef: "a1b2c3d4e5", country: "Chile", city: "Santiago", possui: [], procura: [] }]);
const getMatchesForUser = vi.fn(async () => [
  { matchId: 1, matchedUserId: 2, overallScore: 90 },
  { matchId: 2, matchedUserId: 3, overallScore: 80 },
]);
// Um mock só: os routers importam "../db", que resolve para o mesmo módulo
// que este arquivo enxerga como "./db".
vi.mock("./db", async () => ({
  // Sem banco: getDb devolve null e exigirDb lança, como o db.ts real.
  getDb: async () => null,
  exigirDb: async () => { throw new (await import("./banco-indisponivel")).BancoIndisponivel(); },
  createPrivateContact: (...args: unknown[]) => createPrivateContact(...(args as [])),
  updatePrivateContact: (...args: unknown[]) => updatePrivateContact(...(args as [])),
  deletePrivateContact: async () => true,
  listPrivateContacts: async () => ({ data: [], total: 0 }),
  getPrivateContactById: async () => contatoExistente,
  imagemUsadaPorOutroContato: (...args: unknown[]) => imagemUsadaPorOutroContato(...(args as [])),
  listVitrineColetiva: (...args: unknown[]) => listVitrineColetiva(...(args as [])),
  getMatchesForUser: (...args: unknown[]) => getMatchesForUser(...(args as [])),
  dismissMatch: async () => {},
  regenerateMatches: async () => 0,
}));

const hasValidConsent = vi.fn(async () => true);
const usersComConsentimento = vi.fn(async (ids: number[]) => new Set(ids));
vi.mock("./routers/consent", () => ({
  hasValidConsent: (...args: unknown[]) => hasValidConsent(...(args as [])),
  usersComConsentimento: (...args: unknown[]) => usersComConsentimento(...(args as [number[]])),
}));
vi.mock("./match-service", () => ({
  recalculatePrivateMatches: async () => ({ created: 0, updated: 0, removed: 0, total: 0 }),
  slugifyMatchTag: (v: string) => v.toLowerCase(),
}));
const storageDelete = vi.fn(async () => {});
vi.mock("./storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("./storage")>();
  return { ...real, storageDelete: (...args: unknown[]) => storageDelete(...(args as [string])) };
});

const { networkRouter } = await import("./routers/network");
const { profileMatchesRouter } = await import("./routers/profileMatches");

const ctx = {
  user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" },
  req: { headers: {}, socket: {} },
  res: { cookie: () => {} },
} as never;

beforeEach(() => {
  createPrivateContact.mockClear();
  updatePrivateContact.mockClear();
  getMatchesForUser.mockClear();
  hasValidConsent.mockClear(); hasValidConsent.mockResolvedValue(true);
  usersComConsentimento.mockClear();
  usersComConsentimento.mockImplementation(async (ids: number[]) => new Set(ids));
  storageDelete.mockClear();
  imagemUsadaPorOutroContato.mockClear(); imagemUsadaPorOutroContato.mockResolvedValue(false);
  contatoExistente = null;
});

describe("Etapa 1/8 — imagem compartilhada por duas fichas da mesma dona fica no bucket", () => {
  // A reverificação de 04/09 achou o modal de edição criando uma duplicata com
  // o MESMO photoUrl; excluir a duplicata apagava o objeto e a foto do contato
  // original quebrava (o proxy assina, o bucket devolve 404).
  const rede = networkRouter.createCaller(ctx);
  const foto = "/manus-storage/contacts/dona-1/foto_ana.jpg";

  it("delete: outro contato da dona ainda usa a foto ⇒ o objeto NÃO sai do bucket", async () => {
    contatoExistente = { id: 8, ownerId: "dona-1", photoUrl: foto, cardImageUrl: null };
    imagemUsadaPorOutroContato.mockResolvedValue(true);
    await rede.delete({ id: 8 });
    expect(storageDelete).not.toHaveBeenCalled();
    // A pergunta é feita na rede DESTA dona, sobre ESTA chave, excluindo a ficha que sai.
    expect(imagemUsadaPorOutroContato).toHaveBeenCalledWith("dona-1", foto, 8);
  });

  it("delete: nenhum outro contato usa a foto ⇒ o objeto sai do bucket", async () => {
    contatoExistente = { id: 8, ownerId: "dona-1", photoUrl: foto, cardImageUrl: null };
    imagemUsadaPorOutroContato.mockResolvedValue(false);
    await rede.delete({ id: 8 });
    expect(storageDelete).toHaveBeenCalledTimes(1);
    expect(storageDelete).toHaveBeenCalledWith("contacts/dona-1/foto_ana.jpg");
  });

  it("update trocando a foto: a velha fica se outra ficha ainda a usa", async () => {
    contatoExistente = { id: 8, ownerId: "dona-1", photoUrl: foto, cardImageUrl: null };
    imagemUsadaPorOutroContato.mockResolvedValue(true);
    await rede.update({ id: 8, photoUrl: "/manus-storage/contacts/dona-1/foto_nova.jpg" });
    expect(storageDelete).not.toHaveBeenCalled();
  });
});

describe("Etapa 8 — o nível é escolha da dona", () => {
  const rede = networkRouter.createCaller(ctx);

  it("contato novo sem escolha nasce sem nível no input: o banco aplica 'privado'", async () => {
    await rede.create({ fullName: "Ana" });
    const recebido = createPrivateContact.mock.calls[0][1] as Record<string, unknown>;
    expect(recebido.nivelVisibilidade).toBeUndefined();
  });

  it("a dona escolhe 'publico' na criação e o nível passa inteiro", async () => {
    await rede.create({ fullName: "Ana", nivelVisibilidade: "publico" });
    const recebido = createPrivateContact.mock.calls[0][1] as Record<string, unknown>;
    expect(recebido.nivelVisibilidade).toBe("publico");
  });

  it("o nível muda depois, a qualquer momento, pelo update", async () => {
    await rede.update({ id: 7, nivelVisibilidade: "privado" });
    const recebido = updatePrivateContact.mock.calls[0][2] as Record<string, unknown>;
    expect(recebido.nivelVisibilidade).toBe("privado");
  });

  it("nível fora do vocabulário é recusado", async () => {
    await expect(rede.create({ fullName: "Ana", nivelVisibilidade: "secreto" as never })).rejects.toThrow();
  });

  it("a vitrine responde pelo caminho do banco, para qualquer membra logada", async () => {
    const itens = await rede.vitrine();
    expect(itens[0].contatoRef).toBe("a1b2c3d4e5");
    expect(listVitrineColetiva).toHaveBeenCalled();
  });

  it("o padrão 'privado' está pinado no schema, não na boa vontade do cliente", () => {
    const schema = readFileSync(join(__dirname, "..", "drizzle", "schema.ts"), "utf8");
    expect(schema).toContain('varchar("nivel_visibilidade", { length: 10, enum: ["privado", "ouro", "publico"] }).default("privado").notNull()');
  });

  it("em produção o boot aplica as migrações antes de aceitar tráfego", () => {
    const boot = readFileSync(join(__dirname, "_core", "index.ts"), "utf8");
    const inicio = boot.slice(boot.indexOf("async function startServer"), boot.indexOf("const app = express()"));
    expect(inicio).toContain('spawnSync(process.execPath, ["scripts/migrar.mjs"]');
    expect(inicio).toContain('process.env.NODE_ENV === "production"');
    expect(inicio).toContain("process.exit(1)");
    // e a imagem leva o script junto
    const docker = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
    expect(docker).toContain("COPY --from=build /app/scripts ./scripts");
  });
});

describe("Etapa 8 — a projeção pública não lê colunas pessoais", () => {
  const fonte = readFileSync(join(__dirname, "db.ts"), "utf8");
  const corpo = fonte.slice(fonte.indexOf("export async function listVitrineColetiva"), fonte.indexOf("// ─── Contextos"));

  it("filtra por nível no banco, em tempo de leitura", () => {
    expect(corpo).toContain('eq(privateContacts.nivelVisibilidade, "publico")');
  });

  it("nenhuma coluna pessoal aparece na consulta da vitrine", () => {
    for (const proibida of ["fullName", "phone", "whatsapp", "email", "linkedinUrl", "instagram", "photoUrl", "cardImageUrl", "company", "jobTitle", "notes", "description", "state", "cardOcrText"]) {
      expect(corpo).not.toContain(proibida);
    }
  });
});

describe("Etapa 8/11 — a trava de leitura mora no caminho vivo", () => {
  const perfis = profileMatchesRouter.createCaller(ctx);

  it("dona que revogou o termo não vê matches — e o banco nem é consultado", async () => {
    hasValidConsent.mockResolvedValue(false);
    expect(await perfis.list({ limit: 20 })).toEqual([]);
    expect(getMatchesForUser).not.toHaveBeenCalled();
  });

  it("match citando quem revogou some da lista", async () => {
    usersComConsentimento.mockResolvedValue(new Set([3]));
    const lista = await perfis.list({ limit: 20 });
    expect(lista).toHaveLength(1);
    expect((lista[0] as { matchedUserId: number }).matchedUserId).toBe(3);
  });

  it("a duplicata sem trava foi aposentada: matching.ts não exporta mais getMatchesForUser", () => {
    const motor = readFileSync(join(__dirname, "matching.ts"), "utf8");
    expect(motor).not.toContain("export async function getMatchesForUser");
  });
});

describe("Etapa 8 — confidencial não vaza pelo segundo caminho", () => {
  it("getRecommendedOpportunities aplica a régua de opportunities.list", () => {
    const rotas = readFileSync(join(__dirname, "routers", "matching.ts"), "utf8");
    const corpo = rotas.slice(rotas.indexOf("getRecommendedOpportunities"), rotas.indexOf("checkAndNotifyHighCompatibility"));
    // o pin é a expressão exata da guarda: trocar false por true, ou remover o
    // condicional, quebra aqui
    expect(corpo).toContain("...(isGold ? [] : [eq(opportunities.isConfidential, false)])");
  });

  it("o alerta de oportunidade confidencial só alcança quem é Ouro+", () => {
    const rotas = readFileSync(join(__dirname, "routers", "matching.ts"), "utf8");
    const corpo = rotas.slice(rotas.indexOf("notifyHighCompatibilityForOpportunity"));
    expect(corpo).toContain("opp.isConfidential ? todos.filter(perfil => podeVerConfidencial(perfil.role)) : todos");
  });
});
