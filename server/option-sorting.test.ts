import { describe, expect, it } from "vitest";
import { sortOptionsAlphabetically, sortTextAlphabetically } from "../shared/option-sorting";

describe("ordenação alfabética de opções", () => {
  it("ordena textos sem diferenciar maiúsculas ou acentos", () => {
    expect(sortTextAlphabetically(["Zeta", "Árvore", "empresa", "Beta"])).toEqual([
      "Árvore",
      "Beta",
      "empresa",
      "Zeta",
    ]);
  });

  it("ordena objetos pelo rótulo preservando os dados da opção", () => {
    const options = sortOptionsAlphabetically([
      { value: "legal", label: "Pessoa Jurídica" },
      { value: "mei", label: "MEI" },
      { value: "individual", label: "Pessoa Física" },
    ]);
    expect(options.map(option => option.value)).toEqual(["mei", "individual", "legal"]);
  });
});
