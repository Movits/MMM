import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatCnpj, isValidCnpj, maskCnpj, normalizeCnpj } from "../shared/business-registration";

describe("dados empresariais", () => {
  it("normaliza, formata e valida um CNPJ válido", () => {
    expect(normalizeCnpj("04.252.011/0001-10")).toBe("04252011000110");
    expect(formatCnpj("04252011000110")).toBe("04.252.011/0001-10");
    expect(isValidCnpj("04.252.011/0001-10")).toBe(true);
  });

  it("rejeita CNPJ inválido e mascara o valor exibido", () => {
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
    expect(isValidCnpj("04.252.011/0001-11")).toBe(false);
    expect(maskCnpj("04.252.011/0001-10")).toBe("**.***.***/0001-10");
  });

  it("mantém os rótulos empresariais nos 10 idiomas", () => {
    const localesDir = join(process.cwd(), "client", "src", "i18n", "locales");
    const localeFiles = readdirSync(localesDir).filter(file => file.endsWith(".json"));
    expect(localeFiles).toHaveLength(10);

    for (const filename of localeFiles) {
      const locale = JSON.parse(readFileSync(join(localesDir, filename), "utf8"));
      expect(locale.profile.business.personType, `${filename}: personType`).toBeTypeOf("string");
      expect(locale.profile.business.companySize, `${filename}: companySize`).toBeTypeOf("string");
      expect(locale.profile.business.cnpj, `${filename}: cnpj`).toBeTypeOf("string");
    }
  });
});
