import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { userProfiles } from "../drizzle/schema";

describe("onboarding: recursos atuais", () => {
  it("inclui uma coluna de texto livre para recursos atuais", () => {
    expect(userProfiles.currentResources).toBeDefined();
    expect(userProfiles.currentResources.name).toBe("currentResources");
  });

  it("mantém a pergunta de recursos atuais traduzida em todos os idiomas", () => {
    const localesDir = join(process.cwd(), "client", "src", "i18n", "locales");
    const localeFiles = readdirSync(localesDir).filter(file => file.endsWith(".json"));
    expect(localeFiles).toHaveLength(10);

    for (const filename of localeFiles) {
      const locale = JSON.parse(readFileSync(join(localesDir, filename), "utf8"));
      expect(locale.onboarding.fields.currentResources, `${filename}: pergunta`).toBeTypeOf("string");
      expect(locale.onboarding.fields.currentResourcesPlaceholder, `${filename}: placeholder`).toBeTypeOf("string");
      expect(locale.onboarding.fields.currentResourcesHint, `${filename}: dica`).toBeTypeOf("string");
    }
  });
});
