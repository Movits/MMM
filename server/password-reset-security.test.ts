import { describe, expect, it } from "vitest";
import {
  getRequestIp,
  hashPasswordResetToken,
  PASSWORD_RESET_GENERIC_MESSAGE,
  PASSWORD_RESET_RATE_LIMIT,
  PASSWORD_RESET_TTL_MS,
} from "./password-reset-security";

describe("segurança da recuperação de senha", () => {
  it("produz hash SHA-256 estável sem persistir o token original", () => {
    const rawToken = "token-secreto-de-teste";
    const hash = hashPasswordResetToken(rawToken);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(rawToken);
    expect(hashPasswordResetToken(rawToken)).toBe(hash);
  });

  it("mantém os limites de segurança definidos para o fluxo", () => {
    expect(PASSWORD_RESET_RATE_LIMIT).toBe(3);
    expect(PASSWORD_RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(PASSWORD_RESET_GENERIC_MESSAGE).not.toMatch(/existe|não existe/i);
  });

  it("usa somente o primeiro IP encaminhado pelo proxy", () => {
    expect(getRequestIp("203.0.113.10, 10.0.0.1")).toBe("203.0.113.10");
    expect(getRequestIp(undefined, "127.0.0.1")).toBe("127.0.0.1");
  });
});
