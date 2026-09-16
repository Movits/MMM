import { describe, expect, it } from "vitest";
import {
  COREOGRAFIA,
  saiAndando,
  chegadaNoGiro,
  enquadramento,
  fracaoNaJanela,
  inversoSuave,
  raioDaPracaEmPx,
  roteiroDaRede,
  suave,
} from "./coreografia-do-globo";
import { montarPracasDoGlobo } from "./pracas-do-globo";

describe("enquadramento — a câmera da viagem", () => {
  it("abre com o planeta inteiro e o Brasil de frente", () => {
    expect(enquadramento(0)).toEqual({ abertura: 1, fechamento: 0, lonCentro: COREOGRAFIA.LON_BRASIL });
  });

  it("no pico a câmera está 2,8× mais perto, com o Brasil parado no centro", () => {
    for (const p of [COREOGRAFIA.PICO, 0.35, COREOGRAFIA.SEGURA]) {
      const e = enquadramento(p);
      expect(e.abertura).toBeCloseTo(1 + COREOGRAFIA.FECHO, 10);
      expect(e.fechamento).toBeCloseTo(1, 10);
      expect(e.lonCentro).toBe(COREOGRAFIA.LON_BRASIL);
    }
  });

  it("reage desde o primeiro pixel: sem trecho parado no começo da página", () => {
    // Página de ~7000 px no computador e ~11600 px no celular: 60 px de rolagem
    // já precisam mexer o globo de forma visível.
    for (const alcance of [7000, 11600]) {
      const e = enquadramento(60 / alcance);
      expect(e.abertura).toBeGreaterThan(1.009);
      expect(e.fechamento).toBeGreaterThan(0.005);
    }
    // E segue crescendo em passos parecidos no começo, sem arrancada nem freio.
    const passo1 = enquadramento(0.01).abertura - enquadramento(0).abertura;
    const passo2 = enquadramento(0.02).abertura - enquadramento(0.01).abertura;
    expect(passo2 / passo1).toBeGreaterThan(0.9);
  });

  it("o giro só começa depois do pico: durante a aproximação o Brasil não sai do lugar", () => {
    for (let p = 0; p <= COREOGRAFIA.SEGURA; p += 0.01) {
      expect(enquadramento(p).lonCentro).toBe(COREOGRAFIA.LON_BRASIL);
    }
  });

  it("termina aberto, com ~172° de giro para o leste (Ásia e Oceania de frente)", () => {
    const fim = enquadramento(1);
    expect(fim.abertura).toBe(1);
    expect(fim.fechamento).toBe(0);
    expect(fim.lonCentro).toBe(COREOGRAFIA.LON_BRASIL + COREOGRAFIA.GIRO);
  });

  it("é monótona onde deve ser: o zoom só cresce até o pico e o giro só avança", () => {
    let anterior = enquadramento(0);
    for (let p = 0.005; p <= 1; p += 0.005) {
      const atual = enquadramento(p);
      if (p <= COREOGRAFIA.PICO) expect(atual.abertura).toBeGreaterThanOrEqual(anterior.abertura);
      if (p >= COREOGRAFIA.SEGURA) expect(atual.abertura).toBeLessThanOrEqual(anterior.abertura + 1e-12);
      expect(atual.lonCentro).toBeGreaterThanOrEqual(anterior.lonCentro);
      anterior = atual;
    }
  });
});

describe("chegadaNoGiro — quando cada longitude chega à frente da câmera", () => {
  it("saiAndando: começa com a velocidade da rolagem e para suave no fim, sem voltar", () => {
    expect(saiAndando(0)).toBe(0);
    expect(saiAndando(1)).toBe(1);
    expect((saiAndando(1e-6) - saiAndando(0)) / 1e-6).toBeCloseTo(1, 4);
    expect((saiAndando(1) - saiAndando(1 - 1e-6)) / 1e-6).toBeCloseTo(0, 4);
    for (let t = 0; t < 1; t += 0.01) expect(saiAndando(t + 0.01)).toBeGreaterThanOrEqual(saiAndando(t));
  });

  it("inversoSuave desfaz suave", () => {
    for (const u of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(suave(inversoSuave(u))).toBeCloseTo(u, 5);
  });

  it("o Brasil e o que fica a oeste chegam no começo do giro; a Ásia bem depois; ninguém passa de 0,9", () => {
    expect(chegadaNoGiro(COREOGRAFIA.LON_BRASIL)).toBeCloseTo(COREOGRAFIA.SEGURA, 5);
    expect(chegadaNoGiro(2.5)).toBeGreaterThan(0.55); // França
    expect(chegadaNoGiro(103)).toBeGreaterThan(chegadaNoGiro(54)); // China depois dos Emirados
    expect(chegadaNoGiro(174)).toBe(0.9); // Nova Zelândia, além do fim do giro
  });
});

describe("roteiroDaRede — quando cada rota cresce e cada praça acende", () => {
  const presenca = [
    { pais: "BR", total: 50 },
    { pais: "AR", total: 9 },
    { pais: "US", total: 8 },
    { pais: "MX", total: 5 },
    { pais: "FR", total: 7 },
    { pais: "PT", total: 4 },
    { pais: "AE", total: 6 },
    { pais: "JP", total: 3 },
    { pais: "AU", total: 2 },
    { pais: "NZ", total: 1 },
  ];
  const { pracas, ligacoes } = montarPracasDoGlobo(presenca);
  const roteiro = roteiroDaRede(pracas, ligacoes);
  const indice = (nome: string) => pracas.findIndex(p => p.nome === nome);
  const praca = (nome: string) => roteiro.pracas[indice(nome)];

  it("a sede fica sempre acesa; portas e países ganham o papel certo", () => {
    expect(roteiro.pracas[0]).toEqual({ papel: "sede", janela: null, brilho: 1 });
    expect(praca("Estados Unidos").papel).toBe("porta");
    expect(praca("França").papel).toBe("porta");
    expect(praca("Portugal").papel).toBe("pais");
    expect(praca("Argentina").papel).toBe("pais");
  });

  it("todo ponto acende só depois que a linha que chega nele termina de crescer", () => {
    for (const rota of roteiro.rotas) {
      const destino = roteiro.pracas[rota.para].janela!;
      expect(destino.inicio).toBeGreaterThanOrEqual(rota.janela.fim);
      // No meio do crescimento da linha, o ponto ainda está apagado.
      const meio = (rota.janela.inicio + rota.janela.fim) / 2;
      expect(fracaoNaJanela(meio, rota.janela)).toBeGreaterThan(0);
      expect(fracaoNaJanela(meio, destino)).toBe(0);
    }
  });

  it("cascata: os ramos de um continente só saem depois que a porta dele acende", () => {
    for (const rota of roteiro.rotas) {
      if (rota.de === 0) continue;
      const porta = roteiro.pracas[rota.de].janela!;
      expect(rota.janela.inicio).toBeGreaterThanOrEqual(porta.fim - 1e-12);
    }
  });

  it("a América do Sul: os ramos crescem na aproximação e os pontos acendem no pico, com o Brasil no centro", () => {
    const ramo = roteiro.rotas.find(r => r.para === indice("Argentina"))!;
    expect(ramo.nivel).toBe("ramo");
    expect(ramo.janela.fim).toBe(COREOGRAFIA.PICO);
    const argentina = praca("Argentina").janela!;
    expect(argentina.inicio).toBe(COREOGRAFIA.PICO);
    expect(argentina.fim).toBeLessThan(COREOGRAFIA.SEGURA);
  });

  it("a América do Norte (a oeste) chega antes do pico; a Europa só quando o giro a traz", () => {
    const eua = roteiro.rotas.find(r => r.para === indice("Estados Unidos"))!;
    expect(eua.janela.fim).toBeLessThanOrEqual(COREOGRAFIA.PICO);
    const franca = roteiro.rotas.find(r => r.para === indice("França"))!;
    expect(franca.janela.inicio).toBeGreaterThanOrEqual(COREOGRAFIA.PICO);
    expect(franca.janela.fim).toBeCloseTo(chegadaNoGiro(2.5) + 0.02, 10);
    // O ponto da porta acende logo depois que o tronco chega.
    expect(praca("França").janela!.inicio).toBe(franca.janela.fim);
  });

  it("os continentes chegam na ordem do giro: Europa, Ásia, Oceania", () => {
    const fimDoTronco = (nome: string) => roteiro.rotas.find(r => r.para === indice(nome))!.janela.fim;
    expect(fimDoTronco("França")).toBeLessThan(fimDoTronco("Emirados Árabes Unidos"));
    expect(fimDoTronco("Emirados Árabes Unidos")).toBeLessThan(fimDoTronco("Austrália"));
  });

  it("no fim da página a rede inteira está desenhada", () => {
    for (const rota of roteiro.rotas) expect(fracaoNaJanela(1, rota.janela)).toBe(1);
    for (const p of roteiro.pracas) if (p.janela) expect(fracaoNaJanela(1, p.janela)).toBe(1);
  });

  it("no começo da página só a sede está acesa", () => {
    for (const rota of roteiro.rotas) expect(fracaoNaJanela(0, rota.janela)).toBe(0);
    for (const p of roteiro.pracas) if (p.janela) expect(fracaoNaJanela(0, p.janela)).toBe(0);
  });

  it("índice inválido não derruba o roteiro: a rota some, o resto segue", () => {
    const r = roteiroDaRede(pracas, [...ligacoes, [0, 99, "tronco"], [2, 2, "ramo"]]);
    expect(r.rotas).toHaveLength(ligacoes.length);
  });

  it("sem praças, roteiro vazio", () => {
    expect(roteiroDaRede([], [])).toEqual({ rotas: [], pracas: [] });
  });
});

describe("raioDaPracaEmPx", () => {
  it("a sede cresce até o pico; porta maior que país", () => {
    expect(raioDaPracaEmPx("sede", 0)).toBe(4);
    expect(raioDaPracaEmPx("sede", 0.3)).toBe(6);
    expect(raioDaPracaEmPx("sede", 1)).toBe(6);
    expect(raioDaPracaEmPx("porta", 0.5)).toBeGreaterThan(raioDaPracaEmPx("pais", 0.5));
  });
});
