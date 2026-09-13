import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * Regra da demanda expressa no motor PRIVADO (contatos da mesma dona) —
 * pedido do Nicolas, 12/09/2026.
 *
 * "Advocacia tributária" registrada em "o que possui" casava por CATEGORIA com
 * qualquer necessidade de mesma categoria ("Distribuidor para a África", ambos
 * em "Serviços"): 60, acima do corte de 50, e virava sugestão. É o match
 * presumido que o pedido veta. Serviço agora só casa quando a necessidade o
 * NOMEIA — tag, objeto ou núcleo, que é o que já valia 100 — e a categoria em
 * comum deixa de ser evidência para esse tipo. Para os outros tipos nada muda.
 */
const { scoreMatch, slugifyMatchTag } = await import("./match-service");
const { nucleoDoTermo, nomeiamAMesmaCoisa, slugDoTermo } = await import("@shared/direcao-do-termo");

const item = (label: string, category: string | null = null) =>
  ({ slug: slugifyMatchTag(label), label, category });

describe("Serviço × necessidade presumida — os exemplos do pedido NÃO casam", () => {
  it("exemplo 2: serviços jurídicos tributários × indústria farmacêutica que procura distribuidor (mesma categoria)", () => {
    const r = scoreMatch(
      item("Serviços jurídicos especializados em Direito Tributário", "Serviços"),
      item("Distribuidor para expansão na África", "Serviços"),
    );
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBe("servico-sem-demanda-expressa");
  });

  it("exemplo 3: consultoria em internacionalização × empresa que procura investidor para a fábrica (mesma categoria)", () => {
    const r = scoreMatch(
      item("Consultoria em internacionalização de empresas", "Consultoria"),
      item("Investidor para ampliação da fábrica", "Consultoria"),
    );
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBe("servico-sem-demanda-expressa");
  });

  it("a categoria digitada como 'Serviços' basta para classificar: 'Direito tributário' [Serviços] × 'Compradores' [Serviços] não casa", () => {
    expect(scoreMatch(item("Direito tributário", "Serviços"), item("Compradores no exterior", "Serviços")).score).toBe(0);
  });
});

describe("Serviço × necessidade que o NOMEIA — casa em 100", () => {
  it("tag igual, objeto igual atrás de marcador fraco, e núcleo atravessando 'serviços de'", () => {
    expect(scoreMatch(item("Consultoria tributária"), item("Consultoria tributária")).score).toBe(100);
    expect(scoreMatch(item("Serviços jurídicos tributários"), item("Procura serviços jurídicos tributários")).score).toBe(100);
    expect(scoreMatch(item("Serviços de tradução"), item("Tradução")).score).toBe(100);
    expect(scoreMatch(item("Prestação de serviços de contabilidade"), item("Contabilidade")).score).toBe(100);
  });

  it("a necessidade genérica que nomeia a família do serviço é demanda expressa: 'Consultoria' × 'Consultoria jurídica'", () => {
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Consultoria", "Serviços")).score).toBe(100);
    expect(scoreMatch(item("Empresa de consultoria"), item("Procura consultoria")).score).toBe(100);
    // Outra especialidade pedida é outra necessidade; outra família também.
    expect(scoreMatch(item("Consultoria jurídica"), item("Consultoria em marketing")).score).toBe(0);
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Advocacia", "Serviços")).score).toBe(0);
  });

  it("o motor privado não adivinha paráfrase: exemplo 1 do pedido só casa nos motores por IA", () => {
    // "Serviços jurídicos tributários" × "assessoria tributária para revisar a
    // carga fiscal" é equivalência semântica de verdade — mas este motor decide
    // por tag/objeto/núcleo, nunca por parecença (spec da cliente). A paráfrase
    // é tratada pelos prompts de routers/matching.ts, com citação conferida.
    const r = scoreMatch(
      item("Serviços jurídicos especializados em Direito Tributário", "Jurídico"),
      item("Assessoria tributária para revisão da carga fiscal da empresa", "Jurídico"),
    );
    expect(r.score).toBe(0);
  });

  it("a similaridade (quando religada) é a compatibilidade semântica DEPOIS do portão", () => {
    expect(scoreMatch(item("Consultoria tributária"), item("Revisão de tributos"), 0.71)).toEqual({ score: 45, type: "semantic" });
  });
});

describe("Os outros tipos continuam casando por categoria", () => {
  it("investimento, mineração, produto: 60 pela categoria, como sempre", () => {
    expect(scoreMatch(item("Capital semente", "investimento"), item("Venture capital", "investimento"))).toEqual({ score: 60, type: "category" });
    expect(scoreMatch(item("Lavra", "Mineração"), item("Britagem", "mineracao"))).toEqual({ score: 60, type: "category" });
    expect(scoreMatch(item("Café especial", "Alimentos"), item("Fornecedor de cacau", "Alimentos"))).toEqual({ score: 60, type: "category" });
  });

  it("produto com palavra de serviço atrás de preposição segue nos 60 por categoria (não virou serviço)", () => {
    expect(scoreMatch(item("Peças de manutenção", "Produto"), item("Peças automotivas", "Produto"))).toEqual({ score: 60, type: "category" });
    expect(scoreMatch(item("Centro de treinamento", "Infraestrutura"), item("Galpão", "Infraestrutura"))).toEqual({ score: 60, type: "category" });
  });

  it("a necessidade pode ser serviço: quem TEM a categoria em comum é o ativo, não o pedido", () => {
    // O portão é sobre o que se OFERECE. Uma fábrica (ativo) diante de uma
    // necessidade de mesma categoria segue nos 60 de sempre.
    expect(scoreMatch(item("Fábrica de embalagens", "Indústria"), item("Consultoria industrial", "Indústria")).score).toBe(60);
  });

  it("sem categoria em comum, serviço ou não, é zero sem bloqueio nomeado para os outros tipos", () => {
    const r = scoreMatch(item("Lavra", "Mineração"), item("Frete", "Logística"));
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBeUndefined();
  });
});

describe("Núcleo do termo — o serviço nomeado pelo genitivo", () => {
  it("'serviços de X' e 'prestação de serviços de X' reduzem a X", () => {
    expect(nucleoDoTermo("Serviços de tradução")).toBe("traducao");
    expect(nucleoDoTermo("Prestação de serviços de contabilidade")).toBe("contabilidade");
    expect(nucleoDoTermo("Services of translation")).toBe("translation");
  });

  it("locativo e lugar continuam protegidos", () => {
    expect(nucleoDoTermo("Serviços para a China")).toBe("servicos-para-a-china");
    expect(nucleoDoTermo("Serviços da China")).toBe("servicos-da-china");
  });

  it("os casos antigos não mudam", () => {
    expect(nucleoDoTermo("Mina de terras raras")).toBe("terras-raras");
    expect(nucleoDoTermo("Sapatos de couro")).toBe("sapatos-de-couro");
    expect(nucleoDoTermo("Exportação para a China")).toBe("exportacao-para-a-china");
    expect(nucleoDoTermo("Terras raras")).toBe("terras-raras");
  });
});

describe("nomeiamAMesmaCoisa — a equivalência compartilhada com o motor de perfis", () => {
  it("mesmo objeto em direções opostas, marcador fraco e cabeça transparente", () => {
    expect(nomeiamAMesmaCoisa("Exportar vinho", "Importar vinho")).toBe(true);
    expect(nomeiamAMesmaCoisa("Terras raras", "Procura terras raras")).toBe(true);
    expect(nomeiamAMesmaCoisa("Mina de terras raras", "Fornecedor de terras raras")).toBe(true);
  });

  it("lugar não é mercadoria de quem declarou direção", () => {
    expect(nomeiamAMesmaCoisa("Importação da China", "Exportação da China")).toBe(false);
    expect(nomeiamAMesmaCoisa("China", "Procura China")).toBe(true);
  });

  it("coisas diferentes não casam", () => {
    expect(nomeiamAMesmaCoisa("Armazenagem refrigerada", "Terrenos com outorga")).toBe(false);
    expect(nomeiamAMesmaCoisa("Sapatos de couro", "Bolsa de couro")).toBe(false);
  });
});

describe("Fiação", () => {
  const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), "utf8");

  it("slugifyMatchTag é o slugDoTermo compartilhado", () => {
    for (const tag of ["Mineração de Terras Raras", "Nº 5", "شراب", "Import/export"]) {
      expect(slugifyMatchTag(tag)).toBe(slugDoTermo(tag));
    }
    expect(slugifyMatchTag("Mineração de Terras Raras")).toBe("mineracao-de-terras-raras");
  });

  it("o chat de enriquecimento manda a IA não deduzir o que ninguém disse", () => {
    const prompt = fonte(join("routers", "enrichment.ts"));
    expect(prompt).toContain("NUNCA deduza o que a pessoa oferece ou procura");
  });

  it("os prompts de oportunidade deixaram de pedir 'necessidades implícitas' e carregam a regra", () => {
    const rotas = fonte(join("routers", "matching.ts"));
    expect(rotas).not.toContain("necessidades implícitas");
    expect(rotas.split("REGRA_DA_DEMANDA_EXPRESSA").length - 1).toBeGreaterThanOrEqual(3); // import + 2 prompts
    expect(rotas.split("passaNoPortao(").length - 1).toBe(2); // recomendação e alerta
  });

  it("o insight do Dashboard recebe o que cada perfil tem/precisa e a ordem de não presumir", () => {
    const motor = fonte("matching.ts");
    expect(motor).toContain("nunca presuma que alguém precisa de um serviço");
    expect(motor).toContain("O que A precisa:");
  });
});
