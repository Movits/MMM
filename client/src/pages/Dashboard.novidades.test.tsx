import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * O AVISO QUE PISCAVA (revisão da rodada anterior do item 6.4).
 *
 * "N novas conexões sugeridas esperando pela sua atenção" nunca baixava, porque
 * nada marcava `userSeen`. O conserto — marcar as sugestões desenhadas como
 * vistas — trocou um defeito pelo outro: o `onSuccess` da mutation refazia
 * `matches.list`, a lista voltava com `userSeen` verdadeiro e o aviso SUMIA na
 * mesma carga, dois ou três segundos depois de aparecer. Quem estava lendo a
 * saudação via o número evaporar debaixo do olho.
 *
 * A regra passa a ser: a marcação é silenciosa (o servidor sabe; a tela não se
 * refaz por causa dela) e o número fica CONGELADO na carga em que apareceu. Ele
 * só é recalculado quando a própria pessoa pede sugestões novas ("Reanalisar").
 * Na carga seguinte — outro acesso, F5 — ele já nasce menor, que é o que o
 * item 6.4 pedia.
 */

const duble = vi.hoisted(() => {
  const respostas: Record<string, { data?: unknown; isError?: boolean; error?: unknown }> = {};
  /** Um `refetch` ESTÁVEL por procedimento: é nele que se lê se a tela se refez. */
  const refetches: Record<string, ReturnType<typeof vi.fn>> = {};
  /** As opções passadas a cada `useMutation`, para disparar o onSuccess à mão. */
  const mutacoes: Record<string, { onSuccess?: (...args: unknown[]) => void; onError?: (...args: unknown[]) => void }> = {};
  const mutates: Record<string, ReturnType<typeof vi.fn>> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const procedimento = (caminho: string) => ({
    useQuery: (_input: unknown, opcoes?: { select?: (dados: never) => unknown }) => {
      refetches[caminho] ??= vi.fn();
      const resultado = { data: undefined as unknown, isLoading: false, isPending: false, isError: false, error: null as unknown, refetch: refetches[caminho], ...(respostas[caminho] ?? {}) };
      if (opcoes?.select && resultado.data !== undefined) resultado.data = opcoes.select(resultado.data as never);
      return resultado;
    },
    useMutation: (opcoes?: { onSuccess?: (...args: unknown[]) => void; onError?: (...args: unknown[]) => void }) => {
      mutacoes[caminho] = opcoes ?? {};
      mutates[caminho] ??= vi.fn();
      return { mutate: mutates[caminho], mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, data: undefined };
    },
  });
  const utils = new Proxy({}, {
    get: (_, r) => ignorar(r) ? undefined : new Proxy({}, {
      get: (_, p) => ignorar(p) ? undefined : new Proxy({}, { get: (_, m) => ignorar(m) ? undefined : vi.fn(async () => undefined) }),
    }),
  });
  const trpc = new Proxy({}, {
    get: (_, router) => {
      if (ignorar(router)) return undefined;
      if (router === "useUtils") return () => utils;
      return new Proxy({}, { get: (_, proc) => ignorar(proc) ? undefined : procedimento(`${String(router)}.${String(proc)}`) });
    },
  });
  return { respostas, refetches, mutacoes, mutates, trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null, GlobalMenu: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/SmartMatchConsent", () => ({ SmartMatchConsent: () => null }));

/** A linha que `matches.list` devolve, no formato anônimo do servidor. */
function sugestao(matchId: number, userSeen: boolean) {
  return {
    matchId, overallScore: 85, userSeen,
    specialtyScore: 90, objectivesScore: 80, incomeScore: 70, locationScore: 60, valuesScore: 50,
    aiInsight: null, createdAt: new Date("2026-09-10T12:00:00Z"),
    city: "Lisboa", country: "PT", primarySpecialty: "tech",
    seekingTypes: [], businessInterests: [], values: [], sector: null,
    connectionId: null, connectionStatus: null, souDestinataria: null, displayName: null,
  };
}

function definirSugestoes(linhas: ReturnType<typeof sugestao>[]) {
  duble.respostas["matches.list"] = { data: linhas };
}

/** O texto exato do aviso, como a tela o monta (chave com plural + complemento). */
function avisoDeNovidades(quantas: number) {
  return i18n.t("dashboard.greetingUnseen", { count: quantas });
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  for (const chave of Object.keys(duble.refetches)) delete duble.refetches[chave];
  for (const chave of Object.keys(duble.mutacoes)) delete duble.mutacoes[chave];
  for (const chave of Object.keys(duble.mutates)) delete duble.mutates[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana", city: "Lisboa", profileCompleteness: 80 } } };
  duble.respostas["consent.status"] = { data: { accepted: true, document: null } };
  definirSugestoes([]);
  duble.respostas["connections.list"] = { data: [] };
  duble.respostas["matching.getRecommendedOpportunities"] = { data: [] };
  duble.respostas["dealRoom.listRooms"] = { data: [] };
  duble.respostas["notifications.list"] = { data: [] };
});

describe("o aviso de novidades não pisca na carga em que apareceu", () => {
  it("marcar como visto não refaz a consulta da lista", () => {
    definirSugestoes([sugestao(10, false), sugestao(11, false)]);
    render(<Dashboard />);

    // A tela avisou o servidor sobre as duas sugestões que desenhou.
    expect(duble.mutates["matches.marcarVistas"]).toHaveBeenCalledWith({ matchIds: [10, 11] });

    // E o servidor respondeu. É aqui que o refetch acontecia e o aviso sumia.
    act(() => { duble.mutacoes["matches.marcarVistas"]?.onSuccess?.({ marcadas: 2 }); });

    expect(duble.refetches["matches.list"]).not.toHaveBeenCalled();
    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();
  });

  it("a lista que volta com userSeen verdadeiro não apaga o número já mostrado", () => {
    definirSugestoes([sugestao(10, false), sugestao(11, false)]);
    const { rerender } = render(<Dashboard />);
    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();

    // Qualquer outra coisa da tela pode refazer `matches.list` (demonstrar
    // interesse, aceitar, dispensar) e trazer as MESMAS sugestões já vistas.
    definirSugestoes([sugestao(10, true), sugestao(11, true)]);
    rerender(<Dashboard />);

    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();
  });

  it("'Reanalisar' solta o número: sugestão nova encontrada volta a ser anunciada", () => {
    definirSugestoes([sugestao(10, true)]);
    const { rerender } = render(<Dashboard />);
    expect(screen.queryByText(avisoDeNovidades(1))).toBeNull();

    act(() => { duble.mutacoes["matches.regenerate"]?.onSuccess?.({ count: 3 }); });
    definirSugestoes([sugestao(10, true), sugestao(20, false), sugestao(21, false), sugestao(22, false)]);
    rerender(<Dashboard />);

    expect(screen.getByText(avisoDeNovidades(3))).toBeInTheDocument();
  });

  it("'Reanalisar' que não acha nada novo não apaga o aviso que está na tela", () => {
    definirSugestoes([sugestao(10, false), sugestao(11, false)]);
    const { rerender } = render(<Dashboard />);
    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();

    // A pessoa clica em "Reanalisar" e o servidor não encontra sugestão nova.
    act(() => { duble.mutacoes["matches.regenerate"]?.onSuccess?.({ count: 0 }); });

    // O refetch do onSuccess traz as MESMAS duas sugestões — agora com
    // `userSeen` verdadeiro, porque a tela já as marcou. Soltar o congelamento
    // aqui fazia o número recomeçar do zero e o aviso sumir no meio da leitura.
    definirSugestoes([sugestao(10, true), sugestao(11, true)]);
    rerender(<Dashboard />);

    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();
  });

  it("dispensar uma sugestão encurta a lista, e o número não se refaz por isso", () => {
    definirSugestoes([sugestao(10, false), sugestao(11, false)]);
    const { rerender } = render(<Dashboard />);
    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();

    // Dispensar refaz `matches.list`: sobra uma linha, já vista.
    act(() => { duble.mutacoes["matches.dismiss"]?.onSuccess?.({}); });
    definirSugestoes([sugestao(10, true)]);
    rerender(<Dashboard />);

    expect(screen.getByText(avisoDeNovidades(2))).toBeInTheDocument();
  });

  it("sem sugestão nova, nenhum aviso — o número congelado não inventa novidade", () => {
    definirSugestoes([sugestao(10, true), sugestao(11, true)]);
    render(<Dashboard />);

    expect(screen.queryByText(avisoDeNovidades(2))).toBeNull();
    expect(screen.queryByText(avisoDeNovidades(0))).toBeNull();
    // Nada a marcar: a mutation não é disparada por sugestão já vista.
    expect(duble.mutates["matches.marcarVistas"]).not.toHaveBeenCalled();
  });
});
