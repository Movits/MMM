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

  it("a necessidade genérica que nomeia a família do serviço é demanda expressa, e vale 60 — não 100", () => {
    // Valia 100 até 13/09, e era o terceiro defeito do relato sobre a #101:
    // "Consultoria" procurado dava 100 para consultoria tributária, de
    // marketing E de segurança do trabalho, empatado com quem tivesse pedido
    // exatamente aquilo. 100 é a nota de quem tem a MESMA coisa. O par
    // CONTINUA existindo, acima do corte de 50 — derrubar para 0 repetiria o
    // defeito que a regra da especialidade consertou.
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Consultoria", "Serviços"))).toEqual({ score: 60, type: "category" });
    // Este valia 60 até 14/09 e passou a valer 100, junto com o conserto de
    // "Contabilidade" × "Contador" — é a MESMA regra, e a mudança é deliberada.
    // O defeito 3 era necessidade genérica contra oferta ESPECIALIZADA
    // ("Consultoria" pedido dando 100 para consultoria tributária, de marketing
    // e de segurança do trabalho, as três empatadas). Aqui os dois lados são
    // genéricos: uma empresa de consultoria diante de quem procura consultoria
    // não está a uma especialidade de distância — é o mesmo serviço. Manter 60
    // aqui exigiria um critério que separasse este par de "Contabilidade" ×
    // "Contador", e não existe: "empresa" e "procura" são estrutura.
    expect(scoreMatch(item("Empresa de consultoria"), item("Procura consultoria")).score).toBe(100);
    // Outra especialidade pedida é outra necessidade; outra família também.
    expect(scoreMatch(item("Consultoria jurídica"), item("Consultoria em marketing")).score).toBe(0);
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Advocacia", "Serviços")).score).toBe(0);
    // A família junta as flexões: "Advogado" procurado × "Advocacia tributária" possuído.
    expect(scoreMatch(item("Advocacia tributária", "Jurídico"), item("Advogado", "Jurídico")).score).toBe(60);
    expect(scoreMatch(item("Serviços jurídicos tributários"), item("Advogada")).score).toBe(60);
  });

  it("atividade e profissional da MESMA família, sem mais nada, são a mesma coisa: 100", () => {
    // Achado na revisão de 14/09 da #124, e era regressão da própria PR: com as
    // duas especialidades vazias, o par caía na regra da família e valia 60 (no
    // motor da #124 porque `mesmoConjunto` exigia conjunto não-vazio; no da
    // #127 porque `comoAtende` dava "familia" a todo pedido genérico). Abaixo do
    // EMAIL_THRESHOLD de 70 — o match existia e a pessoa NÃO era avisada.
    //
    // Quem oferece "Contabilidade" e quem procura "Contador" não estão a uma
    // especialidade de distância: é o mesmo serviço dito de dois jeitos.
    for (const categoria of [undefined, "Serviços"]) {
      expect(scoreMatch(item("Contabilidade", categoria), item("Contador", categoria)), `Contabilidade × Contador [${categoria}]`)
        .toEqual({ score: 100, type: "exact" });
      expect(scoreMatch(item("Advocacia", categoria), item("Advogado", categoria)), `Advocacia × Advogado [${categoria}]`)
        .toEqual({ score: 100, type: "exact" });
    }
    // Cabeça neutra é estrutura, como "empresa" e "procura" no teste acima.
    expect(scoreMatch(item("Escritório de contabilidade"), item("Contador"))).toEqual({ score: 100, type: "exact" });

    // E o que separa esses de "Consultoria jurídica" NÃO é ter especialidade —
    // ela é vazia nos dois —, é nomearem uma SEGUNDA família além da sua. Se
    // esta distinção se perder, o teste da família genérica acima cai junto.
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Consultoria", "Serviços")).score).toBe(60);
    expect(scoreMatch(item("Consultoria de marketing", "Serviços"), item("Consultoria", "Serviços")).score).toBe(60);

    // Do lado da NECESSIDADE, "nada além da família" é literal: adjetivo sozinho
    // e lugar dizem algo a mais, e a #127 os fixou em 60 (ver "a necessidade
    // que nomeia só a família vale 60 e fica no banco").
    expect(scoreMatch(item("Contabilidade"), item("Contábil")).score).toBe(60);
  });

  it("do lado da OFERTA, público e lugar não são especialidade: 100 diante da necessidade que nomeia só o serviço", () => {
    // Revisão de 14/09 na #127: "Contabilidade para pequenas empresas" ×
    // "Contador" ficava em 60, abaixo do EMAIL_THRESHOLD, e o mesmo em inglês e
    // espanhol. "Contabilidade em São Paulo" × "Contador" valia 60 por um
    // teste da própria integração da 9615971, e passa a 100 pela mesma regra.
    for (const [oferta, necessidade] of [
      ["Contabilidade para pequenas empresas", "Contador"], ["Contabilidade em São Paulo", "Contador"],
      ["Accounting services", "Accountant"], ["Despacho de abogados", "Abogado"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
    // O que diz algo a mais sobre O QUE se presta segue na nota da família: a
    // especialidade (o conserto do defeito 3), o público que é especialidade
    // curada ("divórcio" é família) e o público que nomeia outro serviço.
    for (const [oferta, necessidade] of [
      ["Consultoria tributária", "Consultoria"], ["Advogado para divórcio", "Advogado"], ["Marketing para advogados", "Marketing"],
    ] as Array<[string, string]>) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 60, type: "category" });
      }
    }
  });

  it("o mesmo serviço com escritório, 'firm' ou adjetivo de estilo vale 100; o falso positivo provado segue fechado", () => {
    // Revisão de 14/09 na #127: a regra estrita da palavra desconhecida cortava
    // estes pares. Só saem da especialidade a cabeça neutra (inclusive colada
    // depois do serviço, "law FIRM") e "estratégica" ao lado de especialidade
    // reconhecida.
    for (const [oferta, necessidade] of [
      ["Escritório de advocacia", "Escritório de advogados"], ["Tax law firm", "Tax lawyer"],
      ["Advocacia tributária estratégica", "Advogado tributarista"], ["Boutique de advocacia tributária", "Advogado tributarista"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
    // Sozinha, "estratégica" é o assunto da consultoria, não a genérica.
    expect(scoreMatch(item("Consultoria estratégica"), item("Consultoria"))).toEqual({ score: 60, type: "category" });
    for (const [oferta, necessidade] of [
      ["Consultoria em segurança do trabalho", "Consultoria trabalhista"], ["Consultoria em seguros empresariais", "Consultoria empresarial"],
      ["Sell-side advisory", "Buy-side advisory"], ["Consultoria publicitária imobiliária", "Consultoria imobiliária"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços")).score, `${oferta} × ${necessidade}`).toBe(0);
    }
  });

  it("\"cobertura\" não é imóvel: reportagem não escapa do portão", () => {
    // Também da revisão de 14/09. "cobertura" tinha entrado em IMOVEL junto com
    // apartamento e casa; fora do mercado imobiliário ela é reportagem, seguro
    // ou telhado. Classificado como imóvel, o item SAI do portão da demanda
    // expressa e volta a casar por categoria — o vazamento que a #101 fecha.
    expect(scoreMatch(item("Cobertura jornalística", "Serviços"), item("Compradores", "Serviços")).score).toBe(0);
    // Revisão de 14/09 na #127: "house" no fim do composto em inglês é a empresa, não o imóvel.
    expect(scoreMatch(item("Consulting house", "Consulting"), item("Buyers", "Consulting")).score).toBe(0);
  });

  it("mas a necessidade que nomeia a ESPECIALIDADE, e não só a família, segue valendo 100", () => {
    // A separação das duas notas é o conserto do defeito 3: pedir "Advogado"
    // é pedir a família; pedir "Advogado tributarista" é pedir este serviço.
    expect(scoreMatch(item("Advocacia tributária", "Jurídico"), item("Advogado tributarista", "Jurídico"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Consultoria tributária"), item("Consultor tributário")).score).toBe(100);
  });

  it("item coordenado ('Mina e consultoria mineral') fica com a mina e segue nos 60 por categoria", () => {
    expect(scoreMatch(item("Mina e consultoria mineral", "Mineração"), item("Britagem", "Mineração"))).toEqual({ score: 60, type: "category" });
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

/**
 * Defeito relatado em 13/09, depois de a #101 entrar em produção: a regra
 * passou a barrar pares em que a necessidade FOI declarada, só porque a
 * redação mudava. "Advocacia tributária" possuído × "Advogado tributarista"
 * procurado caía de 60 para 0 — e 0 não é só esconder: abaixo de
 * SAVE_THRESHOLD a linha não entra em `pares` e a limpeza de órfãos remove a
 * sugestão que havia. Quem escrevia a necessidade de forma MAIS específica
 * perdia o match; quem escrevia "Advogado" (genérico) continuava achando.
 */
describe("Serviço × necessidade declarada com outra flexão — casa (defeito da #101)", () => {
  it("a mesma família com a mesma especialidade casa em 100, escrita como for", () => {
    for (const [oferta, necessidade] of [
      ["Advocacia tributária", "Advogado tributarista"],
      ["Advocacia tributária", "Advogado de tributos"],
      ["Consultoria tributária", "Consultor tributário"],
      ["Advocacia trabalhista", "Advogado trabalhista"],
    ] as const) {
      const r = scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços"));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(100);
      expect(r.type, `${oferta} × ${necessidade}`).toBe("exact");
    }
  });

  it("e o que a #101 veio barrar continua barrado: outra família, outra especialidade, e a categoria em comum", () => {
    for (const [oferta, necessidade] of [
      ["Advocacia tributária", "Distribuidor para a África"],
      ["Advocacia tributária", "Contador"],
      ["Consultoria tributária", "Consultoria de marketing"],
      ["Advocacia trabalhista", "Advogado tributarista"],
      ["Sell-side advisory", "Buy-side advisory"],
    ] as const) {
      expect(scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços")).score, `${oferta} × ${necessidade}`).toBe(0);
    }
  });
});

/**
 * Quarto ponto do mesmo relato de 13/09: a regra só existia em português,
 * inglês e espanhol. Nos outros 7 idiomas nada era classificado como serviço,
 * então o portão NUNCA disparava — a regra da cliente simplesmente não valia
 * para quem escreve neles, e um serviço casava por categoria como antes da #101.
 *
 * Revisão de 14/09 na #127 (itens 3 e 6): com a categoria "Serviços" o par já
 * dava 0 na main, porque a categoria sozinha classifica o item como serviço — o
 * teste não provava nada sobre o idioma. Com a categoria escrita no idioma, na
 * main o par valia 60. E o conserto não pode ter levado a zero o que casava:
 * o mesmo serviço nesses idiomas vale 100, e o que as listas não leem vale a
 * categoria, como na main.
 */
describe("O portão dispara nos 10 idiomas (defeito da #101)", () => {
  it.each([
    ["pt", "Consultoria tributária", "Compradores", "Finanças"],
    ["en", "Tax consulting", "Buyers", "Finance"],
    ["es", "Asesoría fiscal", "Compradores", "Finanzas"],
    ["de", "Steuerberatung", "Maschinen", "Finanzen"],
    ["fr", "Conseil fiscal", "Machines", "Finances"],
    ["ru", "Налоговый консалтинг", "Покупатели", "Финансы"],
    ["hi", "कर परामर्श", "खरीदार", "वित्त"],
    ["ar", "استشارات ضريبية", "مشترون", "مالية"],
    ["zh", "税务咨询", "买家", "财务"],
    ["ja", "税務コンサルティング", "買い手", "財務"],
  ])("%s: serviço × necessidade presumida, com a categoria no idioma, não casa", (_idioma, oferta, necessidade, categoria) => {
    const r = scoreMatch(item(oferta, categoria), item(necessidade, categoria));
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBe("servico-sem-demanda-expressa");
  });

  it.each([
    ["ru", "Налоговый консалтинг", "Налоговая консультация", "Финансы"],
    ["fr", "Avocat fiscaliste", "Avocat fiscal", "Finances"],
    ["fr", "Conseil fiscal", "Conseil en fiscalité", "Finances"],
    ["zh", "税务咨询", "税务顾问", "财务"],
    ["zh", "税务咨询", "税务咨询服务", "财务"],
    ["ja", "税務コンサルティング", "税務コンサル", "財務"],
    ["zh", "律师事务所", "律师", "财务"],
    ["de", "Steuerberatung", "Suche Steuerberater", "Finanzen"],
  ])("%s: o mesmo serviço escrito de outro jeito vale 100, com e sem categoria — %s × %s", (_idioma, oferta, necessidade, categoria) => {
    for (const cat of [categoria, null]) {
      expect(scoreMatch(item(oferta, cat), item(necessidade, cat)), `[${cat}]`).toEqual({ score: 100, type: "exact" });
    }
  });

  it("o que as listas não leem num idioma novo não é bloqueado: vale a categoria, como na main", () => {
    expect(scoreMatch(item("Steuerberatung für Erbschaften", "Finanzen"), item("Steuerberater für Erbschaftsteuer", "Finanzen"))).toEqual({ score: 60, type: "category" });
    expect(scoreMatch(item("Conseil en fiscalité internationale", "Finances"), item("Conseil en fiscalité des entreprises", "Finances"))).toEqual({ score: 60, type: "category" });
    // Sem categoria em comum, zero sem o bloqueio nomeado — também como a main.
    const semCategoria = scoreMatch(item("Steuerberatung für Erbschaften"), item("Steuerberater für Erbschaftsteuer"));
    expect(semCategoria.score).toBe(0);
    expect((semCategoria as { bloqueio?: string }).bloqueio).toBeUndefined();
  });

  it("e o que o motor entende continua barrado: outra família, outra especialidade entendida, e o português segue estrito", () => {
    for (const [oferta, necessidade, categoria] of [
      ["Налоговый консалтинг", "Юрист", "Финансы"], ["Налоговый консалтинг", "Юридическая консультация", "Финансы"],
      ["税务咨询", "法律咨询", "财务"], ["Consultoria em exportação", "Consultoria em comércio exterior", "Serviços"],
      ["Consultoria em segurança do trabalho", "Consultoria trabalhista", "Finanças"],
      // A palavra desconhecida do lado em português ("segurança") continua valendo contra o par, mesmo diante de francês.
      ["Consultoria em segurança do trabalho", "Conseil en droit du travail", "Services"],
    ] as Array<[string, string, string]>) {
      const r = scoreMatch(item(oferta, categoria), item(necessidade, categoria));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(0);
      expect((r as { bloqueio?: string }).bloqueio, `${oferta} × ${necessidade}`).toBe("servico-sem-demanda-expressa");
    }
  });
});

describe("A mesma coisa escrita de outro jeito casa em 100; serviço diferente não (defeitos a e c da #101, 13/09)", () => {
  it("(a) mesma família e mesma especialidade, com ou sem categoria: 'Advocacia tributária' × 'Advogado tributarista'", () => {
    const pares: Array<[string, string]> = [
      ["Advocacia tributária", "Advogado tributarista"],
      ["Advogado tributarista", "Advocacia tributária"],
      ["Contabilidade tributária", "Contador tributário"],
      ["Tradução jurídica", "Tradutor jurídico"],
      ["Advocacia previdenciária", "Advogado previdenciarista"],
      ["Tax lawyer", "Advogado tributarista"],
      ["Advocacia tributária", "Procuro advogado tributarista"],
      ["Advocacia tributária", "Contratar advogado tributarista"],
      ["Advocacia tributária em São Paulo", "Advogado tributarista"],
      ["Advocacia tributária e trabalhista", "Advogado trabalhista"],
      ["Consultoria jurídica tributária", "Consultoria tributária"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Jurídico", "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)).score, `${oferta} × ${necessidade} [${categoria}]`).toBe(100);
      }
    }
  });

  it("(c) outra especialidade, outro lema ou oferta genérica: zero com o bloqueio nomeado, com ou sem categoria", () => {
    const pares: Array<[string, string]> = [
      ["Consultoria jurídica", "Consultor de marketing"],
      ["Consultoria jurídica", "Assessoria em marketing"],
      ["Consultoria jurídica", "Assessoria"],
      ["Consultoria em marketing", "Advisory"],
      ["Assessoria de imprensa", "Consultoria"],
      ["Assistência jurídica", "Suporte"],
      ["Interpretação de exames laboratoriais", "Tradutor"],
      ["Consultoria em marketing para advogados", "Consultoria jurídica"],
      ["Consultoria para PMEs", "Consultoria jurídica para PMEs"],
      ["Mentoria para mulheres", "Mentoria financeira para mulheres"],
      ["Advocacia", "Advogado tributarista"],
      ["Advocacia tributária", "Advogado trabalhista"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Serviços"]) {
        const r = scoreMatch(item(oferta, categoria), item(necessidade, categoria));
        expect(r.score, `${oferta} × ${necessidade} [${categoria}]`).toBe(0);
        expect((r as { bloqueio?: string }).bloqueio, `${oferta} × ${necessidade}`).toBe("servico-sem-demanda-expressa");
      }
    }
  });
});

describe("Serviço com adjetivo de outro tipo não escapa do portão (revisão de 13/09)", () => {
  it("'Consultoria financeira' e 'Consultoria logística' não casam pela categoria; com a necessidade nomeada, casam", () => {
    const r = scoreMatch(item("Consultoria financeira", "Consultoria"), item("Distribuidor para a África", "Consultoria"));
    expect(r.score).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio).toBe("servico-sem-demanda-expressa");
    expect(scoreMatch(item("Consultoria logística", "Logística"), item("Frete marítimo", "Logística")).score).toBe(0);
    expect(scoreMatch(item("Consultoria financeira"), item("Consultor financeiro")).score).toBe(100);
  });
});

describe("Necessidade que coordena serviços diferentes casa com cada um (revisão de 13/09)", () => {
  it("'Advocacia tributária' e 'Contabilidade' × 'Advogado e contador' casam em 60, a nota da família (cada parte pedida só nomeia a família)", () => {
    for (const categoria of [null, "Serviços"]) {
      expect(scoreMatch(item("Advocacia tributária", categoria), item("Advogado e contador", categoria)).score, String(categoria)).toBe(60);
      expect(scoreMatch(item("Contabilidade", categoria), item("Advogado e contador", categoria)).score, String(categoria)).toBe(60);
    }
  });
});

describe("Correção dos defeitos da #101 por cima da #124 — motor privado (14/09)", () => {
  it("o que a regeneração apagaria volta: a especialidade escrita de outro jeito vale 100", () => {
    const pares: Array<[string, string]> = [
      ["Advocacia tributária", "Advogado tributarista em São Paulo"], ["Advocacia tributária", "Precisamos de advogado tributarista"],
      ["Advocacia tributária", "Advogada tributarista experiente"], ["Advocacia tributária", "Advogado especializado em direito tributário"],
      ["Advocacia tributária", "Advocacia jurídica tributária"], ["Tradução jurídica", "Tradutor jurídico"],
      ["Consultoria em planejamento financeiro", "Consultoria financeira"], ["Advocacia tributária e trabalhista", "Advogado trabalhista"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 100, type: "exact" });
      }
    }
  });

  it("a necessidade que nomeia só a família vale 60 e fica no banco: adjetivo sozinho, lugar, serviços coordenados", () => {
    const pares: Array<[string, string]> = [
      ["Advocacia", "Jurídico"], ["Jurídico", "Advogado"], ["Contabilidade", "Contábil"],
      ["Contabilidade", "Contador em Campinas/SP"], ["Tradução e interpretação", "Intérprete"], ["Advocacia tributária", "Advogado e contador"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 60, type: "category" });
      }
    }
  });

  it("serviço diferente escrito com 'para', idioma ou lema que colide fica em zero com o bloqueio", () => {
    for (const [oferta, necessidade] of [
      ["Advocacia tributária", "Advogado para divórcio"], ["Tradução de alemão", "Tradutor de japonês"],
      ["Consultoria em segurança do trabalho", "Consultoria trabalhista"], ["Consultoria digital", "Consultoria em direito digital"],
      ["Assessoria de imprensa", "Consultoria"], ["Interpretação de exames laboratoriais", "Tradutor"],
    ] as Array<[string, string]>) {
      const r = scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços"));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(0);
      expect((r as { bloqueio?: string }).bloqueio).toBe("servico-sem-demanda-expressa");
    }
  });
});

describe("'Direito tributário' sem categoria também passa pelo portão (14/09)", () => {
  it("casa em 100 com a necessidade que o nomeia", () => {
    expect(scoreMatch(item("Direito tributário"), item("Advogado tributarista"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Direito do trabalho"), item("Advocacia trabalhista"))).toEqual({ score: 100, type: "exact" });
  });
});


describe("Revisão adversarial da correção empilhada sobre a #124 — notas do motor privado (14/09)", () => {
  it("o mesmo serviço escrito de outro jeito vale 100; a necessidade que nomeia só a família, 60", () => {
    expect(scoreMatch(item("Tradutora-intérprete de Libras"), item("Intérprete de Libras"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Property lawyer"), item("Advogado imobiliário"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Advocacia tributária"), item("Assessoria jurídica tributária"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Advogada consultora"), item("Advogada"))).toEqual({ score: 60, type: "category" });
    // Valia 60 até a revisão de 14/09 na #127: "律师" (advogado) e "Advogado" são o mesmo serviço sem mais nada dos
    // dois lados, a regra de "Contabilidade" × "Contador", agora lida também em chinês ("律师事务所" × "律师").
    expect(scoreMatch(item("律师"), item("Advogado"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Advocacia trabalhista"), item("Assessoria jurídica e tributária"))).toEqual({ score: 60, type: "category" });
  });

  it("serviço diferente fica abaixo do corte e a linha não é gravada", () => {
    for (const [oferta, necessidade] of [
      ["Consultoria trabalhista", "Consultoria para segurança do trabalho"], ["Traduction juridique", "Avocat"],
      ["Advocacia de família", "Advogado para pensão por morte"], ["Consultoria em gestão", "Consultoria em gestão pública"],
      ["Consultoria jurídica", "Consultoria de seleção"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)).score, `${oferta} × ${necessidade}`).toBeLessThan(50);
    }
  });
});
