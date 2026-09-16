import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O CARTÃO DE CONEXÃO CABE NO CELULAR.
 *
 * Na aba Conexões do Dashboard, o cartão era uma linha só: avatar, texto e, à
 * direita, o selo de status (ou os botões de aceitar e recusar). O selo vem do
 * `Badge`, que é `whitespace-nowrap`, e "Aguardando resposta do outro membro" é
 * longo. No celular do Severo (16/09, dia do lançamento) a coluna do texto
 * encolheu até caber uma palavra por linha ("Membro / da / rede") e o selo ficou
 * por cima dela.
 *
 * O conserto deixa o cartão quebrar linha (`flex-wrap`) e dá ao texto um mínimo
 * (`min-w-[10rem]`): quando o selo não cabe ao lado, ele desce para a linha de
 * baixo, alinhado à direita (`ml-auto`). O teste é por classe, porque layout não
 * se mede no jsdom e é a classe que some quando alguém reescreve o cartão.
 */
const dashboard = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
const inicio = dashboard.indexOf("GRUPOS_DE_CONEXAO.map(");
const cartao = dashboard.slice(inicio, dashboard.indexOf("dashboard.declined", inicio));

describe("cartão de conexão no celular", () => {
  it("o trecho do cartão foi encontrado", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(cartao).toContain("dashboard.awaitingOtherReply");
  });

  it("o cartão quebra linha em vez de espremer o texto", () => {
    expect(cartao).toMatch(/rounded-2xl p-5 flex flex-wrap items-center gap-4/);
  });

  it("a coluna do texto tem largura mínima, e não min-w-0", () => {
    expect(cartao).toMatch(/className="flex-1 min-w-\[10rem\]"/);
    expect(cartao).not.toMatch(/className="flex-1 min-w-0"/);
  });

  it("o selo ou os botões descem alinhados à direita", () => {
    expect(cartao).toMatch(/flex items-center gap-2 flex-shrink-0 ml-auto/);
  });
});
