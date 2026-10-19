import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("client/index.html", "utf8");

const conteudoDe = (atributo: "property" | "name", chave: string) => {
  const achado = html.match(new RegExp(`<meta ${atributo}="${chave}" content="([^"]*)"`));
  return achado?.[1] ?? null;
};

/**
 * A PRÉVIA DO LINK COMPARTILHADO PRECISA DE URL ABSOLUTA.
 *
 * Crawler de Open Graph — o do WhatsApp, o do LinkedIn, o do Facebook — não
 * resolve caminho relativo: ele lê o HTML fora do contexto da página. Com
 * `content="/brand/og-image.png"`, o link do site aparecia sem imagem nenhuma
 * em toda conversa em que fosse colado, e isso não dá erro em lugar nenhum —
 * some em silêncio.
 *
 * O arquivo em si sempre esteve certo (1200×630, a proporção que esses
 * crawlers esperam). O que faltava era o endereço, e o próprio HTML trazia o
 * lembrete de trocar "quando o domínio de produção existir". Ele existe desde
 * 16/09/2026.
 */
describe("prévia do link compartilhado", () => {
  it("toda URL de imagem da prévia é absoluta", () => {
    for (const [atributo, chave] of [["property", "og:image"], ["name", "twitter:image"]] as const) {
      const valor = conteudoDe(atributo, chave);
      expect(valor, chave).toBeTruthy();
      expect(valor, chave).toMatch(/^https:\/\//);
    }
  });

  it("a página se identifica com a própria URL canônica", () => {
    expect(conteudoDe("property", "og:url")).toBe("https://wrwglobal.org/");
  });

  it("as dimensões declaradas são as do arquivo que está no ar", () => {
    // Conferidas no arquivo servido por wrwglobal.org em 16/09/2026.
    expect(conteudoDe("property", "og:image:width")).toBe("1200");
    expect(conteudoDe("property", "og:image:height")).toBe("630");
  });

  it("título e descrição da prévia não ficaram vazios", () => {
    expect(conteudoDe("property", "og:title")).toBeTruthy();
    expect(conteudoDe("property", "og:description")).toBeTruthy();
    expect(conteudoDe("property", "og:image:alt")).toBeTruthy();
  });
});
