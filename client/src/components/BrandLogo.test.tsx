import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { BrandLogo, BrandMark } from "./BrandLogo";

/**
 * Marca WRW (decisão do Roberto em 15/09): o nome é marca e não se traduz. Antes a
 * arte e o alt mudavam com o idioma (lockup PT × EN, "Mulheres que Movem o Mundo" ×
 * "Women Moving the World"); aqui se prova que os 10 idiomas recebem a mesma peça.
 */

const ALT = "WRW — Women Rocking the World";

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("BrandLogo — a mesma marca WRW em todo idioma", () => {
  const ARTES = [
    ["monograma", "/brand/monograma-branco.png"],
    ["wordmark", "/brand/wordmark-branco.png"],
    ["lockup", "/brand/lockup-branco.png"],
    ["destaque", "/brand/lockup-cor.png"],
    ["selo", "/brand/selo.png"],
  ] as const;

  for (const idioma of ["pt-BR", "en", "zh"]) {
    it(`em ${idioma}: cada variante aponta para a arte WRW, com o alt da marca`, async () => {
      await i18n.changeLanguage(idioma);
      for (const [variante, src] of ARTES) {
        const { unmount } = render(<BrandLogo variante={variante} />);
        const img = screen.getByRole("img", { name: ALT });
        expect(img).toHaveAttribute("src", src);
        unmount();
      }
    });
  }

  it("BrandMark (headers) mostra o wordmark WRW, sem o texto 'MMM' ao lado", () => {
    const { container } = render(<BrandMark />);
    expect(screen.getByRole("img", { name: ALT })).toHaveAttribute("src", "/brand/wordmark-branco.png");
    expect(container).not.toHaveTextContent("MMM");
  });
});
