/**
 * Do agregado por país (stats.presencaPorPais) para as praças e rotas que o
 * globo da home desenha. Aqui só entra dado AGREGADO — sigla ISO e contagem;
 * nunca nome, cidade ou qualquer coisa de uma pessoa.
 *
 * O protótipo do planeta (PR #52) nasceu com praças inventadas (Lagos, Dubai,
 * Frankfurt, Joanesburgo); a revisão de 06/09 trocou tudo por presença real.
 * Em 07/09 o Nicolas decidiu, com essa troca já no ar, reabrir uma exceção
 * CONTROLADA: a VITRINE DA EUROPA — um conjunto fixo de países europeus
 * sempre aceso, ligado só ao Distrito Federal, mostrando para onde a rede
 * quer ir. O resto continua real: a malha entre praças é exclusiva de quem
 * tem usuárias de verdade, e um país da vitrine que ganhar cadastro vira
 * presença real sozinho (a sigla é a mesma).
 */

export type Praca = { nome: string; lat: number; lon: number };
export type Ligacao = [number, number];
export type PresencaPorPais = { pais: string; total: number };

/**
 * Um ponto representativo por país — o centroide aproximado, não uma cidade:
 * o dado é nacional e cravar uma capital sugeriria precisão que não existe.
 * As siglas são as do select do Onboarding (mais ZA e NG, que já constaram em
 * cadastros antigos); sigla fora desta tabela fica de fora do globo em vez de
 * cair no oceano.
 */
const PONTO_POR_PAIS: Record<string, Praca> = {
  // O Brasil é a exceção à regra do centroide: o ponto é o Distrito Federal,
  // sede da rede, de onde parte a conexão principal (pedido do Nicolas, 06/09).
  BR: { nome: "Brasil (Distrito Federal)", lat: -15.79, lon: -47.88 },
  PT: { nome: "Portugal", lat: 39.4, lon: -8.2 },
  US: { nome: "Estados Unidos", lat: 39.8, lon: -98.6 },
  AR: { nome: "Argentina", lat: -34.6, lon: -64.7 },
  CL: { nome: "Chile", lat: -31.8, lon: -71.2 },
  MX: { nome: "México", lat: 23.6, lon: -102.5 },
  CO: { nome: "Colômbia", lat: 4.6, lon: -74.1 },
  DE: { nome: "Alemanha", lat: 51.2, lon: 10.4 },
  FR: { nome: "França", lat: 46.6, lon: 2.5 },
  GB: { nome: "Reino Unido", lat: 54.0, lon: -2.5 },
  ES: { nome: "Espanha", lat: 40.2, lon: -3.7 },
  IT: { nome: "Itália", lat: 42.6, lon: 12.6 },
  JP: { nome: "Japão", lat: 36.2, lon: 138.3 },
  CN: { nome: "China", lat: 35.0, lon: 103.0 },
  IN: { nome: "Índia", lat: 21.0, lon: 78.0 },
  AE: { nome: "Emirados Árabes Unidos", lat: 24.0, lon: 54.0 },
  ZA: { nome: "África do Sul", lat: -29.0, lon: 24.0 },
  NG: { nome: "Nigéria", lat: 9.1, lon: 8.7 },
};

/** Mais que isso vira poluição: pontos e arcos brigando com o texto do hero. */
export const MAXIMO_DE_PRACAS = 12;
export const MAXIMO_DE_ROTAS = 30;

/**
 * A vitrine: países da Europa sempre acesos no globo, ligados SÓ ao Distrito
 * Federal (pedido do Nicolas, 07/09: "mais conexões em vários países da
 * Europa, sempre saindo do Distrito Federal"). Presença real tem prioridade
 * na ordem e no teto de praças; a vitrine preenche o que sobrar.
 */
const VITRINE_DA_EUROPA = ["PT", "ES", "FR", "DE", "GB", "IT"];

/**
 * O hub fica no índice 0 e as rotas que o tocam são as PRINCIPAIS — é o
 * contrato com o GloboDoMundo, que as desenha mais fortes. O hub é SEMPRE o
 * Brasil (Distrito Federal, sede da rede): é de lá que a vitrine irradia,
 * com ou sem cadastro brasileiro no dia.
 *
 * Rotas: primeiro o hub liga em cada praça (as principais, com a vitrine
 * incluída), depois SÓ as praças com presença real se ligam entre si em
 * malha — a vitrine não tece malha, senão o globo mentiria conexões entre
 * países onde a rede ainda nem chegou. Índices das rotas sempre apontam
 * para praças existentes, por construção.
 */
export function montarPracasDoGlobo(presenca: PresencaPorPais[] | undefined): {
  pracas: Praca[];
  ligacoes: Ligacao[];
} {
  const reais = (presenca ?? [])
    .filter(p => p.total > 0 && PONTO_POR_PAIS[p.pais])
    .sort((a, b) => b.total - a.total || a.pais.localeCompare(b.pais));
  const comPresenca = new Set(reais.map(p => p.pais));

  const siglas = ["BR", ...reais.map(p => p.pais).filter(s => s !== "BR")];
  for (const sigla of VITRINE_DA_EUROPA) {
    if (!siglas.includes(sigla)) siglas.push(sigla);
  }
  const escolhidas = siglas.slice(0, MAXIMO_DE_PRACAS);

  const pracas = escolhidas.map(s => PONTO_POR_PAIS[s]);
  const ligacoes: Ligacao[] = [];
  for (let i = 1; i < pracas.length && ligacoes.length < MAXIMO_DE_ROTAS; i++) {
    ligacoes.push([0, i]);
  }
  for (let i = 1; i < pracas.length && ligacoes.length < MAXIMO_DE_ROTAS; i++) {
    if (!comPresenca.has(escolhidas[i])) continue;
    for (let j = i + 1; j < pracas.length && ligacoes.length < MAXIMO_DE_ROTAS; j++) {
      if (comPresenca.has(escolhidas[j])) ligacoes.push([i, j]);
    }
  }
  return { pracas, ligacoes };
}
