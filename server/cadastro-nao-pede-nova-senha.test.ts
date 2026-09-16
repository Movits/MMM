import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const IDIOMAS = ["pt-BR", "en", "es", "fr", "de", "ru", "zh", "ja", "ar", "hi"] as const;

const auth = (idioma: string) =>
  JSON.parse(readFileSync(`client/src/i18n/locales/${idioma}.json`, "utf8")).auth as Record<string, string>;

const tela = (arquivo: string) => readFileSync(`client/src/pages/${arquivo}`, "utf8");

/**
 * O CADASTRO NÃO PEDE PARA "CONFIRMAR A NOVA SENHA".
 *
 * As duas telas que pedem senha duas vezes — criar conta e redefinir senha —
 * usavam a MESMA chave, `auth.confirmPassword`, cuja redação foi escrita para a
 * redefinição: "Confirmar nova senha". No cadastro não existe senha velha, e
 * quem cria a conta lia um campo falando de uma senha anterior que nunca
 * existiu. Estava assim nos 10 idiomas, e apareceu no site em inglês como
 * "Confirm new password" logo abaixo de "Create account".
 *
 * Agora são duas chaves: a genérica, neutra, que o cadastro usa, e
 * `auth.confirmNewPassword`, com a redação de antes, que a redefinição usa.
 * Este teste prende as duas pontas — a chave certa em cada tela e a existência
 * do par em todos os idiomas —, porque reunir de novo as duas redações numa
 * chave só é o tipo de "simplificação" que parece limpeza.
 */
describe("o campo de confirmar senha fala a língua da tela onde está", () => {
  it("todos os 10 idiomas têm o par, e as duas redações são diferentes", () => {
    for (const idioma of IDIOMAS) {
      const a = auth(idioma);
      expect(a.confirmPassword, idioma).toBeTruthy();
      expect(a.confirmNewPassword, idioma).toBeTruthy();
      expect(a.confirmPasswordPlaceholder, idioma).toBeTruthy();
      expect(a.confirmNewPasswordPlaceholder, idioma).toBeTruthy();
      expect(a.confirmPassword, idioma).not.toBe(a.confirmNewPassword);
      expect(a.confirmPasswordPlaceholder, idioma).not.toBe(a.confirmNewPasswordPlaceholder);
    }
  });

  it("em português e em inglês, o cadastro não menciona senha nova", () => {
    // Só nestes dois: são os idiomas que o time lê, e prometer conferir o
    // sentido de uma palavra nos outros oito seria fingir revisão nativa.
    for (const [idioma, proibido] of [["pt-BR", /nova/i], ["en", /\bnew\b/i]] as const) {
      const a = auth(idioma);
      expect(a.confirmPassword, idioma).not.toMatch(proibido);
      expect(a.confirmPasswordPlaceholder, idioma).not.toMatch(proibido);
      expect(a.confirmNewPassword, idioma).toMatch(proibido);
    }
  });

  it("a tela de criar conta usa a chave neutra", () => {
    const criarConta = tela("Register.tsx");
    expect(criarConta).toContain('t("auth.confirmPassword")');
    expect(criarConta).not.toContain("auth.confirmNewPassword");
  });

  it("a tela de redefinir senha usa a chave da senha nova", () => {
    const redefinir = tela("ResetPassword.tsx");
    expect(redefinir).toContain("auth.confirmNewPassword");
    expect(redefinir).not.toMatch(/auth\.confirmPassword["',]/);
  });
});

/**
 * O QUE A PESSOA ACEITA, ELA CONSEGUE LER.
 *
 * A frase "ao criar sua conta, você concorda com nossos Termos de Uso e
 * Política de Privacidade" trazia os dois nomes como <span> com cor de link e
 * `cursor-pointer` — pareciam clicáveis e não levavam a lugar nenhum. As duas
 * páginas existem e são públicas, e desde 16/09 /termos mostra o Termo Geral
 * vigente. Abrir em aba nova é parte da correção: ler o termo no meio do
 * cadastro não pode custar o formulário já preenchido.
 */
describe("o cadastro deixa ler o que a pessoa está aceitando", () => {
  const criarConta = tela("Register.tsx");

  it("os dois nomes são links para as páginas públicas", () => {
    expect(criarConta).toMatch(/<a href="\/termos"/);
    expect(criarConta).toMatch(/<a href="\/privacidade"/);
  });

  it("abrem em aba nova, para o formulário não se perder", () => {
    for (const trecho of criarConta.split("<a ").slice(1)) {
      if (!/href="\/(termos|privacidade)"/.test(trecho)) continue;
      const ateOFim = trecho.slice(0, trecho.indexOf(">"));
      expect(ateOFim).toContain('target="_blank"');
      expect(ateOFim).toContain("noopener");
    }
  });

  it("não sobrou texto fingindo ser link", () => {
    // O <span> com cursor-pointer era exatamente isto: aparência de link sem
    // destino. Se voltar, some com o acesso ao termo sem quebrar nada visível.
    const trechoDosTermos = criarConta.slice(criarConta.indexOf('t("auth.termsPrefix")'), criarConta.indexOf('t("auth.dataProtected")'));
    expect(trechoDosTermos).not.toContain("cursor-pointer");
  });
});
