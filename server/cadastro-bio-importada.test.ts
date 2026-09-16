import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * Concluir o cadastro NÃO pode encurtar uma apresentação que já era maior do
 * que o formulário mostra (`profile.completeOnboarding`, server/routers/profile.ts).
 *
 * A importação da planilha grava bio de até 2000 caracteres
 * (scripts/importacao/planilha.mjs); o campo do cadastro mostra 1000. A tela já
 * deixou de reenviar o texto cortado quando ninguém tocou no campo
 * (Onboarding.tsx), mas essa trava é de CLIENTE: um bundle antigo em cache
 * durante o deploy volta a mandar o corte, e o upsert grava por cima — 1000
 * caracteres ficam, o resto some, em silêncio e sem histórico da coluna.
 *
 * A guarda do servidor é estreita de propósito: só vale quando a bio gravada
 * não cabe no campo E o texto que chegou é o começo dela. Reescrever a bio
 * continua gravando, e o Perfil, que mostra o texto inteiro, continua podendo
 * encurtar.
 */

const upsertFalso = vi.fn();
const perfilSalvo = vi.fn<[], { bio?: string | null } | null>(() => null);
const fakeDb = {
  update: () => ({ set: () => ({ where: async () => {} }) }),
} as never;

vi.mock("./db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirDb: async () => fakeDb,
  getUserProfile: async () => perfilSalvo(),
  upsertUserProfile: (...args: unknown[]) => upsertFalso(...args),
}));

vi.mock("./termo-geral-de-uso", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  exigirAceiteDoTermoGeral: async () => {},
}));
vi.mock("./nivel-do-perfil", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  reavaliarNivelPeloPerfil: async () => ({ promovidaAPrata: false }),
}));
vi.mock("./matching", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  generateMatchesForUser: async () => {},
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const CADASTRO_MINIMO = { displayName: "Ana Souza", city: "Porto Alegre" };
const TETO = 1000;
/** A folga do corte da tela, que para antes de partir um emoji (server/routers/profile.ts). */
const MARGEM = 16;
/** Uma bio importada que não cabe no campo do cadastro. */
const BIO_IMPORTADA = `Exporto vinho para a Europa desde 2011. ${"Detalhe do meu trabalho. ".repeat(60)}`;
const CORTE_DO_FORMULARIO = BIO_IMPORTADA.slice(0, TETO);

function caller() {
  const ctx = {
    user: {
      id: 7, openId: "open-7", email: "ana@exemplo.com", name: "Ana", role: "bronze",
      isActive: true, onboardingCompleted: false, country: "BR",
    },
    req: { protocol: "https", headers: {}, ip: "203.0.113.9" },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

/** O que o procedimento mandou gravar em user_profiles. */
function dadosGravados(): Record<string, unknown> {
  expect(upsertFalso).toHaveBeenCalledTimes(1);
  return upsertFalso.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  upsertFalso.mockReset();
  upsertFalso.mockResolvedValue(undefined);
  perfilSalvo.mockReset();
  perfilSalvo.mockReturnValue(null);
});

describe("bio maior que o formulário do cadastro", () => {
  it("o texto cortado no teto não apaga o resto: a bio gravada fica inteira", async () => {
    expect(BIO_IMPORTADA.length).toBeGreaterThan(TETO);
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: CORTE_DO_FORMULARIO });

    expect(dadosGravados().bio).toBe(BIO_IMPORTADA);
  });

  it("bio reescrita grava normalmente — a guarda é contra o corte, não contra a edição", async () => {
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: "Exporto vinho e azeite para a Europa." });

    expect(dadosGravados().bio).toBe("Exporto vinho e azeite para a Europa.");
  });

  it("bio que cabe no campo continua podendo ser encurtada, mesmo no limite do teto", async () => {
    // Ela CABE no formulário (exatamente o teto), então o texto que chega é
    // edição, não corte: encurtar tem de valer.
    const noTeto = BIO_IMPORTADA.slice(0, TETO);
    expect(noTeto).toHaveLength(TETO);
    perfilSalvo.mockReturnValue({ bio: noTeto });
    const encurtada = noTeto.slice(0, TETO - MARGEM);

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: encurtada });

    expect(perfilSalvo).toHaveBeenCalled();
    expect(dadosGravados().bio).toBe(encurtada);
  });

  it("bio curta nem chega a consultar o perfil", async () => {
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: "Exporto vinho" });

    expect(dadosGravados().bio).toBe("Exporto vinho");
    expect(perfilSalvo).not.toHaveBeenCalled();
  });

  it("sem bio no pedido, a coluna não é tocada e nem se lê o perfil por causa dela", async () => {
    await caller().profile.completeOnboarding(CADASTRO_MINIMO);

    expect("bio" in dadosGravados()).toBe(false);
    expect(perfilSalvo).not.toHaveBeenCalled();
  });
});
