/**
 * Do agregado por país (stats.presencaPorPais) para as praças e rotas que o
 * globo da home desenha. Aqui só entra dado AGREGADO — sigla ISO e contagem;
 * nunca nome, cidade ou qualquer coisa de uma pessoa.
 *
 * O protótipo do planeta (PR #52) nasceu com praças inventadas (Lagos, Dubai,
 * Frankfurt, Joanesburgo) para a cena não estrear vazia. A decisão da revisão
 * de 06/09 é desenhar só onde a rede EXISTE: sem usuárias num país, sem ponto
 * nele — e sem nenhuma usuária com país, o planeta fica limpo, inteiro do
 * mesmo jeito (continentes, atmosfera, movimento).
 */

export type Praca = { nome: string; lat: number; lon: number };
export type PresencaPorPais = { pais: string; total: number };

/**
 * Os dois níveis da Rede viva.
 *
 * `tronco` sai da sede e alcança UM país por continente — a porta de entrada
 * daquele continente, que é o país com mais presença ali. `ramo` fica dentro
 * do continente: da porta para os vizinhos. É o que faz a leitura ser "a rede
 * sai do Brasil, alcança o continente e de lá se espalha pelos países", em vez
 * de dezenas de linhas saindo juntas de Brasília.
 */
export type NivelDaRota = "tronco" | "ramo";
export type Ligacao = [de: number, para: number, nivel: NivelDaRota];

export type Continente =
  | "América do Sul"
  | "América do Norte"
  | "Europa"
  // A África tem duas portas: com uma só, o trecho em que o giro passa pelo
  // Saara ficava sem tronco chegando (era assim no protótipo aprovado).
  | "Norte da África"
  | "África Subsaariana"
  | "Ásia"
  | "Oceania";

type PontoConhecido = Praca & { continente: Continente };

/**
 * Um ponto representativo por país — o centroide aproximado, não uma cidade:
 * o dado é nacional e cravar uma capital sugeriria precisão que não existe.
 * Sigla fora desta tabela fica de fora do globo em vez de cair no oceano.
 *
 * A tabela cobre os países do select do Onboarding e os da Rede viva (os que
 * a rede alcança de verdade ou deve alcançar: América do Sul e do Norte,
 * Europa, África do norte ao sul, Oriente Médio, Ásia e Oceania). Ter a sigla
 * aqui não desenha nada sozinho: o ponto só aparece com presença real.
 */
const PONTO_POR_PAIS: Record<string, PontoConhecido> = {
  // O Brasil é a exceção à regra do centroide: o ponto é o Distrito Federal,
  // sede da rede, de onde parte toda a rede (pedido do Nicolas, 06/09).
  BR: { nome: "Brasil (Distrito Federal)", lat: -15.79, lon: -47.88, continente: "América do Sul" },
  AR: { nome: "Argentina", lat: -34.6, lon: -64.7, continente: "América do Sul" },
  CL: { nome: "Chile", lat: -31.8, lon: -71.2, continente: "América do Sul" },
  CO: { nome: "Colômbia", lat: 4.6, lon: -74.1, continente: "América do Sul" },
  PE: { nome: "Peru", lat: -9.2, lon: -75.0, continente: "América do Sul" },
  BO: { nome: "Bolívia", lat: -16.3, lon: -63.6, continente: "América do Sul" },
  PY: { nome: "Paraguai", lat: -25.3, lon: -57.6, continente: "América do Sul" },

  US: { nome: "Estados Unidos", lat: 39.8, lon: -98.6, continente: "América do Norte" },
  MX: { nome: "México", lat: 23.6, lon: -102.5, continente: "América do Norte" },
  CA: { nome: "Canadá", lat: 56.0, lon: -106.0, continente: "América do Norte" },
  CR: { nome: "Costa Rica", lat: 9.7, lon: -84.0, continente: "América do Norte" },
  PA: { nome: "Panamá", lat: 8.5, lon: -80.1, continente: "América do Norte" },
  DO: { nome: "República Dominicana", lat: 18.7, lon: -70.2, continente: "América do Norte" },

  PT: { nome: "Portugal", lat: 39.4, lon: -8.2, continente: "Europa" },
  FR: { nome: "França", lat: 46.6, lon: 2.5, continente: "Europa" },
  DE: { nome: "Alemanha", lat: 51.2, lon: 10.4, continente: "Europa" },
  IT: { nome: "Itália", lat: 42.6, lon: 12.6, continente: "Europa" },
  GB: { nome: "Reino Unido", lat: 54.0, lon: -2.5, continente: "Europa" },
  ES: { nome: "Espanha", lat: 40.2, lon: -3.7, continente: "Europa" },
  BE: { nome: "Bélgica", lat: 50.5, lon: 4.5, continente: "Europa" },
  FI: { nome: "Finlândia", lat: 61.9, lon: 25.7, continente: "Europa" },

  NG: { nome: "Nigéria", lat: 9.1, lon: 8.7, continente: "África Subsaariana" },
  ZA: { nome: "África do Sul", lat: -29.0, lon: 24.0, continente: "África Subsaariana" },
  MZ: { nome: "Moçambique", lat: -18.6, lon: 35.5, continente: "África Subsaariana" },
  TZ: { nome: "Tanzânia", lat: -6.4, lon: 34.9, continente: "África Subsaariana" },
  CD: { nome: "RD Congo", lat: -2.9, lon: 23.6, continente: "África Subsaariana" },
  AO: { nome: "Angola", lat: -11.2, lon: 17.9, continente: "África Subsaariana" },
  GH: { nome: "Gana", lat: 7.9, lon: -1.0, continente: "África Subsaariana" },
  EG: { nome: "Egito", lat: 26.8, lon: 30.8, continente: "Norte da África" },
  MA: { nome: "Marrocos", lat: 31.8, lon: -7.1, continente: "Norte da África" },
  TN: { nome: "Tunísia", lat: 34.0, lon: 9.5, continente: "Norte da África" },
  SN: { nome: "Senegal", lat: 14.5, lon: -14.4, continente: "África Subsaariana" },
  SD: { nome: "Sudão", lat: 15.6, lon: 32.5, continente: "Norte da África" },
  ET: { nome: "Etiópia", lat: 9.1, lon: 40.5, continente: "África Subsaariana" },
  KE: { nome: "Quênia", lat: 0.2, lon: 37.9, continente: "África Subsaariana" },
  LY: { nome: "Líbia", lat: 32.9, lon: 13.2, continente: "Norte da África" },

  AE: { nome: "Emirados Árabes Unidos", lat: 24.0, lon: 54.0, continente: "Ásia" },
  SA: { nome: "Arábia Saudita", lat: 24.7, lon: 46.7, continente: "Ásia" },
  TR: { nome: "Turquia", lat: 39.0, lon: 35.2, continente: "Ásia" },
  IN: { nome: "Índia", lat: 21.0, lon: 78.0, continente: "Ásia" },
  CN: { nome: "China", lat: 35.0, lon: 103.0, continente: "Ásia" },
  JP: { nome: "Japão", lat: 36.2, lon: 138.3, continente: "Ásia" },
  SG: { nome: "Singapura", lat: 1.35, lon: 103.8, continente: "Ásia" },
  BD: { nome: "Bangladesh", lat: 23.7, lon: 90.4, continente: "Ásia" },
  UZ: { nome: "Uzbequistão", lat: 41.3, lon: 69.2, continente: "Ásia" },

  AU: { nome: "Austrália", lat: -25.0, lon: 134.0, continente: "Oceania" },
  NZ: { nome: "Nova Zelândia", lat: -41.0, lon: 174.0, continente: "Oceania" },
};

/**
 * Teto de praças. A Rede viva é uma árvore (uma rota chegando em cada praça),
 * então o globo aguenta bem mais pontos que a malha antiga sem virar novelo;
 * o teto só evita que um cadastro espalhado pelo mundo encha o fundo da home.
 */
export const MAXIMO_DE_PRACAS = 40;

/**
 * O hub fica no índice 0 — é o contrato com o GloboDoMundo. Hub é o Brasil
 * (Distrito Federal, sede da rede) sempre que houver presença aqui; sem
 * Brasil, o país com mais usuárias assume.
 *
 * A FIAÇÃO É A DA REDE VIVA, em dois níveis:
 *
 *   1. TRONCO: da sede até a porta de entrada de cada continente — o país com
 *      mais presença naquele continente. Um tronco por continente, nunca mais.
 *   2. RAMO: de dentro do continente, da porta para cada vizinho.
 *
 * O continente da própria sede não ganha tronco: a sede já é a porta dele, e
 * os vizinhos saem dela como ramos.
 *
 * O desenho anterior era outro: o hub ligava em TODAS as praças e, por cima,
 * todas se ligavam entre si numa malha. Ficava um novelo saindo de Brasília.
 * Aqui cada praça tem exatamente uma rota que chega — e é a chegada dela que
 * acende a praça no globo.
 *
 * Um país só rende um ponto sem rota; nenhum país rende cena vazia. Índices
 * das rotas sempre apontam para praças existentes, por construção.
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
  const posicaoDoBrasil = conhecidas.findIndex(p => p.pais === "BR");
  if (posicaoDoBrasil > 0) conhecidas.unshift(...conhecidas.splice(posicaoDoBrasil, 1));

  const pontos = conhecidas.map(p => PONTO_POR_PAIS[p.pais]);

  // Índices agrupados por continente, já na ordem de presença: o primeiro de
  // cada grupo é a porta de entrada. Map preserva a ordem de inserção, então a
  // cena não troca de lugar entre duas visitas com o mesmo dado.
  const porContinente = new Map<Continente, number[]>();
  pontos.forEach((ponto, i) => {
    const grupo = porContinente.get(ponto.continente);
    if (grupo) grupo.push(i);
    else porContinente.set(ponto.continente, [i]);
  });
  // Array.from e não `porContinente.values()` direto: o alvo do tsconfig não
  // deixa iterar um MapIterator.
  const grupos = Array.from(porContinente.values());

  const ligacoes: Ligacao[] = [];
  // Troncos primeiro, para o globo desenhá-los antes dos ramos.
  for (const indices of grupos) {
    if (indices[0] !== 0) ligacoes.push([0, indices[0], "tronco"]);
  }
  for (const indices of grupos) {
    const porta = indices[0];
    for (const destino of indices) {
      if (destino !== porta) ligacoes.push([porta, destino, "ramo"]);
    }
  }

  // Só o que o globo usa: o continente é detalhe da fiação.
  const pracas = pontos.map(({ nome, lat, lon }) => ({ nome, lat, lon }));
  return { pracas, ligacoes };
}
