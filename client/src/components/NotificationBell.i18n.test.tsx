import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { NotificationBell } from "./NotificationBell";

/**
 * O sino era português fixo nos 10 idiomas: título, "Notificações", o contador
 * "{n} nova(s)" com plural feito à mão, "Marcar todas como lidas", o vazio, o
 * "Ver todas as notificações" e o tempo relativo ("agora", "5min atrás").
 * Quem abria o app em inglês via tudo isso em português — e é o componente que
 * aparece em toda tela logada, todo dia.
 *
 * Este teste renderiza o sino ABERTO em inglês e varre o que a usuária lê:
 * nenhum pedaço de português pode sobrar. O plural entra por chave com as 6
 * formas do CLDR, então o contador é conferido em inglês e em português.
 *
 * O dublê do tRPC é o mesmo molde de Dashboard.i18n.test.tsx: qualquer
 * `trpc.a.b.useQuery` responde o que o teste registrou em `respostas["a.b"]`.
 *
 * O teste nasceu na #138 do Gabryel, que traduzia os mesmos quatro componentes
 * que a #141 traduziu primeiro. A tradução dela ficou; este teste veio junto,
 * porque ele afere o TEXTO QUE APARECE, não o nome da chave: vale para
 * qualquer uma das duas e reprova se o português voltar ao sino.
 */

type Resposta = { data?: unknown; isLoading?: boolean; isError?: boolean };

const duble = vi.hoisted(() => {
  const respostas: Record<string, Resposta> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";

  const procedimento = (caminho: string) => ({
    useQuery: () => ({
      data: undefined as unknown,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      ...(respostas[caminho] ?? {}),
    }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  });

  const trpc = new Proxy({}, {
    get: (_, router) => ignorar(router)
      ? undefined
      : new Proxy({}, { get: (_, proc) => ignorar(proc) ? undefined : procedimento(`${String(router)}.${String(proc)}`) }),
  });

  return { respostas, trpc };
});

vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
// O sino usa <Link> do wouter, que exige Router: aqui só o conteúdo interessa.
vi.mock("wouter", () => ({ Link: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

/** Pedaços que só existem no texto em português do sino. */
const PORTUGUES = /Notificações|nova|novas|Marcar todas|lidas|Nenhuma notificação|Ver todas|agora|atrás/;

function notificacao(id: number, isRead: boolean, minutosAtras: number) {
  return {
    id,
    type: "new_match",
    title: `Match ${id}`,
    body: null,
    actionUrl: null,
    isRead,
    createdAt: new Date(Date.now() - minutosAtras * 60_000),
  };
}

function abrirSino() {
  render(<NotificationBell />);
  fireEvent.click(screen.getAllByRole("button")[0]);
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
});

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("sino de notificações — o que a usuária lê em cada idioma", () => {
  it("em inglês, com duas não lidas: nenhum texto em português sobra na tela", async () => {
    duble.respostas["notifications.list"] = {
      data: [notificacao(1, false, 5), notificacao(2, false, 3)],
    };
    await i18n.changeLanguage("en");
    abrirSino();

    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("2 new")).toBeInTheDocument();
    expect(screen.getByText("Mark all as read")).toBeInTheDocument();
    expect(screen.getByText("See all notifications")).toBeInTheDocument();
    expect(screen.getByText("5min ago")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(PORTUGUES);
  });

  it("em inglês, sem notificação nenhuma: o vazio também está traduzido", async () => {
    duble.respostas["notifications.list"] = { data: [] };
    await i18n.changeLanguage("en");
    abrirSino();

    expect(screen.getByText("No notifications yet")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(PORTUGUES);
  });

  it("o contador respeita o plural: uma em inglês e uma em português", async () => {
    duble.respostas["notifications.list"] = { data: [notificacao(1, false, 0)] };

    await i18n.changeLanguage("en");
    abrirSino();
    expect(screen.getByText("1 new")).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();
  });

  it("em português segue dizendo o que dizia antes, no singular e no plural", async () => {
    duble.respostas["notifications.list"] = { data: [notificacao(1, false, 0)] };
    await i18n.changeLanguage("pt-BR");
    abrirSino();
    expect(screen.getByText("1 nova")).toBeInTheDocument();
    expect(screen.getByText("agora")).toBeInTheDocument();
    expect(screen.getByText("Notificações")).toBeInTheDocument();
  });

  it("duas não lidas em português: o contador vai para o plural", async () => {
    duble.respostas["notifications.list"] = {
      data: [notificacao(1, false, 90), notificacao(2, false, 2000)],
    };
    await i18n.changeLanguage("pt-BR");
    abrirSino();
    expect(screen.getByText("2 novas")).toBeInTheDocument();
    expect(screen.getByText("1h atrás")).toBeInTheDocument();
    expect(screen.getByText("1d atrás")).toBeInTheDocument();
  });
});
