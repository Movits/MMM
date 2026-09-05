// Interesses de negócio no cartão de match (Dashboard). O perfil guarda a
// CHAVE da opção ("agribusiness", "investor") ou, em dados antigos, texto
// livre ("roupas", "tech", "food", "Alimentos & Bebidas"). Este módulo casa o
// TERMO CRU com uma chave de interesse (dashboard.interests.*) ANTES de
// qualquer tradução. O Dashboard fazia o contrário — traduzia a chave para o
// rótulo do idioma da tela e só então procurava o sinônimo num mapa com
// rótulos em português fixo: em inglês "food" virava "Food", não casava com
// nada, e o que casava saía "Alimentos & Bebidas" em todos os idiomas.
export const CHAVES_DE_INTERESSE = [
  "fashion", "technology", "foodBeverage", "agribusiness", "beauty",
  "health", "education", "finance", "investment", "realEstate",
] as const;

export type ChaveDeInteresse = typeof CHAVES_DE_INTERESSE[number];

// Sinônimos sem acento e em minúsculas (ver `normalizar`): "Saúde", "saude"
// e "SAÚDE" caem na mesma entrada. Inclui os rótulos em português e em inglês
// que o mapa antigo produzia, para dado gravado com o rótulo continuar casando.
const SINONIMOS: Record<string, ChaveDeInteresse> = {
  // Moda / vestuário
  moda: "fashion", roupas: "fashion", vestuario: "fashion", fashion: "fashion",
  clothing: "fashion", textil: "fashion", textile: "fashion", confeccao: "fashion", apparel: "fashion",
  // Tecnologia
  tecnologia: "technology", tech: "technology", ti: "technology", software: "technology", startup: "technology",
  // Alimentação
  "alimentos & bebidas": "foodBeverage", "food & beverage": "foodBeverage",
  alimentos: "foodBeverage", comida: "foodBeverage", food: "foodBeverage", bebidas: "foodBeverage",
  // Agronegócio
  agronegocio: "agribusiness", agro: "agribusiness", agribusiness: "agribusiness",
  // Beleza
  "beleza & cosmeticos": "beauty", "beauty & cosmetics": "beauty",
  beleza: "beauty", cosmeticos: "beauty", beauty: "beauty",
  // Saúde
  saude: "health", health: "health", medico: "health",
  // Educação
  educacao: "education", education: "education",
  // Finanças
  financas: "finance", financeiro: "finance", finance: "finance",
  investimento: "investment", investment: "investment",
  // Imobiliário
  imobiliario: "realEstate", imoveis: "realEstate", "real estate": "realEstate",
};

// Minúsculas, sem acento, espaços e sublinhados reduzidos a um espaço:
// "Real_Estate", "real estate" e "REAL ESTATE" são o mesmo termo.
function normalizar(termo: string): string {
  return termo
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
}

/** Chave de interesse do termo cru, ou null quando ele não é sinônimo de nenhum. */
export function chaveDeInteresse(termoCru: string): ChaveDeInteresse | null {
  return SINONIMOS[normalizar(termoCru)] ?? null;
}

/**
 * Rótulo traduzido do interesse. Com sinônimo, é t("dashboard.interests.X");
 * sem sinônimo, `semSinonimo(termoCru)` decide — o Dashboard passa a tradução
 * das opções do onboarding ("investor" → "Investidora"), e o padrão devolve o
 * termo como veio.
 */
export function rotuloDeInteresse(
  t: (chave: string) => string,
  termoCru: string,
  semSinonimo: (termo: string) => string = (termo) => termo,
): string {
  const chave = chaveDeInteresse(termoCru);
  return chave ? t(`dashboard.interests.${chave}`) : semSinonimo(termoCru);
}
