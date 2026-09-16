import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * Governança (spec da Glenda de 14/09/2026, itens 1 e 12): as quantidades de
 * Membros Bronze, Prata e Ouro saíram da Home e aparecem SÓ no Dashboard, com
 * dados reais.
 *
 *  1. Os números vêm de `stats.membrosPorNivel` (consulta de quem está logada);
 *     trocar a resposta muda a tela: nada cravado.
 *  2. Ficam na seção "A rede hoje", com o mesmo cartão dos outros indicadores.
 *  3. Consulta que falhou vira traço, não zero.
 *
 * O dublê do tRPC é o mesmo de Dashboard.indicadores-da-plataforma.test.tsx.
 */

type Resposta = { data?: unknown; isLoading?: boolean; isError?: boolean; error?: unknown };

const duble = vi.hoisted(() => {
  const respostas: Record<string, Resposta> = {};
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
    get: (_, router) => ignorar(router) ? undefined : new Proxy({}, {
      get: (_, proc) => ignorar(proc) ? undefined : new Proxy({}, {
        get: (_, metodo) => ignorar(metodo) ? undefined : vi.fn(async () => undefined),
      }),
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
// A seção está escondida em produção desde 16/09 (MOSTRAR_NUMEROS_DA_REDE, pedido do
// Rosber). Este arquivo guarda o comportamento dela LIGADA, para quando voltar;
// o estado desligado está em Dashboard.numeros-da-rede-escondidos.test.tsx.
vi.mock("@/lib/numeros-da-rede", () => ({ MOSTRAR_NUMEROS_DA_REDE: true }));

const ESPERA = { timeout: 3000 };

/** Números que não colidem com nenhum outro cartão da tela. */
const NIVEIS = { bronze: 13, silver: 58, gold: 9 };

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "bronze" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana", profileCompleteness: 40 } } };
  duble.respostas["matches.list"] = { data: [] };
  duble.respostas["connections.list"] = { data: [] };
  duble.respostas["consent.status"] = { data: { accepted: true, document: null } };
  duble.respostas["stats.platform"] = { data: { users: 80, opportunities: 21, connections: 34, countries: 6 } };
  duble.respostas["stats.membrosPorNivel"] = { data: NIVEIS };
});

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

/** O cartão de um rótulo: o número mora no mesmo bloco que o rótulo. */
const cartao = (rotulo: string) => screen.getByText(rotulo).parentElement as HTMLElement;

describe("membros Bronze, Prata e Ouro no Dashboard", () => {
  it("mostra os três níveis com os números de stats.membrosPorNivel", async () => {
    render(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Membros por nível" }, ESPERA)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(cartao("Membros Bronze")).getByText("13")).toBeInTheDocument();
      expect(within(cartao("Membros Prata")).getByText("58")).toBeInTheDocument();
      expect(within(cartao("Membros Ouro")).getByText("9")).toBeInTheDocument();
    }, ESPERA);
  });

  it("outra resposta, outros números: o dado é dinâmico", async () => {
    duble.respostas["stats.membrosPorNivel"] = { data: { bronze: 101, silver: 202, gold: 3 } };
    render(<Dashboard />);

    await waitFor(() => {
      expect(within(cartao("Membros Bronze")).getByText("101")).toBeInTheDocument();
      expect(within(cartao("Membros Prata")).getByText("202")).toBeInTheDocument();
    }, ESPERA);
    expect(screen.queryByText("58")).not.toBeInTheDocument();
  });

  it("consulta que falhou vira traço nos três, sem apagar os indicadores da plataforma", async () => {
    duble.respostas["stats.membrosPorNivel"] = { isError: true, error: new Error("queda") };
    render(<Dashboard />);

    await waitFor(() => {
      for (const rotulo of ["Membros Bronze", "Membros Prata", "Membros Ouro"]) {
        expect(within(cartao(rotulo)).getByText("—"), rotulo).toBeInTheDocument();
      }
    }, ESPERA);
    await waitFor(() => expect(screen.getByText("80")).toBeInTheDocument(), ESPERA);
  });

  it("os rótulos acompanham o idioma", async () => {
    await i18n.changeLanguage("en");
    render(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Members by level" }, ESPERA)).toBeInTheDocument();
    expect(screen.getByText("Silver Members")).toBeInTheDocument();
    expect(screen.queryByText("Membros Prata")).not.toBeInTheDocument();
  });
});
