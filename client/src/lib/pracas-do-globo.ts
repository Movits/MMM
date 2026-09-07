/**
 * Do agregado por país (stats.presencaPorPais) para as praças e rotas que o
 * globo da home desenha. Aqui só entra dado AGREGADO — sigla ISO e contagem;
 * nunca nome, cidade ou qualquer coisa de uma pessoa.
 *
 * O protótipo do planeta (PR #52) nasceu com praças inventadas (Lagos, Dubai,
 * Frankfurt, Joanesburgo) para a cena não estrear vazia. A decisão da revisão
 * de 06/09 é desenhar só onde a rede EXISTE: sem usuárias num país, sem ponto
 * nele — e sem nenhuma usuária com país, o planeta fica limpo, inteiro do
 * mesmo jeito (continentes, atmosfera, rotação).
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
  BR: { nome: "Brasil", lat: -14.2, lon: -51.9 },
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
export const MAXIMO_DE_ROTAS = 8;

/**
 * Praças em ordem de presença (maior primeiro) e rotas em estrela a partir do
 * país com mais usuárias — é dele que a rede "irradia". Um país só rende um
 * ponto sem rota; nenhum país rende cena vazia. Índices das rotas sempre
 * apontam para praças existentes, por construção.
 */
export function montarPracasDoGlobo(presenca: PresencaPorPais[] | undefined): {
  pracas: Praca[];
  ligacoes: Ligacao[];
} {
  if (!presenca?.length) return { pracas: [], ligacoes: [] };

  const conhecidas = presenca
    .filter(p => p.total > 0 && PONTO_POR_PAIS[p.pais])
    .sort((a, b) => b.total - a.total || a.pais.localeCompare(b.pais))
    .slice(0, MAXIMO_DE_PRACAS);

  const pracas = conhecidas.map(p => PONTO_POR_PAIS[p.pais]);
  const ligacoes: Ligacao[] = [];
  for (let i = 1; i < pracas.length && ligacoes.length < MAXIMO_DE_ROTAS; i++) {
    ligacoes.push([0, i]);
  }
  return { pracas, ligacoes };
}
