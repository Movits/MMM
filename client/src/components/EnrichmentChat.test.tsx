import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnrichmentChat } from "./EnrichmentChat";

/**
 * Etapa 4 — o cartão de sugestão e a confirmação pendente.
 *
 * A auditoria de 04/09 achou o cartão se escondendo ANTES de o servidor
 * responder: se a confirmação falhava, sobrava um chat sem cartão, sem campo
 * de digitar e com o aviso "Confirme ou ignore..." apontando para nada. E ao
 * fechar e reabrir o contato, o cartão pendente não voltava.
 *
 * O tRPC vira um dublê: cada useMutation registra as opções (onSuccess/onError)
 * para o teste "responder pelo servidor" na hora que quiser.
 */

type Vars = Record<string, unknown>;
type Opcoes = { onSuccess?: (data: unknown, vars: Vars) => void; onError?: (erro: unknown, vars: Vars) => void };

// vi.mock é içado para o topo do arquivo; o que as fábricas usam precisa
// nascer em vi.hoisted, senão é lido antes de existir.
const duble = vi.hoisted(() => {
  const mutacoes: Record<string, { opcoes: Opcoes; mutate: ReturnType<typeof vi.fn> }> = {};
  const registrar = (nome: string) => ({
    useMutation: (opcoes: Opcoes) => {
      const m = (mutacoes[nome] ??= { opcoes, mutate: vi.fn() });
      m.opcoes = opcoes;
      return { mutate: m.mutate, isPending: false };
    },
  });
  return {
    mutacoes,
    registrar,
    getActiveSession: vi.fn(),
    getMessages: vi.fn(),
    utils: {
      enrichment: {
        getActiveSession: { invalidate: vi.fn() },
        getMessages: { fetch: vi.fn(), invalidate: vi.fn() },
        getHistory: { invalidate: vi.fn() },
      },
      network: {
        get: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
        assetsNeeds: { invalidate: vi.fn() },
      },
    },
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => duble.utils,
    enrichment: {
      getActiveSession: { useQuery: (...args: unknown[]) => duble.getActiveSession(...args) },
      getMessages: { useQuery: (...args: unknown[]) => duble.getMessages(...args) },
      startSession: duble.registrar("startSession"),
      sendMessage: duble.registrar("sendMessage"),
      confirmSuggestion: duble.registrar("confirmSuggestion"),
      ignoreSuggestion: duble.registrar("ignoreSuggestion"),
      completeSession: duble.registrar("completeSession"),
    },
  },
}));

const pergunta = { id: "m1", role: "assistant", content: "Qual é o telefone dele/dela?", suggestions: [] };
const resposta = { id: "m2", role: "user", content: "11 99999-8888", suggestions: [] };
const cartao = { id: "sug-1", fieldType: "phone", suggestedValue: "11 99999-8888", confidence: 0.9, status: "pending" as const };
const pedidoDeConfirmacao = { id: "m3", role: "assistant", content: "Confirma: 11 99999-8888?", suggestions: [cartao] };

// O dublê entrega as mensagens como um refetch já concluído (isFetchedAfterMount):
// é o único dado do qual a tela hidrata — cache da abertura anterior não vale.
function montar(mensagens: unknown[], frescas = true) {
  duble.getActiveSession.mockReturnValue({ data: { id: "sessao-1", status: "active" }, isLoading: false });
  duble.getMessages.mockReturnValue({ data: mensagens, isFetchedAfterMount: frescas });
  return render(<EnrichmentChat contactId={42} contactName="Ana" />);
}

const botaoConfirmar = () => screen.queryByRole("button", { name: /^confirmar$/i });
const botaoIgnorar = () => screen.queryByRole("button", { name: /^ignorar$/i });
const campoDeResposta = () => screen.queryByPlaceholderText("Responda aqui...");
const aviso = () => screen.queryByText(/confirme ou ignore/i);

const erroGenerico = { message: "Erro de rede", data: { code: "INTERNAL_SERVER_ERROR" } };
const proximaPergunta = { success: true, status: "applied", nextQuestion: "Em qual empresa trabalha?", nextMessageId: "m4", sessionComplete: false, pendentesRestantes: 0 };

beforeEach(() => {
  for (const m of Object.values(duble.mutacoes)) m.mutate.mockReset();
  duble.utils.enrichment.getMessages.fetch.mockReset();
  duble.utils.enrichment.getMessages.invalidate.mockReset();
  duble.utils.enrichment.getHistory.invalidate.mockReset();
  duble.utils.network.get.invalidate.mockReset();
  duble.utils.network.list.invalidate.mockReset();
  duble.utils.network.assetsNeeds.invalidate.mockReset();
  vi.mocked(toast.info).mockReset();
});

describe("EnrichmentChat — cartão pendente", () => {
  it("ao reabrir o contato, o cartão pendente volta e a digitação fica travada até a decisão", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);

    // Mutante "map descarta as sugestões": nada disto apareceria.
    expect(botaoConfirmar()).toBeInTheDocument();
    expect(screen.getByText(/telefone/i, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("90% confiança")).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
  });

  it("o cartão só sai da tela quando o servidor confirma; em erro, fica, avisa e deixa tentar de novo", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const confirmar = duble.mutacoes.confirmSuggestion;

    fireEvent.click(botaoConfirmar()!);
    expect(confirmar.mutate).toHaveBeenCalledWith({ suggestionId: "sug-1", editedValue: undefined });
    // Mutante "esconder antes da resposta": o cartão já teria sumido aqui.
    expect(botaoConfirmar()).toBeInTheDocument();

    act(() => confirmar.opcoes.onError?.(erroGenerico, { suggestionId: "sug-1" }));
    // Mutante "não restaurar no erro": sem cartão, sem campo e com o aviso apontando para nada.
    expect(botaoConfirmar()).toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Erro ao salvar informação.");

    // A trava anti-duplo-clique foi liberada: dá para tentar de novo.
    fireEvent.click(botaoConfirmar()!);
    expect(confirmar.mutate).toHaveBeenCalledTimes(2);

    act(() => confirmar.opcoes.onSuccess?.(proximaPergunta, { suggestionId: "sug-1" }));
    expect(botaoConfirmar()).not.toBeInTheDocument();
    expect(screen.getByText("Em qual empresa trabalha?")).toBeInTheDocument();
    expect(campoDeResposta()).toBeInTheDocument();
    expect(aviso()).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Informação salva no perfil!");
  });

  it("quando o servidor explica o motivo (BAD_REQUEST), o aviso mostra a frase dele", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const confirmar = duble.mutacoes.confirmSuggestion;
    const motivo = "Valor muito longo para este campo: no máximo 50 caracteres.";

    fireEvent.click(botaoConfirmar()!);
    act(() => confirmar.opcoes.onError?.({ message: motivo, data: { code: "BAD_REQUEST" } }, { suggestionId: "sug-1" }));

    expect(toast.error).toHaveBeenCalledWith(motivo);
    expect(botaoConfirmar()).toBeInTheDocument();
  });

  it("editar e salvar manda o valor editado e também mantém o cartão até a resposta", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const confirmar = duble.mutacoes.confirmSuggestion;

    fireEvent.click(screen.getByRole("button", { name: /editar/i }));
    const campoDeEdicao = screen.getByDisplayValue("11 99999-8888");
    fireEvent.change(campoDeEdicao, { target: { value: "11 98888-7777" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar edição/i }));

    expect(confirmar.mutate).toHaveBeenCalledWith({ suggestionId: "sug-1", editedValue: "11 98888-7777" });
    expect(screen.getByDisplayValue("11 98888-7777")).toBeInTheDocument();

    act(() => confirmar.opcoes.onError?.(erroGenerico, { suggestionId: "sug-1" }));
    expect(screen.getByDisplayValue("11 98888-7777")).toBeInTheDocument();
  });

  it("ignorar segue a mesma regra: fica em erro, some no sucesso", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const ignorar = duble.mutacoes.ignoreSuggestion;

    fireEvent.click(botaoIgnorar()!);
    expect(ignorar.mutate).toHaveBeenCalledWith({ suggestionId: "sug-1" });
    expect(botaoIgnorar()).toBeInTheDocument();

    act(() => ignorar.opcoes.onError?.(erroGenerico, { suggestionId: "sug-1" }));
    expect(botaoIgnorar()).toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Erro ao ignorar informação.");

    act(() => ignorar.opcoes.onSuccess?.({ ...proximaPergunta, status: "ignored" }, { suggestionId: "sug-1" }));
    expect(botaoIgnorar()).not.toBeInTheDocument();
    expect(campoDeResposta()).toBeInTheDocument();
  });

  it("se o servidor recusar a resposta por pendência, a conversa é recarregada com o cartão", async () => {
    // Tela desatualizada: não sabe do cartão que existe no servidor.
    montar([pergunta]);
    duble.utils.enrichment.getMessages.fetch.mockResolvedValue([pergunta, resposta, pedidoDeConfirmacao]);
    const enviar = duble.mutacoes.sendMessage;

    const campo = campoDeResposta()!;
    fireEvent.change(campo, { target: { value: "11 99999-8888" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(enviar.mutate).toHaveBeenCalledWith({ sessionId: "sessao-1", contactId: 42, content: "11 99999-8888" });

    await act(async () => {
      enviar.opcoes.onError?.({ message: "SUGGESTION_PENDING", data: { code: "CONFLICT" } }, {});
    });

    expect(duble.utils.enrichment.getMessages.fetch).toHaveBeenCalledWith({ sessionId: "sessao-1", limit: 50 });
    expect(botaoConfirmar()).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(toast.info).toHaveBeenCalled();
    // Não é "não consegui processar": a resposta foi recusada de propósito.
    expect(screen.queryByText(/não consegui processar/i)).not.toBeInTheDocument();
  });
});

describe("EnrichmentChat — IA indisponível", () => {
  it("o aviso aparece, o texto volta ao campo para reenviar, o balão fica e a conversa NÃO é reidratada sem ele", () => {
    // Do lado do servidor, a resposta da usuária não é gravada nesse ramo (é o
    // que evita a duplicata ao reenviar). A revisão da PR-C achou o outro lado:
    // a tela invalidava getMessages, a hidratação apagava o balão dela e o
    // campo já estava vazio — a resposta sumia sem ela ter como reenviar.
    montar([pergunta]);
    const enviar = duble.mutacoes.sendMessage;
    const texto = "11 99999-8888, ramal 12";

    const campo = campoDeResposta()!;
    fireEvent.change(campo, { target: { value: texto } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(enviar.mutate).toHaveBeenCalledWith({ sessionId: "sessao-1", contactId: 42, content: texto });
    expect((campoDeResposta() as HTMLInputElement).value).toBe("");

    const aviso = "O assistente de IA está indisponível neste momento, então sua resposta ainda não foi processada. Tente de novo em instantes.";
    act(() => enviar.opcoes.onSuccess?.(
      { messageId: "m2", aiResponse: aviso, suggestions: [], sessionComplete: false, completionSummary: null, awaitingConfirmation: false, aiUnavailable: true },
      { sessionId: "sessao-1", contactId: 42, content: texto },
    ));

    expect(screen.getByText(/indisponível neste momento/)).toBeInTheDocument();
    // Mutante "tratar como resposta comum": o campo ficaria vazio e o
    // getMessages invalidado (a reidratação apaga o balão da usuária).
    expect((campoDeResposta() as HTMLInputElement).value).toBe(texto);
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(duble.utils.enrichment.getMessages.invalidate).not.toHaveBeenCalled();
    // Nada foi gravado no contato: não há perfil, lista ou histórico a refazer.
    expect(duble.utils.network.get.invalidate).not.toHaveBeenCalled();
    expect(duble.utils.enrichment.getHistory.invalidate).not.toHaveBeenCalled();
  });
});

describe("EnrichmentChat — reabrir o contato não pode hidratar do cache velho", () => {
  it("dado que ainda é o cache da abertura anterior (isFetchedAfterMount=false) não hidrata: espera o servidor", () => {
    // Cache velho com um cartão que, no servidor, já foi decidido. Hidratar dele
    // trancava a tela: cartão indecidível + "Erro ao salvar informação." em loop.
    montar([pergunta, resposta, pedidoDeConfirmacao], false);

    expect(botaoConfirmar()).not.toBeInTheDocument();
    expect(aviso()).not.toBeInTheDocument();
    expect(screen.getByText(/iniciando conversa/i)).toBeInTheDocument();
  });

  it("gravar resposta, confirmar ou ignorar invalida o getMessages, para o cache acompanhar o servidor", () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const invalidar = duble.utils.enrichment.getMessages.invalidate;

    act(() => duble.mutacoes.confirmSuggestion.opcoes.onSuccess?.(proximaPergunta, { suggestionId: "sug-1" }));
    expect(invalidar).toHaveBeenCalledTimes(1);

    act(() => duble.mutacoes.ignoreSuggestion.opcoes.onSuccess?.({ ...proximaPergunta, status: "ignored" }, { suggestionId: "sug-1" }));
    expect(invalidar).toHaveBeenCalledTimes(2);

    act(() => duble.mutacoes.sendMessage.opcoes.onSuccess?.(
      { messageId: "m5", aiResponse: "Confirma: Acme?", suggestions: [], sessionComplete: false, awaitingConfirmation: true }, {},
    ));
    expect(invalidar).toHaveBeenCalledTimes(3);
  });

  it("confirmar, ignorar e responder refazem o perfil aberto, a lista, o Histórico IA e possui/procura", () => {
    // A reverificação de 04/09: o telefone confirmado não aparecia no perfil
    // nem na lista, e o badge do Histórico IA não mudava — a usuária concluía
    // que não salvou e digitava de novo. Tudo isso lê do cache do React Query.
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const { enrichment, network } = duble.utils;

    act(() => duble.mutacoes.confirmSuggestion.opcoes.onSuccess?.(proximaPergunta, { suggestionId: "sug-1" }));
    expect(network.get.invalidate).toHaveBeenCalledWith({ id: 42 });
    expect(network.list.invalidate).toHaveBeenCalledTimes(1);
    expect(enrichment.getHistory.invalidate).toHaveBeenCalledWith({ contactId: 42 });
    expect(network.assetsNeeds.invalidate).toHaveBeenCalledWith({ contactId: 42 });

    act(() => duble.mutacoes.ignoreSuggestion.opcoes.onSuccess?.({ ...proximaPergunta, status: "ignored" }, { suggestionId: "sug-1" }));
    act(() => duble.mutacoes.sendMessage.opcoes.onSuccess?.(
      { messageId: "m5", aiResponse: "Confirma: Acme?", suggestions: [], sessionComplete: false, awaitingConfirmation: true }, {},
    ));
    expect(network.get.invalidate).toHaveBeenCalledTimes(3);
    expect(network.list.invalidate).toHaveBeenCalledTimes(3);
    expect(enrichment.getHistory.invalidate).toHaveBeenCalledTimes(3);
    expect(network.assetsNeeds.invalidate).toHaveBeenCalledTimes(3);
  });

  it("cartão que o servidor diz já decidido (NOT_FOUND) não fica preso: a conversa é recarregada", async () => {
    montar([pergunta, resposta, pedidoDeConfirmacao]);
    const proxima = { id: "m4", role: "assistant", content: "Em qual empresa trabalha?", suggestions: [] };
    duble.utils.enrichment.getMessages.fetch.mockResolvedValue([pergunta, resposta, { ...pedidoDeConfirmacao, suggestions: [] }, proxima]);

    fireEvent.click(botaoConfirmar()!);
    await act(async () => {
      duble.mutacoes.confirmSuggestion.opcoes.onError?.({ message: "SUGGESTION_NOT_FOUND", data: { code: "NOT_FOUND" } }, { suggestionId: "sug-1" });
    });

    // Mutante "tratar NOT_FOUND como erro comum": o cartão ficaria e o toast seria de erro.
    expect(duble.utils.enrichment.getMessages.fetch).toHaveBeenCalledWith({ sessionId: "sessao-1", limit: 50 });
    expect(botaoConfirmar()).not.toBeInTheDocument();
    expect(screen.getByText("Em qual empresa trabalha?")).toBeInTheDocument();
    expect(campoDeResposta()).toBeInTheDocument();
    expect(toast.info).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith("Erro ao salvar informação.");
  });
});

describe("EnrichmentChat — vários cartões na mesma pergunta (etapa de lista)", () => {
  // "O que essa pessoa pode oferecer?" convida uma lista; a IA devolve N itens
  // e cada um vira um cartão. A digitação só volta quando o servidor diz que
  // não sobrou nenhum (pendentesRestantes) — não quando UM foi decidido.
  const perguntaDeAtivos = { id: "m1", role: "assistant", content: "O que essa pessoa pode oferecer?", suggestions: [] };
  const respostaDeAtivos = { id: "m2", role: "user", content: "uma mina de lítio e uma fábrica de baterias", suggestions: [] };
  const mina = { id: "sug-mina", fieldType: "assets", suggestedValue: "mina de lítio", confidence: 0.9, status: "pending" as const };
  const fabrica = { id: "sug-fabrica", fieldType: "assets", suggestedValue: "fábrica de baterias", confidence: 0.9, status: "pending" as const };
  const pedidoComDois = { id: "m3", role: "assistant", content: "Confirma os dois itens?", suggestions: [mina, fabrica] };
  const perguntaSeguinte = { success: true, status: "applied", nextQuestion: "O que ela está procurando?", nextMessageId: "m4", sessionComplete: false, pendentesRestantes: 0 };
  const botoesConfirmar = () => screen.getAllByRole("button", { name: /^confirmar$/i });

  it("ao reabrir com dois pendentes, os dois voltam e a digitação fica travada", () => {
    montar([perguntaDeAtivos, respostaDeAtivos, pedidoComDois]);

    expect(botoesConfirmar()).toHaveLength(2);
    expect(screen.getByText("mina de lítio")).toBeInTheDocument();
    expect(screen.getByText("fábrica de baterias")).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
  });

  it("confirmar o 1º mantém o 2º e o aviso; confirmar o 2º libera o campo com a próxima pergunta", () => {
    montar([perguntaDeAtivos, respostaDeAtivos, pedidoComDois]);
    const confirmar = duble.mutacoes.confirmSuggestion;

    fireEvent.click(botoesConfirmar()[0]);
    expect(confirmar.mutate).toHaveBeenCalledWith({ suggestionId: "sug-mina", editedValue: undefined });
    act(() => confirmar.opcoes.onSuccess?.(
      { success: true, status: "applied", nextQuestion: null, sessionComplete: false, pendentesRestantes: 1 }, { suggestionId: "sug-mina" },
    ));

    // Mutante "setAwaitingConfirmation(false) no sucesso": o campo voltaria com a fábrica ainda pendente.
    expect(botoesConfirmar()).toHaveLength(1);
    expect(screen.queryByText("mina de lítio")).not.toBeInTheDocument();
    expect(screen.getByText("fábrica de baterias")).toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();

    // O cartão restante continua clicável (a decisão anterior já voltou).
    fireEvent.click(botoesConfirmar()[0]);
    expect(confirmar.mutate).toHaveBeenCalledWith({ suggestionId: "sug-fabrica", editedValue: undefined });
    act(() => confirmar.opcoes.onSuccess?.(perguntaSeguinte, { suggestionId: "sug-fabrica" }));

    expect(botaoConfirmar()).not.toBeInTheDocument();
    expect(screen.getByText("O que ela está procurando?")).toBeInTheDocument();
    expect(campoDeResposta()).toBeInTheDocument();
    expect(aviso()).not.toBeInTheDocument();
  });

  it("ignorar um com o outro pendente também não libera o campo", () => {
    montar([perguntaDeAtivos, respostaDeAtivos, pedidoComDois]);
    const ignorar = duble.mutacoes.ignoreSuggestion;

    fireEvent.click(screen.getAllByRole("button", { name: /^ignorar$/i })[1]);
    act(() => ignorar.opcoes.onSuccess?.(
      { success: true, status: "ignored", nextQuestion: null, sessionComplete: false, pendentesRestantes: 1 }, { suggestionId: "sug-fabrica" },
    ));

    expect(botoesConfirmar()).toHaveLength(1);
    expect(screen.getByText("mina de lítio")).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
  });
});
