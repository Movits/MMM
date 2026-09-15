import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * "Nova conexão!" (grupo Projetos IA, 14/09): quando duas pessoas demonstram
 * interesse uma na outra, a tela avisa que a conexão foi criada.
 *
 * O caminho principal é aceitar um pedido encaminhado (`connections.respond`).
 * O outro é o cartão velho: a outra pessoa já tinha um pedido encaminhado para
 * mim, a lista aberta no navegador ainda não sabia, e eu clico em "Demonstrar
 * Interesse". O servidor fecha o interesse mútuo e responde `revelou: true`;
 * antes, a tela dizia "interesse enviado, um distribuidor confere", o que era
 * falso — não há mais nada a conferir, os nomes já foram revelados.
 *
 * O dublê guarda as opções de cada `useMutation` pelo caminho, para o teste
 * chamar o `onSuccess` com a resposta que o servidor daria.
 */

const duble = vi.hoisted(() => {
  const respostas: Record<string, { data?: unknown }> = {};
  const mutacoes: Record<string, { mutate: ReturnType<typeof vi.fn>; opcoes: { onSuccess?: (dados: unknown, vars: unknown) => void } }> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const procedimento = (caminho: string) => ({
    useQuery: (_input: unknown, opcoes?: { select?: (dados: never) => unknown }) => {
      const resultado = { data: undefined as unknown, isLoading: false, isPending: false, isError: false, error: null as unknown, refetch: vi.fn(), ...(respostas[caminho] ?? {}) };
      if (opcoes?.select && resultado.data !== undefined) resultado.data = opcoes.select(resultado.data as never);
      return resultado;
    },
    useMutation: (opcoes: { onSuccess?: (dados: unknown, vars: unknown) => void } = {}) => {
      const registro = (mutacoes[caminho] ??= { mutate: vi.fn(), opcoes });
      registro.opcoes = opcoes;
      return { mutate: registro.mutate, mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, data: undefined };
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
  return { respostas, mutacoes, trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null, GlobalMenu: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/SmartMatchConsent", () => ({ SmartMatchConsent: () => null }));

function cartao(extra: Record<string, unknown> = {}) {
  return {
    matchId: 1, overallScore: 60, userSeen: false,
    specialtyScore: 90, objectivesScore: 80, incomeScore: 70, locationScore: 60, valuesScore: 50,
    aiInsight: null, city: "Lisboa", country: "PT", primarySpecialty: "tech",
    seekingTypes: [], businessInterests: [], values: [], sector: null,
    displayName: null, connectionId: null, connectionStatus: null, souDestinataria: null,
    ...extra,
  };
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  for (const chave of Object.keys(duble.mutacoes)) delete duble.mutacoes[chave];
  vi.mocked(toast.success).mockClear();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana", city: "Lisboa", profileCompleteness: 80 } } };
  duble.respostas["consent.status"] = { data: { accepted: true, document: null } };
  duble.respostas["connections.list"] = { data: [] };
  duble.respostas["matching.getRecommendedOpportunities"] = { data: [] };
  duble.respostas["dealRoom.listRooms"] = { data: [] };
  duble.respostas["notifications.list"] = { data: [] };
  duble.respostas["matches.list"] = { data: [cartao()] };
});

describe("aviso de conexão criada no Dashboard", () => {
  it("o texto do aviso traz a frase pedida e não fala em match", () => {
    const aviso = i18n.t("dashboard.connectionAccepted");
    expect(aviso).toMatch(/Nova conexão!|Vocês criaram uma conexão!/);
    expect(aviso).not.toMatch(/match/i);
    // Os dois avisos precisam ser diferentes, senão os testes abaixo não discriminam.
    expect(aviso).not.toBe(i18n.t("dashboard.interestSent"));
  });

  it("demonstrar interesse que fecha o interesse mútuo (revelou): avisa a conexão criada", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("dashboard.connect") }));
    const envio = duble.mutacoes["connections.send"];
    expect(envio.mutate).toHaveBeenCalledWith({ matchId: 1 });

    envio.opcoes.onSuccess?.({ success: true, revelou: true }, { matchId: 1 });
    expect(toast.success).toHaveBeenCalledWith(i18n.t("dashboard.connectionAccepted"));
    expect(toast.success).not.toHaveBeenCalledWith(i18n.t("dashboard.interestSent"));
  });

  it("demonstrar interesse sem reciprocidade: continua o aviso de interesse enviado", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("dashboard.connect") }));
    duble.mutacoes["connections.send"].opcoes.onSuccess?.({ success: true, revelou: false }, { matchId: 1 });
    expect(toast.success).toHaveBeenCalledWith(i18n.t("dashboard.interestSent"));
    expect(toast.success).not.toHaveBeenCalledWith(i18n.t("dashboard.connectionAccepted"));
  });

  it("aceitar um pedido recebido: avisa a conexão criada", () => {
    duble.respostas["matches.list"] = { data: [cartao({ connectionId: 7, connectionStatus: "pending", souDestinataria: true })] };
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("dashboard.acceptReveal") }));
    const resposta = duble.mutacoes["connections.respond"];
    expect(resposta.mutate).toHaveBeenCalledWith({ connectionId: 7, accept: true });

    resposta.opcoes.onSuccess?.({ success: true }, { connectionId: 7, accept: true });
    expect(toast.success).toHaveBeenCalledWith(i18n.t("dashboard.connectionAccepted"));
  });
});
