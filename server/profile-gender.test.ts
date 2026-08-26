import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { userProfiles } from "../drizzle/schema";

const LOCALES_DIR = join(process.cwd(), "client", "src", "i18n", "locales");
const VALID_GENDERS = ["male", "female", "prefer_not_to_say"];

describe("perfil: seleção de gênero", () => {
  it("restringe o campo aos três valores privados aceitos", () => {
    expect(userProfiles.gender.enumValues).toEqual(VALID_GENDERS);
  });

  it("mantém as chaves de gênero traduzidas em todos os locales", () => {
    const localeFiles = readdirSync(LOCALES_DIR).filter(file => file.endsWith(".json"));
    expect(localeFiles).toHaveLength(10);

    for (const filename of localeFiles) {
      const locale = JSON.parse(readFileSync(join(LOCALES_DIR, filename), "utf8"));
      expect(locale.profile.gender.label, `${filename}: label`).toBeTypeOf("string");
      expect(locale.profile.gender.placeholder, `${filename}: placeholder`).toBeTypeOf("string");
      expect(locale.profile.gender.male, `${filename}: male`).toBeTypeOf("string");
      expect(locale.profile.gender.female, `${filename}: female`).toBeTypeOf("string");
      expect(locale.profile.gender.preferNotToSay, `${filename}: preferNotToSay`).toBeTypeOf("string");
    }
  });
});
