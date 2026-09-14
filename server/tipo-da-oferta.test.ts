import { describe, expect, it } from "vitest";
import { normalizar, tokensDoTermo } from "@shared/direcao-do-termo";
import { classificarOferta, ehServico, ehServicoDeAssessoria, especialidadeDoServico, familiaDoServico, LISTAS_POR_TIPO, mesmaFamiliaEEspecialidade, necessidadeGenericaNomeiaOServico, necessidadeNomeiaOServico, servicoAtendeNecessidade, TIPOS_DA_OFERTA, trechoNomeiaServicoAtendido } from "@shared/tipo-da-oferta";

/**
 * Regra da demanda expressa (12/09/2026) — a classificação que vem ANTES do
 * cruzamento. Só "servico" muda comportamento, então a precisão que importa é
 * a desse tipo: o que é serviço tem de ser reconhecido (senão o presumido
 * passa) e o que não é não pode virar serviço (senão um match legítimo por
 * categoria some). Na dúvida, "outros".
 */
describe("Tipo da oferta — as listas", () => {
  it("são os nove tipos do pedido, nesta ordem", () => {
    expect(TIPOS_DA_OFERTA.map(t => t.tipo)).toEqual([
      "servico", "produto", "ativo", "oportunidade", "investimento", "conexao", "tecnologia", "imovel", "outros",
    ]);
  });

  it("nenhuma palavra está em dois tipos (uma repetição sobrescreveria a outra em silêncio)", () => {
    const vistas = new Map<string, string>();
    for (const [tipo, palavras] of LISTAS_POR_TIPO) {
      for (const palavra of palavras) {
        expect(vistas.get(palavra) ?? tipo, `"${palavra}" em ${vistas.get(palavra)} e ${tipo}`).toBe(tipo);
        vistas.set(palavra, tipo);
      }
    }
  });

  it("as listas estão normalizadas: cada palavra é igual ao que normalizar() devolve, e não tem espaço", () => {
    // Era /^[a-z0-9]+$/, que só valia enquanto o léxico fosse latino. Com
    // russo, híndi e árabe (cobertura de idiomas, 14/09) o ASCII deixou de ser
    // a invariante — e a de verdade é mais forte: a palavra da lista tem de ser
    // EXATAMENTE o que a tokenização produz, em qualquer escrita. Uma entrada
    // com maiúscula, acento latino ou espaço nunca casaria e falha aqui.
    for (const [, palavras] of LISTAS_POR_TIPO) {
      for (const palavra of palavras) {
        expect(normalizar(palavra), palavra).toBe(palavra);
        expect(tokensDoTermo(palavra), palavra).toHaveLength(1);
      }
    }
  });
});

describe("Tipo da oferta — os exemplos do pedido são serviço", () => {
  it.each([
    "Advocacia especializada em Direito Tributário",
    "Serviços jurídicos especializados em Direito Tributário",
    "Consultoria em internacionalização de empresas",
    "Consultoria para registro de medicamentos",
    "Advocacia tributária",
    "Assessoria tributária",
  ])("%s → servico", rotulo => {
    expect(classificarOferta(rotulo)).toBe("servico");
    expect(ehServico(rotulo)).toBe(true);
  });

  it("reconhece serviço em inglês e espanhol", () => {
    expect(classificarOferta("Tax consulting")).toBe("servico");
    expect(classificarOferta("Legal advisory")).toBe("servico");
    expect(classificarOferta("Law firm")).toBe("servico");
    expect(classificarOferta("Asesoría tributaria")).toBe("servico");
    expect(classificarOferta("Servicios de contabilidad")).toBe("servico");
  });
});

describe("Tipo da oferta — os outros tipos", () => {
  it.each([
    ["Produtos orgânicos", "produto"],
    ["Estoque de vinhos", "produto"],
    ["Matérias-primas (commodities)", "produto"],
    ["Mina de lítio", "ativo"],
    ["Fazenda de café", "ativo"],
    ["Licenças ambientais", "ativo"],
    ["Fábrica de calçados", "ativo"],
    ["Projeto de expansão na Ásia", "oportunidade"],
    ["Edital de compras públicas", "oportunidade"],
    ["Capital para investir", "investimento"],
    ["Fundo de investimento", "investimento"],
    ["Venture capital", "investimento"],
    ["Acesso a governo", "conexao"],
    ["Contatos na Ásia", "conexao"],
    ["Canais comerciais", "conexao"],
    ["Software de gestão", "tecnologia"],
    ["Patente de processo", "tecnologia"],
    ["Plataforma de pagamentos", "tecnologia"],
    ["Galpão em Santos", "imovel"],
    ["Terreno industrial", "imovel"],
    ["Real estate in Lisbon", "imovel"],
  ])("%s → %s", (rotulo, tipo) => {
    expect(classificarOferta(rotulo)).toBe(tipo);
  });

  it("na dúvida é 'outros' — e 'outros' nunca é serviço", () => {
    for (const rotulo of ["Café especial", "Terras raras", "Distribuidor na África", "Vinhos", "Cacau fino"]) {
      expect(classificarOferta(rotulo)).toBe("outros");
      expect(ehServico(rotulo)).toBe(false);
    }
  });

  it("as opções fixas de 'O que tenho' do onboarding nunca são serviço", () => {
    const ids = ["industria", "fazenda", "laboratorio", "tecnologia", "investidores", "acesso_governamental", "commodities", "licencas", "imoveis", "logistica", "canais_comerciais"];
    for (const id of ids) expect(ehServico(id), id).toBe(false);
    expect(classificarOferta("acesso_governamental")).toBe("conexao");
    expect(classificarOferta("investidores")).toBe("investimento");
    expect(classificarOferta("logistica")).toBe("ativo");
  });

  it("logística, transporte e armazenagem NÃO são serviço: são capacidade operacional no vocabulário da plataforma", () => {
    expect(classificarOferta("Logística internacional")).toBe("ativo");
    expect(classificarOferta("Transporte rodoviário")).toBe("ativo");
    expect(classificarOferta("Armazenagem refrigerada")).toBe("ativo");
    for (const rotulo of ["Logística internacional", "Transporte rodoviário", "Armazenagem refrigerada", "Frete marítimo"]) {
      expect(ehServico(rotulo), rotulo).toBe(false);
    }
  });
});

describe("Tipo da oferta — a ordem da decisão", () => {
  it("a cabeça manda: 'Software de consultoria' é tecnologia, 'Rede de advogados' é conexão", () => {
    expect(classificarOferta("Software de consultoria")).toBe("tecnologia");
    expect(classificarOferta("Rede de advogados")).toBe("conexao");
  });

  it("substantivo de serviço colado à cabeça decide: 'Logistics consulting', 'Tax law', 'Customs brokerage'", () => {
    expect(classificarOferta("Logistics consulting")).toBe("servico");
    expect(classificarOferta("Transport consultancy")).toBe("servico");
    expect(classificarOferta("Real estate consulting")).toBe("servico");
    expect(classificarOferta("Real estate in Lisbon")).toBe("imovel");
    expect(classificarOferta("Tax law")).toBe("servico");
    expect(classificarOferta("International law firm")).toBe("servico");
    expect(classificarOferta("Customs brokerage")).toBe("servico");
    expect(classificarOferta("Technical support")).toBe("servico");
    expect(classificarOferta("Despacho de abogados")).toBe("servico");
  });

  it("composto em inglês cuja última palavra é de outro tipo: o serviço é só o assunto", () => {
    expect(classificarOferta("Marketing platform")).toBe("tecnologia");
    expect(classificarOferta("Accounting software")).toBe("tecnologia");
    expect(classificarOferta("Training materials")).toBe("produto");
    expect(classificarOferta("Legal database")).toBe("tecnologia");
    // e o contrário continua serviço
    expect(classificarOferta("Consulting services")).toBe("servico");
    expect(classificarOferta("Marketing digital")).toBe("servico");
  });

  it("conjunção coordena outro item: a cabeça fica com o que é", () => {
    expect(classificarOferta("Mina e consultoria mineral")).toBe("ativo");
    expect(classificarOferta("Capital e mentoria")).toBe("investimento");
    expect(classificarOferta("Logística e consultoria aduaneira")).toBe("ativo");
    expect(classificarOferta("Peças e manutenção")).toBe("outros");
  });

  it("cabeça genérica 'serviços' deixa o complemento decidir", () => {
    expect(classificarOferta("Serviços de logística")).toBe("ativo");
    expect(classificarOferta("Serviços financeiros")).toBe("investimento");
    expect(classificarOferta("Serviços de tecnologia")).toBe("tecnologia");
    expect(classificarOferta("Serviços de consultoria")).toBe("servico");
    expect(classificarOferta("Serviços de tradução")).toBe("servico");
    expect(classificarOferta("Serviços")).toBe("servico");
  });

  it("atrás de preposição, com cabeça de outra natureza, o serviço é só modificador (produto/ativo não mudam)", () => {
    // Regressão apanhada pela revisão de 12/09: estes viravam serviço e
    // perdiam o match por categoria que tinham na main.
    expect(classificarOferta("Peças de manutenção", "Produto")).toBe("produto");
    expect(classificarOferta("Peças de manutenção")).toBe("outros");
    expect(classificarOferta("Material de treinamento", "Produto")).toBe("produto");
    expect(classificarOferta("Centro de treinamento", "Infraestrutura")).toBe("imovel");
    expect(classificarOferta("Ferramenta de marketing", "Tecnologia")).toBe("tecnologia");
    expect(classificarOferta("Kit de marketing")).toBe("outros");
    expect(classificarOferta("Relatório de auditoria")).toBe("outros");
    for (const rotulo of ["Peças de manutenção", "Centro de treinamento", "Ferramenta de marketing", "Relatório de auditoria", "Memória de tradução"]) {
      expect(ehServico(rotulo), rotulo).toBe(false);
    }
  });

  it("adjetivo de serviço solto não decide: 'Pessoa jurídica', 'Estrutura jurídica em Portugal', 'Dados contábeis'", () => {
    expect(classificarOferta("Pessoa jurídica no Brasil")).toBe("outros");
    expect(classificarOferta("Estrutura jurídica em Portugal")).toBe("outros");
    expect(classificarOferta("Dados contábeis")).toBe("tecnologia");
    expect(ehServico("Cannabis legal")).toBe(false);
  });

  it("'instalação' é ambígua e não decide: 'Instalação portuária' não é serviço", () => {
    expect(ehServico("Instalação portuária")).toBe(false);
    expect(ehServico("Instalação industrial")).toBe(false);
  });

  it("cabeça neutra (empresa, escritório) deixa o complemento pelo genitivo decidir — inclusive o adjetivo", () => {
    expect(classificarOferta("Escritório de advocacia")).toBe("servico");
    expect(classificarOferta("Empresa de contabilidade")).toBe("servico");
    expect(classificarOferta("Escritório jurídico")).toBe("servico");
    expect(classificarOferta("Escritório comercial")).toBe("outros");
    // "para" não é genitivo: o escritório PARA advogados é o imóvel
    expect(classificarOferta("Escritório para advogados", "Imóveis")).toBe("imovel");
    expect(ehServico("Escritório para advogados")).toBe(false);
  });

  it("marcadores fracos, artigos e genitivo saem da frente", () => {
    expect(classificarOferta("Oferece consultoria tributária")).toBe("servico");
    expect(classificarOferta("Tem uma fábrica")).toBe("ativo");
    expect(classificarOferta("Oferta de terrenos")).toBe("imovel");
  });

  it("'design' e 'engenharia' só decidem na cabeça: 'Móveis de design' não é serviço", () => {
    expect(classificarOferta("Design gráfico")).toBe("servico");
    expect(classificarOferta("Móveis de design")).toBe("outros");
  });

  it("a categoria digitada decide quando o texto não decidiu — e não passa por cima da cabeça", () => {
    expect(classificarOferta("Direito tributário", "Jurídico")).toBe("servico");
    expect(classificarOferta("Café", "Produto")).toBe("produto");
    expect(classificarOferta("Café", "Mineração")).toBe("outros");
    expect(classificarOferta("Software de gestão", "Serviços")).toBe("tecnologia");
  });

  it("na categoria, palavra de outro tipo vence só o genérico 'serviços': 'Serviços financeiros' é capital", () => {
    expect(classificarOferta("Linha de crédito", "Serviços financeiros")).toBe("investimento");
    expect(classificarOferta("Linha de crédito", "Serviços de tecnologia")).toBe("tecnologia");
    expect(classificarOferta("Linha de crédito", "Serviços jurídicos")).toBe("servico");
    expect(ehServico("Linha de crédito", "Serviços financeiros")).toBe(false);
  });

  it("na categoria, palavra ESPECÍFICA de serviço decide em qualquer posição: 'Consultoria financeira' é serviço", () => {
    expect(classificarOferta("Planejamento patrimonial", "Consultoria financeira")).toBe("servico");
    expect(classificarOferta("Contratos", "Advocacia imobiliária")).toBe("servico");
    expect(classificarOferta("Campanhas", "Marketing")).toBe("servico");
    expect(classificarOferta("Relatórios", "Auditoria")).toBe("servico");
    expect(classificarOferta("Programa para fundadoras", "Mentoria")).toBe("servico");
  });
});

describe("Imóvel residencial e comercial — a cabeça decide antes da categoria", () => {
  it("apartamento, casa, sala e loja são imóvel pela própria cabeça, mesmo com categoria dizendo outra coisa", () => {
    expect(classificarOferta("Apartamento na praia")).toBe("imovel");
    expect(classificarOferta("Apartamento na praia", "Serviços jurídicos")).toBe("imovel");
    expect(classificarOferta("Casa em Cascais", "Consultoria")).toBe("imovel");
    expect(classificarOferta("Sala comercial no centro")).toBe("imovel");
    expect(classificarOferta("Loja de rua", "Serviços")).toBe("imovel");
    // Rural continua ATIVO, como já era decidido: "Fazenda de café" produz.
    expect(classificarOferta("Fazenda de café")).toBe("ativo");
  });

  it("house, flat e store só são imóvel na cabeça: 'Consulting house' é a consultoria (revisão de 14/09 na #127)", () => {
    for (const rotulo of ["House", "Flat na praia", "Store"]) {
      expect(classificarOferta(rotulo, "Serviços"), rotulo).toBe("imovel");
    }
    expect(classificarOferta("Consulting house")).toBe("servico");
    expect(classificarOferta("Consulting house", "Imóveis")).toBe("servico");
  });
});

describe("Família do serviço e necessidade genérica", () => {
  it("a família é o lema do primeiro substantivo de serviço; 'serviços' sozinho não é família", () => {
    expect(familiaDoServico("Consultoria jurídica")).toBe("consultoria");
    expect(familiaDoServico("Empresa de consultoria")).toBe("consultoria");
    expect(familiaDoServico("Tax consulting")).toBe("consultoria");
    expect(familiaDoServico("Advogada tributarista")).toBe("advocacia");
    expect(familiaDoServico("Serviços jurídicos tributários")).toBe("advocacia");
    expect(familiaDoServico("Serviços de tradução")).toBe("traducao");
    expect(familiaDoServico("Serviços")).toBeNull();
    expect(familiaDoServico("Mina de lítio")).toBeNull();
  });

  it("'Consultoria' procurado nomeia 'Consultoria jurídica' possuído; 'Consultoria em marketing' procurado não", () => {
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consultoria")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Procura consultoria")).toBe(true);
    // "Empresa de consultoria" × "Consultoria" deixou de ser a genérica em 14/09: os dois lados nomeiam o mesmo
    // serviço e nada além dele, o que vale 100 (revisão da #124). O par continua atendido; só muda a nota.
    expect(necessidadeGenericaNomeiaOServico("Empresa de consultoria", null, "Consultoria")).toBe(false);
    expect(necessidadeNomeiaOServico("Empresa de consultoria", null, "Consultoria")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consultoria em marketing")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consultoria tributária")).toBe(false); // duas palavras: outra necessidade
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Advocacia")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Serviços jurídicos", null, "Serviços")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Mina de lítio", null, "Consultoria")).toBe(false);
  });

  it("a família junta flexões e idiomas: 'Advogado' procurado nomeia 'Advocacia tributária' e 'Serviços jurídicos'", () => {
    expect(necessidadeGenericaNomeiaOServico("Advocacia tributária", null, "Advogado")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Serviços jurídicos tributários", null, "Advogada")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consulting")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Contabilidade tributária", null, "Contador")).toBe(true);
    // "Contabilidade para PMEs" deixou de ser a genérica em 14/09 (revisão na #127): público na oferta não é
    // especialidade, e o par é o mesmo serviço.
    expect(necessidadeGenericaNomeiaOServico("Contabilidade para PMEs", null, "Contador")).toBe(false);
    expect(mesmaFamiliaEEspecialidade("Contabilidade para PMEs", null, "Contador")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Advocacia tributária", null, "Contador")).toBe(false);
  });
});

describe("Cobertura de idiomas — a regra existia só em pt, en e es (defeito relatado depois da #101)", () => {
  it.each([
    ["pt", "Consultoria tributária", "consultoria"],
    ["en", "Tax consulting", "consultoria"],
    ["es", "Consultoría fiscal", "consultoria"],
    ["de", "Steuerberatung", "contabilidade"],
    ["de", "Rechtsberatung für Unternehmen", "advocacia"],
    ["fr", "Conseil fiscal", "consultoria"],
    ["fr", "Avocat fiscaliste", "advocacia"],
    ["ru", "Налоговый консалтинг", "consultoria"],
    ["ru", "Юридические услуги", "advocacia"],
    ["hi", "कर परामर्श", "consultoria"],
    // "कानूनी सलाहकार" é "consultor jurídico": a família é a do substantivo que nomeia a prestação (consultor), como em "Consultoria jurídica" (14/09).
    ["hi", "कानूनी सलाहकार", "consultoria"],
    ["ar", "استشارات ضريبية", "consultoria"],
    ["ar", "خدمات محاماة", "advocacia"],
    // Chinês e japonês não separam palavra por espaço: aqui quem reconhece é
    // SERVICOS_SEM_ESPACO, por substring.
    ["zh", "税务咨询", "consultoria"],
    ["zh", "法律服务", "advocacia"],
    ["ja", "税務コンサルティング", "consultoria"],
    ["ja", "弁護士事務所", "advocacia"],
  ])("%s: %s é serviço da família %s", (_idioma, rotulo, familia) => {
    expect(classificarOferta(rotulo)).toBe("servico");
    expect(familiaDoServico(rotulo)).toBe(familia);
  });

  it("e o que NÃO é serviço nesses idiomas continua não sendo — errar para cá barraria match legítimo", () => {
    for (const rotulo of ["Maschinen", "Оборудование", "मशीनरी", "آلات صناعية", "工业机械", "産業機械", "不動産"]) {
      expect(classificarOferta(rotulo), rotulo).not.toBe("servico");
    }
  });
});

describe("Especialidade do serviço e a necessidade que o nomeia (defeito relatado depois da #101)", () => {
  it("a especialidade é o que sobra tirada a prestação, em lema: tributária e tributarista são a mesma", () => {
    expect(especialidadeDoServico("Advocacia tributária")).toEqual(["tributario"]);
    expect(especialidadeDoServico("Advogado tributarista")).toEqual(["tributario"]);
    expect(especialidadeDoServico("Advogado de tributos")).toEqual(["tributario"]);
    expect(especialidadeDoServico("Escritório de advocacia trabalhista")).toEqual(["trabalhista"]);
    // Só nomeia a prestação, não o assunto.
    expect(especialidadeDoServico("Consultoria jurídica")).toEqual([]);
    expect(especialidadeDoServico("Mina de lítio")).toEqual([]);
  });

  it("a especialidade leva a CABEÇA junto: é ela que separa sell-side de buy-side", () => {
    // A primeira versão desta regra tirava só o complemento da cabeça, e em
    // "Sell-side advisory" a cabeça é "sell" — os dois lados da mesa casavam
    // em 100. O teste de direcao-do-termo pegou; este guarda a causa.
    expect(especialidadeDoServico("Sell-side advisory")).toEqual(["sell", "side"]);
    expect(especialidadeDoServico("Buy-side advisory")).toEqual(["buy", "side"]);
    expect(necessidadeNomeiaOServico("Sell-side advisory", null, "Buy-side advisory")).toBe(false);
  });

  it("mesma família e mesma especialidade: a necessidade nomeia o serviço, ainda que com outra flexão", () => {
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Advogado tributarista")).toBe(true);
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Advogado de tributos")).toBe(true);
    expect(necessidadeNomeiaOServico("Consultoria tributária", null, "Consultor tributário")).toBe(true);
    expect(necessidadeNomeiaOServico("Advocacia trabalhista", null, "Advogado trabalhista")).toBe(true);
    // A necessidade genérica continua valendo (regra de 12/09, intacta).
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Advogado")).toBe(true);
  });

  it("outra especialidade na mesma família NÃO casa — é o que a spec da cliente veta", () => {
    expect(necessidadeNomeiaOServico("Consultoria tributária", null, "Consultoria de marketing")).toBe(false);
    expect(necessidadeNomeiaOServico("Advocacia trabalhista", null, "Advogado tributarista")).toBe(false);
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Contador")).toBe(false);
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Distribuidor para a África")).toBe(false);
  });
});

describe("Serviço de assessoria — o que atende a opção fixa 'Consultoria'", () => {
  it("consultoria, jurídico, contábil, auditoria e mentoria atendem", () => {
    for (const rotulo of ["Advocacia tributária", "Consultoria em exportação", "Legal advisory", "Auditoria contábil", "Mentoria para fundadoras", "Asesoría fiscal"]) {
      expect(ehServicoDeAssessoria(rotulo), rotulo).toBe(true);
    }
    expect(ehServicoDeAssessoria("Direito tributário", "Jurídico")).toBe(true);
  });

  it("marketing, tradução e manutenção são serviço, mas não consultoria", () => {
    for (const rotulo of ["Marketing digital", "Serviços de tradução", "Manutenção industrial"]) {
      expect(ehServico(rotulo), rotulo).toBe(true);
      expect(ehServicoDeAssessoria(rotulo), rotulo).toBe(false);
    }
  });

  it("o que não é serviço nunca é assessoria — 'legal' fora da cabeça é adjetivo", () => {
    expect(ehServicoDeAssessoria("Cannabis legal")).toBe(false);
    expect(ehServicoDeAssessoria("Mina de lítio")).toBe(false);
  });

  it("a guarda de serviço vale: palavra de assessoria no meio de um item de outro tipo não conta", () => {
    // Mata o mutante que remove `if (!ehServico(...)) return false`.
    expect(ehServicoDeAssessoria("Rede de advogados")).toBe(false);
    expect(ehServicoDeAssessoria("Software de consultoria")).toBe(false);
  });
});

describe("Correção dos defeitos da #101 por cima da #124 — família, especialidade e classificação (14/09)", () => {
  it("(a) a mesma coisa escrita de outro jeito atende: mesma família e mesma especialidade (defeito a da #101, 13/09)", () => {
    const pares: Array<[string, string]> = [
      ["Advocacia tributária", "Advogado tributarista"],
      ["Advogado tributarista", "Advocacia tributária"],
      ["Contabilidade tributária", "Contador tributário"],
      ["Tradução jurídica", "Tradutor jurídico"],
      ["Advocacia criminal", "Advogado criminalista"],
      ["Tax lawyer", "Advogado tributarista"],
      ["Escritório de advocacia tributária", "Advogado tributarista"],
      ["Advocacia tributária", "Preciso de um advogado tributarista"],
      ["Advocacia tributária", "Advogado tributarista para revisão de ICMS"],
      ["Advocacia tributária em São Paulo", "Advogado tributarista"],
      ["Advocacia tributária", "Direito tributário"],
      ["Advocacia tributária e trabalhista", "Advogado trabalhista"],
      ["Consultoria tributária", "Assessoria tributária"],
      ["Consultoria jurídica para agências de marketing", "Consultoria jurídica"],
    ];
    for (const [oferta, necessidade] of pares) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(true);
    }
  });

  it("a necessidade genérica é atendida pela mesma família: 'Advogado' por 'Advocacia tributária', 'Consultoria' por 'Consultoria jurídica'", () => {
    const pares: Array<[string, string]> = [
      ["Consultoria jurídica", "Consultoria"],
      ["Consultoria jurídica", "Procura consultoria"],
      ["Empresa de consultoria", "Consultoria"],
      ["Advocacia tributária", "Advogado"],
      ["Serviços jurídicos tributários", "Advogada"],
      ["Consultoria jurídica", "Consulting"],
      ["Contabilidade para PMEs", "Contador"],
    ];
    for (const [oferta, necessidade] of pares) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(true);
    }
  });

  it("(c) serviços diferentes não se atendem pela palavra: outra especialidade, outro lema, oferta genérica (defeito c da #101)", () => {
    const pares: Array<[string, string]> = [
      ["Consultoria jurídica", "Consultoria em marketing"],
      ["Consultoria em marketing", "Consultoria jurídica"],
      ["Consultoria jurídica", "Assessoria"],
      ["Consultoria em marketing", "Advisory"],
      ["Assessoria de imprensa", "Consultoria"],
      ["Assistência jurídica", "Suporte"],
      ["Interpretação de exames laboratoriais", "Tradutor"],
      ["Consultoria de marketing jurídico", "Consultoria jurídica"],
      ["Consultoria em marketing para advogados", "Consultoria jurídica"],
      ["Consultoria digital", "Consultoria em marketing digital"],
      ["Consultoria de carreira", "Consultor de carros"],
      ["Consultoria jurídica", "Advocacia"],
      ["Advocacia", "Advogado tributarista"],
      ["Advocacia tributária", "Advogado trabalhista"],
      ["Advocacia tributária", "Contador"],
      ["Advocacia tributária", "Assessoria tributária"],
      ["Contabilidade tributária", "Advogado tributarista"],
      ["Serviços jurídicos", "Serviços"],
      ["Mina de lítio", "Consultoria"],
    ];
    for (const [oferta, necessidade] of pares) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(false);
    }
  });

  it("adjetivo posposto em português não é cabeça inglesa: 'Consultoria financeira' e 'Consultoria logística' são serviço (revisão de 13/09)", () => {
    for (const rotulo of ["Consultoria financeira", "Assessoria financeira", "Consultoria logística", "Auditoria financeira", "Consultor financeiro", "Asesoría financiera"]) {
      expect(classificarOferta(rotulo), rotulo).toBe("servico");
    }
    // O genérico "serviços" e o composto em inglês continuam como eram.
    expect(classificarOferta("Serviços financeiros")).toBe("investimento");
    expect(classificarOferta("Marketing platform")).toBe("tecnologia");
    expect(classificarOferta("Accounting software")).toBe("tecnologia");
  });

  it("decide a família da CABEÇA, e assessoria de imprensa ou de eventos não é consultoria (defeito c da #101, 13/09)", () => {
    for (const rotulo of ["Marketing para advogados", "Tradução jurídica", "Assessoria de imprensa", "Assessoria de eventos", "Assessoria de imprensa e eventos"]) {
      expect(ehServicoDeAssessoria(rotulo), rotulo).toBe(false);
    }
    for (const rotulo of ["Assessoria", "Assessoria jurídica", "Assessoria jurídica e de imprensa", "Coaching executivo", "Consultoria em marketing"]) {
      expect(ehServicoDeAssessoria(rotulo), rotulo).toBe(true);
    }
  });

  it("a família é o lema da palavra que nomeia o serviço: cabeça, composto inglês e adjetivo sozinho; e família é lema, não área", () => {
    expect(familiaDoServico("Marketing consulting")).toBe("consultoria");
    expect(familiaDoServico("Accounting advisory")).toBe("assessoria");
    expect(familiaDoServico("Legal translation")).toBe("traducao");
    expect(familiaDoServico("Jurídico")).toBe("advocacia");
    expect(familiaDoServico("Assessoria de imprensa")).toBe("assessoria");
    expect(familiaDoServico("Interpretação de exames laboratoriais")).toBe("interpretacao");
    expect(familiaDoServico("Coaching executivo")).toBe("coaching");
  });

  it("a família e a especialidade são coisas diferentes: 'Advogado' nomeia a família, 'Advogado tributarista' este serviço", () => {
    expect(necessidadeGenericaNomeiaOServico("Advocacia tributária", null, "Advogado")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Advocacia tributária", null, "Advogado tributarista")).toBe(false);
    expect(necessidadeNomeiaOServico("Advocacia tributária", null, "Advogado tributarista em São Paulo")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Advocacia tributária", null, "Assessoria jurídica")).toBe(true);
    expect(necessidadeNomeiaOServico("Direito tributário", "Serviços", "Advogado tributarista")).toBe(true);
  });

  it("cabeças neutras e revenda: agência e especialista atravessam; revenda de marca colada à cabeça não é serviço", () => {
    expect(classificarOferta("Agência de viagens")).toBe("outros");
    expect(classificarOferta("Agência de publicidade")).toBe("servico");
    expect(classificarOferta("Empresa especializada em consultoria")).toBe("servico");
    expect(classificarOferta("Contratação de pessoal")).toBe("outros");
    expect(classificarOferta("Consultora Natura")).toBe("outros");
    expect(classificarOferta("Mentoria para revendedoras Natura")).toBe("servico");
    expect(classificarOferta("Material publicitário", "Produtos")).toBe("produto");
    expect(classificarOferta("Suporte financeiro", "Capital")).toBe("investimento");
    expect(ehServicoDeAssessoria("Jurídico")).toBe(true);
    expect(ehServicoDeAssessoria("Legal services")).toBe(true);
  });
});

describe("Revisão adversarial da correção (13/09) — a mesma coisa escrita de outro jeito", () => {
  const casos = (pares: Array<[string, string]>, esperado: boolean) => {
    for (const [oferta, necessidade] of pares) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(esperado);
    }
  };

  it("adjetivo sozinho nomeia o serviço: 'Jurídico', 'Contábil', 'Legal services'", () => {
    casos([["Advocacia", "Jurídico"], ["Jurídico", "Advogado"], ["Contabilidade", "Contábil"], ["Contábil", "Contador"], ["Legal services", "Lawyer"], ["Servicios legales", "Abogado"]], true);
    expect(ehServicoDeAssessoria("Legal services")).toBe(true);
    expect(classificarOferta("Pessoa jurídica")).toBe("outros");
  });

  it("profissão, jeito de pedir, lugar e qualificador não mudam o serviço", () => {
    casos([
      ["Engenharia civil", "Engenheiro civil"], ["Publicidade", "Publicitário"], ["Palestras", "Palestrante"],
      ["Contabilidade", "Contabilista"], ["Recrutamento", "Recrutadora"],
      ["Contabilidade", "Estou procurando contador"], ["Advocacia", "We are looking for a lawyer"], ["Tax lawyer", "Looking for a tax lawyer"],
      ["Contabilidade", "Gostaria de contratar contador"], ["Contabilidade", "Indicação de contador"], ["Contabilidade", "Necesitamos contador"],
      ["Advocacia tributária", "Especialista em direito tributário"], ["Marketing digital", "Agência de marketing digital"],
      ["Contabilidade", "Contador em Campinas"], ["Advocacia tributária", "Advogado tributarista em Curitiba"], ["Advocacia", "Advogado em Belo Horizonte"],
      ["Advocacia tributária", "Advogado tributarista em São Paulo"], ["Advocacia tributária", "Precisamos de advogado tributarista"],
      ["Advocacia tributária", "Advogada tributarista experiente"], ["Advocacia tributária", "Advogado especializado em direito tributário"],
      ["Advocacia tributária", "Advocacia jurídica tributária"], ["Contabilidade internacional", "We need an accountant"],
    ], true);
  });

  it("plurais, sinônimos curados e serviços coordenados", () => {
    casos([
      ["Consultoria em exportação", "Consultoria em exportações"], ["Treinamento gerencial", "Treinamentos gerenciais"],
      ["Design de embalagens", "Designer de embalagem"], ["Advocacia cível", "Advogado civil"], ["Abogado laboralista", "Derecho laboral"],
      ["Advocacia imobiliária", "Advogado especialista em imóveis"], ["Advocacia corporativa", "Advogado societário"],
      ["Tradução e interpretação", "Intérprete"], ["Mentoria e coaching", "Coach"], ["Advocacia tributária", "Contador ou advogado tributarista"],
      ["Advocacia", "Assessoria jurídica"], ["Contabilidade", "Assessoria contábil"],
    ], true);
  });
});

describe("Revisão adversarial da correção (13/09) — serviços diferentes continuam sem casar", () => {
  it("público-alvo, finalidade e 'com foco em' não fazem a necessidade genérica", () => {
    for (const [oferta, necessidade] of [
      ["Advocacia tributária", "Advogado para divórcio"], ["Consultoria jurídica", "Consultoria para exportação"], ["Tax lawyer", "Lawyer for immigration"],
      ["Consultoria jurídica", "Consultoria com foco em marketing digital"], ["Advocacia tributária", "Advogada com experiência em direito do trabalho"],
    ] as Array<[string, string]>) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(false);
    }
    expect(servicoAtendeNecessidade("Advocacia tributária", "Advogado para revisão tributária")).toBe(true);
    expect(servicoAtendeNecessidade("Consultoria jurídica para PMEs", "Consultoria para PMEs")).toBe(true);
    expect(servicoAtendeNecessidade("Consultoria em exportação", "Consultoria voltada para exportação")).toBe(true);
  });

  it("idioma, lema que colide, 'direito' e palavra de serviço dentro do assunto", () => {
    for (const [oferta, necessidade] of [
      ["Tradução de alemão", "Tradutor de japonês"], ["Curso de espanhol", "Curso de alemão"],
      ["Consultoria em segurança do trabalho", "Consultoria trabalhista"], ["Consultoria corporativa", "Consultoria societária"],
      ["Consultoria em conselho fiscal", "Consultoria tributária"], ["Consultoria em construção civil", "Consultoria em direito civil"],
      ["Treinamento corporativo", "Treinamento societário"], ["Consultoria digital", "Consultoria em direito digital"],
      ["Consultoria em tecnologia jurídica", "Consultoria jurídica"], ["Consultoria em gestão de escritórios de advocacia", "Consultoria jurídica"],
      ["Consultoria jurídica para startups e empresas de tecnologia", "Consultoria em tecnologia"],
      ["Marketing para advogados e contadores", "Contador"], ["Consultoria jurídica", "Consultoria em gestão"],
    ] as Array<[string, string]>) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(false);
    }
    expect(servicoAtendeNecessidade("Advocacia trabalhista", "Advogado do trabalho")).toBe(true);
    expect(servicoAtendeNecessidade("Auditoria fiscal", "Auditoria tributária")).toBe(true);
    expect(servicoAtendeNecessidade("Tradução juramentada de espanhol", "Tradutor de espanhol")).toBe(true);
  });

  it("assessoria que não aconselha não atende a opção fixa 'Consultoria'", () => {
    for (const rotulo of ["Assessoria de redes sociais", "Assessoria de viagens", "Coach de corrida", "Consultora Natura"]) {
      expect(ehServicoDeAssessoria(rotulo), rotulo).toBe(false);
    }
    expect(ehServicoDeAssessoria("Coaching executivo")).toBe(true);
  });

  it("no trecho da IA, vírgula e conjunção separam os pedidos; assunto em comum não basta", () => {
    expect(trechoNomeiaServicoAtendido("precisa de advogado, contador e designer", ["Advocacia empresarial"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("assessoria jurídica para abrir a empresa", ["Advocacia empresarial"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("consultoria em marketing para mulheres empreendedoras", ["Consultoria jurídica para mulheres empreendedoras"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria em agronegócio", ["Marketing para o agronegócio"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("suporte em marketing para a clínica", ["Marketing digital para clínicas"])).toBe("atende");
  });
});

describe("trechoNomeiaServicoAtendido — a citação da IA amarrada ao serviço oferecido (defeito c da #101, 13/09)", () => {
  it("frase sem palavra de serviço é paráfrase e fica com a IA", () => {
    expect(trechoNomeiaServicoAtendido("Precisamos revisar nossos tributos e identificar créditos fiscais", ["Advocacia tributária"])).toBe("nao-nomeia-servico");
  });

  it("outro serviço não atende; o mesmo, escrito de outro jeito ou mais específico, atende", () => {
    const frase = "consultoria em marketing digital para lançar a marca no Brasil";
    expect(trechoNomeiaServicoAtendido(frase, ["Consultoria jurídica"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido(frase, ["Consultoria em marketing"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido(frase, ["Consultoria jurídica", "Consultoria em marketing"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("precisamos de advogado tributarista para o ICMS", ["Advocacia tributária"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("precisamos de contador tributário", ["Advocacia tributária"])).toBe("nao-atende");
  });

  it("serviço de apoio se amarra pelo assunto; oferta genérica deixa a especialidade para a IA", () => {
    // Apoio diante de assessoria com a mesma especialidade (ou nenhuma reconhecida) fica com a IA: não barra.
    expect(trechoNomeiaServicoAtendido("assessoria tributária para revisar a carga fiscal", ["Serviços jurídicos tributários"])).not.toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("suporte para obter autorização regulatória do nosso medicamento", ["Consultoria para registro de medicamentos"])).not.toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria financeira para reestruturar dívidas", ["consultoria"])).toBe("atende");
  });
});

describe("Necessidade que coordena serviços diferentes (revisão de 13/09)", () => {
  it("'Advogado e contador' nomeia os dois: atendida pela advocacia e pela contabilidade", () => {
    const atende: Array<[string, string]> = [
      ["Advocacia tributária", "Advogado e contador"],
      ["Contabilidade", "Advogado e contador"],
      ["Advocacia tributária", "Advogado e contador tributário"],
      ["Advocacia tributária", "Precisamos de advogado e contador"],
      ["Tradução e interpretação", "Intérprete"],
      ["Advocacia tributária", "Distribuidor e advogado tributarista"],
      ["Advocacia trabalhista", "Advogado tributarista e trabalhista"],
    ];
    for (const [oferta, necessidade] of atende) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(true);
    }
  });

  it("especialidade coordenada, complemento com preposição e público-alvo não abrem outro serviço", () => {
    const naoAtende: Array<[string, string]> = [
      ["Marketing digital", "Consultoria jurídica e de marketing"],
      ["Advocacia tributária", "Marketing para escritórios e empresas de advocacia"],
      ["Mina e consultoria mineral", "Consultoria mineral"],
      ["Advocacia tributária", "Advogado trabalhista e previdenciário"],
    ];
    for (const [oferta, necessidade] of naoAtende) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(false);
    }
  });
});

describe("'Direito' com área curada é serviço pelo texto (fecha o buraco registrado na #124, 14/09)", () => {
  it("'Direito tributário' sem categoria é serviço; 'Direito' sem área curada, não", () => {
    for (const rotulo of ["Direito tributário", "Direito do trabalho", "Direito de família", "Derecho laboral"]) {
      expect(classificarOferta(rotulo), rotulo).toBe("servico");
    }
    for (const rotulo of ["Direito minerário", "Direito creditório", "Direitos minerários", "Direito real de uso", "Direito exclusivo de distribuição", "Lado direito"]) {
      expect(ehServico(rotulo), rotulo).toBe(false);
    }
    expect(classificarOferta("Especialista em direito tributário")).toBe("servico");
    expect(familiaDoServico("Direito do trabalho")).toBe("advocacia");
    expect(servicoAtendeNecessidade("Direito imobiliário", "Advogado especialista em imóveis")).toBe(true);
  });
});


describe("Revisão adversarial da correção empilhada sobre a #124 (14/09)", () => {
  it("dois profissionais colados e adjetivo de profissão posposto não trocam a família", () => {
    expect(familiaDoServico("Tradutora-intérprete de Libras")).toBe("traducao");
    expect(familiaDoServico("Advogado consultor")).toBe("advocacia");
    expect(familiaDoServico("Traduction juridique")).toBe("traducao");
    expect(familiaDoServico("Audit comptable")).toBe("auditoria");
    expect(familiaDoServico("محاسب قانوني")).toBe("contabilidade");
    expect(familiaDoServico("Comptable")).toBe("contabilidade");
    expect(familiaDoServico("Marketing consulting")).toBe("consultoria");
  });

  it("o mesmo serviço volta a casar", () => {
    for (const [oferta, necessidade] of [
      ["Tradutora-intérprete de Libras", "Intérprete de Libras"], ["Tradutora-intérprete de Libras", "Tradutora de Libras"],
      ["Advogada consultora", "Advogada"], ["Advogado consultor tributário", "Advogado tributarista"], ["Contadora auditora", "Contadora"],
      ["Traduction juridique", "Traducteur"], ["Audit comptable", "Auditeur"], ["محاسب قانوني", "محاسب"], ["律师", "Advogado"], ["会计", "Contador"],
      ["Property lawyer", "Advogado imobiliário"], ["Corporate training", "Treinamento corporativo"], ["Consultoria empresarial", "Consultoria corporativa"],
      ["Advocacia tributária corporativa", "Advogado tributarista"], ["Advocacia criminal", "Advogado para defesa criminal"],
      ["Advogados e consultores tributários", "Advogado tributarista"], ["Consultoria marketing digital", "Consultoria em marketing digital"],
      ["Advocacia de família", "Advogado para inventário"], ["Advocacia de família", "Advogado para pensão alimentícia"],
    ] as Array<[string, string]>) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(true);
    }
  });

  it("serviço diferente continua sem casar", () => {
    for (const [oferta, necessidade] of [
      ["Traduction juridique", "Avocat"], ["Marketing juridique", "Avocat"], ["محاسب قانوني", "محامي"], ["Audit comptable", "Comptable"],
      ["律师", "Advogado tributarista"],
      ["Consultoria trabalhista", "Consultoria para segurança do trabalho"], ["Consultoria jurídica", "Consultoria para advogados"],
      ["Engenharia civil", "Engenheiro para aviação civil"], ["Consultoria empresarial", "Consultoria para seguros empresariais"],
      ["Advocacia de família", "Advogado para pensão por morte"], ["Auditoria de inventário", "Auditoria familiar"],
      ["Consultoria em inventário", "Consultoria familiar"], ["Consultoria em gestão", "Consultoria em gestão pública"],
      ["Consultoria em gestão pública", "Consultoria em gestão"], ["Consultoria jurídica", "Consultoria de seleção"],
      ["Consultoria publicitária imobiliária", "Consultoria imobiliária"], ["Advocacia tributária", "Advogado para processos"],
    ] as Array<[string, string]>) {
      expect(servicoAtendeNecessidade(oferta, necessidade), `${oferta} × ${necessidade}`).toBe(false);
    }
  });

  it("'Direito digital' seguido do objeto é o ativo, não o serviço", () => {
    for (const rotulo of ["Direito digital de transmissão do filme", "Direito internacional de distribuição da marca", "Direito digital sobre o catálogo musical"]) {
      expect(ehServico(rotulo), rotulo).toBe(false);
    }
    expect(ehServico("Direito digital")).toBe(true);
    expect(ehServico("Direito internacional")).toBe(true);
  });

  it("no trecho da IA: outro serviço entendido barra; o que as listas não leem fica com o modelo", () => {
    expect(trechoNomeiaServicoAtendido("consultoria em marketing jurídico", ["Consultoria jurídica"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria jurídica", ["Consultoria de marketing jurídico"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria em marketing digital", ["Consultoria em transformação digital"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria em marketing digital", ["Consultoria em marketing"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("consultoria em e-commerce", ["Consultoria jurídica"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria em marketing digital e redes sociais", ["Consultoria jurídica"])).toBe("nao-atende");
    for (const trecho of ["advogado também", "lawyer urgently", "law firm", "advogado para a nossa empresa", "advogado de LGPD", "avocat pour notre filiale"]) {
      expect(trechoNomeiaServicoAtendido(trecho, ["Advocacia tributária"]), trecho).not.toBe("nao-atende");
    }
  });
});


describe("Reverificação dos consertos da correção empilhada (14/09)", () => {
  it("no trecho da IA: 'técnica' é especialidade, o serviço como assunto da profissão passa, idioma e 'holding familiar' ficam com o modelo", () => {
    expect(trechoNomeiaServicoAtendido("assistência técnica para as máquinas", ["Advocacia tributária"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("consultoria jurídica de design de marca", ["Consultoria jurídica"])).toBe("atende");
    expect(trechoNomeiaServicoAtendido("consultoria em design digital", ["Consultoria digital"])).toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("tradutor de inglês para documentos do visto", ["Tradução juramentada"])).not.toBe("nao-atende");
    expect(trechoNomeiaServicoAtendido("advogado holding familiar", ["Advocacia societária"])).not.toBe("nao-atende");
  });

  it("empresa familiar não é a área de família", () => {
    expect(servicoAtendeNecessidade("Consultoria em empresas familiares", "Consultoria familiar")).toBe(false);
    expect(servicoAtendeNecessidade("Advocacia de família", "Advogado de família")).toBe(true);
    expect(servicoAtendeNecessidade("Family lawyer", "Advogado de família")).toBe(true);
  });
});
