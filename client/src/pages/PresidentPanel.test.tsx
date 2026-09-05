import { act, fireEvent, render, screen } from "@testing-library/react";
import { keepPreviousData } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PresidentPanel from "./PresidentPanel";

/**
 * Etapa 10 — Painel Ouro: a busca de membras vai ao SERVIDOR.
 *
 * Antes, as abas "Gestão Ouro" e "Líderes" filtravam em memória as 100 mais
 * recentes: a membra mais antiga que a 100ª "não existia" para a presidente.
 * Agora o termo vai na consulta, com 300 ms de espera (uma consulta por
 * busca, não por tecla), a tela avisa quando a página não é a lista inteira,
 * e a lista anterior fica no lugar enquanto a nova viaja (keepPreviousData)
 * em vez de piscar "Nenhuma membra encontrada." a cada busca.
 *
 * O tRPC vira um dublê (molde de EnrichmentChat.test.tsx) que faz o papel do
 * React Query no que importa aqui: guarda a resposta por chave de consulta e
 * aplica `placeholderData` quando a chave nova ainda não respondeu. Assim o
 * teste exercita o keepPreviousData de verdade, e não só a presença da opção.
 */

type Entrada = Record<string, unknown> | undefined;
type Opcoes = { placeholderData?: (anterior: unknown) => unknown } | undefined;
type Resposta = { users: unknown[]; total: number };

// vi.mock é içado para o topo do arquivo; o que as fábricas usam precisa
// nascer em vi.hoisted, senão é lido antes de existir.
const duble = vi.hoisted(() => {
  // Uma lojinha externa: "o servidor respondeu" vira um re-render dos
  // componentes que consultam, como o React Query faria.
  const ouvintes = new Set<() => void>();
  let versao = 0;
  const loja = {
    subscribe: (fn: () => void) => { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; },
    getSnapshot: () => versao,
    notificar: () => { versao += 1; ouvintes.forEach(fn => fn()); },
  };
  return {
    loja,
    /** O "servidor": resposta por chave de consulta (JSON da entrada); ausente = ainda viajando. */
    respostas: {} as Record<string, Resposta | undefined>,
    ultimaResposta: undefined as unknown,
    chamadas: [] as { input: Entrada; opts: Opcoes }[],
    mutacao: () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }),
    consulta: (data: unknown = undefined) => ({ useQuery: () => ({ data, isLoading: false, refetch: vi.fn() }) }),
  };
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "president", name: "Presidente" }, loading: false, isAuthenticated: true }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/president", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/trpc", async () => {
  const React = await import("react");
  return {
    trpc: {
      useUtils: () => ({}),
      president: {
        getGovernanceStats: duble.consulta(),
        getGoldGrants: duble.consulta([]),
        listLeaders: duble.consulta([]),
        getLeaderOpportunities: duble.consulta(),
        grantGold: duble.mutacao(),
        revokeGold: duble.mutacao(),
        nominateLeader: duble.mutacao(),
        revokeLeader: duble.mutacao(),
        listAllUsers: {
          useQuery: (input: Entrada, opts: Opcoes) => {
            React.useSyncExternalStore(duble.loja.subscribe, duble.loja.getSnapshot);
            duble.chamadas.push({ input, opts });
            const resposta = duble.respostas[JSON.stringify(input)];
            // O que o React Query faz com placeholderData: enquanto a chave nova
            // não tem resposta, mostra o que a função devolver para o dado
            // anterior (keepPreviousData devolve o próprio anterior).
            const data = resposta ?? opts?.placeholderData?.(duble.ultimaResposta);
            if (resposta) duble.ultimaResposta = resposta;
            return { data, isLoading: !resposta, refetch: vi.fn() };
          },
        },
      },
    },
  };
});

const usuarias = [
  { id: 10, name: "Ana Lima", email: "ana@exemplo.com", role: "silver", country: "Brasil" },
  { id: 11, name: "Bia Souza", email: "bia@exemplo.com", role: "silver", country: null },
];

// Chaves que o dublê usa: JSON.stringify descarta `search: undefined`.
const CHAVE_PRATA = JSON.stringify({ role: "silver" });
const CHAVE_PRATA_BIA = JSON.stringify({ role: "silver", search: "bia" });
const CHAVE_TODAS = JSON.stringify({});

function abrirAba(nome: RegExp) {
  render(<PresidentPanel />);
  fireEvent.click(screen.getByRole("button", { name: nome }));
}

const chamadasComTermo = () => duble.chamadas.filter(c => c.input?.search !== undefined);
const digitar = (campo: HTMLElement, valor: string) => fireEvent.change(campo, { target: { value: valor } });
const esperar = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  duble.respostas = {};
  duble.ultimaResposta = undefined;
  duble.chamadas = [];
  // Só os timers que a espera da busca usa: o agendador do React fica real.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PresidentPanel — Gestão Ouro busca no servidor", () => {
  it("três teclas rápidas geram UMA consulta com o termo inteiro, 300 ms depois da última", () => {
    duble.respostas[CHAVE_PRATA] = { users: usuarias, total: 2 };
    abrirAba(/gestão ouro/i);
    const campo = screen.getByPlaceholderText("Buscar por nome ou e-mail...");

    digitar(campo, "a");
    esperar(100);
    digitar(campo, "an");
    esperar(100);
    digitar(campo, "ana");
    // 299 ms depois da última tecla (499 ms depois da primeira): a espera da
    // primeira tecla já teria vencido — se não tivesse sido cancelada.
    esperar(299);
    expect(chamadasComTermo()).toEqual([]);

    esperar(1);
    // Mutante "sem atraso": aqui haveria "a", "an" e "ana"; mutante "sem
    // cancelar o timer anterior": "a" teria saído aos 300 ms.
    expect(chamadasComTermo().map(c => c.input)).toEqual([{ role: "silver", search: "ana" }]);
  });

  it("quando o total passa da página, a tela avisa 'Mostrando N de total'", () => {
    duble.respostas[CHAVE_PRATA] = { users: usuarias, total: 7 };
    abrirAba(/gestão ouro/i);
    expect(screen.getByText(/Mostrando 2 de 7/)).toBeInTheDocument();
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
  });

  it("total igual ao tamanho da página: nenhum aviso", () => {
    duble.respostas[CHAVE_PRATA] = { users: usuarias, total: 2 };
    abrirAba(/gestão ouro/i);
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it("enquanto a busca nova viaja, a lista anterior fica no lugar (keepPreviousData) — sem piscar 'Nenhuma membra encontrada.'", () => {
    duble.respostas[CHAVE_PRATA] = { users: usuarias, total: 2 };
    abrirAba(/gestão ouro/i);
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();

    digitar(screen.getByPlaceholderText("Buscar por nome ou e-mail..."), "bia");
    esperar(300);
    // A chave nova ainda não respondeu. Mutante "sem placeholderData": a lista
    // zeraria e o texto de vazio apareceria aqui.
    expect(chamadasComTermo().at(-1)?.input).toEqual({ role: "silver", search: "bia" });
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Bia Souza")).toBeInTheDocument();
    expect(screen.queryByText("Nenhuma membra encontrada.")).not.toBeInTheDocument();

    // O servidor responde: só quem casou com o termo fica.
    act(() => {
      duble.respostas[CHAVE_PRATA_BIA] = { users: [usuarias[1]], total: 1 };
      duble.loja.notificar();
    });
    expect(screen.queryByText("Ana Lima")).not.toBeInTheDocument();
    expect(screen.getByText("Bia Souza")).toBeInTheDocument();
  });

  it("busca sem resultado, depois de o servidor responder, mostra o texto de vazio", () => {
    duble.respostas[CHAVE_PRATA] = { users: usuarias, total: 2 };
    abrirAba(/gestão ouro/i);
    digitar(screen.getByPlaceholderText("Buscar por nome ou e-mail..."), "bia");
    esperar(300);
    act(() => {
      duble.respostas[CHAVE_PRATA_BIA] = { users: [], total: 0 };
      duble.loja.notificar();
    });
    expect(screen.getByText("Nenhuma membra encontrada.")).toBeInTheDocument();
  });
});

describe("PresidentPanel — Líderes usa a mesma busca", () => {
  it("uma consulta com o termo após 300 ms, keepPreviousData e o aviso de lista cortada", () => {
    duble.respostas[CHAVE_TODAS] = { users: usuarias, total: 9 };
    abrirAba(/líderes/i);
    expect(screen.getByText(/Mostrando 2 de 9/)).toBeInTheDocument();

    digitar(screen.getByPlaceholderText("Buscar membra por nome ou e-mail..."), "ana");
    esperar(299);
    expect(chamadasComTermo()).toEqual([]);
    esperar(1);
    expect(chamadasComTermo().map(c => c.input)).toEqual([{ search: "ana" }]);
    expect(chamadasComTermo()[0].opts?.placeholderData).toBe(keepPreviousData);

    // A lista anterior continua enquanto a resposta não chega.
    expect(screen.getByText("Ana Lima")).toBeInTheDocument();
    expect(screen.getByText("Bia Souza")).toBeInTheDocument();
  });
});
