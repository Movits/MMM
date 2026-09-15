import { describe, expect, it, vi } from "vitest";

// A tela inteira vem junto no import, e SmartMatchConsent puxa CSS do katex,
// que o runner não transforma. O selo não depende dele; o dublê só corta a
// corrente de imports.
vi.mock("@/components/SmartMatchConsent", () => ({ SmartMatchConsent: () => null }));

const { seloDoMatch } = await import("./IntelligentMatches");

/**
 * O selo do match. Desde 14/09 o tipo "category" carrega DUAS coisas com a
 * mesma nota 60: a categoria em comum de sempre e a necessidade que nomeia só
 * a FAMÍLIA do serviço (conserto do terceiro defeito relatado sobre a #101,
 * que dava 100 à família genérica). Dizer "Mesma categoria" no segundo caso
 * afirmaria à usuária uma coisa que os termos na linha de baixo desmentem.
 */
const t = (chave: string) => chave.replace("intelligentMatches.", "");
const item = (label: string, category: string | null = null) => ({ slug: "", label, category });

describe("seloDoMatch", () => {
  it("necessidade que nomeia a família do serviço: diz família, não categoria", () => {
    expect(seloDoMatch({
      matchType: "category",
      matchedAssets: [item("Consultoria tributária", "Serviços")],
      matchedNeeds: [item("Consultoria", "Serviços")],
    }, t)).toBe("seloFamilia");
  });

  it("categoria em comum de verdade, sem serviço envolvido: segue dizendo categoria", () => {
    expect(seloDoMatch({
      matchType: "category",
      matchedAssets: [item("Mina de lítio", "Mineração")],
      matchedNeeds: [item("Britagem", "Mineração")],
    }, t)).toBe("seloCategoria");
  });

  it("mesma categoria entre serviços de famílias DIFERENTES não é família", () => {
    expect(seloDoMatch({
      matchType: "category",
      matchedAssets: [item("Advocacia tributária", "Serviços")],
      matchedNeeds: [item("Tradução juramentada", "Serviços")],
    }, t)).toBe("seloCategoria");
  });

  it("os outros tipos não mudaram", () => {
    const termos = { matchedAssets: [item("Café")], matchedNeeds: [item("Café")] };
    expect(seloDoMatch({ matchType: "mutual", ...termos }, t)).toBe("seloMutuo");
    expect(seloDoMatch({ matchType: "semantic", ...termos }, t)).toBe("seloSignificados");
    expect(seloDoMatch({ matchType: "exact", ...termos }, t)).toBe("seloTagExata");
    expect(seloDoMatch({
      matchType: "exact",
      matchedAssets: [item("Exportar vinho")],
      matchedNeeds: [item("Importar vinho")],
    }, t)).toBe("seloOfertaProcura");
  });
});


describe("seloDoMatch — a mesma pergunta que o motor fez (14/09)", () => {
  it("apoio que nomeia a profissão e profissional coordenado, sem categoria: diz família", () => {
    expect(seloDoMatch({ matchType: "category", matchedAssets: [item("Advocacia tributária")], matchedNeeds: [item("Assessoria jurídica")] }, t)).toBe("seloFamilia");
    expect(seloDoMatch({ matchType: "category", matchedAssets: [item("Advogado e contador")], matchedNeeds: [item("Contador")] }, t)).toBe("seloFamilia");
  });
});

describe("seloDoMatch — o 100 pelo mesmo serviço não é 'Tag exata' (revisão de 14/09 na #127)", () => {
  it("especialidade ou família escritas de outro jeito dizem 'Mesmo serviço'", () => {
    for (const [ativo, necessidade] of [["Advocacia tributária", "Advogado tributarista"], ["Contabilidade", "Contador"], ["律师事务所", "律师"]]) {
      expect(seloDoMatch({ matchType: "exact", matchedAssets: [item(ativo)], matchedNeeds: [item(necessidade)] }, t), `${ativo} × ${necessidade}`).toBe("seloMesmoServico");
    }
  });

  it("a mesma tag e o mesmo objeto seguem dizendo 'Tag exata'", () => {
    expect(seloDoMatch({ matchType: "exact", matchedAssets: [item("Consultoria tributária")], matchedNeeds: [item("Consultoria tributária")] }, t)).toBe("seloTagExata");
    expect(seloDoMatch({ matchType: "exact", matchedAssets: [item("Terras raras")], matchedNeeds: [item("Procura terras raras")] }, t)).toBe("seloTagExata");
    // O mesmo SERVIÇO pelo mesmo objeto também é tag exata: o motor o reconhece como mesmo serviço, e sem a pergunta do
    // objeto (`nomeiamAMesmaCoisa`) o selo diria "Mesmo serviço" para tags iguais a menos do "Procura" (revisão de 15/09 na #127).
    for (const [ativo, necessidade] of [["Consultoria tributária", "Procura consultoria tributária"], ["Contabilidade", "Procura contabilidade"]]) {
      expect(seloDoMatch({ matchType: "exact", matchedAssets: [item(ativo)], matchedNeeds: [item(necessidade)] }, t), `${ativo} × ${necessidade}`).toBe("seloTagExata");
    }
  });
});
