import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * O bloqueio de login do banco (5 falhas por hora por e-mail + IP) contava
 * pelo IP cru: com IPv6, trocar de endereço dentro da mesma /64 zerava a
 * contagem. Agora `loginUser` recebe a chave de rede (/56) para o bloqueio e
 * continua gravando o IP cru na sessão, que a detecção de anomalia compara.
 */

const estado = vi.hoisted(() => ({
  hash: "",
  sessoes: [] as Array<Record<string, unknown>>,
  checkLoginRateLimit: vi.fn(async (_identificador: string, _ip: string) => ({ allowed: true, remainingAttempts: 5 })),
  recordLoginAttempt: vi.fn(async (_identificador: string, _ip: string, _sucesso: boolean) => undefined),
}));

vi.mock("./security", () => ({
  checkLoginRateLimit: estado.checkLoginRateLimit,
  recordLoginAttempt: estado.recordLoginAttempt,
}));

vi.mock("./db", () => ({
  exigirDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: 7,
              openId: "email_x",
              name: "Membra",
              email: "membra@exemplo.test",
              isActive: true,
              passwordHash: estado.hash,
              role: "silver",
              onboardingCompleted: true,
            },
          ],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: async (valores: Record<string, unknown>) => {
        estado.sessoes.push(valores);
      },
    }),
  }),
}));

import { loginUser } from "./auth";
import { filaDoBcrypt } from "./fila-do-bcrypt";

const IP_CRU = "2001:db8:abcd:1234:5678:9abc:def0:1";
const REDE = "2001:db8:abcd:1200::/56";

describe("loginUser: a chave do bloqueio é a rede, a sessão guarda o IP cru", () => {
  beforeEach(() => {
    estado.hash = bcrypt.hashSync("senha-certa-123", 4);
    estado.sessoes = [];
    estado.checkLoginRateLimit.mockClear();
    estado.recordLoginAttempt.mockClear();
  });

  it("senha errada: a contagem e a falha usam a chave de rede", async () => {
    await expect(
      loginUser({ email: "membra@exemplo.test", password: "errada", ip: IP_CRU, chaveDoBloqueio: REDE }),
    ).rejects.toThrow(/E-mail ou senha incorretos/);

    expect(estado.checkLoginRateLimit).toHaveBeenCalledWith("membra@exemplo.test", REDE);
    expect(estado.recordLoginAttempt).toHaveBeenCalledWith("membra@exemplo.test", REDE, false);
  });

  it("senha certa: limpa pela chave de rede e grava a sessão com o IP cru; o bcrypt passa pela fila", async () => {
    const naFila = vi.spyOn(filaDoBcrypt, "executar");
    const { token } = await loginUser({ email: "membra@exemplo.test", password: "senha-certa-123", ip: IP_CRU, chaveDoBloqueio: REDE });

    expect(token).toBeTruthy();
    expect(estado.recordLoginAttempt).toHaveBeenCalledWith("membra@exemplo.test", REDE, true);
    expect(estado.sessoes).toHaveLength(1);
    expect(estado.sessoes[0].ipAddress).toBe(IP_CRU);
    expect(naFila).toHaveBeenCalledTimes(1);
    naFila.mockRestore();
  });

  it("sem a chave, o bloqueio usa o IP cru, como antes", async () => {
    await expect(loginUser({ email: "membra@exemplo.test", password: "errada", ip: IP_CRU })).rejects.toThrow();
    expect(estado.checkLoginRateLimit).toHaveBeenCalledWith("membra@exemplo.test", IP_CRU);
  });
});
