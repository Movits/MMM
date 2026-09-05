import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import en from "../i18n/locales/en.json";
import ptBR from "../i18n/locales/pt-BR.json";
import { CHAVES_DE_INTERESSE, chaveDeInteresse, rotuloDeInteresse } from "./interesses";

// Interesses do cartão de match (reverificação de 04/09, major 25 do
// Dashboard): o sinônimo é resolvido sobre o TERMO CRU, antes de traduzir.
// Antes, o Dashboard traduzia primeiro e procurava depois num mapa de rótulos
// em português — em inglês "food" não casava com nada e o que casava saía
// "Alimentos & Bebidas" em todos os idiomas.
describe("chaveDeInteresse", () => {
  it("termo cru (rótulo antigo em português) vira a chave de interesse", () => {
    expect(chaveDeInteresse("Alimentos & Bebidas")).toBe("foodBeverage");
    expect(chaveDeInteresse("Beleza & Cosméticos")).toBe("beauty");
    expect(chaveDeInteresse("Imobiliário")).toBe("realEstate");
  });

  it("sinônimos informais, com ou sem acento, maiúsculas e sublinhado", () => {
    expect(chaveDeInteresse("roupas")).toBe("fashion");
    expect(chaveDeInteresse("SAÚDE")).toBe("health");
    expect(chaveDeInteresse("saude")).toBe("health");
    expect(chaveDeInteresse("real_estate")).toBe("realEstate");
    expect(chaveDeInteresse("  food ")).toBe("foodBeverage");
    expect(chaveDeInteresse("agronegócio")).toBe("agribusiness");
  });

  it("termo desconhecido não vira chave nenhuma", () => {
    expect(chaveDeInteresse("investor")).toBeNull();
    expect(chaveDeInteresse("Financeiro & Fintechs")).toBeNull();
    expect(chaveDeInteresse("")).toBeNull();
  });
});

describe("rotuloDeInteresse", () => {
  it("com sinônimo, traduz pela chave dashboard.interests.* — em inglês, 'Food & Beverage'", () => {
    const en = (chave: string) => (chave === "dashboard.interests.foodBeverage" ? "Food & Beverage" : chave);
    expect(rotuloDeInteresse(en, "Alimentos & Bebidas")).toBe("Food & Beverage");
    expect(rotuloDeInteresse(en, "food")).toBe("Food & Beverage");
  });

  it("sem sinônimo, o termo passa cru (padrão) ou pelo tradutor de opções que a tela passar", () => {
    const t = vi.fn((chave: string) => chave);
    expect(rotuloDeInteresse(t, "Financeiro & Fintechs")).toBe("Financeiro & Fintechs");
    expect(t).not.toHaveBeenCalled();

    const opcoes = vi.fn((termo: string) => (termo === "investor" ? "Investidora" : termo));
    expect(rotuloDeInteresse(t, "investor", opcoes)).toBe("Investidora");
    expect(opcoes).toHaveBeenCalledWith("investor");
    expect(t).not.toHaveBeenCalled();
  });

  it("toda chave de interesse tem tradução em pt-BR e em inglês, e a inglesa não é a portuguesa copiada", () => {
    for (const chave of CHAVES_DE_INTERESSE) {
      expect(ptBR.dashboard.interests, `pt-BR: dashboard.interests.${chave}`).toHaveProperty(chave);
      expect(en.dashboard.interests, `en: dashboard.interests.${chave}`).toHaveProperty(chave);
    }
    expect(en.dashboard.interests.foodBeverage).toBe("Food & Beverage");
    expect(en.dashboard.interests.foodBeverage).not.toBe(ptBR.dashboard.interests.foodBeverage);
  });
});

// A ORDEM é o que corrige o bug: sinônimo no termo CRU, e só depois a
// tradução. "tech" serve de prova porque é as duas coisas ao mesmo tempo:
// sinônimo de technology (lib/interesses.ts) E chave de especialidade do
// onboarding (onboarding.specialties.tech = "Technology & Software"). Na ordem
// certa, o sinônimo casa primeiro e o rótulo é dashboard.interests.technology
// ("Technology"); na ordem antiga do Dashboard — traduzir pelas opções e só
// então procurar o sinônimo — "tech" vira "Technology & Software", que não é
// sinônimo de nada, e é isso que sai na tela. O tradutor de opções nem pode
// ser chamado quando o sinônimo casou: chamá-lo é sinal da ordem invertida.
// `t` é o da instância real do app (getFixedT), para provar também que a
// chave dashboard.interests.technology existe nos JSONs com esse texto.
describe("ordem: sinônimo no termo cru ANTES de traduzir", () => {
  const opcoesDe = (idioma: typeof en | typeof ptBR) =>
    vi.fn((termo: string) => (idioma.onboarding.specialties as Record<string, string>)[termo] ?? termo);

  it("premissa: 'tech' é sinônimo E chave de especialidade do onboarding, com rótulos diferentes", () => {
    expect(chaveDeInteresse("tech")).toBe("technology");
    expect(en.onboarding.specialties.tech).toBe("Technology & Software");
    expect(en.dashboard.interests.technology).toBe("Technology");
    expect(chaveDeInteresse(en.onboarding.specialties.tech)).toBeNull();
  });

  it("inglês: 'tech' sai 'Technology' — não 'Technology & Software' — e o tradutor de opções não é consultado", () => {
    const opcoes = opcoesDe(en);
    const rotulo = rotuloDeInteresse(i18n.getFixedT("en"), "tech", opcoes);
    expect(rotulo).toBe("Technology");
    expect(rotulo).not.toBe("Technology & Software");
    expect(opcoes).not.toHaveBeenCalled();
  });

  it("português: 'tech' sai 'Tecnologia' — não 'Tecnologia & Software'", () => {
    const opcoes = opcoesDe(ptBR);
    expect(rotuloDeInteresse(i18n.getFixedT("pt-BR"), "tech", opcoes)).toBe("Tecnologia");
    expect(opcoes).not.toHaveBeenCalled();
  });

  it("sem sinônimo, o tradutor de opções recebe o termo CRU (não um termo já traduzido)", () => {
    const opcoes = opcoesDe(en);
    expect(rotuloDeInteresse(i18n.getFixedT("en"), "design", opcoes)).toBe("Design & Creativity");
    expect(opcoes).toHaveBeenCalledTimes(1);
    expect(opcoes).toHaveBeenCalledWith("design");
  });
});
