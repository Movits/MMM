import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CADASTRO_EMPRESARIAL_MAX,
  exigeCadastroEmpresarial,
  mascararCadastroEmpresarial,
  normalizarCadastroEmpresarial,
} from "../shared/business-registration";

/**
 * Número de Cadastro Empresarial no lugar do CNPJ (Rosber, 14/09 20:44),
 * com o comportamento da PR #133 do Gabriel: alfanumérico, sem máscara, sem
 * 14 dígitos fixos nem dígito verificador, e normalizado igual na tela e no
 * servidor.
 */
describe("dados empresariais", () => {
  it("tira hífen, ponto, barra e espaço e guarda letras e números", () => {
    expect(normalizarCadastroEmpresarial("04.252.011/0001-10")).toBe("04252011000110");
    expect(normalizarCadastroEmpresarial("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(normalizarCadastroEmpresarial(" B-1234 5678 ")).toBe("B12345678");
    expect(normalizarCadastroEmpresarial("---")).toBe("");
  });

  it("converte algarismos de outros teclados em vez de apagá-los e mantém letras acentuadas", () => {
    // Largura cheia (IME japonês/chinês), árabe-índico, persa e devanágari.
    expect(normalizarCadastroEmpresarial("１２３-４５")).toBe("12345");
    expect(normalizarCadastroEmpresarial("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
    expect(normalizarCadastroEmpresarial("۱۲۳۴")).toBe("1234");
    expect(normalizarCadastroEmpresarial("१२३४-५")).toBe("12345");
    // RFC mexicano: o Ñ fica; o & é símbolo e sai, como o hífen.
    expect(normalizarCadastroEmpresarial("ÑA&-850101-AB1")).toBe("ÑA850101AB1");
  });

  it("não corta o número em 14 dígitos nem confere dígito verificador", () => {
    const longo = "1234567890123456789012345";
    expect(normalizarCadastroEmpresarial(longo)).toBe(longo);
    expect(longo.length).toBeGreaterThan(14);
    expect(longo.length).toBeLessThanOrEqual(CADASTRO_EMPRESARIAL_MAX);
    // "00000000000000" era recusado como CNPJ inválido; agora é só um número.
    expect(normalizarCadastroEmpresarial("00.000.000/0000-00")).toBe("00000000000000");
  });

  it("tira separadores que o Unicode trata como letra: ー do teclado japonês, ـ árabe e o sinal №", () => {
    expect(normalizarCadastroEmpresarial("０１００ー０１ー１２３４５６")).toBe("010001123456");
    expect(normalizarCadastroEmpresarial("١٠١٠ـ١٢٣")).toBe("1010123");
    expect(normalizarCadastroEmpresarial("№ 1027700132195")).toBe("1027700132195");
  });

  it("mascara o valor exibido com 4 asteriscos fixos e os 4 últimos caracteres", () => {
    expect(mascararCadastroEmpresarial("04.252.011/0001-10")).toBe("****0110");
    expect(mascararCadastroEmpresarial("B12345678")).toBe("****5678");
    expect(mascararCadastroEmpresarial("1234")).toBe("1234");
    // Número longo não empurra os 4 últimos para fora do cartão do perfil.
    expect(mascararCadastroEmpresarial("A".repeat(CADASTRO_EMPRESARIAL_MAX))).toHaveLength(8);
  });

  it("exige o cadastro de todo tipo com personalidade jurídica, menos da pessoa física", () => {
    expect(exigeCadastroEmpresarial("legal_entity")).toBe(true);
    expect(exigeCadastroEmpresarial("mei")).toBe(true);
    expect(exigeCadastroEmpresarial("nonprofit")).toBe(true);
    expect(exigeCadastroEmpresarial("individual")).toBe(false);
    expect(exigeCadastroEmpresarial("")).toBe(false);
    expect(exigeCadastroEmpresarial(undefined)).toBe(false);
  });

  it("mantém os rótulos empresariais nos 10 idiomas, sem citar CNPJ nem a máscara antiga", () => {
    const localesDir = join(process.cwd(), "client", "src", "i18n", "locales");
    const localeFiles = readdirSync(localesDir).filter(file => file.endsWith(".json"));
    expect(localeFiles).toHaveLength(10);

    for (const filename of localeFiles) {
      const locale = JSON.parse(readFileSync(join(localesDir, filename), "utf8"));
      const business = locale.profile.business;
      expect(business.personType, `${filename}: personType`).toBeTypeOf("string");
      expect(business.nonprofit, `${filename}: nonprofit`).toBeTypeOf("string");
      expect(business.companySize, `${filename}: companySize`).toBeTypeOf("string");
      expect(business.registrationNumber, `${filename}: registrationNumber`).toBeTypeOf("string");
      expect(business.registrationNumberHint, `${filename}: registrationNumberHint`).toBeTypeOf("string");
      expect(business.registrationNumberRequired, `${filename}: registrationNumberRequired`).toBeTypeOf("string");
      expect(business.cnpj, `${filename}: chave cnpj antiga`).toBeUndefined();
      const textos = JSON.stringify(business);
      expect(textos, `${filename}: ainda cita CNPJ`).not.toMatch(/CNPJ/);
      expect(textos, `${filename}: ainda mostra a máscara`).not.toContain("00.000.000/0000-00");
    }
  });

  it("o rótulo em português é exatamente o pedido: 'Número de Cadastro Empresarial'", () => {
    const pt = JSON.parse(readFileSync(join(process.cwd(), "client", "src", "i18n", "locales", "pt-BR.json"), "utf8"));
    expect(pt.profile.business.registrationNumber).toBe("Número de Cadastro Empresarial");
  });
});
