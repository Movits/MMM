import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { rotuloDaBusca } from "./interesses";

/**
 * Perfis gravados antes de 14/09 têm as 5 chaves antigas de "O que você busca?"
 * e não foram migrados. O Dashboard e a revisão do cadastro precisam continuar
 * mostrando algo legível: a opção nova equivalente quando existe, o rótulo
 * antigo quando não existe.
 */
const t = (chave: string, opcoes?: Record<string, unknown>) => i18n.t(chave, opcoes) as string;

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("rotuloDaBusca", () => {
  it("chave nova sai com o título da opção", () => {
    expect(rotuloDaBusca(t, "servico_especializado")).toBe("Serviço Especializado");
  });

  it("antigas com equivalente saem com o rótulo da nova", () => {
    expect(rotuloDaBusca(t, "investor")).toBe("Investimento / Capital");
    expect(rotuloDaBusca(t, "strategic_partner")).toBe("Parceiro estratégico");
    expect(rotuloDaBusca(t, "team")).toBe("Talentos / Especialistas");
  });

  it("job e mentor, sem equivalente, seguem com o rótulo antigo", () => {
    expect(rotuloDaBusca(t, "job")).toBe("Emprego/Projeto");
    expect(rotuloDaBusca(t, "mentor")).toBe("Mentor");
  });

  it("valor que não é resposta de busca devolve null (quem chama decide)", () => {
    expect(rotuloDaBusca(t, "roupas")).toBeNull();
  });

  it("no idioma da tela", async () => {
    await i18n.changeLanguage("en");
    expect(rotuloDaBusca(t, "investor")).toBe("Investment / Capital");
    expect(rotuloDaBusca(t, "job")).not.toBe("Emprego/Projeto");
  });
});
