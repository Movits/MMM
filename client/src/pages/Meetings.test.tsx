import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Meetings from "./Meetings";

/**
 * Etapa 3 — a tela de Reuniões (reverificação de 04/09), em duas frentes.
 *
 * Erro de consulta: a lista falhando virava "Nenhuma reunião registrada" com
 * as reuniões intactas no banco, e o detalhe falhando virava um spinner
 * eterno (isLoading false, data undefined → o ramo do spinner nunca saía).
 *
 * Detalhe da reunião: "Excluir" apagava áudio, transcrição, traduções e
 * sugestões com um clique, sem confirmação, num botão colado ao selo de
 * status; e a caixa de falha renderizava o que viesse em processing_error —
 * inclusive o código ERRO_INTERROMPIDO da varredura de reuniões presas. Em
 * processamento o botão continua vivo (o servidor compensa o que gravaria;
 * desabilitá-lo deixava uma reunião morta pelo deploy presa E inexcluível),
 * e o modal avisa que o trabalho em curso será descartado.
 *
 * O tRPC vira um dublê no molde de EnrichmentChat.test.tsx: cada useMutation
 * registra o `mutate` (e as opções) para o teste conferir se o servidor foi
 * chamado e disparar o onError. O AppHeader (menu global, sino, idioma) fica
 * de fora porque não é o que se prova aqui.
 */

type Opcoes = { onSuccess?: (data: unknown, vars: unknown) => void; onError?: (erro: unknown, vars: unknown) => void };

// vi.mock é içado para o topo do arquivo; o que as fábricas usam precisa
// nascer em vi.hoisted, senão é lido antes de existir.
const duble = vi.hoisted(() => {
  const mutacoes: Record<string, { opcoes: Opcoes; mutate: ReturnType<typeof vi.fn> }> = {};
  const registrar = (nome: string) => ({
    useMutation: (opcoes: Opcoes = {}) => {
      const m = (mutacoes[nome] ??= { opcoes, mutate: vi.fn() });
      m.opcoes = opcoes;
      return { mutate: m.mutate, mutateAsync: vi.fn(), isPending: false };
    },
  });
  return {
    mutacoes,
    registrar,
    list: vi.fn(),
    get: vi.fn(),
    utils: { meetings: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// O header lê sessão e notificações pelo tRPC real; não é o que está em teste.
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => duble.utils,
    meetings: {
      list: { useQuery: (...args: unknown[]) => duble.list(...args) },
      get: { useQuery: (...args: unknown[]) => duble.get(...args) },
      create: duble.registrar("create"),
      submitRecording: duble.registrar("submitRecording"),
      decideEntity: duble.registrar("decideEntity"),
      decideContactSuggestion: duble.registrar("decideContactSuggestion"),
      translateTranscript: duble.registrar("translateTranscript"),
      delete: duble.registrar("delete"),
    },
  },
}));

beforeEach(() => {
  for (const m of Object.values(duble.mutacoes)) m.mutate.mockReset();
});

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

const REUNIAO = {
  id: "8b1f6a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", ownerId: "dona", title: "Reunião com a vinícola",
  status: "ready", processingError: null as string | null, createdAt: Date.UTC(2026, 8, 4, 12), updatedAt: Date.UTC(2026, 8, 4, 12),
};

/** Monta a lista com uma reunião e abre o detalhe dela. */
function abrirDetalhe(reuniao: Partial<typeof REUNIAO> = {}) {
  const meeting = { ...REUNIAO, ...reuniao };
  duble.list.mockReturnValue({ data: [meeting], isLoading: false });
  duble.get.mockReturnValue({
    data: { meeting, transcript: null, entities: [], suggestions: [], recording: null, recordingExpired: false },
    isLoading: false,
  });
  render(<Meetings />);
  fireEvent.click(screen.getByRole("button", { name: /Reunião com a vinícola/ }));
  return meeting;
}

const botaoExcluir = () => screen.getByRole("button", { name: /^Excluir$/ });
const tituloDoModal = () => screen.queryByText("Excluir esta reunião?");
const botaoConfirmar = () => screen.getByRole("button", { name: "Excluir reunião" });

describe("Detalhe da reunião — excluir pede confirmação", () => {
  it("clicar em Excluir abre o modal e NÃO chama o servidor", () => {
    abrirDetalhe();

    expect(tituloDoModal()).not.toBeInTheDocument();
    fireEvent.click(botaoExcluir());

    expect(tituloDoModal()).toBeInTheDocument();
    // o texto nomeia tudo que some
    expect(screen.getByText(/áudio, a transcrição, as traduções e as sugestões de contato/)).toBeInTheDocument();
    expect(duble.mutacoes.delete.mutate).not.toHaveBeenCalled();
  });

  it("confirmar no modal é o único caminho até delete.mutate, com o id da reunião", () => {
    const meeting = abrirDetalhe();
    fireEvent.click(botaoExcluir());

    fireEvent.click(botaoConfirmar());

    expect(duble.mutacoes.delete.mutate).toHaveBeenCalledTimes(1);
    expect(duble.mutacoes.delete.mutate).toHaveBeenCalledWith({ meetingId: meeting.id });
  });

  it("Cancelar fecha o modal sem excluir", () => {
    abrirDetalhe();
    fireEvent.click(botaoExcluir());

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(tituloDoModal()).not.toBeInTheDocument();
    expect(duble.mutacoes.delete.mutate).not.toHaveBeenCalled();
  });

  it("o servidor recusou a exclusão: o modal fecha e a dona lê o motivo no toast — não fica num modal preso com a reunião ainda lá", () => {
    const meeting = abrirDetalhe();
    fireEvent.click(botaoExcluir());
    fireEvent.click(botaoConfirmar());
    expect(tituloDoModal()).toBeInTheDocument();

    act(() => { duble.mutacoes.delete.opcoes.onError?.(new Error("x"), { meetingId: meeting.id }); });

    expect(tituloDoModal()).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("x");
    // a reunião continua aberta: o detalhe não foi trocado pela lista
    expect(screen.getByRole("button", { name: /^Excluir$/ })).toBeInTheDocument();
  });
});

describe("Detalhe da reunião — em processamento", () => {
  const aviso = () => screen.queryByText(/ainda está em processamento/);

  it("Excluir continua habilitado; o modal acrescenta o aviso de que o processamento em curso será descartado, e confirmar exclui", () => {
    const meeting = abrirDetalhe({ status: "processing" });

    const botao = botaoExcluir();
    expect(botao).toBeEnabled();
    fireEvent.click(botao);

    expect(tituloDoModal()).toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
    expect(duble.mutacoes.delete.mutate).not.toHaveBeenCalled();

    fireEvent.click(botaoConfirmar());
    expect(duble.mutacoes.delete.mutate).toHaveBeenCalledWith({ meetingId: meeting.id });
  });

  it("pronta, o modal não traz o aviso", () => {
    abrirDetalhe({ status: "ready" });
    fireEvent.click(botaoExcluir());
    expect(tituloDoModal()).toBeInTheDocument();
    expect(aviso()).not.toBeInTheDocument();
  });
});

describe("Detalhe da reunião — a falha é explicada no idioma da dona", () => {
  it("o código ERRO_INTERROMPIDO aparece traduzido, nunca cru", () => {
    abrirDetalhe({ status: "failed", processingError: "ERRO_INTERROMPIDO" });

    expect(screen.getByText(/O processamento foi interrompido antes de terminar/)).toBeInTheDocument();
    expect(screen.queryByText(/ERRO_INTERROMPIDO/)).not.toBeInTheDocument();
  });

  it("outra mensagem de falha aparece como veio: o servidor já a escreveu para a dona", () => {
    abrirDetalhe({ status: "failed", processingError: "Arquivo de áudio inválido." });
    expect(screen.getByText("Arquivo de áudio inválido.")).toBeInTheDocument();
  });

  it("sem mensagem, a caixa usa o texto de reserva", () => {
    abrirDetalhe({ status: "failed", processingError: null });
    expect(screen.getByText(/O processamento não foi concluído/)).toBeInTheDocument();
  });
});
