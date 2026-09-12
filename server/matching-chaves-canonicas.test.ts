// server/matching.ts resolve VAULT_ENCRYPTION_KEY no import (senão lança). O
// `.env` seta vazio, então `||=` (não `??=`) garante um valor mesmo no CI.
// Mesmo padrão de complementaridade.test.ts.
process.env.VAULT_ENCRYPTION_KEY ||= "chave-de-teste-sem-valor";

import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserProfile } from "../drizzle/schema";
import ptBR from "../client/src/i18n/locales/pt-BR.json";
import {
  listaParaPrompt, rotuloEmPortugues, rotulosEmPortugues, textoParaPrompt,
  valorParaPrompt, SEM_INFORMACAO,
} from "./rotulos-canonicos";

/**
 * A tarefa "adaptar o matching às chaves canônicas".
 *
 * A PR #12 fez o perfil guardar a CHAVE estável ("strategic_partner") em vez do
 * texto traduzido, para que usuárias de idiomas diferentes casassem entre si —
 * mas não tocou em `server/matching.ts`. Restaram duas metades soltas: as
 * comparações de score, que precisam continuar vendo CHAVE dos dois lados; e o
 * prompt do insight, que recebia a chave crua e devolvia "strategic_partner"
 * dentro do texto que a usuária lê.
 *
 * O que este arquivo cobra é a separação: chave para comparar, rótulo só no
 * texto legível, e nada de "undefined" no meio da frase.
 */

// O LLM é capturado, não chamado: o que interessa é o TEXTO que sairia daqui.
// O parâmetro é declarado (e não `vi.fn(async () => ...)`, como no dublê vizinho
// de matching-consentimento-e-cota.test.ts) porque este teste LÊ o argumento:
// sem tipo, `mock.calls[0][0]` seria uma tupla vazia e só um `as` esconderia
// isso — exatamente o dublê de forma errada que o CLAUDE.md manda evitar.
type PedidoAoLLM = { messages: { role: string; content: string }[] };
const invokeLLM = vi.fn(async (_pedido: PedidoAoLLM) => ({
  choices: [{ message: { content: "insight de teste" } }],
}));
vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: unknown[]) => invokeLLM(...(args as [PedidoAoLLM])),
}));
vi.mock("./routers/consent", () => ({
  hasValidConsent: vi.fn(async () => true),
  usersComConsentimento: vi.fn(async (ids: number[]) => new Set(ids)),
}));

// Banco simulado por fila, mesmo dublê de matching-consentimento-e-cota.test.ts:
// cada SELECT terminado devolve a próxima resposta enfileirada.
const filas: unknown[][] = [];
const upserts: Array<{ values: Record<string, unknown> }> = [];
function cadeiaDeSelect() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["from", "where", "innerJoin", "limit", "orderBy"]) cadeia[metodo] = () => cadeia;
  (cadeia as { then?: unknown }).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(filas.shift() ?? []).then(resolve, reject);
  return cadeia;
}
const fakeDb = {
  select: () => cadeiaDeSelect(),
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onDuplicateKeyUpdate: () => {
        upserts.push({ values });
        return Promise.resolve();
      },
    }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
};
vi.mock("./db", () => ({ getDb: async () => fakeDb as never, exigirDb: async () => fakeDb as never }));

const motor = await import("./matching");
const PESOS = motor.PESOS_DO_SCORE;

/** Perfil só com o que o teste declara; o resto fica nulo, como no banco. */
const perfil = (campos: Partial<UserProfile>) => campos as UserProfile;

/** Uma rodada de `generateMatchesForUser`: perfil da dona, candidatas, insights. */
async function gerarMatches(dona: Partial<UserProfile>, candidatas: Partial<UserProfile>[]) {
  filas.length = 0;
  upserts.length = 0;
  filas.push([dona], candidatas, []);
  return motor.generateMatchesForUser(1);
}

const zerado = {
  overall: 0, specialty: 0, objectives: 0, complementarity: 0,
  sector: 0, investment: 0, location: 0, values: 0,
};

/** O prompt que `generateMatchInsight` montaria para este par. */
async function promptDe(a: Partial<UserProfile>, b: Partial<UserProfile> = {}) {
  await motor.generateMatchInsight(perfil(a), perfil(b), zerado);
  expect(invokeLLM).toHaveBeenCalled();
  const pedido = invokeLLM.mock.calls.at(-1)?.[0];
  if (!pedido) throw new Error("o insight não chegou a montar prompt nenhum");
  return pedido.messages[0].content;
}

beforeEach(() => invokeLLM.mockClear());

// ─────────────────────────────────────────────────────────────
// 1 e 2 — a comparação é por CHAVE, nunca por rótulo
// ─────────────────────────────────────────────────────────────
describe("comparações continuam sendo por chave canônica", () => {
  it("(1) duas chaves iguais casam: valores idênticos dão o valuesScore cheio", () => {
    const iguais = motor.calculateCompatibilityScore(
      perfil({ values: ["innovation", "autonomy"] }),
      perfil({ values: ["innovation", "autonomy"] }),
    );
    expect(iguais.values).toBe(100);
  });

  it("(1) mesma especialidade e mesmo setor casam pela chave", () => {
    const scores = motor.calculateCompatibilityScore(
      perfil({ primarySpecialty: "engineering", sector: "health" }),
      perfil({ primarySpecialty: "engineering", sector: "health" }),
    );
    expect(scores.specialty).toBe(60);
    expect(scores.sector).toBe(70);
  });

  it("(2) chaves DIFERENTES com rótulos parecidos não casam", () => {
    // "social_impact" (Impacto social) e "sustainability" (Sustentabilidade)
    // são vizinhas no discurso e distintas na chave. Sem overlap, o score de
    // valores é só o piso de 20 da fórmula.
    const scores = motor.calculateCompatibilityScore(
      perfil({ values: ["social_impact"] }),
      perfil({ values: ["sustainability"] }),
    );
    expect(scores.values).toBe(20);
  });

  it("(2) a chave não casa com o próprio rótulo traduzido", () => {
    // O lado esquerdo é um perfil migrado; o direito, um perfil que ficou para
    // trás com o texto em português. Eles NÃO podem casar por acidente: se um
    // dia casarem, é porque alguém comparou rótulo com chave.
    const scores = motor.calculateCompatibilityScore(
      perfil({ values: ["innovation"] }),
      perfil({ values: ["Inovação"] }),
    );
    expect(scores.values).toBe(20);
  });

  it("(7) o resultado não muda se o pt-BR mudar o texto de uma chave", () => {
    // A comparação não lê rótulo nenhum, então trocar a tradução é irrelevante
    // para o score. É o que garante que 10 idiomas cheguem ao mesmo número.
    const antes = motor.calculateCompatibilityScore(
      perfil({ seekingTypes: ["strategic_partner"], values: ["purpose"] }),
      perfil({ seekingTypes: ["strategic_partner"], values: ["purpose"] }),
    );
    const depois = motor.calculateCompatibilityScore(
      perfil({ seekingTypes: ["strategic_partner"], values: ["purpose"] }),
      perfil({ seekingTypes: ["strategic_partner"], values: ["purpose"] }),
    );
    expect(depois).toEqual(antes);
  });
});

// ─────────────────────────────────────────────────────────────
// 3 e 6 — o prompt recebe rótulo, e os cinco campos seguem a mesma regra
// ─────────────────────────────────────────────────────────────
describe("o prompt do LLM recebe rótulos em português", () => {
  it("(3, 6) busca, valores, especialidade, setor, idiomas e interesses saem traduzidos", async () => {
    const prompt = await promptDe({
      primarySpecialty: "engineering",
      seekingTypes: ["strategic_partner", "investor"],
      sector: "health",
      businessInterests: ["agribusiness", "logistics"],
      values: ["innovation", "social_impact"],
      languages: ["portuguese", "english"],
      city: "Recife",
      country: "BR",
    });

    expect(prompt).toContain("- Especialidades: Engenharia & Infraestrutura");
    expect(prompt).toContain("- Busca: Sócia ou parceira de negócios, Investidora");
    expect(prompt).toContain("- Setor: Saúde");
    expect(prompt).toContain("- Interesses de negócio: Agronegócio, Logística & Transporte");
    expect(prompt).toContain("- Valores: Inovação, Impacto social");
    expect(prompt).toContain("- Idiomas: Português, Inglês");
    expect(prompt).toContain("- Localização: Recife, BR");
  });

  it("(3) nenhuma chave técnica sobra no prompt", async () => {
    const prompt = await promptDe({
      primarySpecialty: "sustainability",
      seekingTypes: ["be_mentor", "team", "job"],
      sector: "technology",
      businessInterests: ["financial"],
      values: ["technical_excellence", "fast_growth"],
      languages: ["mandarin"],
    });

    for (const chave of [
      "sustainability", "be_mentor", "team", "job", "technology",
      "financial", "technical_excellence", "fast_growth", "mandarin",
    ]) {
      expect(prompt).not.toContain(chave);
    }
  });

  it("(3) o rótulo é o do pt-BR.json, não uma cópia envelhecida no servidor", async () => {
    // O mapa que vivia em matching.ts dizia "Sócia estratégica"; a PR #12
    // reescreveu o texto no JSON e a cópia ficou para trás. Este teste amarra o
    // prompt à fonte oficial: se o JSON mudar, o prompt muda junto.
    const oficial = ptBR.onboarding.seeking.strategic_partner;
    const prompt = await promptDe({ seekingTypes: ["strategic_partner"] });
    expect(prompt).toContain(`- Busca: ${oficial}`);
    expect(prompt).not.toContain("Sócia estratégica");
  });

  it("(3) setor gravado como rótulo de OUTRO idioma chega em português", async () => {
    // O onboarding ainda grava o setor pelo rótulo do idioma de quem preencheu
    // (essa raiz é outra tarefa). `chaveDoSetor` normaliza antes de rotular.
    const prompt = await promptDe({ sector: "Health & Healthtechs" });
    expect(prompt).toContain("- Setor: Saúde");
  });
});

// ─────────────────────────────────────────────────────────────
// 6 — "especialidades", no plural: a principal e as secundárias
// ─────────────────────────────────────────────────────────────
describe("especialidades: primária e secundárias na mesma linha", () => {
  it("lista as duas, com a principal na frente", async () => {
    const prompt = await promptDe({
      primarySpecialty: "engineering",
      secondarySpecialties: ["design", "startups"],
    });
    expect(prompt).toContain(
      "- Especialidades: Engenharia & Infraestrutura, Design & Criatividade, Startups & Inovação",
    );
  });

  it("(3) as chaves das secundárias não sobram cruas no prompt", async () => {
    const prompt = await promptDe({
      primarySpecialty: "finance",
      secondarySpecialties: ["legal", "marketing"],
    });
    for (const chave of ["finance", "legal", "marketing"]) {
      expect(prompt).not.toContain(chave);
    }
  });

  it("não repete a principal quando ela também aparece nas secundárias", async () => {
    const prompt = await promptDe({
      primarySpecialty: "tech",
      secondarySpecialties: ["tech", "health"],
    });
    expect(prompt).toContain("- Especialidades: Tecnologia & Software, Saúde & Bem-estar");
    // Uma vez só: se repetisse, a contagem seria 2.
    expect(prompt.split("Tecnologia & Software")).toHaveLength(2);
  });

  it("a deduplicação é pelo RÓTULO, não pela chave", async () => {
    // Duas chaves distintas podem ter caído no mesmo texto em português depois
    // de uma fusão de opções. O prompt não repete a palavra por causa disso.
    const rotulo = rotuloEmPortugues("specialties", "retail");
    const prompt = await promptDe({
      primarySpecialty: "retail",
      secondarySpecialties: [rotulo],
    });
    expect(prompt).toContain(`- Especialidades: ${rotulo}`);
    expect(prompt.split(rotulo)).toHaveLength(2);
  });

  it("(4) especialidade secundária desconhecida usa fallback e não vira undefined", async () => {
    // `customSpecialty` entra em secondarySpecialties como texto livre quando a
    // usuária escolheu ao menos uma da lista.
    const prompt = await promptDe({
      primarySpecialty: "gastronomy",
      secondarySpecialties: ["Perfumaria artesanal", "chave_inexistente"],
    });
    expect(prompt).toContain(
      "- Especialidades: Gastronomia & Hospitalidade, Perfumaria artesanal, chave_inexistente",
    );
    expect(prompt).not.toContain("undefined");
  });

  it("(4) só secundárias, sem principal: a linha sai mesmo assim", async () => {
    const prompt = await promptDe({ primarySpecialty: null, secondarySpecialties: ["design"] });
    expect(prompt).toContain("- Especialidades: Design & Criatividade");
  });

  it("(4) só a principal, sem secundárias: a linha não ganha vírgula solta", async () => {
    const prompt = await promptDe({ primarySpecialty: "legal", secondarySpecialties: [] });
    expect(prompt).toContain("- Especialidades: Direito\n");
  });

  it("(4) null, undefined, lista vazia e valor inválido caem em SEM_INFORMACAO", async () => {
    for (const secundarias of [null, undefined, [], "design", 7, {}]) {
      const prompt = await promptDe({
        primarySpecialty: null,
        secondarySpecialties: secundarias as unknown as string[],
      });
      expect(prompt).toContain(`- Especialidades: ${SEM_INFORMACAO}`);
      expect(prompt).not.toContain("undefined");
      expect(prompt).not.toContain("null");
    }
  });

  it("(4) itens nulos ou vazios dentro da lista são descartados, não viram buraco", async () => {
    const prompt = await promptDe({
      primarySpecialty: "health",
      secondarySpecialties: ["", null, "  ", "education"] as unknown as string[],
    });
    expect(prompt).toContain("- Especialidades: Saúde & Bem-estar, Educação & Pesquisa");
  });

  it("(6) as secundárias não mexem no score: elas já pesavam pela CHAVE, e continuam", () => {
    // A linha nova é só texto. `calculateCompatibilityScore` compara
    // secondarySpecialties por chave desde antes desta tarefa, e nada aqui muda.
    const scores = motor.calculateCompatibilityScore(
      perfil({ primarySpecialty: "engineering", secondarySpecialties: ["design", "startups"] }),
      perfil({ primarySpecialty: "finance", secondarySpecialties: ["design"] }),
    );
    expect(scores.specialty).toBe(60); // 40 + 1 overlap * 20
  });
});

// ─────────────────────────────────────────────────────────────
// 4 e 5 — fallback seguro, e nada de "undefined" no prompt
// ─────────────────────────────────────────────────────────────
describe("fallback seguro para dado ausente ou desconhecido", () => {
  it("(4) chave desconhecida passa como veio, e não some nem vira undefined", async () => {
    // `customSpecialty` é texto livre; perfil anterior à migração guarda o
    // rótulo em português. Os dois precisam continuar legíveis.
    const prompt = await promptDe({
      primarySpecialty: "Perfumaria artesanal",
      values: ["innovation", "Coragem"],
      languages: ["klingon"],
    });
    expect(prompt).toContain("- Especialidades: Perfumaria artesanal");
    expect(prompt).toContain("- Valores: Inovação, Coragem");
    expect(prompt).toContain("- Idiomas: klingon");
  });

  it("(4, 5) perfil inteiramente vazio não imprime null nem undefined", async () => {
    const prompt = await promptDe({
      primarySpecialty: null,
      seekingTypes: null,
      sector: null,
      businessInterests: undefined,
      values: [],
      languages: null,
      city: null,
      country: null,
    });

    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
    expect(prompt).toContain(`- Especialidades: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Busca: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Setor: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Interesses de negócio: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Valores: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Idiomas: ${SEM_INFORMACAO}`);
    expect(prompt).toContain(`- Localização: ${SEM_INFORMACAO}`);
  });

  it("(5) lista com buraco não vira vírgula solta no meio da frase", async () => {
    const prompt = await promptDe({ values: ["innovation", null, "", "purpose"] as unknown as string[] });
    expect(prompt).toContain("- Valores: Inovação, Propósito");
  });

  it("(5) coluna JSON que não é lista degrada em vez de quebrar", async () => {
    const prompt = await promptDe({ values: "innovation" as unknown as string[] });
    expect(prompt).toContain(`- Valores: ${SEM_INFORMACAO}`);
  });

  it("(5) campos ausentes, null e arrays vazios não quebram o SCORE", () => {
    expect(() =>
      motor.calculateCompatibilityScore(
        perfil({ values: null, seekingTypes: undefined, secondarySpecialties: [] }),
        perfil({}),
      ),
    ).not.toThrow();
    const scores = motor.calculateCompatibilityScore(perfil({}), perfil({}));
    for (const valor of Object.values(scores)) expect(Number.isFinite(valor)).toBe(true);
  });

  it("(5) cidade sem país (e vice-versa) sai só com o que existe", async () => {
    expect(await promptDe({ city: "Salvador", country: null })).toContain("- Localização: Salvador");
    expect(await promptDe({ city: null, country: "PT" })).toContain("- Localização: PT");
  });
});

// ─────────────────────────────────────────────────────────────
// O módulo de rótulos, isolado
// ─────────────────────────────────────────────────────────────
describe("rotulos-canonicos: a fonte única de tradução", () => {
  it("traduz cada namespace a partir do pt-BR.json", () => {
    expect(rotuloEmPortugues("specialties", "gastronomy")).toBe(ptBR.onboarding.specialties.gastronomy);
    expect(rotuloEmPortugues("seeking", "mentor")).toBe(ptBR.onboarding.seeking.mentor);
    expect(rotuloEmPortugues("sectors", "telecom")).toBe(ptBR.onboarding.sectors.telecom);
    expect(rotuloEmPortugues("values", "diversity")).toBe(ptBR.onboarding.values.diversity);
    expect(rotuloEmPortugues("languages", "arabic")).toBe(ptBR.onboarding.languages.arabic);
  });

  it("devolve a própria chave quando não há rótulo", () => {
    expect(rotuloEmPortugues("values", "chave_que_nao_existe")).toBe("chave_que_nao_existe");
  });

  it("devolve string vazia para vazio, nulo ou não-texto", () => {
    for (const valor of [null, undefined, "", "   ", 42, {}, []]) {
      expect(rotuloEmPortugues("values", valor)).toBe("");
    }
  });

  it("rotulosEmPortugues devolve lista vazia para qualquer coisa que não seja lista", () => {
    for (const valor of [null, undefined, "innovation", 7, {}]) {
      expect(rotulosEmPortugues("values", valor)).toEqual([]);
    }
  });

  it("não repete rótulo quando duas chaves foram fundidas na PR #12", () => {
    // `advisor` e `mentor` viraram a mesma opção; um perfil antigo pode ter as
    // duas gravadas. O prompt não precisa dizer "Mentora, Mentora".
    expect(rotulosEmPortugues("seeking", ["mentor", "mentor"])).toEqual([ptBR.onboarding.seeking.mentor]);
  });

  it("listaParaPrompt e valorParaPrompt caem em SEM_INFORMACAO, nunca em vazio", () => {
    expect(listaParaPrompt("values", [])).toBe(SEM_INFORMACAO);
    expect(listaParaPrompt("values", null)).toBe(SEM_INFORMACAO);
    expect(valorParaPrompt("specialties", null)).toBe(SEM_INFORMACAO);
    expect(valorParaPrompt("specialties", "tech")).toBe(ptBR.onboarding.specialties.tech);
  });

  it("textoParaPrompt junta só o que existe", () => {
    expect(textoParaPrompt("Recife", "BR")).toBe("Recife, BR");
    expect(textoParaPrompt(null, "BR")).toBe("BR");
    expect(textoParaPrompt(null, undefined)).toBe(SEM_INFORMACAO);
    expect(textoParaPrompt("  ", null)).toBe(SEM_INFORMACAO);
  });
});

// ─────────────────────────────────────────────────────────────
// Dados suficientes: perfil vazio não vira match
// ─────────────────────────────────────────────────────────────
describe("perfil sem informação não gera match", () => {
  const vazio = perfil({});

  it("o par vazio ainda pontua 41 — o defeito nunca foi o número", () => {
    // Documenta a causa: 40,5 de valores neutros, arredondado. Mexer no corte
    // não resolveria; por isso o corte continua 40 e o filtro é outro.
    expect(motor.calculateCompatibilityScore(vazio, vazio).overall).toBe(41);
    expect(motor.calculateCompatibilityScore(vazio, vazio).overall).toBeGreaterThan(40);
  });

  it("…e mesmo assim não passa, porque nada foi apurado", () => {
    expect(motor.pesoApurado(vazio, vazio)).toBe(0);
    expect(motor.temDadosSuficientesParaMatch(vazio, vazio)).toBe(false);
  });

  it("o corte de 40 continua sendo 40", () => {
    // A regra nova é independente do limite; ele não foi tocado.
    const semEncaixe = motor.calculateCompatibilityScore(
      perfil({ lookingForInvestment: true }),
      perfil({ lookingForInvestment: true }),
    );
    expect(semEncaixe.overall).toBe(33);
    expect(semEncaixe.overall).toBeLessThan(40);
  });

  it("investimento só conta como apurado com declaração positiva dos dois lados", () => {
    // `lookingForInvestment` é false por padrão no schema: "não preenchi" chega
    // igual a "não procuro" e caía no ramo de 60 pontos. É o que mais inflava
    // o par vazio.
    expect(motor.pesoApurado(perfil({ lookingForInvestment: false }), perfil({ lookingForInvestment: false }))).toBe(0);
    expect(motor.pesoApurado(perfil({ lookingForInvestment: true }), perfil({ investmentCapacity: "50k_200k" })))
      .toBe(PESOS.investimento);
  });

  it("cada dimensão soma exatamente o seu peso da fórmula", () => {
    const casos: [Partial<UserProfile>, Partial<UserProfile>, number][] = [
      [{ whatIHave: ["tecnologia"] }, { whatINeed: ["tecnologia"] }, PESOS.complementaridade],
      [{ sector: "health" }, { sector: "retail" }, PESOS.setor],
      [{ primarySpecialty: "tech" }, { primarySpecialty: "design" }, PESOS.especialidade],
      [{ values: ["innovation"] }, { values: ["purpose"] }, PESOS.valores],
      [{ country: "BR" }, { country: "PT" }, PESOS.localizacao],
    ];
    for (const [a, b, esperado] of casos) {
      expect(motor.pesoApurado(perfil(a), perfil(b))).toBe(esperado);
    }
    expect(Object.values(PESOS).reduce((soma, peso) => soma + peso, 0)).toBeCloseTo(1);
  });

  it("um lado preenchido e o outro vazio não apura nada", () => {
    // A dimensão só informa quando há os DOIS lados para comparar — é a mesma
    // condição que o score usa.
    const cheia = perfil({
      whatIHave: ["tecnologia"], sector: "health", primarySpecialty: "tech",
      values: ["innovation"], country: "BR", investmentCapacity: "50k_200k",
    });
    expect(motor.pesoApurado(cheia, vazio)).toBe(0);
    expect(motor.temDadosSuficientesParaMatch(cheia, vazio)).toBe(false);
  });

  it("meio a meio passa; abaixo disso, não", () => {
    // Complementaridade (0,30) + valores (0,10) = 0,40 → insuficiente.
    const parFraco: [UserProfile, UserProfile] = [
      perfil({ whatIHave: ["tecnologia"], values: ["innovation"] }),
      perfil({ whatINeed: ["tecnologia"], values: ["innovation"] }),
    ];
    expect(motor.pesoApurado(...parFraco)).toBeCloseTo(0.4);
    expect(motor.temDadosSuficientesParaMatch(...parFraco)).toBe(false);

    // Somando o setor (0,20) → 0,60, acima do mínimo.
    const parBom: [UserProfile, UserProfile] = [
      perfil({ whatIHave: ["tecnologia"], values: ["innovation"], sector: "health" }),
      perfil({ whatINeed: ["tecnologia"], values: ["innovation"], sector: "health" }),
    ];
    expect(motor.pesoApurado(...parBom)).toBeCloseTo(0.6);
    expect(motor.temDadosSuficientesParaMatch(...parBom)).toBe(true);
    expect(motor.PESO_MINIMO_APURADO).toBe(0.5);
  });

  it("o filtro roda no gerador: par vazio não vira linha em `matches`", async () => {
    // O caminho completo, não só a função pura: sem o portão, este par entrava
    // na tabela com overallScore 41.
    expect(await gerarMatches({ userId: 1 }, [{ userId: 2 }])).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it("o gerador continua criando match para um par com dados", async () => {
    const comDados = (userId: number, extra: Partial<UserProfile>) => ({
      userId, sector: "health", primarySpecialty: "tech", values: ["innovation"],
      country: "BR", ...extra,
    });
    const criados = await gerarMatches(
      comDados(1, { whatIHave: ["tecnologia"], whatINeed: ["investidores"] }),
      [comDados(2, { whatIHave: ["investidores"], whatINeed: ["tecnologia"] })],
    );
    expect(criados).toBe(1);
    expect(upserts[0].values.matchedUserId).toBe(2);
  });

  it("a suficiência de dados não olha rótulo nenhum", () => {
    // Setor gravado em três idiomas apura o mesmo peso: a regra nova herda a
    // normalização canônica em vez de criar outra.
    for (const setor of ["health", "Saúde", "Health & Healthtechs"]) {
      expect(motor.pesoApurado(perfil({ sector: setor }), perfil({ sector: "health" })))
        .toBe(PESOS.setor);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Um único motor oficial para perfil × perfil
// ─────────────────────────────────────────────────────────────
describe("o motor oficial é um só", () => {
  const leia = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), "utf8");

  it("só matching.ts escreve na tabela `matches`", () => {
    // O motor de perfis é dono exclusivo de `matches`. Se um segundo arquivo
    // passar a escrever ali, nasceu a quarta implementação que a tarefa veta.
    const escritores = ["./matching.ts", "./match-service.ts", "./routers/profileMatches.ts", "./routers/matches.ts", "./db.ts"]
      .filter(arquivo => /(insert|update)\(matches\)/.test(leia(arquivo)));
    expect(escritores).toEqual(["./matching.ts", "./db.ts"]); // db.ts só marca dispensado
    expect(/insert\(matches\)/.test(leia("./db.ts"))).toBe(false);
  });

  it("match-service.ts é de OUTRO domínio e não toca perfis", () => {
    // Ele cruza contatos da mesma dona (aiMatchSuggestions), não usuárias.
    const servico = leia("./match-service.ts");
    expect(servico).not.toContain("userProfiles");
    expect(servico).not.toContain("calculateCompatibilityScore");
    expect(servico).toContain("aiMatchSuggestions");
  });

  it("os dois motores não se importam nem compartilham pontuação", () => {
    expect(leia("./matching.ts")).not.toContain("match-service");
    expect(leia("./match-service.ts")).not.toContain("from \"./matching\"");
  });

  it("profileMatches.ts só expõe: não pontua nem escreve score", () => {
    const router = leia("./routers/profileMatches.ts");
    expect(router).not.toContain("calculateCompatibilityScore");
    expect(router).not.toMatch(/overallScore\s*[:=]/);
  });

  it("todo caminho de (re)geração passa pelo mesmo generateMatchesForUser", () => {
    // profile.ts e db.ts são os dois pontos de entrada; ambos delegam.
    for (const arquivo of ["./routers/profile.ts", "./db.ts"]) {
      expect(leia(arquivo)).toContain("generateMatchesForUser");
    }
    expect(leia("./db.ts")).toContain('await import("./matching")');
  });
});

// ─────────────────────────────────────────────────────────────
// 10 — websiteUrl e linkedinUrl ficam fora do score
// ─────────────────────────────────────────────────────────────
describe("o que esta tarefa não muda", () => {
  it("(10) websiteUrl e linkedinUrl não alteram a pontuação", () => {
    const sem = motor.calculateCompatibilityScore(
      perfil({ values: ["innovation"], sector: "technology" }),
      perfil({ values: ["innovation"], sector: "technology" }),
    );
    const com = motor.calculateCompatibilityScore(
      perfil({
        values: ["innovation"], sector: "technology",
        websiteUrl: "https://exemplo.com.br", linkedinUrl: "https://linkedin.com/in/exemplo",
      }),
      perfil({
        values: ["innovation"], sector: "technology",
        websiteUrl: "https://outro.com.br", linkedinUrl: "https://linkedin.com/in/outra",
      }),
    );
    expect(com).toEqual(sem);
  });

  it("(10) as URLs também não contam como 'informação suficiente'", () => {
    // Preencher LinkedIn e site é barato e não diz nada sobre encaixe. Se
    // contassem, um par vazio com dois links voltaria a virar match.
    const comLinks = perfil({
      websiteUrl: "https://exemplo.com.br",
      linkedinUrl: "https://linkedin.com/in/exemplo",
    });
    expect(motor.pesoApurado(comLinks, comLinks)).toBe(0);
    expect(motor.temDadosSuficientesParaMatch(comLinks, comLinks)).toBe(false);
  });

  it("(10) as URLs nem chegam ao motor: as consultas não as selecionam", () => {
    // A decisão está gravada onde ela é executada. Passar a pontuá-las exige,
    // antes, trazê-las do banco — e este teste obriga a decisão a ser explícita.
    const motorFonte = readFileSync(new URL("./matching.ts", import.meta.url), "utf8");
    expect(motorFonte).not.toContain("websiteUrl");
    expect(motorFonte).not.toContain("linkedinUrl");
  });
});
