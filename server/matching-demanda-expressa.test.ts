// server/matching.ts:12 resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../drizzle/schema";

/**
 * Regra da demanda expressa no motor de PERFIS (Dashboard) — pedido do
 * Nicolas, 12/09/2026.
 *
 * As seis dimensões somam nota mesmo sem encaixe nenhum: setor adjacente,
 * capacidade de investimento "neutra", valores, cidade. Um perfil cujo "o que
 * tenho" é só serviço ("Advocacia tributária", texto livre que o zod aceita e
 * "falar sobre o negócio" grava) virava match com quem "poderia precisar" —
 * por setor, nunca por necessidade declarada. Agora o par sustentado só por
 * serviço sem demanda expressa dá zero (bloqueio nomeado), a linha antiga sai
 * do banco no "Reanalisar" e some da leitura. Base expressa por outro caminho
 * (produto que a outra declarou precisar, investimento buscado × capacidade
 * declarada) mantém o par: a regra é específica de serviço.
 */

vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: async () => ({ choices: [{ message: { content: "insight" } }] }) }));

// Banco simulado por fila: cada SELECT terminado devolve a próxima resposta.
const filas: unknown[][] = [];
const upserts: Array<{ values: Record<string, unknown> }> = [];
const deletes: unknown[] = [];
function cadeiaDeSelect() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["from", "where", "innerJoin", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
  (cadeia as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(filas.shift() ?? []).then(resolve, reject);
  return cadeia;
}
// Conta as consultas: "não consulta o banco" só é prova se a contagem existir
// (a fila vazia é verdadeira antes e depois, e não discrimina nada).
let selects = 0;
const fakeDb = {
  select: () => { selects += 1; return cadeiaDeSelect(); },
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onDuplicateKeyUpdate: () => { upserts.push({ values }); return Promise.resolve(); },
    }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  delete: () => ({ where: (condicao: unknown) => { deletes.push(condicao); return Promise.resolve(); } }),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb as never, exigirDb: async () => fakeDb as never }));

const { calculateCompatibilityScore, generateMatchesForUser, matchesBloqueadosPelaDemandaExpressa } = await import("./matching");

const perfil = (extra: Partial<UserProfile>) => ({ whatIHave: null, whatINeed: null, ...extra }) as unknown as UserProfile;

beforeEach(() => { filas.length = 0; upserts.length = 0; deletes.length = 0; selects = 0; });

describe("calculateCompatibilityScore — serviço sem demanda expressa dá zero", () => {
  it("advocacia tributária × quem procura distribuidores: bloqueado, nota zero", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], sector: "Jurídico" }),
      perfil({ whatINeed: ["distribuidores"], sector: "Farmacêutico" }),
    );
    expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
    expect(r.overall).toBe(0);
    expect(r.complementarity).toBe(0);
  });

  it("vale nos dois sentidos: quem só oferece serviço do lado B também não vira match presumido", () => {
    const r = calculateCompatibilityScore(
      perfil({}),
      perfil({ whatIHave: ["Consultoria em exportação"] }),
    );
    expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
    expect(r.overall).toBe(0);
  });

  it("setor igual, valores iguais e mesma cidade não salvam o serviço sem demanda", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], sector: "Saúde", values: ["innovation"], country: "BR", city: "São Paulo" }),
      perfil({ whatINeed: ["fornecedores"], sector: "Saúde", values: ["innovation"], country: "BR", city: "São Paulo" }),
    );
    expect(r.overall).toBe(0);
  });
});

describe("calculateCompatibilityScore — necessidade expressa libera o serviço", () => {
  it("a opção fixa 'Consultoria' declara precisar de assessoria: advocacia tributária atende", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"] }),
      perfil({ whatINeed: ["consultoria"] }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(60); // uma via
    expect(r.overall).toBeGreaterThanOrEqual(40);
  });

  it("texto livre que nomeia o serviço também é demanda expressa", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"] }),
      perfil({ whatINeed: ["Procura advocacia tributária"] }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(60);
  });

  it("'Consultoria' não é atendida por qualquer serviço: marketing não é assessoria", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Marketing digital"] }),
      perfil({ whatINeed: ["consultoria"] }),
    );
    expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
  });
});

describe("calculateCompatibilityScore — a regra é específica de serviço", () => {
  it("oferta mista: a fazenda atende 'fornecedores' e o par passa (o serviço só não soma)", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária", "fazenda"] }),
      perfil({ whatINeed: ["fornecedores"] }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(60);
  });

  it("a outra tem o que esta declarou precisar: base expressa no sentido contrário mantém o par", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], whatINeed: ["tecnologia"] }),
      perfil({ whatIHave: ["tecnologia"] }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(60);
  });

  it("investimento buscado × capacidade declarada é base expressa (categoria investimento)", () => {
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], lookingForInvestment: false, investmentCapacity: "200k_plus" }),
      perfil({ lookingForInvestment: true, investmentAmountSeeking: "under_50k" }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.investment).toBe(90);
  });

  it("'busco investimento' sem capacidade DECLARADA do outro lado não é base expressa (capacidade em branco ou 'none')", () => {
    // A nota 90 sai mesmo com capacidade em branco (o `?? 2` do rank); a
    // base expressa exige declaração — senão um perfil só de serviço que
    // marcasse "busco investimento" casaria com qualquer perfil.
    const emBranco = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], lookingForInvestment: true }),
      perfil({ lookingForInvestment: false, investmentCapacity: null }),
    );
    expect(emBranco.investment).toBe(90);
    expect(emBranco.bloqueio).toBe("servico-sem-demanda-expressa");
    const none = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária"], lookingForInvestment: true }),
      perfil({ lookingForInvestment: false, investmentCapacity: "none" }),
    );
    expect(none.bloqueio).toBe("servico-sem-demanda-expressa");
  });

  it("oferta mista SEM encaixe: o ativo continua pontuando como na main (every, não some)", () => {
    // Mata o mutante `have.some(ehServico)`: com "industria" na lista, a oferta
    // não é só de serviço, então nada bloqueia — e a nota é a de sempre para
    // um ativo sem encaixe (complementaridade 20, overall 32 com o resto vazio).
    const r = calculateCompatibilityScore(
      perfil({ whatIHave: ["Advocacia tributária", "industria"] }),
      perfil({ whatINeed: ["tecnologia"] }),
    );
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(20);
    expect(r.overall).toBe(32);
  });

  it("perfil sem nada em 'o que tenho' segue como sempre: não oferece serviço nenhum", () => {
    const r = calculateCompatibilityScore(perfil({}), perfil({}));
    expect(r.bloqueio).toBeUndefined();
    expect(r.overall).toBe(41);
  });

  it("ativo sem encaixe continua pontuando como antes (não é serviço)", () => {
    const r = calculateCompatibilityScore(perfil({ whatIHave: ["industria"] }), perfil({ whatINeed: ["tecnologia"] }));
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(20);
    expect(r.overall).toBe(32);
  });
});

const dona = { userId: 1, whatIHave: ["Advocacia tributária"], whatINeed: [], sector: "Jurídico", country: "BR", city: "Brasília", values: ["innovation"] };
const candidata = (userId: number, extra: Record<string, unknown>) => ({ userId, sector: "Jurídico", country: "BR", city: "Brasília", values: ["innovation"], whatIHave: [], whatINeed: [], ...extra });

describe("generateMatchesForUser — o par bloqueado não é gravado nem apagado", () => {
  it("candidata sem demanda expressa: nenhum upsert e NENHUM delete (a dispensa da dona sobrevive); candidata com 'consultoria': upsert", async () => {
    filas.push([dona], [candidata(2, { whatINeed: ["fornecedores"] }), candidata(3, { whatINeed: ["consultoria"] })], []);

    const criados = await generateMatchesForUser(1);

    expect(criados).toBe(1);
    expect(upserts.map(u => u.values.matchedUserId)).toEqual([3]);
    // Apagar levaria junto userDismissed: quando o bloqueio cessasse, o
    // upsert reinseriria o par e o match dispensado voltaria à tela.
    expect(deletes).toHaveLength(0);
  });
});

describe("matchesBloqueadosPelaDemandaExpressa — a leitura enxerga o portão", () => {
  it("devolve só os ids cujo par está bloqueado hoje, em duas consultas (perfil próprio + inArray)", async () => {
    filas.push([dona], [
      { userId: 2, whatIHave: [], whatINeed: ["fornecedores"], investmentCapacity: null, lookingForInvestment: false, investmentAmountSeeking: null },
      { userId: 3, whatIHave: [], whatINeed: ["consultoria"], investmentCapacity: null, lookingForInvestment: false, investmentAmountSeeking: null },
    ]);
    const bloqueados = await matchesBloqueadosPelaDemandaExpressa(1, [2, 3]);
    expect([...bloqueados]).toEqual([2]);
    expect(selects).toBe(2);
  });

  it("sem ids não consulta o banco", async () => {
    expect(await matchesBloqueadosPelaDemandaExpressa(1, [])).toEqual(new Set());
    expect(selects).toBe(0);
  });
});
