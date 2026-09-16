import { beforeEach, describe, expect, it, vi } from "vitest";

// server/auth.ts exige JWT_SECRET já na carga do módulo — vi.hoisted roda antes dos imports.
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
  process.env.FRONTEND_URL ??= "https://exemplo-de-teste.invalid";
});

const { sendEmailMock, pedidosNaJanela } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  pedidosNaJanela: { valor: 0 },
}));

vi.mock("./_core/email", () => ({
  sendEmail: sendEmailMock,
  buildPasswordResetEmail: () => ({ html: "<p>oi</p>", text: "oi" }),
}));

const E_MAIL_CADASTRADO = "existe@exemplo.test";

vi.mock("./db", () => ({
  exigirDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          // A busca da usuária termina em `.limit(1)`; a contagem do limite é
          // aguardada direto, e é ela que este teste controla.
          limit: async () => [{ id: 7, name: "Membra", email: E_MAIL_CADASTRADO }],
          then: (resolver: (linhas: unknown[]) => unknown) => resolver([{ count: pedidosNaJanela.valor }]),
        }),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

import { appRouter } from "./routers";
import { PASSWORD_RESET_GENERIC_MESSAGE, PASSWORD_RESET_RATE_LIMIT } from "./password-reset-security";
import type { TrpcContext } from "./_core/context";

function contexto(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, socket: {} },
    res: { status: () => undefined, cookie: () => undefined, clearCookie: () => undefined },
  } as unknown as TrpcContext;
}

const pedirRecuperacao = () =>
  appRouter.createCaller(contexto()).auth.forgotPassword({ email: E_MAIL_CADASTRADO });

/**
 * O LIMITE POR IP NÃO PODE SER INVISÍVEL PARA QUEM MANTÉM O SISTEMA.
 *
 * A resposta ao usuário é sempre a mesma, de propósito, e isso continua: quem
 * pede a recuperação nunca descobre se o e-mail existe nem se bateu no limite.
 * O problema é que, do nosso lado, o pedido recusado sumia sem rastro — nenhum
 * e-mail sai, e o log do Render não registra nada. Quem testa tenta de novo, que
 * é o que qualquer pessoa faz ao não receber o e-mail, e a partir da quarta
 * tentativa em 15 minutos o fluxo fica mudo. Foi exatamente o relato "o esqueci
 * a senha não chega" do reteste de 15/09.
 */
describe("esqueci a senha — o limite por IP deixa registro no log", () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue(true);
    pedidosNaJanela.valor = 0;
  });

  it("dentro do limite, envia o e-mail e não avisa nada", async () => {
    pedidosNaJanela.valor = PASSWORD_RESET_RATE_LIMIT - 1;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resposta = await pedirRecuperacao();

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
    expect(resposta.message).toBe(PASSWORD_RESET_GENERIC_MESSAGE);
    aviso.mockRestore();
  });

  it("no limite, recusa em silêncio para quem pede e registra para quem mantém", async () => {
    pedidosNaJanela.valor = PASSWORD_RESET_RATE_LIMIT;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resposta = await pedirRecuperacao();

    // Nada sai, e a resposta é a mesma de sempre: o fluxo não vira oráculo.
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(resposta).toEqual({ success: true, message: PASSWORD_RESET_GENERIC_MESSAGE });

    // Mas agora existe rastro, e ele diz por que o e-mail não saiu.
    expect(aviso).toHaveBeenCalledTimes(1);
    const registrado = String(aviso.mock.calls[0]?.[0] ?? "");
    expect(registrado).toContain("[PasswordReset]");
    expect(registrado).toContain(String(PASSWORD_RESET_RATE_LIMIT));
    expect(registrado).toMatch(/15 min/);
    aviso.mockRestore();
  });

  it("o registro não leva e-mail nem IP", async () => {
    pedidosNaJanela.valor = PASSWORD_RESET_RATE_LIMIT + 5;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    await pedirRecuperacao();

    const registrado = String(aviso.mock.calls[0]?.[0] ?? "");
    expect(registrado).not.toContain(E_MAIL_CADASTRADO);
    expect(registrado).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
    aviso.mockRestore();
  });
});
