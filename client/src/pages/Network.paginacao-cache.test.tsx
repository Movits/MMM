import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";
import Network from "./Network";

/**
 * Minha Rede — a paginação com o React Query DE VERDADE.
 *
 * Network.test.tsx troca o tRPC inteiro por um dublê síncrono em que `data` é
 * função pura de `page`. Com isso não existe cache, não existe resposta velha
 * e não existe pedido em voo: a suíte inteira era cega para o defeito que a
 * reverificação de 05/09 achou (major 2).
 *
 * O defeito: quando a página 2 esvazia, o clamp devolve a tela para a 1 — e a
 * entrada [["network","list"],{page:2,limit:20}] fica GUARDADA com
 * {data: [], total: 20} por até 5 minutos (client/src/main.tsx cria
 * `new QueryClient()`, sem staleTime e com o gcTime padrão). Se a rede voltar
 * a ter 21 contatos, o primeiro "Próxima →" recebe primeiro esse total velho,
 * o clamp dispara em cima dele e a tela volta sozinha para a página 1: o
 * clique some, e some de novo a cada tentativa, até o cache expirar.
 *
 * Por isso aqui o React Query e os hooks do tRPC são os de verdade; só a rede
 * é um link falso sobre um servidor em memória (molde:
 * client/src/components/EnrichmentChat.reabrir.test.tsx).
 */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, name: "Dona", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  }),
}));
// O chat de enriquecimento tem os próprios testes e não participa da paginação.
vi.mock("@/components/EnrichmentChat", () => ({ EnrichmentChat: () => null }));

// Cada espera tem folga: o link falso tem latência, e um teste encadeia várias.
const FOLGA = { timeout: 8_000 };
vi.setConfig({ testTimeout: 30_000 });

// Os testes que derrubam a rede mexem num singleton do React Query: sem isto,
// o primeiro deles deixaria os seguintes offline.
afterEach(() => { onlineManager.setOnline(true); });

type Contato = {
  id: number; fullName: string; photoUrl: null; cardImageUrl: null; jobTitle: null; company: null;
  country: null; state: null; city: null; phone: null; whatsapp: null; email: null; linkedinUrl: null;
  instagram: null; profileTags: null; notes: null; enrichmentStatus: null; nivelVisibilidade: string;
  createdAt: number; updatedAt: number;
};

/**
 * Servidor em memória. Imita listPrivateContacts de server/db.ts: ordena por
 * updatedAt decrescente, corta com LIMIT/OFFSET e devolve o total das MESMAS
 * condições — é esse total que a tela usa para saber quantas páginas existem.
 */
function novoServidor() {
  const contato = (id: number, nome: string, updatedAt: number): Contato => ({
    id, fullName: nome, photoUrl: null, cardImageUrl: null, jobTitle: null, company: null,
    country: null, state: null, city: null, phone: null, whatsapp: null, email: null,
    linkedinUrl: null, instagram: null, profileTags: null, notes: null, enrichmentStatus: null,
    nivelVisibilidade: "privado", createdAt: updatedAt, updatedAt,
  });
  // O contato 1 é o mais recente: fica na página 1. O 21 é o mais antigo e
  // sozinho na página 2 — é ele que o teste (a) exclui.
  const estado = {
    contatos: Array.from({ length: 21 }, (_, i) => contato(i + 1, `Contato ${i + 1}`, 9_000_000_000 - i * 1000)),
    paginasPedidas: [] as number[],
    caido: false,
  };
  // Rotas que só o detalhe do contato usa, ou que a tela invalida depois de
  // gravar, e que estes testes não observam: respondem vazio.
  const ROTAS_SEM_OBSERVADOR = new Set(["network.get", "network.assetsNeeds", "enrichment.getHistory", "contexts.listByContact"]);

  const responder = async (path: string, input: unknown) => {
    await new Promise(r => setTimeout(r, 10)); // latência: o cache chega antes da resposta
    switch (path) {
      case "network.list": {
        const { page = 1, limit = 20 } = (input ?? {}) as { page?: number; limit?: number };
        estado.paginasPedidas.push(page);
        // Espelha o zod do router (server/routers/network.ts:196,
        // `page: z.number().int().min(1)`): página abaixo de 1 é entrada
        // INVÁLIDA, não lista vazia — o servidor recusa com BAD_REQUEST.
        if (!Number.isInteger(page) || page < 1) throw new TRPCClientError("page: Number must be greater than or equal to 1");
        if (estado.caido) throw new TRPCClientError("Banco de dados indisponível. Tente de novo em instantes.");
        const ordenados = [...estado.contatos].sort((a, b) => b.updatedAt - a.updatedAt);
        return { data: ordenados.slice((page - 1) * limit, page * limit), total: estado.contatos.length };
      }
      case "network.delete": {
        const { id } = input as { id: number };
        estado.contatos = estado.contatos.filter(c => c.id !== id);
        return { success: true };
      }
      default:
        if (ROTAS_SEM_OBSERVADOR.has(path)) return null;
        throw new TRPCClientError("rota não simulada: " + path);
    }
  };
  /** Outra aba (ou o formulário) cadastra um contato novo, sem esta tela saber. */
  const cadastrarEmOutraAba = (nome: string) => {
    const id = Math.max(0, ...estado.contatos.map(c => c.id)) + 1;
    estado.contatos.push(contato(id, nome, 1)); // o mais antigo: entra na página 2
  };
  /** Outra aba apaga a rede inteira: o total vai a 0 e não sobra página nenhuma. */
  const esvaziarEmOutraAba = () => { estado.contatos = []; };
  /** O servidor cai (banco fora do ar, 500): a lista passa a responder erro. */
  const derrubarServidor = () => { estado.caido = true; };
  return { estado, responder, cadastrarEmOutraAba, esvaziarEmOutraAba, derrubarServidor };
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

/** A entrada de cache da página 2, com o input EXATO que a tela manda. */
const chaveDaPagina = (page: number) =>
  getQueryKey(trpc.network.list, { q: undefined, tag: undefined, page, limit: 20 }, "query");

function novaTela(opcoesDoCliente?: ConstructorParameters<typeof QueryClient>[0]) {
  const srv = novoServidor();
  // Sem argumento: igual a client/src/main.tsx (sem staleTime, gcTime de 5 min).
  const qc = new QueryClient(opcoesDoCliente);
  const client = trpc.createClient({ links: [linkFalso(srv.responder) as never] });
  const abrir = () => render(
    <trpc.Provider client={client} queryClient={qc}>
      <QueryClientProvider client={qc}><Network /></QueryClientProvider>
    </trpc.Provider>,
  );
  /** A tela parou de se mexer: nada em voo e os efeitos já rodaram. */
  const assentar = async () => {
    await waitFor(() => expect(qc.isFetching()).toBe(0), FOLGA);
    // Duas voltas do laço de eventos depois do fim do último pedido: se o
    // clamp for disparar, dispara aqui — e o pedido que ele provoca volta a
    // subir o isFetching.
    await new Promise(r => setTimeout(r, 50));
    await waitFor(() => expect(qc.isFetching()).toBe(0), FOLGA);
  };
  return { srv, qc, abrir, assentar };
}

const indicador = () => (document.body.textContent ?? "").match(/Página \d+ de \d+/)?.[0] ?? "(sem paginação)";
const proxima = () => screen.getByRole("button", { name: "Próxima →" });
const anterior = () => screen.getByRole("button", { name: "← Anterior" });

describe("Minha Rede — a página que esvaziou volta para a última que existe (com React Query de verdade)", () => {
  it("(a) excluir o único contato da página 2 devolve a tela para a página 1, sem 'Sua rede está vazia'", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);
    fireEvent.click(proxima());
    await screen.findByText("Contato 21", {}, FOLGA);

    // Menu "···" do cartão → Excluir → confirmar no modal.
    const cartao = screen.getByText("Contato 21").closest("div.group") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: "···" }));
    fireEvent.click(within(cartao).getByRole("button", { name: "Excluir" }));
    const confirmar = screen.getAllByRole("button", { name: "Excluir" }).at(-1)!;
    fireEvent.click(confirmar);

    await screen.findByText("20 contato", {}, FOLGA);
    await t.assentar();

    // Sem o clamp: "20 contato" sobre "Sua rede está vazia", e a paginação
    // some (só aparece com total > 20) — sem caminho de volta.
    expect(screen.queryByText("Sua rede está vazia")).not.toBeInTheDocument();
    expect(screen.getByText("Contato 1")).toBeInTheDocument();
    expect(t.srv.estado.paginasPedidas.at(-1)).toBe(1);
  });

  it("(b) com a resposta velha da página 2 no cache e o servidor já em 21 contatos, o 1º 'Próxima →' leva e MANTÉM a tela na página 2", async () => {
    const t = novaTela();
    // O rastro que o próprio clamp deixa: a página 2 respondeu vazia com
    // total 20 e a entrada continua no cache (gcTime de 5 minutos).
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    t.srv.estado.paginasPedidas = [];

    fireEvent.click(proxima());

    // O contato que só existe na página 2 aparece — quer dizer que a tela
    // chegou lá. Antes da guarda, o clamp lia o total velho (20) e devolvia
    // a tela para a página 1 antes mesmo de a resposta nova chegar.
    await screen.findByText("Contato 21", {}, FOLGA);
    await t.assentar();

    expect(indicador()).toBe("Página 2 de 2");
    expect(screen.getByText("Contato 21")).toBeInTheDocument();
    expect(screen.queryByText("Contato 1")).not.toBeInTheDocument();
    // E ninguém pediu a página 1 de volta.
    expect(t.srv.estado.paginasPedidas).not.toContain(1);
  });

  it("(b2) a história inteira numa tela só: a página 2 esvazia, outra aba cadastra um contato, e 'Próxima →' volta a funcionar", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);

    // 1) vai para a página 2 e exclui o único contato de lá: o clamp age e a
    //    entrada da página 2 fica no cache com {data: [], total: 20}.
    fireEvent.click(proxima());
    await screen.findByText("Contato 21", {}, FOLGA);
    const cartao = screen.getByText("Contato 21").closest("div.group") as HTMLElement;
    fireEvent.click(within(cartao).getByRole("button", { name: "···" }));
    fireEvent.click(within(cartao).getByRole("button", { name: "Excluir" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Excluir" }).at(-1)!);
    await screen.findByText("20 contato", {}, FOLGA);
    await t.assentar();
    expect(t.qc.getQueryData(chaveDaPagina(2) as never)).toEqual({ data: [], total: 20 });

    // 2) outra aba cadastra a 21ª contato e esta tela relê a lista.
    t.srv.cadastrarEmOutraAba("Zélia Última");
    await t.qc.invalidateQueries({ queryKey: [["network", "list"]] });
    await screen.findByText("21 contato", {}, FOLGA);
    await t.assentar();
    t.srv.estado.paginasPedidas = [];

    // 3) o primeiro clique tem de andar — e ficar.
    fireEvent.click(proxima());
    await screen.findByText("Zélia Última", {}, FOLGA);
    await t.assentar();
    expect(indicador()).toBe("Página 2 de 2");
    expect(t.srv.estado.paginasPedidas).not.toContain(1);
  });

  it("(d) SEM REDE, o total velho do cache não devolve a tela para a página 1 — e o '← Anterior' continua sendo a saída", async () => {
    const t = novaTela();
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    await t.assentar();

    // A rede cai ANTES do clique. Aqui o React Query nem tenta buscar: marca a
    // consulta como "paused" e entrega o dado velho do cache. `isFetching` é
    // false e `isSuccess` continua true — é por isso que a guarda pergunta
    // `fetchStatus === "idle"` e não `!isFetching`.
    onlineManager.setOnline(false);
    t.srv.estado.paginasPedidas = [];

    fireEvent.click(proxima());

    // Sem rede, a página 2 mostra o que sobrou no cache: nada. O que não pode
    // acontecer é a tela se mandar de volta para a página 1 sozinha, lendo o
    // total velho (20) que o cache guardou.
    await screen.findByText("Sua rede está vazia", {}, FOLGA);
    await t.assentar();
    expect(indicador()).toBe("Página 2 de 2");
    expect(t.srv.estado.paginasPedidas).toEqual([]); // offline: nada saiu

    // E há saída: fora da página 1 a paginação aparece mesmo com o total em
    // 20, justamente porque o clamp está parado e não vai trazer ninguém de
    // volta. Sem isso, esta tela seria o beco sem saída de novo, só offline.
    expect(anterior()).toBeEnabled();
    fireEvent.click(anterior());
    await screen.findByText("Contato 1", {}, FOLGA); // o cache da página 1 ainda serve
  });

  it("(e) o servidor CAI no clique: a tela fica na página 2 com o alerta, em vez de voltar calada para a 1", async () => {
    // `retry: false` só tira os backoffs (main.tsx retenta 3 vezes, o que
    // estouraria o tempo do teste); o que se observa é o estado depois que o
    // erro assentou, igual ao da tela de verdade.
    const t = novaTela({ defaultOptions: { queries: { retry: false } } });
    t.qc.setQueryData(chaveDaPagina(2) as never, { data: [], total: 20 } as never);

    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);
    await waitFor(() => expect(indicador()).toBe("Página 1 de 2"), FOLGA);
    await t.assentar();
    t.srv.estado.paginasPedidas = [];

    t.srv.derrubarServidor();
    fireEvent.click(proxima());

    // A consulta da página 2 falha, `isSuccess` vira false e a guarda barra o
    // clamp. Sem a metade `isSuccess`, o clamp leria o total VELHO do cache
    // (20) depois que o erro assenta e devolveria a tela para a página 1 —
    // sem erro visível, como se o clique não tivesse acontecido.
    await screen.findByRole("alert", {}, FOLGA);
    await t.assentar();
    expect(screen.getByRole("button", { name: "↻ Tentar novamente" })).toBeInTheDocument();
    expect(t.srv.estado.paginasPedidas).toEqual([2]);
  });

  it("(f) a rede inteira esvazia estando na página 2: volta para a página 1 vazia, e nenhuma consulta sai com página 0", async () => {
    const t = novaTela();
    t.abrir();
    await screen.findByText("21 contato", {}, FOLGA);
    fireEvent.click(proxima());
    await screen.findByText("Contato 21", {}, FOLGA);
    await t.assentar();

    // Outra aba apaga TODOS os contatos: o total vai a 0. A última página que
    // existe é a 1 — não a 0, que o router recusa
    // (server/routers/network.ts:196, `page: z.number().int().min(1)`). Sem o
    // piso `Math.max(1, …)` do clamp, "rede vazia" viraria alerta de erro.
    t.srv.esvaziarEmOutraAba();
    await t.qc.invalidateQueries({ queryKey: [["network", "list"]] });
    await screen.findByText("Sua rede está vazia", {}, FOLGA);
    await t.assentar();

    expect(t.srv.estado.paginasPedidas.filter(p => p < 1)).toEqual([]);
    expect(t.srv.estado.paginasPedidas.at(-1)).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Lista vazia na página 1 continua sem paginação: o `page > 1` do bloco
    // não faz aparecer botão onde não há para onde ir.
    expect(indicador()).toBe("(sem paginação)");
  });
});
