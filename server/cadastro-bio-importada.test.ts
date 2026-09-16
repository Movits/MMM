import { beforeEach, describe, expect, it, vi } from "vitest";
import { cortarSemPartirEmoji, LIMITE_DA_BIO_GRAVADA, LIMITE_DA_BIO_NO_CADASTRO } from "../shared/apresentacao";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";
});

/**
 * Concluir o cadastro NÃO pode apagar a apresentação que já estava gravada
 * (`profile.completeOnboarding`, server/routers/profile.ts).
 *
 * A carga da planilha grava bio de até `LIMITE_DA_BIO_GRAVADA`
 * (scripts/importacao/planilha.mjs); o campo do cadastro mostra
 * `LIMITE_DA_BIO_NO_CADASTRO`. A tela já deixou de reenviar o corte quando
 * ninguém tocou no campo (Onboarding.tsx), mas essa trava é de CLIENTE: um
 * bundle antigo em cache durante o deploy volta a mandar o corte, e o upsert
 * grava por cima — o resto do texto some, em silêncio e sem histórico da coluna.
 *
 * A guarda do servidor é uma IGUALDADE, não um "começa com": só o texto
 * idêntico ao corte que a tela faz é ignorado. Um "começa com" descartaria
 * edição legítima — apagar o pedaço pendurado no fim do texto cortado é
 * edição, e tem de valer.
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
/** Uma bio importada que não cabe no campo do cadastro. */
const BIO_IMPORTADA = `Exporto vinho para a Europa desde 2011. ${"Detalhe do meu trabalho. ".repeat(60)}`;
const CORTE_DO_FORMULARIO = cortarSemPartirEmoji(BIO_IMPORTADA, LIMITE_DA_BIO_NO_CADASTRO);

function caller({ cadastroConcluido = false } = {}) {
  const ctx = {
    user: {
      id: 7, openId: "open-7", email: "ana@exemplo.com", name: "Ana", role: "bronze",
      isActive: true, onboardingCompleted: cadastroConcluido, country: "BR",
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

describe("bio maior que o campo do cadastro", () => {
  it("o corte que a tela mostrou não apaga o resto: a bio gravada fica inteira", async () => {
    expect(BIO_IMPORTADA.length).toBeGreaterThan(LIMITE_DA_BIO_NO_CADASTRO);
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: CORTE_DO_FORMULARIO });

    expect(dadosGravados().bio).toBe(BIO_IMPORTADA);
  });

  it("apagar o pedaço pendurado no fim é EDIÇÃO e vale — não existe faixa de caracteres engolida", async () => {
    // O texto cortado termina no meio de uma frase; apagar esse resto é o gesto
    // mais óbvio de quem abre o campo. Com uma guarda de "começa com" (e ainda
    // mais com folga), essa edição sumia em silêncio.
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });
    const editada = CORTE_DO_FORMULARIO.slice(0, -11);

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: editada });

    expect(dadosGravados().bio).toBe(editada);
  });

  it("nenhum tamanho vizinho do corte é descartado: um caractere a menos já é edição", async () => {
    for (const apagados of [1, 2, 5, 16, 17]) {
      upsertFalso.mockReset();
      upsertFalso.mockResolvedValue(undefined);
      perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });
      const editada = CORTE_DO_FORMULARIO.slice(0, -apagados);

      await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: editada });

      expect(dadosGravados().bio, `apagou ${apagados} do fim`).toBe(editada);
    }
  });

  it("o corte que para antes de um emoji também é reconhecido", async () => {
    // O corte não parte emoji: ele para uma unidade UTF-16 antes quando o
    // próximo code point não cabe. Esse corte é o que a tela envia.
    const comEmoji = `${"a".repeat(LIMITE_DA_BIO_NO_CADASTRO - 1)}🍷${"b".repeat(600)}`;
    const corte = cortarSemPartirEmoji(comEmoji, LIMITE_DA_BIO_NO_CADASTRO);
    expect(corte).toHaveLength(LIMITE_DA_BIO_NO_CADASTRO - 1);
    perfilSalvo.mockReturnValue({ bio: comEmoji });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: corte });

    expect(dadosGravados().bio).toBe(comEmoji);
  });

  it("bio reescrita grava normalmente — a guarda é contra o corte, não contra a edição", async () => {
    perfilSalvo.mockReturnValue({ bio: BIO_IMPORTADA });

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: "Exporto vinho e azeite para a Europa." });

    expect(dadosGravados().bio).toBe("Exporto vinho e azeite para a Europa.");
  });

  it("bio que cabe no campo continua podendo ser encurtada, mesmo no limite do teto", async () => {
    // Ela CABE no formulário (exatamente o teto), então o texto que chega é
    // edição, não corte: encurtar tem de valer.
    const noTeto = BIO_IMPORTADA.slice(0, LIMITE_DA_BIO_NO_CADASTRO);
    perfilSalvo.mockReturnValue({ bio: noTeto });
    const encurtada = noTeto.slice(0, LIMITE_DA_BIO_NO_CADASTRO - 3);

    await caller().profile.completeOnboarding({ ...CADASTRO_MINIMO, bio: encurtada });

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

/**
 * A outra ponta da mesma história: se o cadastro preserva uma bio maior do que
 * o formulário mostra, o Perfil PRECISA conseguir salvar essa conta. O Perfil
 * carrega a bio inteira no campo e a reenvia a cada salvamento; com o teto do
 * cadastro no zod de `profile.update`, a mutation inteira era recusada — nem
 * cidade, nem cargo, nem nada era salvo — e não havia tela nenhuma capaz de
 * encurtar o texto.
 */
describe("o Perfil continua salvando quem tem bio maior que o campo do cadastro", () => {
  const PERFIL_MINIMO = { displayName: "Ana Souza", city: "Porto Alegre" };
  // O Perfil é de quem já concluiu o cadastro (exigirCadastroConcluido).
  const noPerfil = () => caller({ cadastroConcluido: true }).profile;

  it("salvar o Perfil com a bio inteira (maior que o teto do cadastro) não é recusado", async () => {
    expect(BIO_IMPORTADA.length).toBeGreaterThan(LIMITE_DA_BIO_NO_CADASTRO);
    expect(BIO_IMPORTADA.length).toBeLessThanOrEqual(LIMITE_DA_BIO_GRAVADA);

    await noPerfil().update({ ...PERFIL_MINIMO, bio: BIO_IMPORTADA });

    expect(dadosGravados().bio).toBe(BIO_IMPORTADA);
  });

  it("e encurtar essa bio pelo Perfil grava o texto curto", async () => {
    await noPerfil().update({ ...PERFIL_MINIMO, bio: "Exporto vinho para a Europa desde 2011." });

    expect(dadosGravados().bio).toBe("Exporto vinho para a Europa desde 2011.");
  });

  it("acima do que a plataforma grava, o campo continua recusado", async () => {
    await expect(noPerfil().update({ ...PERFIL_MINIMO, bio: "a".repeat(LIMITE_DA_BIO_GRAVADA + 1) }))
      .rejects.toThrow(/2000|Too big|too_big/);
  });
});
