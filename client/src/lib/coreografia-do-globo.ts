/**
 * A viagem do globo da home (Rede viva, "opção B", escolhida em 16/09/2026):
 * o BRASIL é o protagonista. Tudo aqui é função pura do progresso da rolagem
 * da página (0 no topo, 1 no fim) — nada anima sozinho.
 *
 *   0%         o planeta inteiro, a sede acesa no Distrito Federal;
 *   0 → 30%    a câmera fecha sobre o Brasil desde o primeiro pixel de
 *              rolagem, e as linhas chegam aos vizinhos da América do Sul (e o
 *              tronco à América do Norte, que já está no quadro);
 *   30 → 40%   a câmera segura sobre o Brasil;
 *   40 → 97%   a câmera recua enquanto o planeta gira ~172° para o leste: os
 *              troncos saem do Brasil e cada um termina de chegar quando o giro
 *              traz o seu continente para a frente — e aí os ramos daquele
 *              continente crescem. Termina com a Ásia e a Oceania de frente.
 *
 * Subindo a página, tudo se refaz ao contrário.
 */

import type { Ligacao, Praca } from "./pracas-do-globo";

export const COREOGRAFIA = {
  /** Longitude no centro do quadro na partida: o Brasil de frente. */
  LON_BRASIL: -52,
  /** O meio do Brasil, que a câmera enquadra no pico. */
  FOCO: { lat: -12, lon: -52 },
  /**
   * A aproximação começa JÁ no primeiro pixel. Com 0,04 (o valor do protótipo,
   * que era uma seção curta), a página inteira ficava ~280 px parada no
   * computador e ~460 px no celular antes de o globo reagir — parecia travado.
   */
  ENTRA: 0,
  PICO: 0.3,
  SEGURA: 0.4,
  SAI: 0.95,
  FIM_DO_GIRO: 0.97,
  /** Graus de giro para o leste: até a Ásia com a Oceania de frente. */
  GIRO: 172,
  /** Quanto a câmera fecha além do tamanho de repouso (2,8× no pico). */
  FECHO: 1.8,
} as const;

/** Inclinação do eixo na tela e altura da câmera acima do equador, em graus. */
export const INCLINACAO_GRAUS = -16;
export const LATITUDE_DA_CAMERA_GRAUS = 8;

export const suave = (t: number) => t * t * (3 - 2 * t);
/**
 * Sai andando e chega devagar: começa com a mesma velocidade da rolagem
 * (derivada 1) e para suave no fim (derivada 0). É a curva da aproximação — com
 * `suave`, que também começa parada, os primeiros pixels não mexiam o globo.
 */
export const saiAndando = (t: number) => t + t * t - t * t * t;
export const trecho = (p: number, de: number, ate: number) =>
  Math.min(1, Math.max(0, (p - de) / (ate - de)));

/** O inverso de `suave`, por bisseção (a cúbica não tem inversa simples). */
export function inversoSuave(u: number): number {
  let a = 0;
  let b = 1;
  for (let k = 0; k < 24; k++) {
    const m = (a + b) / 2;
    if (suave(m) < u) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * Em que ponto da rolagem o giro traz uma longitude para a frente da câmera.
 * Teto de 0,9 para o que fica além do fim do giro (a Oceania ainda termina de
 * acender antes do fim da página).
 */
export function chegadaNoGiro(lon: number): number {
  const { LON_BRASIL, GIRO, SEGURA, FIM_DO_GIRO } = COREOGRAFIA;
  const u = Math.min(1, Math.max(0, (lon - LON_BRASIL) / GIRO));
  return Math.min(0.9, SEGURA + (FIM_DO_GIRO - SEGURA) * inversoSuave(u));
}

export type Enquadramento = {
  /** Escala do planeta em relação ao repouso (1 aberto, 2,8 no pico). */
  abertura: number;
  /** 0 aberto, 1 no pico: quanto o foco (o Brasil) já foi para o centro. */
  fechamento: number;
  /** Longitude no centro do quadro. */
  lonCentro: number;
};

export function enquadramento(p: number): Enquadramento {
  const { ENTRA, PICO, SEGURA, SAI, FIM_DO_GIRO, LON_BRASIL, GIRO, FECHO } = COREOGRAFIA;
  const abertura = 1 + FECHO * (saiAndando(trecho(p, ENTRA, PICO)) - suave(trecho(p, SEGURA, SAI)));
  return {
    abertura,
    fechamento: (abertura - 1) / FECHO,
    lonCentro: LON_BRASIL + GIRO * suave(trecho(p, SEGURA, FIM_DO_GIRO)),
  };
}

/** Janela [inicio, fim] da rolagem em que algo cresce de 0 a 1 (suavizado). */
export type Janela = { inicio: number; fim: number };

export const fracaoNaJanela = (p: number, j: Janela) => suave(trecho(p, j.inicio, j.fim));

export type PapelDaPraca = "sede" | "porta" | "pais";

export type RoteiroDaRede = {
  /** Uma entrada por ligação válida, na ordem recebida. */
  rotas: Array<{ de: number; para: number; nivel: Ligacao[2]; janela: Janela }>;
  /** Uma entrada por praça. A sede não tem janela: fica sempre acesa. */
  pracas: Array<{ papel: PapelDaPraca; janela: Janela | null; brilho: number }>;
};

const RAMOS_DO_BRASIL: Janela = { inicio: 0.1, fim: COREOGRAFIA.PICO };
/** Praça sem rota chegando (não acontece na fiação da Rede viva): acende com a aproximação. */
const SEM_ROTA: Janela = { inicio: 0.08, fim: COREOGRAFIA.PICO - 0.04 };
/** Quanto da rolagem o ponto leva para acender, depois que a linha chega nele. */
const ACENDER = 0.03;
/** O último ramo termina aqui, para o último ponto ainda acender antes do fim da página. */
const FIM_DOS_RAMOS = 1 - ACENDER;

/**
 * Quando cada rota cresce e cada praça acende. É a GEOGRAFIA que manda no
 * tempo: um continente é alcançado quando o giro o traz para a frente. O que
 * fica a oeste do Brasil (a América do Norte) já está no quadro na partida e é
 * alcançado junto com a aproximação.
 *
 * O PONTO VEM DEPOIS DA LINHA: cada praça só acende quando a rota que chega
 * nela termina de crescer (pedido do dono, 16/09). A sede é a exceção — é de
 * lá que as linhas saem, então fica acesa desde o começo. E a cascata segue a
 * mesma ordem: o tronco chega, a porta do continente acende, os ramos saem
 * dela, e os países acendem quando os ramos chegam.
 *
 * A câmera sempre fecha sobre o Brasil. A sede é o Distrito Federal sempre que
 * há presença no Brasil (o caso real da rede); sem Brasil, montarPracasDoGlobo
 * põe outro país como sede e a viagem continua a mesma — aceito de propósito,
 * para a coreografia não depender do dado.
 */
export function roteiroDaRede(pracas: Praca[], ligacoes: Ligacao[]): RoteiroDaRede {
  const { LON_BRASIL, PICO } = COREOGRAFIA;
  const validas = ligacoes.filter(([de, para]) => de !== para && pracas[de] && pracas[para]);
  // O que fica a oeste do Brasil (a América do Norte) já está no quadro na
  // partida: é alcançado cedo, enquanto a câmera ainda não fechou tanto que o
  // tire da tela.
  const aOesteDoBrasil = (i: number) => pracas[i].lon <= LON_BRASIL;
  const chegadaDaPorta = (i: number) => (aOesteDoBrasil(i) ? 0.1 : chegadaNoGiro(pracas[i].lon));

  const papeis: PapelDaPraca[] = pracas.map((_, i) => (i === 0 ? "sede" : "pais"));
  const janelas: Array<Janela | null> = pracas.map((_, i) => (i === 0 ? null : SEM_ROTA));
  const acenderDepoisDe = (para: number, rota: Janela) => {
    janelas[para] = { inicio: rota.fim, fim: rota.fim + ACENDER };
  };

  // Troncos primeiro (a fiação já vem nessa ordem, mas o roteiro não depende
  // disso): os ramos de uma porta só saem depois que ela acende.
  let ordemDoTronco = 0;
  const janelaDaRota = new Map<number, Janela>();
  validas.forEach(([de, para, nivel], k) => {
    if (nivel !== "tronco" || de !== 0) return;
    ordemDoTronco++;
    const chegada = chegadaDaPorta(para);
    const partida = aOesteDoBrasil(para) ? 0.03 : PICO + ordemDoTronco * 0.012;
    papeis[para] = "porta";
    const janela = { inicio: partida, fim: Math.max(partida + 0.08, chegada + 0.02) };
    janelaDaRota.set(k, janela);
    acenderDepoisDe(para, janela);
  });
  validas.forEach(([de, para], k) => {
    if (janelaDaRota.has(k)) return;
    let janela: Janela;
    if (de === 0) {
      janela = RAMOS_DO_BRASIL;
    } else {
      // Ramo de uma porta: sai quando a porta já acendeu e termina antes do
      // fim da página, mesmo no continente que chega por último.
      const porta = janelas[de];
      const inicio = porta ? Math.min(porta.fim, FIM_DOS_RAMOS - 0.02) : chegadaDaPorta(de);
      janela = { inicio, fim: Math.min(FIM_DOS_RAMOS, inicio + 0.1) };
    }
    janelaDaRota.set(k, janela);
    acenderDepoisDe(para, janela);
  });
  const rotas = validas.map(([de, para, nivel], k) => ({ de, para, nivel, janela: janelaDaRota.get(k)! }));

  return {
    rotas,
    pracas: pracas.map((_, i) => ({
      papel: papeis[i],
      janela: janelas[i],
      brilho: papeis[i] === "pais" ? 0.95 : 1,
    })),
  };
}

/** Raio de cada praça em pixels, antes do ajuste pelo zoom. */
export function raioDaPracaEmPx(papel: PapelDaPraca, p: number): number {
  if (papel === "sede") return 4 * (1 + saiAndando(trecho(p, 0, COREOGRAFIA.PICO)) * 0.5);
  return papel === "porta" ? 3.2 : 2.2;
}
