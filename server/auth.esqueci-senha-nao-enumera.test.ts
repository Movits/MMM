import { beforeEach, describe, expect, it, vi } from "vitest";

// server/auth.ts exige JWT_SECRET já na carga do módulo — vi.hoisted roda antes dos imports.
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
  process.env.FRONTEND_URL ??= "https://exemplo-de-teste.invalid";
});

const { envioFalhou, sendEmailMock } = vi.hoisted(() => ({
  envioFalhou: { valor: false },
  sendEmailMock: vi.fn(),
}));

vi.mock("./_core/email", () => ({
  sendEmail: sendEmailMock,
  buildPasswordResetEmail: () => ({ html: "<p>oi</p>", text: "oi" }),
}));

// Banco falso: a primeira usuária existe, qualquer outro e-mail não existe.
const E_MAIL_CADASTRADO = "existe@exemplo.test";

const linhasDeUsuaria = (email: string) =>
  email === E_MAIL_CADASTRADO ? [{ id: 7, name: "Membra", email: E_MAIL_CADASTRADO }] : [];

let emailProcurado = "";

vi.mock("./db", () => ({
  exigirDb: async () => ({
    select: (_campos?: unknown) => ({
      from: () => ({
        where: (condicao: unknown) => {
          // A contagem do rate limit e a busca da usuária passam pelo mesmo
          // caminho; o `limit` só existe na segunda.
          const alvo = {
            limit: async () => linhasDeUsuaria(emailProcurado),
            then: (resolver: (linhas: unknown[]) => unknown) => resolver([{ count: 0 }]),
          };
          void condicao;
          return alvo;
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contexto(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, socket: {} },
    res: { status: () => undefined, cookie: () => undefined, clearCookie: () => undefined },
  } as unknown as TrpcContext;
}

async function pedirRecuperacao(email: string) {
  emailProcurado = email;
  const caller = appRouter.createCaller(contexto());
  return caller.auth.forgotPassword({ email });
}

describe("esqueci a senha — a resposta não revela se o e-mail existe", () => {
  beforeEach(() => {
    sendEmailMock.mockReset();
    envioFalhou.valor = false;
  });

  it("responde igual para e-mail cadastrado e não cadastrado quando o envio funciona", async () => {
    sendEmailMock.mockResolvedValue(true);

    const existente = await pedirRecuperacao(E_MAIL_CADASTRADO);
    const inexistente = await pedirRecuperacao("ninguem@exemplo.test");

    expect(existente).toEqual(inexistente);
  });

  it("continua respondendo igual quando a Resend recusa o envio", async () => {
    // Este é o cenário que abria a enumeração de contas: com a cota diária do
    // plano gratuito estourada, TODO e-mail cadastrado falhava no envio. Se a
    // falha virasse erro, 500 passaria a significar "esta conta existe".
    sendEmailMock.mockResolvedValue(false);

    const inexistente = await pedirRecuperacao("ninguem@exemplo.test");
    const existente = await pedirRecuperacao(E_MAIL_CADASTRADO);

    expect(existente).toEqual(inexistente);
  });

  it("continua respondendo igual quando o envio lança exceção", async () => {
    sendEmailMock.mockRejectedValue(new Error("timeout na Resend"));

    const inexistente = await pedirRecuperacao("ninguem@exemplo.test");
    const existente = await pedirRecuperacao(E_MAIL_CADASTRADO);

    expect(existente).toEqual(inexistente);
  });
});
