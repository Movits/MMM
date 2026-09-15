// server/matching.ts resolve VAULT_ENCRYPTION_KEY no import (senão lança); o
// `.env` seta vazio, então `||=`.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../drizzle/schema";

/**
 * Meu Network Inteligente (spec da Glenda de 14/09, itens 15 a 18): os dois
 * motores registram as conexões que nascem neles, com o registro de verdade
 * (network-registro.ts) sobre um banco falso por tabela.
 *
 * O que se trava:
 * 1. Motor de PERFIS: o par gravado como conexão sugerida vira PLATFORM_MATCH
 *    com as duas membras como participantes — só o que passou pelo termo dos
 *    dois lados, pelo portão da demanda expressa e pela nota mínima.
 * 2. Motor PRIVADO: todo recálculo termina registrando a conexão interna
 *    (PRIVATE_NETWORK_MATCH), sem precisar de o router lembrar.
 * 3. Idempotência: a segunda rodada não grava de novo o que já está registrado.
 * 4. Falha do registro não derruba o cálculo; banco fora do ar continua erro.
 */

const consentimento = vi.hoisted(() => ({ autorizadas: null as Set<number> | null }));
vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => consentimento.autorizadas ?? new Set(ids),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: async () => ({ choices: [{ message: { content: "insight" } }] }) }));
vi.mock("./_core/email", () => ({ sendEmail: vi.fn(async () => false) }));
vi.mock("./network-codigo-anonimo", () => ({ garantirCodigosAnonimos: async () => 0 }));

// Banco falso por identidade de tabela. Não interpreta WHERE (cada teste só
// põe na tabela o que a consulta deveria achar); projeta as colunas pedidas
// pelo nome da propriedade, como o drizzle devolve; guarda o que foi inserido
// na própria tabela, para a rodada seguinte ler de volta.
const banco = vi.hoisted(() => ({
  linhas: new Map<unknown, Array<Record<string, unknown>>>(),
  inseridos: [] as Array<{ tabela: unknown; valores: Record<string, unknown> }>,
  falhas: new Map<unknown, Error>(),
  /** Candidatas do motor de perfis: a consulta com innerJoin, distinta da leitura do próprio perfil. */
  candidatas: [] as Array<Record<string, unknown>>,
}));

function projetar(tabela: unknown, campos: Record<string, unknown> | undefined, linha: Record<string, unknown>) {
  if (!campos) return { ...linha };
  const propriedades = Object.entries(tabela as Record<string, unknown>);
  return Object.fromEntries(Object.entries(campos).map(([apelido, coluna]) => {
    const propriedade = propriedades.find(([, valor]) => valor === coluna)?.[0] ?? apelido;
    return [apelido, linha[propriedade]];
  }));
}

vi.mock("./db", () => {
  const leitura = (campos: Record<string, unknown> | undefined) => ({
    from: (tabela: unknown) => {
      let comJoin = false;
      const cadeia: Record<string, unknown> = {};
      for (const metodo of ["where", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
      cadeia.innerJoin = () => { comJoin = true; return cadeia; };
      cadeia.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        const falha = banco.falhas.get(tabela);
        if (falha) return Promise.reject(falha).then(resolve, reject);
        const linhas = comJoin ? banco.candidatas : (banco.linhas.get(tabela) ?? []);
        return Promise.resolve(linhas.map(linha => projetar(tabela, campos, linha))).then(resolve, reject);
      };
      return cadeia;
    },
  });
  const gravar = async (tabela: unknown, valores: Record<string, unknown> | Array<Record<string, unknown>>) => {
    const falha = banco.falhas.get(tabela);
    if (falha) throw falha;
    for (const linha of Array.isArray(valores) ? valores : [valores]) {
      banco.inseridos.push({ tabela, valores: linha });
      banco.linhas.set(tabela, [...(banco.linhas.get(tabela) ?? []), linha]);
    }
  };
  const fakeDb = {
    select: (campos?: Record<string, unknown>) => leitura(campos),
    insert: (tabela: unknown) => ({
      values: (valores: Record<string, unknown>) => ({
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => gravar(tabela, valores).then(resolve, reject),
        onDuplicateKeyUpdate: () => gravar(tabela, valores),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
    delete: () => ({ where: async () => undefined }),
    // O registro grava cabeçalho e participantes numa transação (registrarConexao).
    transaction: async (trabalho: (tx: unknown) => Promise<unknown>) => trabalho(fakeDb),
  };
  return { getDb: async () => fakeDb, exigirDb: async () => fakeDb };
});

const { calculateCompatibilityScore, generateMatchesForUser } = await import("./matching");
const { recalculatePrivateMatches, slugifyMatchTag } = await import("./match-service");
const { chaveDoPar } = await import("./network-registro");
const schema = await import("../drizzle/schema");

const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const quedaDoBanco = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" });

beforeEach(() => {
  banco.linhas.clear();
  banco.inseridos = [];
  banco.falhas.clear();
  banco.candidatas = [];
  consentimento.autorizadas = null;
  avisos.mockClear();
});
afterEach(() => vi.clearAllMocks());

const inseridosEm = (tabela: unknown) => banco.inseridos.filter(i => i.tabela === tabela).map(i => i.valores);

// ─── Motor de perfis → PLATFORM_MATCH ─────────────────────────────────────────

// Molde de matching-demanda-expressa.test.ts: a advogada tributarista só casa
// com quem DECLAROU precisar de consultoria.
const dona = { userId: 1, whatIHave: ["Advocacia tributária"], whatINeed: [], sector: "Jurídico", country: "BR", city: "Brasília", values: ["innovation"] };
const candidata = (userId: number, extra: Record<string, unknown>) =>
  ({ userId, sector: "Jurídico", country: "BR", city: "Brasília", values: ["innovation"], whatIHave: [], whatINeed: [], ...extra });
const semDemanda = candidata(2, { whatINeed: ["fornecedores"] });
const comDemanda = candidata(3, { whatINeed: ["consultoria"] });
const comDemandaSemTermo = candidata(4, { whatINeed: ["consultoria"] });

function rodadaDePerfis() {
  banco.linhas.set(schema.userProfiles, [dona]);
  banco.candidatas = [semDemanda, comDemanda, comDemandaSemTermo];
  consentimento.autorizadas = new Set([2, 3]);
}

describe("motor de perfis — a conexão sugerida entre membras é registrada (PLATFORM_MATCH)", () => {
  it("registra só o par que passou pelo termo dos dois lados, pelo portão e pela nota; participantes são as contas", async () => {
    // Pré-condições do cenário, para a falha dizer o que mudou se a regra mudar.
    expect(calculateCompatibilityScore(dona as unknown as UserProfile, semDemanda as unknown as UserProfile).bloqueio).toBe("servico-sem-demanda-expressa");
    const nota = calculateCompatibilityScore(dona as unknown as UserProfile, comDemanda as unknown as UserProfile).overall;
    expect(nota).toBeGreaterThanOrEqual(40);
    rodadaDePerfis();

    expect(await generateMatchesForUser(1)).toBe(1);

    expect(inseridosEm(schema.matches).map(m => m.matchedUserId)).toEqual([3]);
    const [conexao, ...outras] = inseridosEm(schema.conexoesRegistradas);
    expect(outras).toHaveLength(0);
    expect(conexao).toMatchObject({
      origem: "PLATFORM_MATCH", chaveDoPar: "PLATFORM_MATCH|membro:1|membro:3",
      pontuacao: nota, status: "identificada", statusComissao: "sem_negocio", itens: [],
    });
    // Sem dado pessoal: nem o que a membra escreveu no perfil entra no motivo.
    expect(String(conexao.motivo)).toContain(`${nota}%`);
    expect(String(conexao.motivo)).not.toMatch(/advocacia|consultoria|jur[ií]dico|bras[ií]lia/i);

    const participantes = inseridosEm(schema.conexoesParticipantes);
    expect(participantes.map(p => [p.lado, p.tipo, p.userId, p.ownerId, p.contactId])).toEqual([
      ["a", "membro", 1, null, null],
      ["b", "membro", 3, null, null],
    ]);
  });

  it("dona sem nenhum par gravado: o registro nem é consultado", async () => {
    banco.linhas.set(schema.userProfiles, [dona]);
    banco.candidatas = [semDemanda];
    banco.falhas.set(schema.conexoesRegistradas, quedaDoBanco());

    expect(await generateMatchesForUser(1)).toBe(0);
  });

  it("idempotente: a segunda rodada com a mesma nota não grava de novo, e B×A cai na mesma chave de A×B", async () => {
    rodadaDePerfis();
    await generateMatchesForUser(1);
    await generateMatchesForUser(1);
    expect(inseridosEm(schema.conexoesRegistradas)).toHaveLength(1);

    const membro = (userId: number) => ({ tipo: "membro" as const, userId });
    expect(chaveDoPar("PLATFORM_MATCH", membro(3), membro(1))).toBe("PLATFORM_MATCH|membro:1|membro:3");
  });

  it("falha do registro não derruba a rodada: os pares ficam gravados e o motivo vai ao log", async () => {
    rodadaDePerfis();
    banco.falhas.set(schema.conexoesRegistradas, new Error("Unknown column 'pontuacao'"));

    expect(await generateMatchesForUser(1)).toBe(1);
    expect(inseridosEm(schema.matches)).toHaveLength(1);
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining("conexões entre membras"), "Unknown column 'pontuacao'");
  });

  it("banco fora do ar no registro continua sendo erro", async () => {
    rodadaDePerfis();
    banco.falhas.set(schema.conexoesRegistradas, quedaDoBanco());

    await expect(generateMatchesForUser(1)).rejects.toThrow("ECONNREFUSED");
  });
});

// ─── Motor privado → PRIVATE_NETWORK_MATCH ────────────────────────────────────

const termo = (contactId: number, tagLabel: string) =>
  ({ ownerId: "dona", contactId, tagSlug: slugifyMatchTag(tagLabel), tagLabel, category: null, description: null, createdAt: 1, updatedAt: 1 });

function redeComUmPar() {
  banco.linhas.set(schema.privateContacts, [
    { id: 1, ownerId: "dona", fullName: "Ana Souza", codigoAnonimo: "NW-AAAAAA" },
    { id: 2, ownerId: "dona", fullName: "Bia Lima", codigoAnonimo: "NW-BBBBBB" },
  ]);
  banco.linhas.set(schema.contactAssets, [termo(1, "Vinho tinto")]);
  banco.linhas.set(schema.contactNeeds, [termo(2, "Vinho tinto")]);
}

describe("motor privado — todo recálculo termina registrando a conexão interna (PRIVATE_NETWORK_MATCH)", () => {
  it("a sugestão que acabou de nascer entra no registro, pelos IDs anônimos e sem o nome das contatos", async () => {
    redeComUmPar();

    const resultado = await recalculatePrivateMatches("dona");

    expect(resultado).toMatchObject({ created: 1, total: 1 });
    const [conexao, ...outras] = inseridosEm(schema.conexoesRegistradas);
    expect(outras).toHaveLength(0);
    expect(conexao).toMatchObject({ origem: "PRIVATE_NETWORK_MATCH", chaveDoPar: "PRIVATE_NETWORK_MATCH|contato:1|contato:2", pontuacao: 100 });
    expect(String(conexao.motivo)).toBe("NW-AAAAAA tem Vinho tinto, que NW-BBBBBB procura.");
    const doRegistro = [...inseridosEm(schema.conexoesRegistradas), ...inseridosEm(schema.conexoesParticipantes)];
    expect(doRegistro.length).toBeGreaterThan(1);
    expect(JSON.stringify(doRegistro)).not.toMatch(/Ana|Bia|Souza|Lima/);
  });

  it("idempotente: recalcular de novo não registra outra vez", async () => {
    redeComUmPar();
    await recalculatePrivateMatches("dona");
    await recalculatePrivateMatches("dona");

    expect(inseridosEm(schema.aiMatchSuggestions)).toHaveLength(1);
    expect(inseridosEm(schema.conexoesRegistradas)).toHaveLength(1);
  });

  it("falha do registro não derruba o recálculo: a sugestão fica gravada e o motivo vai ao log", async () => {
    redeComUmPar();
    banco.falhas.set(schema.conexoesRegistradas, new Error("Table 'conexoes_registradas' doesn't exist"));

    await expect(recalculatePrivateMatches("dona")).resolves.toMatchObject({ created: 1 });
    expect(inseridosEm(schema.aiMatchSuggestions)).toHaveLength(1);
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining("conexões internas"), "Table 'conexoes_registradas' doesn't exist");
  });

  it("banco fora do ar no registro continua sendo erro", async () => {
    redeComUmPar();
    banco.falhas.set(schema.conexoesRegistradas, quedaDoBanco());

    await expect(recalculatePrivateMatches("dona")).rejects.toThrow("ECONNREFUSED");
  });
});
