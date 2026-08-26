import { describe, expect, it } from "vitest";
import { ENRICHMENT_STEPS, getEnrichmentStep, isExpectedField, isSkipResponse } from "./enrichment-flow";

describe("roteiro de enriquecimento", () => {
  it("mantém as seis perguntas na ordem obrigatória", () => {
    expect(ENRICHMENT_STEPS).toHaveLength(6);
    expect(getEnrichmentStep(0)?.fieldType).toBe("phone");
    expect(getEnrichmentStep(5)?.fieldType).toBe("relationship_type");
    expect(getEnrichmentStep(6)).toBeNull();
  });

  it("aceita somente a entidade esperada no turno atual", () => {
    expect(isExpectedField("company", "company")).toBe(true);
    expect(isExpectedField("asset_tag", "assets")).toBe(true);
    expect(isExpectedField("needs", "company")).toBe(false);
  });

  it("reconhece respostas que devem pular uma pergunta", () => {
    expect(isSkipResponse("não sei")).toBe(true);
    expect(isSkipResponse("Nao tenho")).toBe(true);
    expect(isSkipResponse("Farmacore")).toBe(false);
  });
});
