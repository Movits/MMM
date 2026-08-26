import { describe, expect, it } from "vitest";
import { normalizePrimarySpecialties, togglePrimarySpecialty } from "../shared/specialties";

describe("especialidades principais", () => {
  it("permite todas as especialidades selecionadas", () => {
    let selected: string[] = [];
    selected = togglePrimarySpecialty(selected, "Tecnologia");
    selected = togglePrimarySpecialty(selected, "Finanças");
    selected = togglePrimarySpecialty(selected, "Direito");
    selected = togglePrimarySpecialty(selected, "Saúde");

    expect(selected).toEqual(["Tecnologia", "Finanças", "Direito", "Saúde"]);
  });

  it("inclui uma especialidade personalizada sem duplicar valores", () => {
    expect(normalizePrimarySpecialties(["Tecnologia", "Tecnologia"], "  Biotecnologia  ")).toEqual([
      "Tecnologia",
      "Biotecnologia",
    ]);
    expect(normalizePrimarySpecialties(["Tecnologia", "Finanças", "Direito"], "Biotecnologia")).toEqual([
      "Tecnologia",
      "Finanças",
      "Direito",
      "Biotecnologia",
    ]);
  });
});
