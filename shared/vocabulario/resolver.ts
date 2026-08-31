import { ITENS_VOCABULARIO, type ChaveVocabulario } from "./itens";

/**
 * Espelha `slugifyMatchTag` (server/match-service.ts) — os slugs já gravados em
 * contact_assets/contact_needs foram produzidos por ela, e um termo normalizado
 * de outro jeito simplesmente não é encontrado. `shared` não pode importar de
 * `server`, então a regra é repetida aqui; mudar uma exige mudar a outra.
 */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

export type ColisaoDeTermo = { termo: string; chaveMantida: ChaveVocabulario; chaveIgnorada: ChaveVocabulario };

const indice = new Map<string, ChaveVocabulario>();
const colisoes: ColisaoDeTermo[] = [];

// Quem chega primeiro fica: a ordem de ITENS_VOCABULARIO (e a dos registros
// posteriores) decide, então o índice não depende da ordem de iteração de nada.
// O conflito descartado é guardado em vez de sobrescrever em silêncio.
function registrar(termo: string, chave: ChaveVocabulario) {
  const normalizado = normalizar(termo);
  if (!normalizado) return;
  const existente = indice.get(normalizado);
  if (existente !== undefined) {
    if (existente !== chave) colisoes.push({ termo: normalizado, chaveMantida: existente, chaveIgnorada: chave });
    return;
  }
  indice.set(normalizado, chave);
}

for (const item of ITENS_VOCABULARIO) {
  registrar(item.chave, item.chave);
  for (const sinonimo of item.sinonimos) registrar(sinonimo, item.chave);
}

/**
 * Termos que vêm de fora da lista — os rótulos traduzidos, por exemplo. A
 * montagem chama isto no arranque; termo já reivindicado por outra chave não é
 * sobrescrito, aparece em `colisoesDeTermos`.
 */
export function registrarTermos(pares: Iterable<readonly [termo: string, chave: ChaveVocabulario]>): void {
  for (const [termo, chave] of pares) registrar(termo, chave);
}

/**
 * Única porta de entrada para traduzir texto livre em chave do vocabulário.
 * Hoje é uma consulta a um Map montado no import; trocar por uma tabela no banco
 * não muda nenhum chamador.
 */
export function resolverTermo(texto: string): ChaveVocabulario | undefined {
  return indice.get(normalizar(texto));
}

/** Conflitos acumulados no índice. Vazio é o estado esperado — serve de teste. */
export function colisoesDeTermos(): readonly ColisaoDeTermo[] {
  return colisoes;
}
