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

function montar(mensagens: unknown[]) {
  duble.getActiveSession.mockReturnValue({ data: { id: "sessao-1", status: "active" }, isLoading: false });
  duble.getMessages.mockReturnValue({ data: mensagens });
  return render(<EnrichmentChat contactId={42} contactName="Ana" />);
}

const botaoConfirmar = () => screen.queryByRole("button", { name: /^confirmar$/i });
const botaoIgnorar = () => screen.queryByRole("button", { name: /^ignorar$/i });
const campoDeResposta = () => screen.queryByPlaceholderText("Responda aqui...");
const aviso = () => screen.queryByText(/confirme ou ignore/i);

const erroGenerico = { message: "Erro de rede", data: { code: "INTERNAL_SERVER_ERROR" } };
const proximaPergunta = { success: true, status: "applied", nextQuestion: "Em qual empresa trabalha?", nextMessageId: "m4", sessionComplete: false };

beforeEach(() => {
  for (const m of Object.values(duble.mutacoes)) m.mutate.mockReset();
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
