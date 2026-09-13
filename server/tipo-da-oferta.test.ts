import { describe, expect, it } from "vitest";
import { classificarOferta, ehServico, ehServicoDeAssessoria, familiaDoServico, LISTAS_POR_TIPO, necessidadeGenericaNomeiaOServico, TIPOS_DA_OFERTA } from "@shared/tipo-da-oferta";

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

  it("as listas estão normalizadas: minúsculas, sem acento, sem espaço", () => {
    for (const [, palavras] of LISTAS_POR_TIPO) {
      for (const palavra of palavras) expect(palavra).toMatch(/^[a-z0-9]+$/);
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
    for (const rotulo of ["Café especial", "Terras raras", "Distribuidor na África", "Direito tributário", "Vinhos", "Cacau fino"]) {
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

  it("substantivo de serviço colado à cabeça decide: 'Logistics consulting', 'Logística e consultoria aduaneira'", () => {
    expect(classificarOferta("Logistics consulting")).toBe("servico");
    expect(classificarOferta("Transport consultancy")).toBe("servico");
    expect(classificarOferta("Logística e consultoria aduaneira")).toBe("servico");
    expect(classificarOferta("Real estate consulting")).toBe("servico");
    expect(classificarOferta("Real estate in Lisbon")).toBe("imovel");
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

  it("cabeça neutra (empresa, escritório) deixa o resto do termo decidir — inclusive o adjetivo", () => {
    expect(classificarOferta("Escritório de advocacia")).toBe("servico");
    expect(classificarOferta("Empresa de contabilidade")).toBe("servico");
    expect(classificarOferta("Escritório jurídico")).toBe("servico");
    expect(classificarOferta("Escritório comercial")).toBe("outros");
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

  it("na categoria, palavra de outro tipo vence 'serviços': 'Serviços financeiros' é capital", () => {
    expect(classificarOferta("Linha de crédito", "Serviços financeiros")).toBe("investimento");
    expect(classificarOferta("Linha de crédito", "Serviços de tecnologia")).toBe("tecnologia");
    expect(classificarOferta("Linha de crédito", "Serviços jurídicos")).toBe("servico");
    expect(ehServico("Linha de crédito", "Serviços financeiros")).toBe(false);
  });
});

describe("Família do serviço e necessidade genérica", () => {
  it("a família é o primeiro substantivo de serviço; 'serviços' sozinho não é família", () => {
    expect(familiaDoServico("Consultoria jurídica")).toBe("consultoria");
    expect(familiaDoServico("Empresa de consultoria")).toBe("consultoria");
    expect(familiaDoServico("Serviços de tradução")).toBe("traducao");
    expect(familiaDoServico("Serviços")).toBeNull();
    expect(familiaDoServico("Mina de lítio")).toBeNull();
  });

  it("'Consultoria' procurado nomeia 'Consultoria jurídica' possuído; 'Consultoria em marketing' procurado não", () => {
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consultoria")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Procura consultoria")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Empresa de consultoria", null, "Consultoria")).toBe(true);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Consultoria em marketing")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Consultoria jurídica", null, "Advocacia")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Serviços jurídicos", null, "Serviços")).toBe(false);
    expect(necessidadeGenericaNomeiaOServico("Mina de lítio", null, "Consultoria")).toBe(false);
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
