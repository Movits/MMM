import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const telas = ["Login.tsx", "Register.tsx"] as const;
const fonte = (arquivo: string) => readFileSync(`client/src/pages/${arquivo}`, "utf8");

/**
 * NADA DE `text-slate-500` OU `text-slate-600` NA ENTRADA DO SITE.
 *
 * As duas telas que qualquer pessoa vê antes de ter conta nasceram de um
 * gabarito claro e ficaram com tons de cinza do Tailwind sobre o fundo escuro
 * do aplicativo (#151312). Medido no site em 16/09/2026, com o cálculo de
 * contraste da WCAG:
 *
 *   text-slate-600 → 2,44 : 1   (mínimo para texto: 4,5)
 *   text-slate-500 → 3,89 : 1
 *   text-white/50  → 5,31 : 1
 *   text-white/60  → 7,16 : 1
 *
 * Na prática, a frase "ao criar sua conta, você concorda com nossos Termos de
 * Uso", o aviso de conexão segura e os textos de ajuda dos campos ficavam quase
 * invisíveis no celular. O Severo relatou "defeito de contraste" no grupo na
 * mesma manhã, com capturas de tela.
 *
 * O teste é por classe, e não por pixel, porque é a classe que volta: um
 * componente novo copiado do mesmo gabarito traz o cinza junto.
 */
describe("contraste das telas de entrada", () => {
  it("nenhuma das duas usa os cinzas ilegíveis do gabarito", () => {
    for (const tela of telas) {
      expect(fonte(tela), tela).not.toMatch(/text-slate-[567]00/);
    }
  });

  it("os tons que entraram no lugar são os da paleta do aplicativo", () => {
    for (const tela of telas) {
      expect(fonte(tela), tela).toMatch(/text-white\/(50|60)/);
    }
  });
});
