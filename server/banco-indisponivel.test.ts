import { describe, expect, it, vi } from "vitest";

/**
 * Banco fora do ar é ERRO, não "sem dados".
 *
 * Antes, getDb() devolvia null e cada helper de db.ts fazia `if (!db) return
 * []`: uma queda do banco aparecia na tela como lista vazia, perfil
 * inexistente, contato apagado. Agora os helpers usam exigirDb(), que lança
 * BancoIndisponivel, e o middleware de server/_core/trpc.ts traduz a exceção
 * numa resposta única para todo procedimento. Este arquivo cobre as três peças:
 * exigirDb, o middleware e o contexto (a sessão que não pôde ser lida).
 */

// db.ts precisa de JWT_SECRET ao carregar. DATABASE_URL sai de propósito para
// getDb() devolver null neste arquivo; cada arquivo de teste tem o próprio
// registro de módulos, então o cache interno de db.ts nasce vazio aqui.
vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
  delete process.env.DATABASE_URL;
});

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));

const { BancoIndisponivel, MENSAGEM_BANCO_INDISPONIVEL } = await import("./banco-indisponivel");
const { exigirDb, getDb } = await import("./db");
const { publicProcedure, protectedProcedure, router } = await import("./_core/trpc");
const { createContext } = await import("./_core/context");
const { sdk } = await import("./_core/sdk");

const semUsuaria = { user: null, req: { headers: {} }, res: {} };

describe("exigirDb", () => {
  it("getDb continua devolvendo null sem conexão; exigirDb lança BancoIndisponivel", async () => {
    expect(await getDb()).toBeNull();
    await expect(exigirDb()).rejects.toBeInstanceOf(BancoIndisponivel);
  });

  it("a mensagem da exceção é a mesma que chega à usuária", () => {
    const erro = new BancoIndisponivel();
    expect(erro.name).toBe("BancoIndisponivel");
    expect(erro.message).toBe(MENSAGEM_BANCO_INDISPONIVEL);
  });
});

describe("o middleware do tRPC traduz BancoIndisponivel", () => {
  const rotas = router({
    cai: publicProcedure.query(async () => { throw new BancoIndisponivel(); }),
    outro: publicProcedure.query(async () => { throw new Error("outra coisa"); }),
    protegido: protectedProcedure.query(async () => "ok"),
  });

  it("procedimento público: INTERNAL_SERVER_ERROR com a frase em português", async () => {
    await expect(rotas.createCaller(semUsuaria as never).cai()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: MENSAGEM_BANCO_INDISPONIVEL,
    });
  });

  it("outros erros passam sem ganhar a frase do banco", async () => {
    await expect(rotas.createCaller(semUsuaria as never).outro()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "outra coisa",
    });
  });

  it("procedimento protegido sem sessão: UNAUTHORIZED, como sempre", async () => {
    await expect(rotas.createCaller(semUsuaria as never).protegido()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("protegido com a sessão não lida por causa do banco: banco, e não UNAUTHORIZED", async () => {
    // Sem isto, a usuária logada era mandada para o login enquanto o banco
    // estava fora do ar, e o login respondia "banco indisponível".
    const ctx = { ...semUsuaria, bancoIndisponivel: true };
    await expect(rotas.createCaller(ctx as never).protegido()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: MENSAGEM_BANCO_INDISPONIVEL,
    });
  });
});

describe("createContext", () => {
  const requisicao = { req: { headers: {} }, res: {} } as never;

  it("anota bancoIndisponivel quando a sessão não pôde ser lida por causa do banco", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValueOnce(new BancoIndisponivel());
    const ctx = await createContext(requisicao);
    expect(ctx.user).toBeNull();
    expect(ctx.bancoIndisponivel).toBe(true);
  });

  it("sem sessão nenhuma, o contexto não culpa o banco", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValueOnce(new Error("Invalid session cookie"));
    const ctx = await createContext(requisicao);
    expect(ctx.user).toBeNull();
    expect(ctx.bancoIndisponivel).toBe(false);
  });
});
