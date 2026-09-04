import { describe, expect, it, vi } from "vitest";
import { OPPORTUNITY_SECTOR_KEYS, opportunitySectorLabel } from "./opportunity-sectors";

// Setor de oportunidade: a chave gravada no banco precisa ser sempre a mesma,
// não importa o idioma da tela em que a oportunidade nasceu (regressão da PR
// #55 — antes, cada idioma gravava um texto diferente e o filtro por setor
// só achava oportunidades criadas no MESMO idioma de quem procura).
describe("opportunitySectorLabel", () => {
  it("traduz uma chave conhecida usando o t() da tela", () => {
    const t = vi.fn((chave: string) => (chave === "newOpportunity.sectorSaude" ? "Salud" : chave));
    expect(opportunitySectorLabel(t, "saude")).toBe("Salud");
    expect(t).toHaveBeenCalledWith("newOpportunity.sectorSaude", { defaultValue: "saude" });
  });

  it("devolve string vazia para valor ausente, sem chamar t()", () => {
    const t = vi.fn();
    expect(opportunitySectorLabel(t, null)).toBe("");
    expect(opportunitySectorLabel(t, undefined)).toBe("");
    expect(t).not.toHaveBeenCalled();
  });

  it("registro antigo (rótulo gravado direto, não é uma chave conhecida) volta como está", () => {
    const t = vi.fn((chave: string, opcoes?: { defaultValue: string }) => opcoes?.defaultValue ?? chave);
    // "Saúde" (rótulo em pt) não é nenhuma das OPPORTUNITY_SECTOR_KEYS.
    expect(opportunitySectorLabel(t, "Saúde")).toBe("Saúde");
    expect(t).not.toHaveBeenCalled();
  });

  it("toda chave em OPPORTUNITY_SECTOR_KEYS tem uma tradução correspondente definida em pt-BR", async () => {
    const ptBR = (await import("../i18n/locales/pt-BR.json")).default as Record<string, Record<string, string>>;
    for (const key of OPPORTUNITY_SECTOR_KEYS) {
      const chaveI18n = `sector${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      expect(ptBR.newOpportunity, `newOpportunity.${chaveI18n} deveria existir`).toHaveProperty(chaveI18n);
    }
  });
});
