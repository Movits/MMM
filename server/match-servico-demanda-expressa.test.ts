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
    // Achado na revisão de 14/09 da #124 (commit 9615971, portado para a leitura
    // da #127): com as duas especialidades vazias o par caía na regra da
    // família, valendo 60. Abaixo do EMAIL_THRESHOLD de 70 — o match existia e
    // a pessoa NÃO era avisada.
    //
    // Quem oferece "Contabilidade" e quem procura "Contador" não estão a uma
    // especialidade de distância: é o mesmo serviço dito de dois jeitos.
    for (const categoria of [undefined, "Serviços"]) {
      expect(scoreMatch(item("Contabilidade", categoria), item("Contador", categoria)), `Contabilidade × Contador [${categoria}]`)
        .toEqual({ score: 100, type: "exact" });
      expect(scoreMatch(item("Advocacia", categoria), item("Advogado", categoria)), `Advocacia × Advogado [${categoria}]`)
        .toEqual({ score: 100, type: "exact" });
    }

    // E o que separa esses de "Consultoria jurídica" NÃO é ter especialidade
    // escrita — é nomearem uma SEGUNDA coisa além da família (o objeto do
    // serviço). Se esta distinção se perder, o teste da família genérica acima
    // cai junto.
    expect(scoreMatch(item("Consultoria jurídica", "Serviços"), item("Consultoria", "Serviços")).score).toBe(60);
    expect(scoreMatch(item("Consultoria de marketing", "Serviços"), item("Consultoria", "Serviços")).score).toBe(60);
    // Dois serviços na oferta, ou oferta lida só por substring (zh/ja, sem saber a especialidade), seguem na família.
    expect(scoreMatch(item("Tradução e interpretação"), item("Intérprete")).score).toBe(60);
    expect(scoreMatch(item("律师"), item("Advogado")).score).toBe(60);
    // Com especialidade de um lado só, nada muda: a necessidade genérica vale 60, a especializada diante da oferta genérica, 0.
    expect(scoreMatch(item("Advocacia tributária"), item("Advogado")).score).toBe(60);
    expect(scoreMatch(item("Advocacia"), item("Advogado trabalhista")).score).toBe(0);
  });

  it("\"cobertura\" não é imóvel: reportagem não escapa do portão", () => {
    // Também da revisão de 14/09. "cobertura" tinha entrado em IMOVEL junto com
    // apartamento e casa; fora do mercado imobiliário ela é reportagem, seguro
    // ou telhado. Classificado como imóvel, o item SAI do portão da demanda
    // expressa e volta a casar por categoria — o vazamento que a #101 fecha.
    expect(scoreMatch(item("Cobertura jornalística", "Serviços"), item("Compradores", "Serviços")).score).toBe(0);
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

  it("exemplo 1 do pedido casa também no motor privado: assessoria numa área da profissão (mudou em 14/09)", () => {
    // Até 14/09 este teste dizia o contrário ("o motor privado não adivinha
    // paráfrase") e esperava 0. A spec da Glenda de 14/09 dá este par como
    // MATCH, e ele não é parecença de texto: quem pede ASSESSORIA TRIBUTÁRIA
    // pede um serviço que a advocacia tributária presta
    // (`AREAS_DAS_PROFISSOES` em shared/tipo-da-oferta.ts). Os casos detalhados
    // estão em demanda-expressa-exemplos-da-spec.test.ts.
    const r = scoreMatch(
      item("Serviços jurídicos especializados em Direito Tributário", "Jurídico"),
      item("Assessoria tributária para revisão da carga fiscal da empresa", "Jurídico"),
    );
    expect(r).toEqual({ score: 100, type: "exact" });
  });

  it("a similaridade (quando religada) é a compatibilidade semântica DEPOIS do portão", () => {
    // "Gestão de caixa" não declara assunto do vocabulário curado: só a similaridade decidiria.
    expect(scoreMatch(item("Consultoria tributária"), item("Gestão de caixa"), 0.71)).toEqual({ score: 45, type: "semantic" });
    // "Revisão de tributos" pede uma ação sobre o assunto do serviço: 60 pelo vocabulário, sem similaridade nenhuma.
    expect(scoreMatch(item("Consultoria tributária"), item("Revisão de tributos"))).toEqual({ score: 60, type: "semantic" });
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
    // Desde a separação instrução × dados do insight (defesa contra injeção pelo
    // texto do perfil), os dois lados saem do mesmo molde, com a letra do perfil.
    expect(motor).toContain("O que ${letra} precisa:");
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
 */
describe("O portão dispara nos 10 idiomas (defeito da #101)", () => {
  it.each([
    ["de", "Steuerberatung", "Maschinen"],
    ["fr", "Conseil fiscal", "Machines"],
    ["ru", "Налоговый консалтинг", "Покупатели"],
    ["hi", "कर परामर्श", "खरीदार"],
    ["ar", "استشارات ضريبية", "مشترون"],
    ["zh", "税务咨询", "买家"],
    ["ja", "税務コンサルティング", "買い手"],
  ])("%s: serviço × necessidade presumida de mesma categoria não casa", (_idioma, oferta, necessidade) => {
    expect(scoreMatch(item(oferta, "Serviços"), item(necessidade, "Serviços")).score).toBe(0);
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

  it("a necessidade que nomeia só a família vale 60 e fica no banco: serviços coordenados, oferta especializada", () => {
    const pares: Array<[string, string]> = [
      ["Tradução e interpretação", "Intérprete"], ["Advocacia tributária", "Advogado e contador"], ["Advocacia tributária", "Jurídico"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 60, type: "category" });
      }
    }
  });

  it("adjetivo sozinho e lugar dos DOIS lados genéricos são o mesmo serviço: 100 (valiam 60 até o porte do 9615971)", () => {
    // Estes quatro estavam na lista de 60 acima. Os dois lados só nomeiam a
    // família — "Jurídico" é advocacia, "Contábil" é contabilidade, e o lugar
    // não é especialidade —, a mesma situação de "Contabilidade" × "Contador".
    const pares: Array<[string, string]> = [
      ["Advocacia", "Jurídico"], ["Jurídico", "Advogado"], ["Contabilidade", "Contábil"], ["Contabilidade", "Contador em Campinas/SP"],
    ];
    for (const [oferta, necessidade] of pares) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 100, type: "exact" });
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
    expect(scoreMatch(item("律师"), item("Advogado"))).toEqual({ score: 60, type: "category" });
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

describe("scoreMatch — lacunas do classificador depois da #127: serviço que casava pela categoria (14/09)", () => {
  it("serviço que o classificador não lia casava em 60 pela categoria digitada; agora só com necessidade que o nomeie", () => {
    const presumidos: Array<[string, string, string, string]> = [
      ["Fisioterapia", "Saúde", "Distribuidor de equipamentos hospitalares", "Saúde"],
      ["Psicóloga", "Saúde", "Clínica à venda", "Saúde"],
      ["Projeto arquitetônico", "Imóveis", "Terreno", "Imóveis"],
      ["Comércio exterior", "Comex", "Compradores na China", "Comex"],
      ["Desenvolvimento de software", "Tecnologia", "Investidores", "Tecnologia"],
      // Logística é serviço desde 14/09 (decisão do Nicolas).
      ["Serviços de logística", "Logística", "Armazém em Santos", "Logística"],
      ["Transporte rodoviário", "Logística", "Frete", "Logística"],
    ];
    for (const [oferta, categoriaDaOferta, necessidade, categoriaDaNecessidade] of presumidos) {
      const r = scoreMatch(item(oferta, categoriaDaOferta), item(necessidade, categoriaDaNecessidade));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(0);
      expect(r.bloqueio, `${oferta} × ${necessidade}`).toBe("servico-sem-demanda-expressa");
    }
  });

  it("a necessidade que nomeia a família do serviço novo passa a casar (era 0: o serviço não tinha família)", () => {
    // Atividade e profissional sem mais nada dos dois lados: o mesmo serviço, 100 (porte do 9615971, como "Contabilidade" × "Contador").
    expect(scoreMatch(item("Fisioterapia", "Saúde"), item("Fisioterapeuta")).score).toBe(100);
    expect(scoreMatch(item("Fisioterapia respiratória", "Saúde"), item("Fisioterapeuta")).score).toBe(60);
    expect(scoreMatch(item("Transporte rodoviário", "Logística"), item("Transportadora")).score).toBe(60);
  });

  it("o bem físico da logística continua casando pela categoria, como antes", () => {
    expect(scoreMatch(item("Galpão alfandegado", "Logística"), item("Armazém em Santos", "Logística"))).toEqual({ score: 60, type: "category" });
  });
});

/**
 * Revisão de 15/09 dos consertos da #127 (116bb56), portada para a leitura desta
 * branch. Ficam os achados que valem para este código: o adjetivo de serviço
 * junto de cabeça genérica ou neutra, o destinatário comum na oferta, a leitura
 * do complemento da cabeça neutra, e o abacate. Os pares dos idiomas novos que
 * dependiam da exceção do que as listas não leem (`regraNaoLeOPar`) e da leitura
 * do chinês pelo fim do termo não estão aqui: essa camada não entrou nesta
 * branch, e a regra aqui é estrita nos 10 idiomas.
 */
describe("Revisão de 15/09 dos consertos da #127 — motor privado", () => {
  it("o serviço nomeado pelo adjetivo junto de cabeça genérica ou neutra é o mesmo serviço: 100, nos dois sentidos", () => {
    for (const [oferta, necessidade] of [
      ["Serviços jurídicos", "Advogado"], ["Legal services", "Lawyer"], ["Servicios jurídicos", "Abogado"], ["Escritório jurídico", "Advogado"],
      ["Serviços contábeis", "Contador"], ["Escritório contábil", "Contador"], ["Servicios contables", "Contador"], ["Services juridiques", "Avocat"],
      ["Lawyer", "Legal services"], ["Contador", "Escritório contábil"],
      // "contable" e "comptable" na cabeça do termo são também o contador
      ["Contable", "Contador"], ["Contabilidad", "Contable"], ["Comptabilité", "Comptable"], ["Comptable", "Comptabilité"], ["Comptabilité", "Un comptable"],
    ] as Array<[string, string]>) {
      for (const categoria of [null, "Serviços"]) {
        expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 100, type: "exact" });
      }
    }
    // A especialidade segue na nota da família.
    expect(scoreMatch(item("Serviços jurídicos tributários"), item("Advogada"))).toEqual({ score: 60, type: "category" });
    // Diferença desta branch para a #127: o adjetivo sozinho dos dois lados nomeia só a família, como na main
    // ("os dois lados só com a família", `mesmaFamiliaEEspecialidade`), e vale 100; na #127 ficava em 60.
    for (const [oferta, necessidade] of [["Contabilidade", "Contábil"], ["Jurídico", "Advogado"]] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
  });

  it("na oferta, o público comum é o destinatário; finalidade e setor depois de 'para' seguem na nota da família", () => {
    for (const [oferta, necessidade] of [
      ["Consultoria para exportação", "Consultoria"], ["Advogado para causas do trabalho", "Advogado"], ["Advogado para recuperação judicial", "Advogado"],
      ["Consultoria para o setor público", "Consultoria"], ["Marketing para restaurantes", "Marketing"], ["Consulting for exporters", "Consulting"],
      ["Consultoria para o agronegócio", "Consultoria"], ["Contabilidade para o agronegócio", "Contador"], ["Mentoria para fundadoras", "Mentoria"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 60, type: "category" });
    }
    for (const [oferta, necessidade] of [
      ["Contabilidade para pequenas empresas", "Contador"], ["Contabilidade para MEI", "Contador"], ["Accounting for small businesses", "Accountant"],
      ["Advocacia para empresas", "Advogado"], ["Contabilidad para pymes", "Contable"],
    ] as Array<[string, string]>) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
  });

  it("o que a classificação diz serviço, a leitura do serviço também lê: não é barrado diante do próprio profissional", () => {
    for (const [oferta, necessidade, categoria] of [
      ["Empresa de gestão contábil", "Contador", "Contabilidade"], ["Escritório de soluções jurídicas", "Advogado", "Jurídico"],
      ["Gestão contábil", "Contador", "Contabilidade"],
      ["Cabinet d'expertise comptable", "Comptable", "Comptabilité"], ["Gestion comptable", "Comptable", "Comptabilité"],
    ] as Array<[string, string, string]>) {
      expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade}`).toEqual({ score: 60, type: "category" });
    }
    // "Expertise" qualifica quem presta nesta branch (QUALIFICA_O_ASSUNTO): "Expertise comptable" é a contabilidade e nada mais.
    expect(scoreMatch(item("Comptable", "Comptabilité"), item("Expertise comptable", "Comptabilité"))).toEqual({ score: 100, type: "exact" });
    // A cabeça desconhecida fica como especialidade: quem PROCURA "Pessoa jurídica" não pediu a advocacia genérica.
    for (const [oferta, necessidade] of [["Advocacia", "Pessoa jurídica"], ["Advocacia", "Estrutura jurídica em Portugal"], ["Contabilidade", "Dados contábeis"]] as Array<[string, string]>) {
      const r = scoreMatch(item(oferta), item(necessidade));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(0);
      expect((r as { bloqueio?: string }).bloqueio, `${oferta} × ${necessidade}`).toBe("servico-sem-demanda-expressa");
    }
  });

  it("a loja e o abacate não são serviço: seguem casando pela categoria", () => {
    for (const [oferta, necessidade, categoria] of [
      ["Boutique de joias de design", "Joias finas", "Joias"], ["Boutique de móveis de design", "Móveis", "Móveis"],
      ["Boutique de muebles de diseño", "Compradores", "Moda"],
      ["Avocats Hass export international", "Importateur de fruits", "Fruits"], ["Avocats frais, qualité fiscal", "Acheteurs de fruits", "Fruits"],
    ] as Array<[string, string, string]>) {
      expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade}`).toEqual({ score: 60, type: "category" });
    }
    // O advogado continua serviço.
    expect(scoreMatch(item("Avocat fiscaliste"), item("Avocat fiscal"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Avocat d'affaires"), item("Avocat"))).toEqual({ score: 60, type: "category" });
  });

  it("idiomas novos: o que o motor entende continua barrado — pedido que não é de serviço, outra especialidade e o desconhecido diante de especialidade entendida", () => {
    for (const [oferta, necessidade, categoria] of [
      ["Consultoria tributária", "Консультация по логистике", "Consultoria"], ["Advocacia tributária", "Юрист по семейным делам", "Jurídico"],
      ["Consultoria tributária", "电商咨询", "Serviços"],
      ["Consultoria tributária", "Консультация по маркетингу", "Consultoria"], ["税务咨询", "招聘咨询", "财务"],
      ["Advogado", "Bureaux pour avocats", "Imobiliário"], ["Advocacia", "Juristische Person", "Recht"], ["Contabilidade", "Software für Buchhaltung", "Contabilidade"],
      ["Consultoria", "Conseil d'administration", "Consultoria"], ["Advogado", "वकील के लिए कार्यालय", "कार्यालय"],
      // o rótulo bilíngue não solta a parte em português
      ["Consultoria em segurança do trabalho / 安全咨询", "Consultoria trabalhista", "Serviços"],
      ["Consultoria em segurança do trabalho (Beratung)", "Consultoria trabalhista", "Serviços"],
    ] as Array<[string, string, string]>) {
      const r = scoreMatch(item(oferta, categoria), item(necessidade, categoria));
      expect(r.score, `${oferta} × ${necessidade}`).toBe(0);
      expect((r as { bloqueio?: string }).bloqueio, `${oferta} × ${necessidade}`).toBe("servico-sem-demanda-expressa");
    }
  });
});

/**
 * Faltas do porte achadas pelo cético na #135 (15/09). Cada par abaixo falhava
 * na árvore do porte antes da correção.
 */
describe("Porte da madrugada de 15/09 na #135 — faltas do cético", () => {
  const barrado = (oferta: string, necessidade: string, categoria: string | null = null) => {
    const r = scoreMatch(item(oferta, categoria), item(necessidade, categoria));
    expect(r.score, `${oferta} × ${necessidade} [${categoria}]`).toBe(0);
    expect((r as { bloqueio?: string }).bloqueio, `${oferta} × ${necessidade} [${categoria}]`).toBe("servico-sem-demanda-expressa");
  };

  it("idiomas novos: com o vocabulário da 116bb56, a forma usual do profissional é o mesmo serviço", () => {
    // Na árvore do porte os cinco eram 0 com bloqueio; na main valiam ao menos 60.
    for (const [oferta, necessidade, categoria] of [
      ["Advogado", "Juriste", null], ["Serviços de tradução", "Traductrice", null], ["Conseil fiscal", "Conseillère fiscale", "Finances"],
      ["خدمات محاسبة", "المحاسب", "مالية"],
    ] as Array<[string, string, string | null]>) {
      expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
    expect(scoreMatch(item("Cabinet d'avocats", "Droit"), item("Juriste", "Droit"))).toEqual({ score: 60, type: "category" });
    // "مستشار" é o consultor: "مستشار قانوني" é a consultoria jurídica, e não atende "محامي", como "Consultoria jurídica"
    // não atende "Advogado" (na árvore do porte valia 60 pela categoria vazando).
    barrado("مستشار قانوني", "محامي");
    barrado("Consultoria jurídica", "Advogado");
  });

  it("a casa de quem presta não impede a leitura do serviço: não é barrada diante do próprio profissional", () => {
    // Na árvore do porte todos eram 0 com bloqueio; na main, 100.
    for (const [oferta, necessidade, categoria] of [
      ["Casa de consultoria", "Consultoria", "Consultoria"], ["Ateliê de arquitetura", "Arquiteto", "Arquitetura"], ["Studio de design", "Designer", "Design"],
      ["Hub de marketing", "Marketing", "Marketing"], ["Instituto de mentoria", "Mentoria", "Serviços"],
      ["Boutique de advocacia tributária", "Advogado tributarista", "Jurídico"], ["Boutique de advocacia tributária", "Advogado tributarista", null],
    ] as Array<[string, string, string | null]>) {
      expect(scoreMatch(item(oferta, categoria), item(necessidade, categoria)), `${oferta} × ${necessidade} [${categoria}]`).toEqual({ score: 100, type: "exact" });
    }
    // Com a especialidade na oferta, a necessidade que só nomeia a família fica na nota da família.
    expect(scoreMatch(item("Boutique de advocacia tributária", "Jurídico"), item("Advogado", "Jurídico"))).toEqual({ score: 60, type: "category" });
    // A cabeça neutra colada DEPOIS do serviço também é quem presta (ff9564f): na árvore do porte, 0 com bloqueio e 60.
    for (const [oferta, necessidade] of [["Tax law firm", "Tax lawyer"], ["Advocacia tributária", "Tax law firm"], ["Advogado", "Law firm"], ["Law firm", "Advogado"]]) {
      expect(scoreMatch(item(oferta), item(necessidade)), `${oferta} × ${necessidade}`).toEqual({ score: 100, type: "exact" });
    }
    // A loja e a casa de câmbio seguem casando pela categoria.
    expect(scoreMatch(item("Boutique de joias de design", "Joias"), item("Joias finas", "Joias"))).toEqual({ score: 60, type: "category" });
    expect(scoreMatch(item("Casa de câmbio", "Financeiro"), item("Compradores", "Financeiro"))).toEqual({ score: 60, type: "category" });
  });

  it("'Pessoa jurídica' oferecida não é a advocacia: o adjetivo qualifica o conceito, não a prestação", () => {
    // Na árvore do porte a oferta "Pessoa jurídica" [Serviços] casava com os pedidos jurídicos em 60.
    for (const necessidade of ["Advogado", "Advocacia", "Lawyer", "Serviços jurídicos"]) barrado("Pessoa jurídica", necessidade, "Serviços");
    barrado("Estrutura jurídica em Portugal", "Advogado", "Jurídico");
    // A cabeça que não é conceito segue lida: "Gestão contábil" [Contabilidade] vale a nota da família diante de "Contador".
    expect(scoreMatch(item("Gestão contábil", "Contabilidade"), item("Contador", "Contabilidade"))).toEqual({ score: 60, type: "category" });
  });

  it("'estratégica' ao lado de especialidade reconhecida sai da oferta; sozinha no pedido é o assunto (ff9564f, portada)", () => {
    // Na árvore do porte os dois primeiros valiam 100, acima do corte de e-mail; na main e na #127, 0 com bloqueio.
    barrado("Consultoria tributária estratégica", "Consultoria estratégica");
    barrado("Consultoria financeira estratégica", "Consultoria estratégica");
    expect(scoreMatch(item("Advocacia tributária estratégica"), item("Advogado tributarista"))).toEqual({ score: 100, type: "exact" });
    expect(scoreMatch(item("Consultoria estratégica"), item("Consultoria"))).toEqual({ score: 60, type: "category" });
  });
});
