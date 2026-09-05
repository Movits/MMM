import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Meetings from "./Meetings";

/**
 * Etapa 3 — erro de consulta na tela de Reuniões (reverificação de 04/09):
 * a lista falhando virava "Nenhuma reunião registrada" com as reuniões
 * intactas no banco, e o detalhe falhando virava um spinner eterno
 * (isLoading false, data undefined → o ramo do spinner nunca saía).
 *
 * O tRPC é um dublê; o AppHeader (menu global, sino, idioma) fica de fora
 * porque não é o que se prova aqui.
 */

type Opcoes = { onSuccess?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => unknown };

const duble = vi.hoisted(() => {
  const registrar = () => ({ useMutation: (_opcoes?: Opcoes) => ({ mutate: vi.fn(), isPending: false }) });
  return {
    registrar,
    list: vi.fn(),
    get: vi.fn(),
    utils: { meetings: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => duble.utils,
    meetings: {
      list: { useQuery: (...args: unknown[]) => duble.list(...args) },
      get: { useQuery: (...args: unknown[]) => duble.get(...args) },
      create: duble.registrar(),
      submitRecording: duble.registrar(),
      decideEntity: duble.registrar(),
      decideContactSuggestion: duble.registrar(),
      translateTranscript: duble.registrar(),
      delete: duble.registrar(),
    },
  },
}));

// Erro como o servidor devolve (envelope tRPC, com data.code): é a mensagem
// dele que a tela mostra. Sem o envelope, valeria o genérico traduzido.
const MENSAGEM = "Banco de dados indisponível. Tente de novo em instantes.";
const emErro = (refetch = vi.fn()) => ({ data: undefined, isLoading: false, isError: true, error: { message: MENSAGEM, data: { code: "INTERNAL_SERVER_ERROR" } }, refetch });
const reuniao = { id: "m1", title: "Reunião com a Ana", status: "ready", createdAt: 1_700_000_000_000 };

describe("Reuniões — erro de consulta não é 'nenhuma reunião'", () => {
  it("lista em erro: mensagem do servidor e botão de tentar de novo, sem o estado vazio", () => {
    const refetch = vi.fn();
    duble.list.mockReturnValue(emErro(refetch));
    render(<Meetings />);

    expect(screen.getByRole("alert")).toHaveTextContent("Algo inesperado aconteceu");
    expect(screen.getByText(MENSAGEM)).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma reunião registrada")).not.toBeInTheDocument();
    expect(screen.queryByText("Carregando reuniões…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("detalhe em erro: mensagem + voltar, em vez de spinner eterno", () => {
    duble.list.mockReturnValue({ data: [reuniao], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    const refetchDetalhe = vi.fn();
    duble.get.mockReturnValue(emErro(refetchDetalhe));
    render(<Meetings />);

    fireEvent.click(screen.getByText("Reunião com a Ana"));

    expect(screen.getByRole("alert")).toHaveTextContent(MENSAGEM);
    expect(document.querySelector(".animate-spin")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(refetchDetalhe).toHaveBeenCalledTimes(1);

    // Há caminho de volta: a lista reaparece.
    fireEvent.click(screen.getByRole("button", { name: /Todas as reuniões/ }));
    expect(screen.getByText("Reunião com a Ana")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
