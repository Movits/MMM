// server/matching.ts resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";
process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../drizzle/schema";

/**
 * As 12 opções de "O que você busca?" (pedido do Lucas no grupo, 14/09 20:58;
 * lista em shared/o-que-busca.ts) nos motores, sob a regra da Glenda:
 *   - "Serviço Especializado" é GENÉRICA: não é necessidade expressa de serviço
 *     nenhum e não abre o portão;
 *   - o texto de "Outra necessidade" é necessidade DECLARADA, lido como "O que
 *     preciso";
 *   - as outras dez nunca liberam serviço sozinhas;
 *   - as chaves antigas (job, team, investor, mentor, strategic_partner) seguem
 *     no banco e seguem valendo como antes; "mentor" pede só mentoria.
 */

vi.mock("./routers/consent", () => ({
  hasValidConsent: async () => true,
  usersComConsentimento: async (ids: number[]) => new Set(ids),
}));
const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));
const filas: unknown[][] = [];
function cadeiaDeSelect() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["from", "where", "innerJoin", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
  (cadeia as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(filas.shift() ?? []).then(resolve, reject);
  return cadeia;
}
const fakeDb = { select: () => cadeiaDeSelect() };
vi.mock("./db", () => ({ getDb: async () => fakeDb as never, exigirDb: async () => fakeDb as never, createNotification: async () => {} }));

const { CHAVES_O_QUE_BUSCA, CHAVE_OUTRA_NECESSIDADE } = await import("@shared/o-que-busca");
const {
  exigeCitacao, necessidadesEscritasDoPerfil, passaNoPortao, perfilDeclarouPrecisarDoServico, REGRA_DA_DEMANDA_EXPRESSA,
  rotularBuscas, temNecessidadeDeclarada,
} = await import("./portao-da-demanda-expressa");
const { calculateCompatibilityScore, generateMatchInsight } = await import("./matching");
const { matchingRouter } = await import("./routers/matching");

const perfil = (extra: Partial<UserProfile>) => ({ whatIHave: null, whatINeed: null, ...extra }) as unknown as UserProfile;
const respostaDaIA = (corpo: unknown) => ({ choices: [{ message: { content: JSON.stringify(corpo) } }] });
const ctx = { user: { id: 1, openId: "dona-1", email: "t@local", role: "silver" }, req: { headers: {}, socket: {} }, res: { cookie: () => {} } } as never;
const SERVICO = "Consultoria tributária";

beforeEach(() => { invokeLLM.mockReset(); filas.length = 0; });

describe("As 12 chaves novas, uma a uma, no portão da IA", () => {
  it("são as 12 do cadastro (se a lista mudar, este arquivo precisa decidir a chave nova)", () => {
    expect(CHAVES_O_QUE_BUSCA).toEqual([
      "expandir_negocio", "parceiro_estrategico", "investimento_capital", "clientes_compradores", "fornecedores_produtos",
      "internacionalizacao", "conexoes_institucionais", "tecnologia_solucoes", "talentos_especialistas", "servico_especializado",
      "visibilidade_posicionamento", "outra_necessidade",
    ]);
  });

  it.each(CHAVES_O_QUE_BUSCA.map(chave => [chave]))("%s sozinha não libera oportunidade que oferece serviço", (chave) => {
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: [chave] }, SERVICO)).toBe(false);
    expect(passaNoPortao({ tipoDaOferta: "nenhuma", necessidadeExpressa: "" }, "Consultoria tributária | revisão de tributos", { seekingTypes: [chave] }, { type: "offer", title: SERVICO })).toBe(false);
  });

  it.each(CHAVES_O_QUE_BUSCA.filter(chave => chave !== "servico_especializado" && chave !== CHAVE_OUTRA_NECESSIDADE).map(chave => [chave]))(
    "%s é base declarada fora do serviço: o piso não exige citação",
    (chave) => {
      const soServico = { whatIHave: ["Advocacia tributária"], whatINeed: [], seekingTypes: [chave] };
      expect(temNecessidadeDeclarada(soServico)).toBe(true);
      expect(exigeCitacao({ tipoDaOferta: "nenhuma" }, soServico)).toBe(false);
    },
  );

  it("servico_especializado é genérica: não é base, e o perfil só de serviço segue exigindo citação", () => {
    const soServico = { whatIHave: ["Advocacia tributária"], whatINeed: [], seekingTypes: ["servico_especializado"] };
    expect(temNecessidadeDeclarada(soServico)).toBe(false);
    expect(exigeCitacao({ tipoDaOferta: "nenhuma" }, soServico)).toBe(true);
    for (const servico of ["Consultoria tributária", "Marketing digital", "Consultoria regulatória", "Advocacia trabalhista"]) {
      expect(perfilDeclarouPrecisarDoServico({ seekingTypes: ["servico_especializado"] }, servico), servico).toBe(false);
    }
  });

  it("outra_necessidade vale pelo TEXTO, como 'O que preciso': nomeia o serviço, libera; pede outra coisa, não", () => {
    const comTexto = (seekingOtherNeed: string) => ({ seekingTypes: [CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed });
    expect(perfilDeclarouPrecisarDoServico(comTexto("Consultor tributário para revisar o ICMS"), SERVICO)).toBe(true);
    expect(perfilDeclarouPrecisarDoServico(comTexto("Precisamos revisar nossos tributos"), SERVICO)).toBe(true);
    expect(perfilDeclarouPrecisarDoServico(comTexto("Distribuidor para a África"), SERVICO)).toBe(false);
    expect(perfilDeclarouPrecisarDoServico(comTexto("Consultoria em marketing"), SERVICO)).toBe(false);
    expect(temNecessidadeDeclarada(comTexto("Consultor tributário"))).toBe(true);
    // Sem texto, ou com texto velho e a opção desmarcada, não há necessidade declarada.
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: [CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed: "  " }, SERVICO)).toBe(false);
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: [], seekingOtherNeed: "Consultor tributário" }, SERVICO)).toBe(false);
    expect(temNecessidadeDeclarada({ seekingTypes: [CHAVE_OUTRA_NECESSIDADE] })).toBe(false);
    expect(necessidadesEscritasDoPerfil({ whatINeed: ["distribuidores"], seekingTypes: [CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed: " Contador " }))
      .toEqual(["distribuidores", "Contador"]);
  });
});

describe("As chaves antigas continuam valendo", () => {
  it.each([["investor"], ["strategic_partner"], ["team"], ["job"]])("%s: base declarada, mas não libera serviço", (chave) => {
    expect(temNecessidadeDeclarada({ whatIHave: ["Advocacia tributária"], seekingTypes: [chave] })).toBe(true);
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: [chave] }, SERVICO)).toBe(false);
  });

  it("mentor pede só mentoria", () => {
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: ["mentor"] }, "Mentoria para fundadoras")).toBe(true);
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: ["mentor"] }, SERVICO)).toBe(false);
  });

  it("be_mentor ('Quero também mentorar') é oferta: nem base, nem libera serviço (liberava qualquer um até 14/09)", () => {
    expect(temNecessidadeDeclarada({ whatIHave: ["Advocacia tributária"], seekingTypes: ["be_mentor"] })).toBe(false);
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: ["be_mentor"] }, SERVICO)).toBe(false);
    expect(perfilDeclarouPrecisarDoServico({ seekingTypes: ["be_mentor"] }, "Mentoria para fundadoras")).toBe(false);
  });

  it("os rótulos do prompt: novas pelo título, antigas pela equivalente ou pelo rótulo de antes, a genérica marcada", () => {
    expect(rotularBuscas(["investimento_capital", "investor", "job", "mentor", "servico_especializado"]))
      .toBe("Investimento / Capital, Investimento / Capital, Emprego/Projeto, Mentora, Serviço Especializado (genérica: não declara necessidade de um serviço específico)");
    expect(rotularBuscas(null)).toBe("");
  });

  it("a regra do prompt diz que a genérica não é necessidade e que o texto de 'Outra necessidade' é", () => {
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("\"Serviço Especializado\" é genérica");
    expect(REGRA_DA_DEMANDA_EXPRESSA).toContain("O texto de \"Outra necessidade\" é necessidade declarada");
  });
});

describe("As chaves no motor de perfis (calculateCompatibilityScore)", () => {
  const tributarista = perfil({ whatIHave: ["Advocacia tributária"] });

  it.each(CHAVES_O_QUE_BUSCA.map(chave => [chave]))("%s sozinha não tira o serviço do bloqueio", (chave) => {
    const r = calculateCompatibilityScore(tributarista, perfil({ seekingTypes: [chave] }));
    expect(r.bloqueio).toBe("servico-sem-demanda-expressa");
    expect(r.overall).toBe(0);
  });

  it("o texto de 'Outra necessidade' que nomeia o serviço é base expressa, como 'o que preciso'", () => {
    const r = calculateCompatibilityScore(tributarista, perfil({ seekingTypes: [CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed: "Advogado tributarista para revisar o ICMS" } as Partial<UserProfile>));
    expect(r.bloqueio).toBeUndefined();
    expect(r.complementarity).toBe(60);
    // Texto velho com a opção desmarcada não conta.
    expect(calculateCompatibilityScore(tributarista, perfil({ seekingTypes: [], seekingOtherNeed: "Advogado tributarista" } as Partial<UserProfile>)).bloqueio)
      .toBe("servico-sem-demanda-expressa");
  });

  it("para os outros tipos nada muda: produto e ativo casam como antes com qualquer busca", () => {
    for (const chave of CHAVES_O_QUE_BUSCA) {
      expect(calculateCompatibilityScore(perfil({ whatIHave: ["fazenda"] }), perfil({ seekingTypes: [chave] })).bloqueio, chave).toBeUndefined();
    }
  });

  it("a dimensão de busca reconhece a chave antiga pela equivalente nova", () => {
    const antiga = calculateCompatibilityScore(perfil({ seekingTypes: ["investor"] }), perfil({ seekingTypes: ["investimento_capital"] }));
    const diferente = calculateCompatibilityScore(perfil({ seekingTypes: ["investor"] }), perfil({ seekingTypes: ["talentos_especialistas"] }));
    expect(antiga.objectives).toBeGreaterThan(0);
    expect(diferente.objectives).toBe(0);
    expect(calculateCompatibilityScore(perfil({ seekingTypes: ["team"] }), perfil({ seekingTypes: ["talentos_especialistas"] })).objectives).toBeGreaterThan(0);
    expect(calculateCompatibilityScore(perfil({ seekingTypes: ["strategic_partner"] }), perfil({ seekingTypes: ["parceiro_estrategico"] })).objectives).toBeGreaterThan(0);
  });

  it("o insight recebe a busca rotulada, a genérica marcada, e o texto de 'Outra necessidade' em 'precisa'", async () => {
    invokeLLM.mockResolvedValue({ choices: [{ message: { content: "insight" } }] });
    const a = perfil({ whatIHave: ["Advocacia tributária"], seekingTypes: ["servico_especializado"] });
    const b = perfil({ seekingTypes: [CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed: "Advogado tributarista" } as Partial<UserProfile>);
    await generateMatchInsight(a, b, calculateCompatibilityScore(a, b));
    const prompt = (invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages.find(m => m.role === "user")!.content;
    expect(prompt).toContain("Busca: Serviço Especializado (genérica");
    expect(prompt).toContain("O que B precisa: Advogado tributarista");
    expect(prompt).not.toContain("servico_especializado");
  });
});

describe("As chaves nos prompts de routers/matching.ts", () => {
  it("a recomendação manda as buscas rotuladas e o texto de 'Outra necessidade' em 'O que preciso'; a genérica não libera a oferta de serviço", async () => {
    const oportunidades = [
      { id: 51, title: "Consultoria tributária para indústrias", sector: "Serviços", type: "offer", tags: [], description: "Revisão de tributos", status: "active", publishedBy: 9, isConfidential: false },
      { id: 52, title: "Consultoria em marketing digital", sector: "Serviços", type: "offer", tags: [], description: "Campanhas", status: "active", publishedBy: 9, isConfidential: false },
    ];
    filas.push([{ userId: 1, whatIHave: ["fazenda"], whatINeed: [], seekingTypes: ["servico_especializado", CHAVE_OUTRA_NECESSIDADE], seekingOtherNeed: "Consultor tributário para revisar o ICMS" }], oportunidades);
    invokeLLM.mockResolvedValue(respostaDaIA({ matches: [
      { index: 0, score: 90, reason: "Pediu", tipoDaOferta: "nenhuma", necessidadeExpressa: "" },
      { index: 1, score: 88, reason: "Serviço especializado", tipoDaOferta: "nenhuma", necessidadeExpressa: "" },
    ] }));
    const silencio = vi.spyOn(console, "info").mockImplementation(() => {});

    const lista = await matchingRouter.createCaller(ctx).getRecommendedOpportunities();

    silencio.mockRestore();
    const usuario = (invokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages.find(m => m.role === "user")!.content;
    expect(usuario).toContain("O que preciso: [\"Consultor tributário para revisar o ICMS\"]");
    expect(usuario).toContain("Buscando: Serviço Especializado (genérica");
    expect(lista.map(o => o.id)).toEqual([51]);
  });
});
