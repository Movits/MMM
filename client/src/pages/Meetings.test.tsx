import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
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

type Opcoes = { onSuccess?: (data: unknown, vars: unknown) => void; onError?: (erro: unknown, vars: unknown) => void; onSettled?: () => void };

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
    utils: { meetings: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn(), setData: vi.fn() } } },
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
      reprocess: duble.registrar("reprocess"),
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
type Detalhe = { transcript: unknown; suggestions: unknown[]; recording: unknown; recordingExpired: boolean };
function abrirDetalhe(reuniao: Partial<typeof REUNIAO> = {}, detalhe: Partial<Detalhe> = {}) {
  const meeting = { ...REUNIAO, ...reuniao };
  duble.list.mockReturnValue({ data: [meeting], isLoading: false });
  duble.get.mockReturnValue({
    data: { meeting, transcript: null, entities: [], suggestions: [], recording: null, recordingExpired: false, ...detalhe },
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

const DIA = 24 * 60 * 60 * 1000;
const gravacao = (expiraEm: number) => ({ url: "/manus-storage/meetings/dona/r/rec.webm", mimeType: "audio/webm", durationSeconds: 95, sizeBytes: 2048, expiresAt: expiraEm });
const botaoReprocessar = () => screen.queryByRole("button", { name: /Reprocessar/ });
const sugestaoPendente = { id: "s1", fullName: "Ana Souza", jobTitle: null, company: null, email: null, status: "pending" };

describe("Gravação — envio que falha", () => {
  it("a lista é relida quando o envio falha: a reunião 'failed' aparece ao voltar, e com ela o Reprocessar", () => {
    duble.list.mockReturnValue({ data: [], isLoading: false });
    render(<Meetings />);
    act(() => { duble.mutacoes.submitRecording.opcoes.onError?.({ message: "O limite de uso gratuito do serviço de IA foi atingido." }, {}); });
    expect(toast.error).toHaveBeenCalledWith("O limite de uso gratuito do serviço de IA foi atingido.");
    expect(duble.utils.meetings.list.invalidate).toHaveBeenCalled();
  });
});

describe("Detalhe da reunião — reprocessar a reunião que falhou", () => {
  it("com áudio guardado: a dica diz até quando ele fica e que o resultado anterior é substituído, e o botão pede o reprocessamento com o id", () => {
    const meeting = abrirDetalhe({ status: "failed", processingError: "Não foi possível transcrever o áudio." }, { recording: gravacao(Date.now() + 20 * DIA) });
    expect(screen.getByText(/continua guardado até .*substitui a transcrição/)).toBeInTheDocument();
    fireEvent.click(botaoReprocessar()!);
    expect(duble.mutacoes.reprocess.mutate).toHaveBeenCalledWith({ meetingId: meeting.id });
  });

  it("sem áudio guardado: nenhum botão, e o texto manda gravar ou enviar de novo", () => {
    abrirDetalhe({ status: "failed", processingError: "Arquivo de áudio inválido." });
    expect(botaoReprocessar()).not.toBeInTheDocument();
    expect(screen.getByText(/não está guardado, então não há o que reprocessar/)).toBeInTheDocument();
  });

  it("áudio que vence em menos de 15 minutos: nenhum botão, e o texto não finge que o áudio sumiu", () => {
    abrirDetalhe({ status: "failed" }, { recording: gravacao(Date.now() + 10 * 60 * 1000) });
    expect(botaoReprocessar()).not.toBeInTheDocument();
    expect(screen.getByText(/Não é possível reprocessar esta reunião/)).toBeInTheDocument();
    expect(screen.queryByText(/não está guardado/)).not.toBeInTheDocument();
  });

  it.each(["ready", "processing"])("reunião %s não oferece reprocessar", status => {
    abrirDetalhe({ status }, { recording: gravacao(Date.now() + 20 * DIA) });
    expect(botaoReprocessar()).not.toBeInTheDocument();
  });

  it.each([
    ["CONFLICT", /não está com falha ou já está sendo processada/],
    ["PRECONDITION_FAILED", /Não é possível reprocessar esta reunião/],
    ["TOO_MANY_REQUESTS", /Muitas tentativas de reprocessar/],
    ["INTERNAL_SERVER_ERROR", /Não foi possível reprocessar a reunião/],
  ])("recusa %s vira a frase traduzida, não a mensagem crua do servidor", (code, frase) => {
    abrirDetalhe({ status: "failed" }, { recording: gravacao(Date.now() + 20 * DIA) });
    act(() => { duble.mutacoes.reprocess.opcoes.onError?.({ message: "mensagem do servidor", data: { code } }, { meetingId: REUNIAO.id }); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(frase));
    expect(toast.error).not.toHaveBeenCalledWith("mensagem do servidor");
  });

  it("pedido aceito: a tela vira 'processing' na hora, sem esperar a releitura", () => {
    abrirDetalhe({ status: "failed" }, { recording: gravacao(Date.now() + 20 * DIA) });
    act(() => { duble.mutacoes.reprocess.opcoes.onSuccess?.({ status: "processing" }, { meetingId: REUNIAO.id }); });
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Reprocessamento iniciado/));
    expect(duble.utils.meetings.get.setData).toHaveBeenCalledTimes(1);
    const [chave, atualizar] = duble.utils.meetings.get.setData.mock.calls[0] as [unknown, (anterior: unknown) => { meeting: Record<string, unknown> } | undefined];
    expect(chave).toEqual({ meetingId: REUNIAO.id });
    expect(atualizar({ meeting: { ...REUNIAO, status: "failed", processingError: "x" } })?.meeting).toMatchObject({ status: "processing", processingError: null });
    expect(atualizar(undefined)).toBeUndefined();
  });

  it("o áudio sumiu do bucket: o motivo sai traduzido, sem a dica de 'continua guardado' e sem o botão", () => {
    abrirDetalhe({ status: "failed", processingError: "O áudio guardado desta reunião não foi encontrado." }, { recording: gravacao(Date.now() + 20 * DIA) });
    expect(botaoReprocessar()).not.toBeInTheDocument();
    expect(screen.queryByText(/continua guardado até/)).not.toBeInTheDocument();
    expect(screen.getByText(/Não é possível reprocessar esta reunião/)).toBeInTheDocument();
  });

  it("…e em inglês o motivo aparece traduzido, não em português", async () => {
    await i18n.changeLanguage("en");
    try {
      abrirDetalhe({ status: "failed", processingError: "O áudio guardado desta reunião não foi encontrado." }, { recording: gravacao(Date.now() + 20 * DIA) });
      expect(screen.getByText("This meeting's stored audio was not found.")).toBeInTheDocument();
      expect(screen.queryByText("O áudio guardado desta reunião não foi encontrado.")).not.toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("pt-BR");
    }
  });

  it("aceito ou recusado, a tela relê a reunião e a lista", () => {
    abrirDetalhe({ status: "failed" }, { recording: gravacao(Date.now() + 20 * DIA) });
    act(() => { duble.mutacoes.reprocess.opcoes.onSettled?.(); });
    expect(duble.utils.meetings.get.invalidate).toHaveBeenCalledWith({ meetingId: REUNIAO.id });
    expect(duble.utils.meetings.list.invalidate).toHaveBeenCalled();
  });

  it("sem transcrição e com o áudio vencido: não diz que 'a transcrição continua aqui' nem que houve gravação apagada", () => {
    abrirDetalhe({ status: "failed" }, { recordingExpired: true });
    expect(screen.queryByText(/A transcrição continua aqui/)).not.toBeInTheDocument();
    expect(screen.queryByText(/foi apagada/)).not.toBeInTheDocument();
    expect(screen.getByText(/O áudio fica guardado por no máximo 30 dias/)).toBeInTheDocument();
  });
});

describe("Detalhe da reunião — enquanto processa", () => {
  const abaContatos = () => screen.getByRole("button", { name: /Contatos/ });

  it("mostra a faixa de processamento e pausa as decisões sobre as sugestões da tentativa anterior", () => {
    abrirDetalhe({ status: "processing" }, { suggestions: [sugestaoPendente] });
    expect(screen.getByRole("status")).toHaveTextContent("Transcrevendo e analisando a reunião");
    fireEvent.click(abaContatos());
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Criar contato/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Disponível quando o processamento terminar/)).toBeInTheDocument();
  });

  it("com a reunião pronta, as decisões voltam", () => {
    abrirDetalhe({ status: "ready" }, { suggestions: [sugestaoPendente] });
    fireEvent.click(abaContatos());
    expect(screen.getByRole("button", { name: /Criar contato/ })).toBeInTheDocument();
  });

  it("detalhe e lista só consultam sozinhos enquanto há reunião processando", () => {
    abrirDetalhe({ status: "failed" });
    const detalhe = duble.get.mock.calls[0][1] as { refetchInterval: (consulta: unknown) => number | false };
    expect(detalhe.refetchInterval({ state: { data: { meeting: { status: "processing" } } } })).toBe(5000);
    expect(detalhe.refetchInterval({ state: { data: { meeting: { status: "failed" } } } })).toBe(false);
    expect(detalhe.refetchInterval({ state: { data: undefined } })).toBe(false);
    const lista = duble.list.mock.calls[0][1] as { refetchInterval: (consulta: unknown) => number | false };
    expect(lista.refetchInterval({ state: { data: [{ status: "ready" }, { status: "processing" }] } })).toBe(10000);
    expect(lista.refetchInterval({ state: { data: [{ status: "ready" }] } })).toBe(false);
  });

  it.each([
    ["ready", "success", "Reunião processada. Revise a transcrição e as sugestões."],
    ["failed", "error", "Não foi possível processar a reunião."],
  ] as const)("quando o processamento termina em %s, a tela avisa", (fim, tipo, frase) => {
    const meeting = { ...REUNIAO, status: "processing" };
    const detalheCom = (status: string) => ({
      data: { meeting: { ...meeting, status }, transcript: null, entities: [], suggestions: [], recording: null, recordingExpired: false },
      isLoading: false,
    });
    duble.list.mockReturnValue({ data: [meeting], isLoading: false });
    duble.get.mockReturnValue(detalheCom("processing"));
    const { rerender } = render(<Meetings />);
    fireEvent.click(screen.getByRole("button", { name: /Reunião com a vinícola/ }));
    expect(toast[tipo]).not.toHaveBeenCalled();

    duble.get.mockReturnValue(detalheCom(fim));
    rerender(<Meetings />);

    expect(toast[tipo]).toHaveBeenCalledWith(frase);
  });

  it.each(["ready", "failed"])("abrir uma reunião %s não dispara aviso de término: só a troca a partir de 'processing' avisa", status => {
    abrirDetalhe({ status });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("na lista, uma consulta periódica que falha não troca as reuniões pela tela de erro", () => {
    duble.list.mockReturnValue({
      data: [{ ...REUNIAO, status: "processing" }], isLoading: false, isError: true,
      error: { message: MENSAGEM, data: { code: "INTERNAL_SERVER_ERROR" } }, refetch: vi.fn(),
    });
    render(<Meetings />);
    expect(screen.getByRole("button", { name: /Reunião com a vinícola/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reunião excluída em outro lugar (NOT_FOUND) enquanto processava: a tela diz que não existe e para de consultar e de tentar", () => {
    const meeting = { ...REUNIAO, status: "processing" };
    duble.list.mockReturnValue({ data: [meeting], isLoading: false });
    duble.get.mockReturnValue({
      data: { meeting, transcript: null, entities: [], suggestions: [], recording: null, recordingExpired: false },
      isLoading: false, isError: true, error: { message: "Reunião não encontrada.", data: { code: "NOT_FOUND" } }, refetch: vi.fn(),
    });
    render(<Meetings />);
    fireEvent.click(screen.getByRole("button", { name: /Reunião com a vinícola/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reunião não encontrada.");
    expect(screen.queryByText(/Transcrevendo e analisando/)).not.toBeInTheDocument();

    const opcoes = duble.get.mock.calls[0][1] as { refetchInterval: (consulta: unknown) => number | false; retry: (tentativas: number, erro: unknown) => boolean };
    const naoEncontrada = { data: { code: "NOT_FOUND" } };
    expect(opcoes.refetchInterval({ state: { data: { meeting: { status: "processing" } }, error: naoEncontrada } })).toBe(false);
    expect(opcoes.retry(0, naoEncontrada)).toBe(false);
    expect(opcoes.retry(0, { data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(true);
    expect(opcoes.retry(3, { data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
  });

  it("uma consulta periódica que falha não troca a reunião pela tela de erro", () => {
    const meeting = { ...REUNIAO, status: "processing" };
    duble.list.mockReturnValue({ data: [meeting], isLoading: false });
    duble.get.mockReturnValue({
      data: { meeting, transcript: null, entities: [], suggestions: [], recording: null, recordingExpired: false },
      isLoading: false, isError: true, error: { message: MENSAGEM, data: { code: "INTERNAL_SERVER_ERROR" } }, refetch: vi.fn(),
    });
    render(<Meetings />);
    fireEvent.click(screen.getByRole("button", { name: /Reunião com a vinícola/ }));
    expect(screen.getByRole("heading", { name: "Reunião com a vinícola" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("em processamento, a transcrição da tentativa anterior não é mandada traduzir", async () => {
    await i18n.changeLanguage("en");
    try {
      abrirDetalhe({ status: "processing" }, { transcript: { id: "t1", transcript: "Fala da reunião.", language: "pt" } });
      expect(duble.mutacoes.translateTranscript.mutate).not.toHaveBeenCalled();
    } finally {
      await i18n.changeLanguage("pt-BR");
    }
  });

  it("…e com a reunião pronta, a tradução automática segue como antes", async () => {
    await i18n.changeLanguage("en");
    try {
      abrirDetalhe({ status: "ready" }, { transcript: { id: "t1", transcript: "Fala da reunião.", language: "pt" } });
      expect(duble.mutacoes.translateTranscript.mutate).toHaveBeenCalledWith({ meetingId: REUNIAO.id, language: "en" }, expect.anything());
      // A resposta é aplicada pelo callback do próprio pedido, que só vale para o
      // último; no hook não há onSuccess que aplique uma resposta atrasada.
      const [, opcoesDoPedido] = duble.mutacoes.translateTranscript.mutate.mock.calls[0] as [unknown, { onSuccess?: unknown }];
      expect(opcoesDoPedido.onSuccess).toBeInstanceOf(Function);
      expect(duble.mutacoes.translateTranscript.opcoes.onSuccess).toBeUndefined();
    } finally {
      await i18n.changeLanguage("pt-BR");
    }
  });
});
