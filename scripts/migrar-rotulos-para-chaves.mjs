// Migra os campos de lista de user_profiles do RÓTULO TRADUZIDO (pt-BR) para
// a CHAVE canônica, e recalcula o profileCompleteness.
//
// Contexto: até 31/08/2026 o onboarding gravava o texto exibido em
// seekingTypes, values, languages, businessInterests e nas especialidades.
// Como o matching compara essas strings entre usuárias, quem preenchesse em
// outro idioma nunca daria match. O front passou a gravar chaves; este script
// converte o que já existia no banco.
//
// Os mapas usam os textos EXATOS do pt-BR.json vigente quando os dados foram
// gravados. Valores já em chave, ou texto custom sem mapa, ficam como estão —
// é seguro rodar mais de uma vez.
//
// Uso:  DATABASE_URL='mysql://...' node scripts/migrar-rotulos-para-chaves.mjs

import mysql from "mysql2/promise";

const SEEKING = {
  "Sócia estratégica": "strategic_partner",
  "Sócia ou parceira de negócios": "strategic_partner",
  "Parceira comercial": "strategic_partner", // opção fundida
  "Investidora": "investor",
  "Mentora": "mentor",
  "Advisor": "mentor", // opção fundida
  "Equipe/Talentos": "team",
  "Emprego/Projeto": "job",
  "Ser mentora": "be_mentor",
  "Quero também mentorar": "be_mentor",
};
const VALORES = {
  "Inovação": "innovation", "Impacto social": "social_impact",
  "Autonomia": "autonomy", "Crescimento rápido": "fast_growth",
  "Estabilidade": "stability", "Propósito": "purpose",
  "Colaboração": "collaboration", "Resultados": "results",
  "Diversidade": "diversity", "Transparência": "transparency",
  "Sustentabilidade": "sustainability", "Excelência técnica": "technical_excellence",
};
const IDIOMAS = {
  "Português": "portuguese", "Inglês": "english", "Espanhol": "spanish",
  "Francês": "french", "Alemão": "german", "Mandarim": "mandarin",
  "Japonês": "japanese", "Árabe": "arabic", "Italiano": "italian",
};
const SETORES = {
  "Agronegócio": "agribusiness", "Construção Civil": "construction",
  "Educação": "education", "Energia & Utilities": "energy",
  "Entretenimento & Mídia": "entertainment", "Financeiro & Fintechs": "financial",
  "Governo & Setor Público": "government", "Indústria & Manufatura": "industry",
  "Logística & Transporte": "logistics", "Saúde & Healthtechs": "health",
  "Tecnologia & SaaS": "technology", "Telecomunicações": "telecom",
  "Turismo & Hospitalidade": "tourism", "Varejo & Consumo": "retail",
  // "Outro" deixa de existir como interesse — vira descarte.
  "Outro": null,
};
const ESPECIALIDADES = {
  "Tecnologia & Software": "tech", "Finanças & Investimentos": "finance",
  "Design & Criatividade": "design", "Marketing & Vendas": "marketing",
  "Direito & Compliance": "legal", "Engenharia & Infraestrutura": "engineering",
  "Saúde & Bem-estar": "health", "Educação & Pesquisa": "education",
  "Sustentabilidade & ESG": "sustainability", "Varejo & E-commerce": "retail",
  "Gastronomia & Hospitalidade": "gastronomy", "Startups & Inovação": "startups",
};

const CAMPOS_COMPLETUDE = ["displayName", "city", "primarySpecialty", "sector",
  "seekingTypes", "incomeRange", "workStyle", "bio", "experienceYears", "values"];

function converterLista(valor, mapa) {
  if (!Array.isArray(valor)) return { novo: valor, mudou: false };
  let mudou = false;
  const novo = [];
  for (const item of valor) {
    if (typeof item === "string" && item in mapa) {
      mudou = true;
      if (mapa[item] !== null) novo.push(mapa[item]);
    } else {
      novo.push(item);
    }
  }
  return { novo: [...new Set(novo)], mudou };
}

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL não definida."); process.exit(1); }
const semSslMode = url.replace(/[?&]ssl-mode=[^&]*/i, "");
const urlFinal = url.includes("ssl-mode=")
  ? semSslMode + (semSslMode.includes("?") ? "&" : "?") + 'ssl={"rejectUnauthorized":false}'
  : url;

const conn = await mysql.createConnection(urlFinal);
const [perfis] = await conn.query(
  "SELECT userId, displayName, city, bio, experienceYears, incomeRange, workStyle, sector, primarySpecialty, secondarySpecialties, seekingTypes, businessInterests, languages, `values` FROM user_profiles"
);

for (const p of perfis) {
  const sets = [];
  const params = [];

  const conv = [
    ["seekingTypes", converterLista(p.seekingTypes, SEEKING)],
    ["businessInterests", converterLista(p.businessInterests, SETORES)],
    ["languages", converterLista(p.languages, IDIOMAS)],
    ["`values`", converterLista(p.values, VALORES)],
    ["secondarySpecialties", converterLista(p.secondarySpecialties, ESPECIALIDADES)],
  ];
  const aposConversao = { ...p };
  for (const [col, r] of conv) {
    if (r.mudou) {
      sets.push(`${col} = ?`);
      params.push(JSON.stringify(r.novo));
      aposConversao[col.replaceAll("`", "")] = r.novo;
    }
  }
  if (typeof p.primarySpecialty === "string" && ESPECIALIDADES[p.primarySpecialty]) {
    sets.push("primarySpecialty = ?");
    params.push(ESPECIALIDADES[p.primarySpecialty]);
    aposConversao.primarySpecialty = ESPECIALIDADES[p.primarySpecialty];
  }

  const preenchidos = CAMPOS_COMPLETUDE.filter(c => {
    const v = aposConversao[c];
    return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  }).length;
  sets.push("profileCompleteness = ?");
  params.push(Math.round((preenchidos / CAMPOS_COMPLETUDE.length) * 100));

  await conn.query(`UPDATE user_profiles SET ${sets.join(", ")} WHERE userId = ?`, [...params, p.userId]);
  console.log(`userId ${p.userId}: ${sets.join(" | ")}`);
}

await conn.end();
console.log(`\n${perfis.length} perfil(is) processado(s).`);
