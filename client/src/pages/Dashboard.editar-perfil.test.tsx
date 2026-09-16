import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * "EDITAR PERFIL" LEVA AO PERFIL, NÃO AO CADASTRO.
 *
 * O botão apontava para /onboarding. Quem já tinha conta e clicava nele era
 * obrigada a refazer as oito etapas do cadastro e, na última, a aceitar o Termo
 * Geral de Uso — que conta antiga NÃO precisa aceitar (a trava do servidor vale
 * para quem não concluiu o cadastro). Pior: sem versão do termo publicada, ela
 * ficava presa na última etapa sem conseguir salvar nada, como o próprio
 * docs/deploy.md avisava.
 *
 * É a janela B da revisão do Nicolas na #135. Quem ainda NÃO tem perfil segue
 * indo para /onboarding, e isso também está travado aqui.
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



/** O perfil já existe: é o caso de quem clica em "Editar perfil". */
function comPerfil() {
  duble.respostas["profile.get"] = {
    data: { profile: { displayName: "Ana", city: "Lisboa", profileCompleteness: 80, bio: "Exporto vinho." } },
  };
}

/**
 * A troca de aba tem animação: `switchTab` só monta a nova 180 ms depois. Sem
 * esperar, o teste procuraria o botão numa aba que ainda nem existe.
 */
async function irParaAAbaPerfil() {
  fireEvent.click(screen.getByRole("button", { name: /Meu Perfil/i }));
  await screen.findByRole("button", { name: /Editar perfil|Criar/i }, { timeout: 2000 });
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  comPerfil();
  duble.respostas["consent.status"] = { data: { accepted: true, document: null } };
  duble.respostas["connections.list"] = { data: [] };
  duble.respostas["matches.list"] = { data: [] };
  duble.respostas["matching.getRecommendedOpportunities"] = { data: [] };
  duble.respostas["dealRoom.listRooms"] = { data: [] };
  duble.respostas["notifications.list"] = { data: [] };
});

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("aba Perfil do Dashboard", () => {
  it("quem já tem perfil vai para /profile, não para o cadastro", async () => {
    render(<Dashboard />);
    await irParaAAbaPerfil();

    const botao = screen.getByRole("button", { name: /Editar perfil/i });
    const link = botao.closest("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("quem ainda não tem perfil continua indo para o cadastro", async () => {
    duble.respostas["profile.get"] = { data: { profile: null } };
    render(<Dashboard />);
    await irParaAAbaPerfil();

    const botao = screen.getByRole("button", { name: /Criar/i });
    expect(botao.closest("a")).toHaveAttribute("href", "/onboarding");
  });
});
