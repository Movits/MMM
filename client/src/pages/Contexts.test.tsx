import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Contexts from "./Contexts";

/**
 * Etapa 5 — a tela Meus Contextos (revisão da PR-A):
 *
 * A. Excluir o único contexto da última página deixava a consulta presa numa
 *    página que não existe mais, sem paginação para voltar.
 * B. Consulta da lista falhando virava "Nenhum contexto ainda" com convite
 *    para registrar o primeiro encontro.
 * C. Detalhe falhando (contexts.get) sumia em silêncio (`if (!data) return
 *    null`) e o card clicado parecia morto.
 *
 * O tRPC vira um dublê (molde: Network.test.tsx): a lista é uma função do
 * input; o detalhe, um dublê à parte. useAuth é dublê como em ProtectedRoute.
 */

type Opcoes = { onSuccess?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => unknown };

const duble = vi.hoisted(() => {
  const registrar = () => ({ useMutation: (_opcoes?: Opcoes) => ({ mutate: vi.fn(), isPending: false }) });
  return { registrar, list: vi.fn(), get: vi.fn(), refetchLista: vi.fn(), refetchDetalhe: vi.fn() };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    contexts: {
      listTypes: { useQuery: () => ({ data: [] }) },
      list: { useQuery: (...args: unknown[]) => duble.list(...args) },
      get: { useQuery: (...args: unknown[]) => duble.get(...args) },
      create: duble.registrar(),
      update: duble.registrar(),
      delete: duble.registrar(),
      linkContact: duble.registrar(),
      unlinkContact: duble.registrar(),
      addParticipant: duble.registrar(),
      uploadMedia: duble.registrar(),
      deleteMedia: duble.registrar(),
    },
    network: { list: { useQuery: () => ({ data: { data: [], total: 0 } }) } },
  },
}));

// Erro como o servidor devolve (envelope tRPC): é a mensagem dele que a tela mostra.
const MENSAGEM = "Banco de dados indisponível. Tente de novo em instantes.";
const erroDoServidor = { message: MENSAGEM, data: { code: "INTERNAL_SERVER_ERROR" } };

function contexto(n: number, nome = `Contexto ${n}`) {
  return { id: `ctx-${n}`, name: nome, isCustom: true, contactCount: 0, eventDate: null, city: null, country: null, notes: null };
}

type Resposta = { data?: { data: ReturnType<typeof contexto>[]; total: number }; isLoading?: boolean; isError?: boolean; error?: typeof erroDoServidor | null };
function servidorResponde(porPagina: (page: number) => Resposta) {
  duble.list.mockImplementation((input: { page: number }) => {
    const resposta = { data: undefined, isLoading: false, isError: false, error: null, refetch: duble.refetchLista, ...porPagina(input.page) };
    // Dublê SÍNCRONO: `data` é função pura de `page`, então a resposta é
    // sempre a que o servidor acabou de dar. Cache, resposta velha e modo
    // offline ficam em Contexts.paginacao-cache.test.tsx, com o React Query
    // de verdade.
    return { ...resposta, fetchStatus: resposta.isLoading ? "fetching" : "idle", isSuccess: !resposta.isLoading && !resposta.isError };
  });
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Dona", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.get.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: duble.refetchDetalhe });
});

describe("Meus Contextos — página que deixou de existir volta para a ÚLTIMA que existe", () => {
  it("41 contextos, o único da página 3 é excluído: a consulta seguinte pede a página 2 (não a 1) e 'Contexto 21' aparece", () => {
    const faixa = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => contexto(de + i));
    let excluido = false;
    servidorResponde(page => {
      if (page === 3) { excluido = true; return { data: { data: [], total: 40 } }; }
      const total = excluido ? 40 : 41;
      return page === 1 ? { data: { data: faixa(1, 20), total } } : { data: { data: faixa(21, 40), total } };
    });

    render(<Contexts />);
    fireEvent.click(screen.getByRole("button", { name: "Próxima →" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima →" }));

    const ultimaConsulta = duble.list.mock.calls.at(-1)?.[0] as { page: number };
    expect(ultimaConsulta.page).toBe(2);
    expect(screen.getByText("Contexto 21")).toBeInTheDocument();
    expect(screen.queryByText("Contexto 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Nenhum contexto ainda")).not.toBeInTheDocument();
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
  });
});

describe("Meus Contextos — erro de consulta não é 'nenhum contexto ainda'", () => {
  it("lista em erro: alerta com a mensagem do servidor, sem o estado vazio e sem contador", () => {
    servidorResponde(() => ({ isError: true, error: erroDoServidor }));
    render(<Contexts />);

    expect(screen.getByRole("alert")).toHaveTextContent("Algo inesperado aconteceu");
    expect(screen.getByText(MENSAGEM)).toBeInTheDocument();
    expect(screen.queryByText("Nenhum contexto ainda")).not.toBeInTheDocument();
    expect(screen.queryByText("Registrar primeiro encontro")).not.toBeInTheDocument();
    // O contador some: não há número a afirmar.
    expect(screen.queryByText("Nenhum contexto encontrado")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ contexto/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(duble.refetchLista).toHaveBeenCalledTimes(1);
  });

  it("detalhe em erro: o modal mostra o erro com 'tentar de novo' e um caminho de volta, em vez de sumir", () => {
    servidorResponde(() => ({ data: { data: [contexto(1, "CPHI 2024")], total: 1 } }));
    duble.get.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: erroDoServidor, refetch: duble.refetchDetalhe });
    render(<Contexts />);

    fireEvent.click(screen.getByText("CPHI 2024"));

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent(MENSAGEM);
    expect(document.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(duble.refetchDetalhe).toHaveBeenCalledTimes(1);

    // Voltar fecha o modal: a lista continua lá e o alerta vai embora.
    fireEvent.click(screen.getByRole("button", { name: /Contextos/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("CPHI 2024")).toBeInTheDocument();
  });
});
