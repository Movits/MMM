// Confere que os 10 arquivos de idioma têm exatamente o MESMO conjunto de
// chaves. Uma chave presente num idioma e ausente noutro vira texto de
// fallback silencioso em produção; este script transforma isso em erro
// visível antes do merge.
//
// Uso:  node scripts/conferir-locales.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "client/src/i18n/locales";

function chaves(obj, prefixo = "") {
  const saida = [];
  for (const [k, v] of Object.entries(obj)) {
    const caminho = prefixo ? `${prefixo}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) saida.push(...chaves(v, caminho));
    else saida.push(caminho);
  }
  return saida;
}

const arquivos = readdirSync(DIR).filter(f => f.endsWith(".json"));
const conjuntos = new Map();
for (const f of arquivos) {
  const dados = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  conjuntos.set(f, new Set(chaves(dados)));
}

const [referencia] = ["pt-BR.json", arquivos[0]].filter(f => conjuntos.has(f));
const base = conjuntos.get(referencia);
let problemas = 0;

for (const [arquivo, conjunto] of conjuntos) {
  if (arquivo === referencia) continue;
  const faltando = [...base].filter(k => !conjunto.has(k));
  const sobrando = [...conjunto].filter(k => !base.has(k));
  if (faltando.length || sobrando.length) {
    problemas++;
    console.error(`\n${arquivo} difere de ${referencia}:`);
    for (const k of faltando.slice(0, 20)) console.error(`  falta:  ${k}`);
    for (const k of sobrando.slice(0, 20)) console.error(`  sobra:  ${k}`);
  }
}

if (problemas) {
  console.error(`\n${problemas} idioma(s) fora de paridade.`);
  process.exit(1);
}
console.log(`${arquivos.length} idiomas em paridade (${base.size} chaves cada).`);
