import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * OS "INTERESSES DE NEGÓCIO" DO CARTÃO DE CONEXÃO, EM TRÊS VOCABULÁRIOS.
 *
 * A coluna `businessInterests` voltou a ser gravada pela CHAVE do setor
 * (`shared/setores.ts`, a MESMA fonte que a tela de cadastro usa para desenhar
 * as caixinhas): o valor precisa ser igual em qualquer idioma, senão duas
 * usuárias com o mesmo interesse declarado em línguas diferentes nunca se
 * cruzam. O Dashboard, porém, só conhecia o vocabulário antigo — sinônimos de
 * `lib/interesses.ts` e as chaves de opção do onboarding — e desenhava a chave
 * CRUA no cartão: quem marcou "Construção Civil" no cadastro via `construcao`.
 *
 * O que fica travado aqui, nos três formatos que convivem na mesma coluna:
 *   1. chave de setor nova ("construcao")            → "Construção Civil";
 *   2. chave antiga em inglês ("technology", "tech") → rótulo de interesse;
 *   3. rótulo traduzido já gravado ("Financeiro &    → passa intacto, como
 *      Fintechs", gravado por engano em 14–15/09)       está no banco.
 * E, em inglês, a chave nova sai traduzida — ela não é texto, é chave.
 */

const duble = vi.hoisted(() => {
  const respostas: Record<string, { data?: unknown; isLoading?: boolean; isError?: boolean; error?: unknown }> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const procedimento = (caminho: string) => ({
    useQuery: (_input: unknown, opcoes?: { select?: (dados: never) => unknown }) => {
      const resultado = { data: undefined as unknown, isLoading: false, isPending: false, isError: false, error: null as unknown, refetch: vi.fn(), ...(respostas[caminho] ?? {}) };
      if (opcoes?.select && resultado.data !== undefined) resultado.data = opcoes.select(resultado.data as never);
      return resultado;
    },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, data: undefined }),
  });
  const utils = new Proxy({}, {
    get: (_, r) => ignorar(r) ? undefined : new Proxy({}, {
      get: (_, p) => ignorar(p) ? undefined : new Proxy({}, { get: (_, m) => ignorar(m) ? undefined : vi.fn(async () => undefined) }),
    }),
  });
  const trpc = new Proxy({}, {
    get: (_, router) => {
      if (ignorar(router)) return undefined;
      if (router === "useUtils") return () => utils;
      return new Proxy({}, { get: (_, proc) => ignorar(proc) ? undefined : procedimento(`${String(router)}.${String(proc)}`) });
    },
  });
  return { respostas, trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null, GlobalMenu: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/SmartMatchConsent", () => ({ SmartMatchConsent: () => null }));

/** Uma sugestão anônima, no formato que `matches.list` devolve. */
function sugestao(businessInterests: string[]) {
  return {
    matchId: 1, overallScore: 60, userSeen: true,
    specialtyScore: 90, objectivesScore: 80, incomeScore: 70, locationScore: 60, valuesScore: 50,
    aiInsight: null, city: "Lisboa", country: "PT", primarySpecialty: null,
    seekingTypes: [], businessInterests, values: [], sector: null,
    connectionId: null, connectionStatus: null, souDestinataria: null, displayName: null,
  };
}

function comInteresses(businessInterests: string[]) {
  duble.respostas["matches.list"] = { data: [sugestao(businessInterests)] };
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana", city: "Lisboa", profileCompleteness: 80 } } };
  duble.respostas["consent.status"] = { data: { accepted: true, document: null } };
  duble.respostas["connections.list"] = { data: [] };
  duble.respostas["matching.getRecommendedOpportunities"] = { data: [] };
  duble.respostas["dealRoom.listRooms"] = { data: [] };
  duble.respostas["notifications.list"] = { data: [] };
  comInteresses([]);
});

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("interesses de negócio no cartão: chave nova, chave antiga e rótulo", () => {
  it("a chave de setor gravada pelo cadastro sai com o rótulo do cadastro, não crua", () => {
    comInteresses(["construcao"]);
    render(<Dashboard />);

    expect(screen.getByText("Construção Civil")).toBeInTheDocument();
    // A trava do defeito: a chave não pode aparecer em lugar nenhum da tela.
    expect(document.body.innerHTML).not.toContain("construcao");
  });

  it("chaves de setor sem sinônimo no vocabulário antigo — todas traduzidas", () => {
    comInteresses(["logistica", "sustentabilidade", "juridico"]);
    render(<Dashboard />);

    expect(screen.getByText("Logística & Transporte")).toBeInTheDocument();
    expect(screen.getByText("Sustentabilidade & ESG")).toBeInTheDocument();
    expect(screen.getByText("Jurídico")).toBeInTheDocument();
    for (const chave of ["logistica", "sustentabilidade", "juridico"]) {
      expect(document.body.innerHTML, chave).not.toContain(chave);
    }
  });

  it("chave nova em inglês: é chave, não texto — sai no idioma da tela", async () => {
    comInteresses(["construcao", "varejo"]);
    await i18n.changeLanguage("en");
    render(<Dashboard />);

    expect(screen.getByText("Construction")).toBeInTheDocument();
    expect(screen.getByText("Retail & Consumer")).toBeInTheDocument();
    expect(screen.queryByText("Construção Civil")).toBeNull();
  });

  it("o dado antigo continua legível: chave em inglês traduzida, rótulo gravado intacto", () => {
    // "tech" e "alimentos" são do vocabulário antigo (sinônimos de
    // lib/interesses.ts); "Financeiro & Fintechs" é o RÓTULO que o cadastro
    // gravou por engano e que ninguém migrou — some se a tela tentar tratá-lo
    // como chave.
    comInteresses(["tech", "alimentos", "Financeiro & Fintechs"]);
    render(<Dashboard />);

    expect(screen.getByText("Tecnologia")).toBeInTheDocument();
    expect(screen.getByText("Alimentos & Bebidas")).toBeInTheDocument();
    expect(screen.getByText("Financeiro & Fintechs")).toBeInTheDocument();
  });

  it("os dois formatos no mesmo cartão: chave nova e dado antigo lado a lado", () => {
    comInteresses(["construcao", "Financeiro & Fintechs"]);
    render(<Dashboard />);

    expect(screen.getByText("Construção Civil")).toBeInTheDocument();
    expect(screen.getByText("Financeiro & Fintechs")).toBeInTheDocument();
  });
});
