import { describe, expect, it } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

const { selarAlcaDoPedido, abrirAlcaDoPedido } = await import("./alca-do-pedido");

/**
 * A alça do pedido na fila de distribuição (revisão da #115, item 2): o id
 * sequencial da conexão não pode chegar à tela da distribuidora, senão os buracos
 * da sequência entregam o pedido oculto para ela.
 */
describe("alça do pedido", () => {
  it("abre para a conta que a recebeu e devolve o id", () => {
    const alca = selarAlcaDoPedido(18, 9);
    expect(abrirAlcaDoPedido(alca, 9)).toBe(18);
  });

  it("não carrega o id em claro nem tem ordem: duas leituras do mesmo pedido dão alças diferentes", () => {
    const [primeira, segunda] = [selarAlcaDoPedido(18, 9), selarAlcaDoPedido(18, 9)];
    expect(primeira).not.toBe(segunda);
    expect(primeira).not.toContain("18");
    expect(abrirAlcaDoPedido(segunda, 9)).toBe(18);
  });

  it("outra conta não abre a alça de quem leu a fila", () => {
    expect(abrirAlcaDoPedido(selarAlcaDoPedido(18, 9), 8)).toBeNull();
  });

  it("alça adulterada, cortada, inventada ou vazia não abre (e não lança)", () => {
    const alca = selarAlcaDoPedido(18, 9);
    const bruto = Buffer.from(alca, "base64url");
    for (const posicao of [0, 12, 20, bruto.length - 1]) {
      const adulterada = Buffer.from(bruto);
      adulterada[posicao] ^= 1;
      expect(abrirAlcaDoPedido(adulterada.toString("base64url"), 9), `byte ${posicao}`).toBeNull();
    }
    for (const invalida of [alca.slice(0, -2), `${alca}AA`, "18", "", "!!!!", "a".repeat(48)]) {
      expect(abrirAlcaDoPedido(invalida, 9), invalida).toBeNull();
    }
  });

  it("id fora da faixa não vira alça", () => {
    expect(() => selarAlcaDoPedido(-1, 9)).toThrow();
    expect(() => selarAlcaDoPedido(1.5, 9)).toThrow();
    expect(() => selarAlcaDoPedido(18, 2 ** 32)).toThrow();
  });
});
