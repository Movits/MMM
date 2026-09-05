import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";
import Contexts from "./Contexts";

/**
 * Meus Contextos — a paginação com o React Query DE VERDADE.
 *
 * Contexts.tsx carrega a MESMA cópia do clamp de Network.tsx, e Contexts.test
 * carrega a mesma cegueira: o tRPC vira um dublê síncrono em que `data` é
 * função pura de `page`, então cache, resposta velha e pedido em voo não
 * existem para a suíte.
 *
 * O defeito (reverificação de 05/09, major 2): depois que a página 2 esvazia,
 * a entrada [["contexts","list"],{page:2,limit:20}] fica guardada com
 * {data: [], total: 20} por até 5 minutos. Com a lista de volta a 21, o
 * primeiro "Próxima →" lia esse total velho, o clamp disparava, e a tela
 * ficava em "Página 1 de 2" enquanto o servidor já tinha respondido a 2.
 *
 * Molde: client/src/components/EnrichmentChat.reabrir.test.tsx — React Query e
 * hooks do tRPC de verdade, só a rede é um link falso.
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Dona", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  }),
}));

const FOLGA = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

// O teste que derruba a rede mexe num singleton do React Query: sem isto, os
// testes seguintes ficariam offline junto.
afterEach(() => { onlineManager.setOnline(true); });

type Ctx = { id: string; name: string; isCustom: boolean; contactCount: number; eventDate: null; city: null; country: null; notes: null; ordem: number };

/** Servidor em memória: ordena, corta com LIMIT/OFFSET e devolve o total. */
function novoServidor() {
  const contexto = (n: number, nome: string, ordem: number): Ctx =>
    ({ id: `ctx-${n}`, name: nome, isCustom: true, contactCount: 0, eventDate: null, city: null, country: null, notes: null, ordem });
  const estado = {
    // O 1 é o mais recente (página 1); o 21 é o mais antigo e o único da página 2.
    contextos: Array.from({ length: 21 }, (_, i) => contexto(i + 1, `Contexto ${i + 1}`, 9_000_000 - i)),
    paginasPedidas: [] as number[],
    caido: false,
  };
  const responder = async (path: string, input: unknown) => {
    await new Promise(r => setTimeout(r, 10)); // latência: o cache chega antes da resposta
    switch (path) {
      case "contexts.list": {
        const { page = 1, limit = 20 } = (input ?? {}) as { page?: number; limit?: number };
        estado.paginasPedidas.push(page);
        // Espelha o zod do router (server/routers/contexts.ts:30,
        // `page: z.number().int().min(1)`): página abaixo de 1 é entrada
        // INVÁLIDA, não lista vazia — o servidor recusa com BAD_REQUEST.
        if (!Number.isInteger(page) || page < 1) throw new TRPCClientError("page: Number must be greater than or equal to 1");
        if (estado.caido) throw new TRPCClientError("Banco de dados indisponível. Tente de novo em instantes.");
        const ordenados = [...estado.contextos].sort((a, b) => b.ordem - a.ordem);
        return { data: ordenados.slice((page - 1) * limit, page * limit), total: estado.contextos.length };
      }
      // Só a LISTA cai: os tipos são outra consulta e não participam do defeito.
      case "contexts.listTypes": return [];
      default: throw new TRPCClientError("rota não simulada: " + path);
    }
  };
  /** Outra aba apaga um contexto — a página 2 fica sem nada. */
  const excluirEmOutraAba = (id: string) => { estado.contextos = estado.contextos.filter(c => c.id !== id); };
  /** Outra aba registra um contexto novo, e a página 2 volta a existir. */
  const cadastrarEmOutraAba = (nome: string) => { estado.contextos.push(contexto(99, nome, 1)); };
  /** Outra aba apaga a lista inteira: o total vai a 0 e não sobra página nenhuma. */
  const esvaziarEmOutraAba = () => { estado.contextos = []; };
  /** O servidor cai (banco fora do ar, 500): a lista passa a responder erro. */
  const derrubarServidor = () => { estado.caido = true; };
  return { estado, responder, excluirEmOutraAba, cadastrarEmOutraAba, esvaziarEmOutraAba, derrubarServidor };
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

const chaveDaPagina = (page: number) =>
  getQueryKey(trpc.contexts.list, { q: undefined, typeSlug: undefined, page, limit: 20 }, "query");

function novaTela(opcoesDoCliente?: ConstructorParameters<typeof QueryClient>[0]) {
  const srv = novoServidor();
  const qc = new QueryClient(opcoesDoCliente); // sem argumento: igual a client/src/main.tsx
  const client = trpc.createClient({ links: [linkFalso(srv.responder) as never] });
  const abrir = () => render(
    <trpc.Provider client={client} queryClient={qc}>
      <QueryClientProvider client={qc}><Contexts /></QueryClientProvider>
    </trpc.Provider>,
  );
  const assentar = async () => {
    await waitFor(() => expect(qc.isFetching()).toBe(0), FOLGA);
    await new Promise(r => setTimeout(r, 50));
    await waitFor(() => expect(qc.isFetching()).toBe(0), FOLGA);
  };
  return { srv, qc, abrir, assentar };
}

const indicador = () => (document.body.textContent ?? "").match(/Página \d+ de \d+/)?.[0] ?? "(sem paginação)";
const proxima = () => screen.getByRole("button", { name: "Próxima →" });
const anterior = () => screen.getByRole("button", { name: "← Anterior" });

describe("Meus Contextos — a página que esvaziou volta para a última que existe (com React Query de verdade)", () => {
  it("(c1) a página 2 fica sem nada: a tela volta para a 1, sem 'Nenhum contexto ainda'", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    fireEvent.click(proxima());
    await screen.findByText("Contexto 21", {}, FOLGA);

    // Outra aba apaga o único contexto da página 2 e esta tela relê.
    t.srv.excluirEmOutraAba("ctx-21");
    await t.qc.invalidateQueries({ queryKey: [["contexts", "list"]] });
    await screen.findByText("20 contexto", {}, FOLGA);
    await t.assentar();

    // Sem o clamp: "20 contexto" sobre "Nenhum contexto ainda", e a paginação
    // some (só aparece com total > 20) — sem caminho de volta.
    expect(screen.queryByText("Nenhum contexto ainda")).not.toBeInTheDocument();
    expect(screen.getByText("Contexto 1")).toBeInTheDocument();
    expect(t.srv.estado.paginasPedidas.at(-1)).toBe(1);
  });

  it("(c2) com a resposta velha da página 2 no cache e o servidor já em 21 contextos, o 1º 'Próxima →' leva e MANTÉM a tela na página 2", async () => {
    const t = novaTela();
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    t.srv.estado.paginasPedidas = [];

    fireEvent.click(proxima());

    await screen.findByText("Contexto 21", {}, FOLGA);
    await t.assentar();

    expect(indicador()).toBe("Página 2 de 2");
    expect(screen.queryByText("Contexto 1")).not.toBeInTheDocument();
    expect(t.srv.estado.paginasPedidas).not.toContain(1);
  });

  it("(c3) a história inteira numa tela só: a página 2 esvazia, outra aba registra um contexto, e 'Próxima →' volta a funcionar", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    fireEvent.click(proxima());
    await screen.findByText("Contexto 21", {}, FOLGA);

    t.srv.excluirEmOutraAba("ctx-21");
    await t.qc.invalidateQueries({ queryKey: [["contexts", "list"]] });
    await screen.findByText("20 contexto", {}, FOLGA);
    await t.assentar();
    expect(t.qc.getQueryData(chaveDaPagina(2) as never)).toEqual({ data: [], total: 20 });

    t.srv.cadastrarEmOutraAba("Encontro Novo");
    await t.qc.invalidateQueries({ queryKey: [["contexts", "list"]] });
    await screen.findByText("21 contexto", {}, FOLGA);
    await t.assentar();
    t.srv.estado.paginasPedidas = [];

    fireEvent.click(proxima());
    await screen.findByText("Encontro Novo", {}, FOLGA);
    await t.assentar();
    expect(indicador()).toBe("Página 2 de 2");
    expect(t.srv.estado.paginasPedidas).not.toContain(1);
  });

  it("(c4) SEM REDE, o total velho do cache não devolve a tela para a página 1 — e o '← Anterior' continua sendo a saída", async () => {
    const t = novaTela();
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    await t.assentar();

    // A rede cai ANTES do clique: o React Query não busca, marca a consulta
    // como "paused" e entrega o dado velho do cache. Ali `isFetching` é false
    // e `isSuccess` é true — daí a guarda perguntar `fetchStatus === "idle"`.
    onlineManager.setOnline(false);
    t.srv.estado.paginasPedidas = [];

    fireEvent.click(proxima());

    await screen.findByText("Nenhum contexto ainda", {}, FOLGA);
    await t.assentar();
    expect(indicador()).toBe("Página 2 de 2");
    expect(t.srv.estado.paginasPedidas).toEqual([]); // offline: nada saiu

    // Fora da página 1 a paginação aparece mesmo com o total velho em 20: com
    // o clamp parado, é o único caminho de volta.
    expect(anterior()).toBeEnabled();
    fireEvent.click(anterior());
    await screen.findByText("Contexto 1", {}, FOLGA); // o cache da página 1 ainda serve
  });

  it("(c5) o servidor CAI no clique: a tela fica na página 2 com o alerta, em vez de voltar calada para a 1", async () => {
    // `retry: false` só tira os backoffs do React Query; o que se observa é o
    // estado depois que o erro assentou.
    const t = novaTela({ defaultOptions: { queries: { retry: false } } });
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    await t.assentar();
    t.srv.estado.paginasPedidas = [];

    t.srv.derrubarServidor();
    fireEvent.click(proxima());

    // Sem a metade `isSuccess` da guarda, o clamp leria o total VELHO do cache
    // (20) depois que o erro assenta e devolveria a tela para a página 1, sem
    // erro visível — como se o clique não tivesse acontecido.
    await screen.findByRole("alert", {}, FOLGA);
    await t.assentar();
    expect(screen.getByRole("button", { name: "↻ Tentar novamente" })).toBeInTheDocument();
    expect(t.srv.estado.paginasPedidas).toEqual([2]);
  });

  it("(c6) a lista inteira esvazia estando na página 2: volta para a página 1 vazia, e nenhuma consulta sai com página 0", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contexto", {}, FOLGA);
    fireEvent.click(proxima());
    await screen.findByText("Contexto 21", {}, FOLGA);
    await t.assentar();

    // Outra aba apaga TODOS os contextos: o total vai a 0. A última página que
    // existe é a 1 — não a 0, que o router recusa
    // (server/routers/contexts.ts:30, `page: z.number().int().min(1)`). Sem o
    // piso `Math.max(1, …)` do clamp, "nenhum contexto" viraria erro.
    t.srv.esvaziarEmOutraAba();
    await t.qc.invalidateQueries({ queryKey: [["contexts", "list"]] });
    await screen.findByText("Nenhum contexto ainda", {}, FOLGA);
    await t.assentar();

    expect(t.srv.estado.paginasPedidas.filter(p => p < 1)).toEqual([]);
    expect(t.srv.estado.paginasPedidas.at(-1)).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Lista vazia na página 1 continua sem paginação.
    expect(indicador()).toBe("(sem paginação)");
  });
});
