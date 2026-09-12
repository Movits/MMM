import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * As três travas de `conta.excluirMinhaConta` (server/routers/conta.ts), rodadas
 * de verdade pelo `createCaller`: a palavra digitada, a senha e a última
 * administradora. O que apaga é testado em `exclusao-de-conta.test.ts`; aqui
 * `excluirConta` é dublê, e metade destes testes prova que ele NÃO foi chamado.
 *
 * Por que cada uma existe:
 * - sem conferir a senha, uma sessão roubada (ou um notebook aberto) apaga a
 *   rede de contatos inteira de uma membra, sem volta;
 * - sem a palavra digitada, o botão vira clique sem querer;
 * - sem a trava da última administradora, a plataforma fica sem moderação de
 *   oportunidade e sem painel, um estado do qual não se sai pela interface.
 */

const excluirContaFalso = vi.fn();
const auditoria: Array<Record<string, unknown>> = [];

vi.mock("./exclusao-de-conta", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  excluirConta: (...args: unknown[]) => excluirContaFalso(...args),
}));

vi.mock("./security", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createAuditLog: async (params: Record<string, unknown>) => { auditoria.push(params); },
}));

const compararSenha = vi.fn();
vi.mock("bcryptjs", () => ({
  compare: (...args: unknown[]) => compararSenha(...args),
  default: { compare: (...args: unknown[]) => compararSenha(...args) },
}));

let tentativasNaJanela = 0;
let outrasAdministradoras = 1;

vi.mock("./db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirDb: async () => fakeDb,
}));

import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { auditLogs, users } from "../drizzle/schema";
import {
  ACAO_EXCLUSAO, ACAO_EXCLUSAO_RECUSADA, LIMITE_DE_TENTATIVAS,
  confirmacaoConfere, confirmacaoEsperada,
} from "./routers/conta";

const fakeDb = {
  select: () => ({
    from: (tabela: unknown) => ({
      where: async () => {
        if (tabela === auditLogs) return [{ total: tentativasNaJanela }];
        if (tabela === users) return [{ total: outrasAdministradoras }];
        return [];
      },
    }),
  }),
} as never;

type Usuaria = NonNullable<TrpcContext["user"]>;

function contexto(sobrescreve: Partial<Usuaria> = {}) {
  const cookiesLimpos: string[] = [];
  const user = {
    id: 7,
    openId: "open-7",
    email: "Dona@Exemplo.com",
    name: "Dona",
    passwordHash: "$2a$hash",
    role: "silver",
    loginMethod: "email",
    emailVerified: true,
    isActive: true,
    isVerified: true,
    onboardingCompleted: true,
    country: "BR",
    company: null,
    position: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...sobrescreve,
  } as Usuaria;
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {}, ip: "203.0.113.9" } as TrpcContext["req"],
    res: { clearCookie: (nome: string) => { cookiesLimpos.push(nome); } } as unknown as TrpcContext["res"],
  };
  return { ctx, cookiesLimpos, caller: appRouter.createCaller(ctx) };
}

const RELATORIO = {
  passos: [{ nome: "users.id + users.openId", linhas: 1 }],
  arquivosApagados: 2,
  arquivosComFalha: [] as string[],
  linhasApagadas: 31,
};

beforeEach(() => {
  excluirContaFalso.mockReset();
  excluirContaFalso.mockResolvedValue(RELATORIO);
  compararSenha.mockReset();
  compararSenha.mockResolvedValue(true);
  auditoria.length = 0;
  tentativasNaJanela = 0;
  outrasAdministradoras = 1;
});

describe("a palavra digitada (trava 1)", () => {
  it("o e-mail confere sem ligar para maiúsculas nem espaços", () => {
    expect(confirmacaoConfere("Dona@Exemplo.com", "  dona@exemplo.com ")).toBe(true);
    expect(confirmacaoConfere("Dona@Exemplo.com", "dona@exemplo.co")).toBe(false);
  });

  it("conta sem e-mail confirma pela palavra fixa, e ela não é traduzida", () => {
    expect(confirmacaoEsperada(null)).toBe("EXCLUIR");
    expect(confirmacaoConfere(null, "excluir")).toBe(true);
    expect(confirmacaoConfere("   ", "EXCLUIR")).toBe(true);
    expect(confirmacaoConfere(null, "delete")).toBe(false);
  });

  it("confirmação errada não apaga nada e nem confere a senha", async () => {
    const { caller } = contexto();
    await expect(caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "sim" }))
      .rejects.toThrow(/digite exatamente/i);
    expect(excluirContaFalso).not.toHaveBeenCalled();
    expect(compararSenha).not.toHaveBeenCalled();
    expect(auditoria).toHaveLength(0);
  });
});

describe("a senha (trava 2)", () => {
  it("senha errada registra a tentativa e não apaga nada", async () => {
    compararSenha.mockResolvedValue(false);
    const { caller } = contexto();
    await expect(caller.conta.excluirMinhaConta({ senha: "errada", confirmacao: "dona@exemplo.com" }))
      .rejects.toThrow("Senha incorreta.");
    expect(excluirContaFalso).not.toHaveBeenCalled();
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ action: ACAO_EXCLUSAO_RECUSADA, status: "failure", userId: 7 });
  });

  it("conta sem senha é recusada com instrução, não com erro genérico", async () => {
    const { caller } = contexto({ passwordHash: null });
    await expect(caller.conta.excluirMinhaConta({ senha: "x", confirmacao: "dona@exemplo.com" }))
      .rejects.toThrow(/Esqueci minha senha/);
    expect(excluirContaFalso).not.toHaveBeenCalled();
  });

  it("passando do limite de tentativas, fecha antes de conferir a senha", async () => {
    tentativasNaJanela = LIMITE_DE_TENTATIVAS;
    const { caller } = contexto();
    await expect(caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" }))
      .rejects.toThrow(/Muitas tentativas/);
    expect(compararSenha).not.toHaveBeenCalled();
    expect(excluirContaFalso).not.toHaveBeenCalled();
  });
});

describe("a última administradora (trava 3)", () => {
  it("presidenta sozinha não se apaga", async () => {
    outrasAdministradoras = 0;
    const { caller } = contexto({ role: "president" });
    await expect(caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" }))
      .rejects.toThrow(/última administradora/);
    expect(excluirContaFalso).not.toHaveBeenCalled();
  });

  it("com outra administradora no ar, a presidenta pode sair", async () => {
    outrasAdministradoras = 1;
    const { caller } = contexto({ role: "president" });
    await expect(caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" }))
      .resolves.toMatchObject({ sucesso: true });
  });

  it("membra comum sozinha no papel não é barrada (a trava é só da governança)", async () => {
    outrasAdministradoras = 0;
    const { caller } = contexto({ role: "silver" });
    await expect(caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" }))
      .resolves.toMatchObject({ sucesso: true });
  });
});

describe("o caminho feliz", () => {
  it("apaga, limpa o cookie e devolve as contagens", async () => {
    const { caller, cookiesLimpos } = contexto();
    const resposta = await caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "DONA@exemplo.com" });
    expect(excluirContaFalso).toHaveBeenCalledTimes(1);
    expect(excluirContaFalso.mock.calls[0][1]).toEqual({ id: 7, openId: "open-7", email: "Dona@Exemplo.com" });
    expect(resposta).toEqual({ sucesso: true, linhasApagadas: 31, arquivosApagados: 2, arquivosComFalha: 0 });
    expect(cookiesLimpos).toEqual([COOKIE_NAME]);
  });

  it("o registro da exclusão não guarda nome nem e-mail", async () => {
    const { caller } = contexto();
    await caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" });
    const registro = auditoria.find(linha => linha.action === ACAO_EXCLUSAO);
    expect(registro).toBeDefined();
    expect(registro).toMatchObject({ status: "success", riskLevel: "high", resource: "conta" });
    const serializado = JSON.stringify(registro!.details);
    expect(serializado).not.toContain("Dona");
    expect(serializado.toLowerCase()).not.toContain("exemplo.com");
    expect(serializado).toContain("linhasApagadas");
  });

  it("arquivo que o bucket recusou vira status failure, sem esconder a exclusão", async () => {
    excluirContaFalso.mockResolvedValue({ ...RELATORIO, arquivosComFalha: ["sivc/7/9/rg.png"] });
    const { caller } = contexto();
    const resposta = await caller.conta.excluirMinhaConta({ senha: "certa", confirmacao: "dona@exemplo.com" });
    expect(resposta.arquivosComFalha).toBe(1);
    expect(auditoria.find(linha => linha.action === ACAO_EXCLUSAO)).toMatchObject({ status: "failure" });
  });
});

describe("requisitosDaExclusao (o que a tela pergunta antes de oferecer o botão)", () => {
  it("diz o que digitar, se há senha e se ela é a última administradora", async () => {
    outrasAdministradoras = 0;
    const { caller } = contexto({ role: "gold" });
    await expect(caller.conta.requisitosDaExclusao()).resolves.toEqual({
      confirmacaoEsperada: "dona@exemplo.com",
      temSenha: true,
      ultimaAdministradora: true,
    });
  });

  it("membra comum nunca é última administradora, mesmo sem nenhuma no ar", async () => {
    outrasAdministradoras = 0;
    const { caller } = contexto({ role: "bronze", email: null, passwordHash: null });
    await expect(caller.conta.requisitosDaExclusao()).resolves.toEqual({
      confirmacaoEsperada: "EXCLUIR",
      temSenha: false,
      ultimaAdministradora: false,
    });
  });
});

// ══ conta de governança DESATIVADA não conta como governança viva ════════════
// Achado da revisão adversarial de 12/09, confirmado por dois verificadores: a
// contagem filtrava só por papel. Com uma única administradora ATIVA e outra
// desativada, a trava liberava — e a plataforma ficava sem ninguém que
// conseguisse entrar para moderar, porque conta inativa é recusada no login e
// reativá-la exige um procedimento de admin.
describe("a trava da última administradora olha quem está ATIVA", () => {
  it("as duas consultas de governança filtram isActive", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("./routers/conta.ts", import.meta.url), "utf8");
    const contagens = fonte.split("inArray(users.role");
    expect(contagens.length - 1, "esperava duas contagens de governança").toBe(2);
    for (const trecho of contagens.slice(1)) {
      const janela = trecho.slice(0, 400);
      expect(janela).toContain("eq(users.isActive, true)");
    }
  });
});
