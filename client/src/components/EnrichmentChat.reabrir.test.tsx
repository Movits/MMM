import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";
import { EnrichmentChat } from "./EnrichmentChat";

/**
 * Etapa 4 — fechar e reabrir o detalhe do contato em menos de 5 minutos.
 *
 * A reverificação de 04/09 pegou uma regressão da PR #64: o React Query
 * entrega primeiro o cache da abertura anterior (main.tsx cria
 * `new QueryClient()`: staleTime 0, gcTime 5 min) e a tela hidratava dele.
 * Resultado: ou o cartão pendente não voltava, ou um cartão JÁ DECIDIDO
 * voltava como pendente e trancava o chat ("Erro ao salvar informação." em
 * loop, sem campo de digitar) até recarregar a página.
 *
 * Aqui o React Query e os hooks do tRPC são os de verdade; só a rede é um
 * link falso sobre um servidor em memória que imita o router: getMessages
 * anexa o cartão pendente da etapa atual, sendMessage recusa com CONFLICT se
 * há pendente, confirmar/ignorar respondem NOT_FOUND se a sugestão não está
 * mais pendente. Fechar o contato desmonta o chat (Network.tsx:
 * `viewContact && <ContactDetail>`); reabrir remonta com o MESMO QueryClient.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ETAPAS = [
  { fieldType: "phone", question: "Qual é o telefone dele/dela?" },
  { fieldType: "company", question: "Em qual empresa trabalha?" },
  { fieldType: "job_title", question: "Qual é o cargo?" },
];

type Sug = { id: string; messageId: string; fieldType: string; suggestedValue: string; status: string; createdAt: number };
type Msg = { id: string; sessionId: string; ownerId: string; role: "assistant" | "user"; content: string; metadata: null; tokenCount: null; createdAt: number; updatedAt: number };

function erro(code: string, message: string) {
  return new TRPCClientError(message, { result: { error: { message, code: -32000, data: { code, httpStatus: 400, path: "" } } } } as never);
}

function novoServidor() {
  let seq = 0;
  let agora = 1000;
  const msg = (role: Msg["role"], content: string): Msg => ({
    id: `m${++seq}`, sessionId: "sessao-1", ownerId: "dona", role, content, metadata: null, tokenCount: null, createdAt: ++agora, updatedAt: agora,
  });
  const estado = { etapa: 0, status: "active", msgs: [msg("assistant", ETAPAS[0].question)], sugs: [] as Sug[], chamadas: [] as string[] };
  const etapaAtual = () => ETAPAS[estado.etapa] ?? null;
  const pendenteDaEtapa = () => {
    const e = etapaAtual();
    return e ? estado.sugs.filter(s => s.status === "pending" && s.fieldType === e.fieldType).sort((a, b) => b.createdAt - a.createdAt)[0] : undefined;
  };
  const avancar = () => {
    estado.etapa++;
    const e = etapaAtual();
    if (!e) { estado.status = "completed"; return null; }
    const m = msg("assistant", e.question);
    estado.msgs.push(m);
    return m;
  };
  // Como routers/enrichment.ts: decide, e só avança se a sugestão é da etapa atual.
  const decidir = (suggestionId: string, novoStatus: "applied" | "ignored") => {
    const s = estado.sugs.find(x => x.id === suggestionId);
    if (!s || s.status !== "pending") throw erro("NOT_FOUND", "SUGGESTION_NOT_FOUND");
    s.status = novoStatus;
    const e = etapaAtual();
    if (!e || s.fieldType !== e.fieldType) return { success: true, status: novoStatus, nextQuestion: null, sessionComplete: false };
    const m = avancar();
    return m
      ? { success: true, status: novoStatus, nextQuestion: m.content, nextMessageId: m.id, sessionComplete: false }
      : { success: true, status: novoStatus, nextQuestion: null, sessionComplete: true };
  };

  const responder = async (path: string, input: unknown) => {
    estado.chamadas.push(path);
    await new Promise(r => setTimeout(r, 10)); // latência de rede: o cache chega antes
    switch (path) {
      case "enrichment.getActiveSession":
        return { id: "sessao-1", ownerId: "dona", contactId: 42, status: estado.status, questionsAnswered: estado.etapa, questionsSkipped: 0, summary: null };
      case "enrichment.getMessages": {
        const cartao = estado.status === "active" ? pendenteDaEtapa() : undefined;
        return estado.msgs.slice(-(input as { limit: number }).limit).map(m => ({
          ...m,
          suggestions: cartao && cartao.messageId === m.id
            ? [{ id: cartao.id, fieldType: cartao.fieldType, suggestedValue: cartao.suggestedValue, confidence: 0.9, status: "pending" }]
            : [],
        }));
      }
      case "enrichment.sendMessage": {
        const e = etapaAtual()!;
        if (pendenteDaEtapa()) throw erro("CONFLICT", "SUGGESTION_PENDING");
        const { content } = input as { content: string };
        estado.msgs.push(msg("user", content));
        const ia = msg("assistant", `Confirma: ${content}?`);
        estado.msgs.push(ia);
        const s: Sug = { id: `sug${++seq}`, messageId: ia.id, fieldType: e.fieldType, suggestedValue: content, status: "pending", createdAt: ia.createdAt };
        estado.sugs.push(s);
        return {
          messageId: ia.id, aiResponse: ia.content,
          suggestions: [{ id: s.id, fieldType: s.fieldType, suggestedValue: s.suggestedValue, confidence: 0.9, status: "pending" }],
          sessionComplete: false, completionSummary: null, awaitingConfirmation: true,
        };
      }
      case "enrichment.confirmSuggestion": return decidir((input as { suggestionId: string }).suggestionId, "applied");
      case "enrichment.ignoreSuggestion": return decidir((input as { suggestionId: string }).suggestionId, "ignored");
      default: throw new Error("rota não simulada: " + path);
    }
  };
  return { estado, responder, decidir };
}

function linkFalso(responder: (path: string, input: unknown) => Promise<unknown>): TRPCLink<never> {
  return () => ({ op }) => observable(observer => {
    let ativo = true;
    responder(op.path, op.input).then(
      data => { if (!ativo) return; observer.next({ result: { type: "data", data } } as never); observer.complete(); },
      err => { if (!ativo) return; observer.error(err instanceof TRPCClientError ? err : TRPCClientError.from(err as Error)); },
    );
    return () => { ativo = false; };
  });
}

function novaTela() {
  const srv = novoServidor();
  const qc = new QueryClient(); // igual a client/src/main.tsx: sem staleTime
  const client = trpc.createClient({ links: [linkFalso(srv.responder) as never] });
  const abrir = () => render(
    <trpc.Provider client={client} queryClient={qc}>
      <QueryClientProvider client={qc}>
        <EnrichmentChat contactId={42} contactName="Ana" />
      </QueryClientProvider>
    </trpc.Provider>,
  );
  // Espera o refetch do getMessages disparado pela remontagem chegar. Antes de
  // contar, deixa assentar o que ainda está em voo (a invalidação da última
  // mutação): a remontagem se encosta nesse pedido em vez de abrir outro.
  const esperarRefetch = async () => {
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    const antes = srv.estado.chamadas.filter(c => c === "enrichment.getMessages").length;
    return async () => {
      await waitFor(() => expect(srv.estado.chamadas.filter(c => c === "enrichment.getMessages").length).toBeGreaterThan(antes));
      await waitFor(() => expect(qc.isFetching()).toBe(0));
    };
  };
  // Responde como a usuária: espera a conversa aparecer (hidratada, nada em
  // voo) e só então digita. O campo já existe antes da 1ª hidratação; quem
  // digita nesse instante vê a hidratação velha chegar depois da resposta.
  const responder = async (texto: string) => {
    await waitFor(() => {
      expect(screen.queryByText(/iniciando conversa/i)).not.toBeInTheDocument();
      expect(qc.isFetching()).toBe(0);
    });
    const campo = await screen.findByPlaceholderText("Responda aqui...");
    fireEvent.change(campo, { target: { value: texto } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await screen.findByRole("button", { name: /^confirmar$/i });
  };
  return { srv, qc, abrir, esperarRefetch, responder };
}

const botaoConfirmar = () => screen.queryByRole("button", { name: /^confirmar$/i });
const campoDeResposta = () => screen.queryByPlaceholderText("Responda aqui...");
const aviso = () => screen.queryByText(/confirme ou ignore/i);

describe("EnrichmentChat — fechar e reabrir o contato em menos de 5 minutos", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("responder, fechar e reabrir: o cartão pendente volta e a digitação fica travada", async () => {
    const t = novaTela();
    const tela1 = t.abrir();
    await t.responder("11 99999-8888");
    expect(campoDeResposta()).not.toBeInTheDocument();
    tela1.unmount();

    const esperar = await t.esperarRefetch();
    t.abrir();
    await esperar();

    // Mutante "hidratar só quando messages.length === 0": o cache velho (só a
    // 1ª pergunta) ganhava e o refetch com o cartão era descartado.
    expect(await screen.findByRole("button", { name: /^confirmar$/i })).toBeInTheDocument();
    expect(screen.getByText("Confirma: 11 99999-8888?")).toBeInTheDocument();
    expect(campoDeResposta()).not.toBeInTheDocument();
    expect(aviso()).toBeInTheDocument();
  });

  it("confirmar, fechar e reabrir: o cartão já decidido NÃO volta e dá para responder a próxima pergunta", async () => {
    const t = novaTela();
    const tela1 = t.abrir();
    await t.responder("11 99999-8888");
    tela1.unmount();

    // 2ª abertura: cache agora tem o cartão; confirma e fecha.
    let esperar = await t.esperarRefetch();
    const tela2 = t.abrir();
    await esperar();
    fireEvent.click(await screen.findByRole("button", { name: /^confirmar$/i }));
    await screen.findByText("Em qual empresa trabalha?");
    expect(t.srv.estado.sugs[0].status).toBe("applied");
    tela2.unmount();

    // 3ª abertura: antes do conserto, o cartão aplicado voltava do cache como
    // pendente, o campo sumia e Confirmar dava "Erro ao salvar" para sempre.
    esperar = await t.esperarRefetch();
    t.abrir();
    await esperar();

    // A pergunta seguinte só entra pela hidratação do dado fresco.
    expect(await screen.findByText("Em qual empresa trabalha?")).toBeInTheDocument();
    expect(botaoConfirmar()).not.toBeInTheDocument();
    expect(aviso()).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    // E a conversa segue de onde o servidor está.
    await t.responder("Acme");
    expect(t.srv.estado.sugs.at(-1)?.fieldType).toBe("company");
  });

  it("cartão decidido em outra aba: clicar não tranca — a conversa é atualizada pelo servidor", async () => {
    const t = novaTela();
    const tela1 = t.abrir();
    await t.responder("11 99999-8888");
    // Outra aba confirma no servidor; esta tela ainda mostra o cartão.
    t.srv.decidir(t.srv.estado.sugs[0].id, "applied");

    fireEvent.click(botaoConfirmar()!);
    await waitFor(() => expect(botaoConfirmar()).not.toBeInTheDocument());
    expect(screen.getByText("Em qual empresa trabalha?")).toBeInTheDocument();
    expect(campoDeResposta()).toBeInTheDocument();
    expect(toast.info).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    tela1.unmount();
  });
});
