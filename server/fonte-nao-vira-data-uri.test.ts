import { describe, expect, it } from "vitest";

import configuracao from "../vite.config";

/**
 * (Mora em server/ porque o projeto client roda em jsdom, e importar o
 * vite.config.ts lá quebra na carga: o Vite confere invariantes de
 * TextEncoder que o jsdom não satisfaz. A regra testada não depende de DOM.)
 *
 * FONTE NUNCA PODE VIRAR `data:` URI.
 *
 * O CSP do servidor (server/_core/csp.ts) aceita fonte só de 'self' e de
 * fonts.gstatic.com. O Vite, por padrão, embute qualquer arquivo abaixo de
 * 4 kB no CSS — e uma das fontes do KaTeX, que o `streamdown` arrasta para
 * dentro do pacote ao renderizar o texto do termo, é pequena o bastante.
 * Resultado: a fonte embutida chegava ao navegador e era barrada, com erro de
 * CSP no console de TODA visita ao site em produção.
 *
 * A regra vive no `vite.config.ts`, que ninguém abre com frequência, e uma
 * dependência nova pode trazer outra fonte pequena a qualquer momento. Este
 * teste prende a regra; sem ele o erro volta em silêncio.
 */

type LimiteDeEmbutir = (caminho: string, conteudo: Buffer) => boolean | undefined;

const limite = (configuracao as { build?: { assetsInlineLimit?: unknown } }).build?.assetsInlineLimit as
  | LimiteDeEmbutir
  | undefined;

const conteudo = Buffer.alloc(64);

describe("o empacotamento não embute fonte em data: URI", () => {
  it("a regra existe e é uma função", () => {
    expect(typeof limite).toBe("function");
  });

  it("recusa embutir qualquer formato de fonte, por menor que seja", () => {
    for (const arquivo of [
      "assets/KaTeX_SansSerif-Regular.woff2",
      "assets/fonte.woff",
      "assets/fonte.ttf",
      "assets/fonte.otf",
      "assets/fonte.eot",
      "assets/FONTE.WOFF2",
    ]) {
      expect(limite!(arquivo, conteudo)).toBe(false);
    }
  });

  it("não interfere no resto: imagem e o que mais houver seguem com o padrão do Vite", () => {
    for (const arquivo of ["assets/logo.svg", "assets/foto.png", "assets/dados.json"]) {
      expect(limite!(arquivo, conteudo)).toBeUndefined();
    }
  });
});
