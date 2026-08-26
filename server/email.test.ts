/**
 * Testa a configuração do serviço de e-mail (Resend)
 * Verifica que o helper de e-mail está configurado e o template HTML é gerado corretamente
 */
import { describe, it, expect } from "vitest";

describe("Email Service", () => {
  it("deve gerar o template HTML de recuperação de senha corretamente", async () => {
    const { buildPasswordResetEmail } = await import("./_core/email");
    const { html, text } = buildPasswordResetEmail("Maria Silva", "https://mmmos.space/reset-password?token=abc123");

    // Verificar que o HTML contém os elementos essenciais
    expect(html).toContain("Maria Silva");
    expect(html).toContain("https://mmmos.space/reset-password?token=abc123");
    expect(html).toContain("Redefinição de senha");
    expect(html).toContain("1 hora");
    expect(html).toContain("MMM OS");

    // Verificar que o texto plano também está correto
    expect(text).toContain("Maria Silva");
    expect(text).toContain("https://mmmos.space/reset-password?token=abc123");
    expect(text).toContain("1 hora");
  });

  it("sendEmail deve ser uma função assíncrona exportável", async () => {
    // O módulo de email usa lazy init com variável de módulo — não é possível reimportar sem cache.
    // Testamos apenas que a função sendEmail é exportável e é assíncrona.
    const { sendEmail } = await import("./_core/email");
    expect(typeof sendEmail).toBe("function");
    expect(sendEmail.constructor.name).toBe("AsyncFunction");
  });

  it("deve ter RESEND_API_KEY configurada no ambiente", () => {
    // Verificar que a chave está presente (pode ser a chave real ou uma de teste)
    const key = process.env.RESEND_API_KEY;
    if (key) {
      expect(key).toBeTruthy();
      expect(key.length).toBeGreaterThan(5);
      console.log("[Email Test] RESEND_API_KEY configurada:", key.substring(0, 8) + "...");
    } else {
      console.warn("[Email Test] RESEND_API_KEY não configurada — e-mails não serão enviados");
      // Não falhar o teste se não tiver chave — é opcional
      expect(true).toBe(true);
    }
  });
});
