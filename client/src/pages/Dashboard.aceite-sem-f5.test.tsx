import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * QUEM PEDIU VÊ O ACEITE SEM F5, E A CONEXÃO ACEITA TEM NOME.
 *
 * Dois achados do Nicolas (#136, validação das #108 e #110) que ficaram de fora
 * quando a entrega incorporou o resto daquela PR:
 *
 *   1. o aceite manda um aviso `interest_received` para quem pediu, mas o
 *      Dashboard não escutava nada disso: o cartão dela continuava anônimo até
 *      o F5, mesmo com o sino já mostrando o aviso;
 *   2. conexão ACEITA de quem não pôs apelido aparecia como "Membro da rede",
 *      embora o servidor já mandasse o nome da conta depois do aceite
 *      (`userName`, atrás do mesmo CASE WHEN de getConnectionsForUser).
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



const aviso = (id, type) => ({ id, type, title: "Aviso", body: null, actionUrl: "/dashboard", isRead: true, createdAt: new Date() });

const conexao = (extra) => ({
  id: 9, status: "accepted", souDestinataria: false, outraParteId: 5, primarySpecialty: "finance",
  city: "Porto", message: null, displayName: null, avatarUrl: null, userName: null, userCompany: null,
  createdAt: new Date(), ...extra,
});

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  });
  duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana", city: "Lisboa", profileCompleteness: 80 } } };
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

describe("quem pediu vê o aceite sem F5", () => {
  it("aviso de interesse NOVO relê conexões e matches; a primeira leitura e aviso de outro tipo, não", () => {
    const releConexoes = vi.fn();
    const releMatches = vi.fn();
    duble.respostas["connections.list"] = { data: [], refetch: releConexoes };
    duble.respostas["matches.list"] = { data: [], refetch: releMatches };
    duble.respostas["notifications.list"] = { data: [aviso(3, "interest_received")] };

    const { rerender } = render(<Dashboard />);
    // O aviso 3 já existia quando a página abriu: nada a reler.
    expect(releConexoes).not.toHaveBeenCalled();
    expect(releMatches).not.toHaveBeenCalled();

    duble.respostas["notifications.list"] = { data: [aviso(4, "gold_granted"), aviso(3, "interest_received")] };
    rerender(<Dashboard />);
    expect(releConexoes).not.toHaveBeenCalled();
    expect(releMatches).not.toHaveBeenCalled();

    // O aceite chega pelo sino.
    duble.respostas["notifications.list"] = { data: [aviso(5, "interest_received"), aviso(4, "gold_granted")] };
    rerender(<Dashboard />);
    expect(releConexoes).toHaveBeenCalledTimes(1);
    expect(releMatches).toHaveBeenCalledTimes(1);
  });
});

describe("aba Conexões — o nome depois do aceite", () => {
  it("aceita sem apelido mostra o nome da conta, e não 'Membro da rede'", async () => {
    duble.respostas["connections.list"] = {
      data: [conexao({ id: 9, userName: "Zuleica Andrade" }), conexao({ id: 10, userName: null })],
    };

    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: /^Conexões( \(\d+\))?$/ }));

    expect(await screen.findByText("Zuleica Andrade", {}, { timeout: 2000 })).toBeInTheDocument();
    // A que não tem nome nenhum continua anônima, como deve.
    expect(screen.getByText("Membro da rede")).toBeInTheDocument();
  });
});
