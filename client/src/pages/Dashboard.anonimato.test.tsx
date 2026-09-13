import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Dashboard from "./Dashboard";

/**
 * O cartão de match não mostra nome (12/09/2026, pedido da cliente).
 *
 * A defesa de verdade é a consulta — `getMatchesForUser` nem seleciona nome,
 * foto, bio, nome civil, empresa ou cargo, e o router recorta o `matchedUserId`
 * antes de responder (server/a13-bloqueio-de-contato.test.ts e
 * server/profile-matches-portao.test.ts travam isso). Este arquivo trava a outra
 * metade: mesmo que a camada de dados REGRIDA e volte a mandar o nome, a tela
 * não o desenha. Por isso as fixturas anônimas daqui vêm com `displayName`
 * PREENCHIDO de propósito.
 *
 * A asserção ingênua — `queryByText("Carla")` — seria frouxa: passa se o nome
 * estiver dentro de um texto maior, num atributo (`title`, `aria-label`) ou se a
 * tela simplesmente não renderizou. Aqui a varredura é sobre o `innerHTML`
 * inteiro, que cobre atributo, e existe a trava anti-vacuidade: o teste do
 * estado revelado EXIGE o nome na tela, então se a fixtura parar de chegar ao
 * componente é ele que fica vermelho, e a negativa deixa de passar por vazio.
 */

const NOME_SECRETO = "Zoroastra Quindim";

type Resposta = { data?: unknown; isLoading?: boolean; isError?: boolean; error?: unknown };

const duble = vi.hoisted(() => {
  const respostas: Record<string, Resposta> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const procedimento = (caminho: string) => ({
    useQuery: (_input: unknown, opcoes?: { select?: (dados: never) => unknown }) => {
      const parcial = respostas[caminho] ?? {};
      const resultado = { data: undefined as unknown, isLoading: false, isPending: false, isError: false, error: null as unknown, refetch: vi.fn(), ...parcial };
      if (opcoes?.select && resultado.data !== undefined) resultado.data = opcoes.select(resultado.data as never);
      return resultado;
    },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, data: undefined }),
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
  return { respostas, trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null, GlobalMenu: () => null }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/SmartMatchConsent", () => ({ SmartMatchConsent: () => null }));

const ESPERA = { timeout: 3000 };

function cartao(extra: Record<string, unknown> = {}) {
  return {
    // Nota abaixo de 80 de propósito: a estrela de "Melhor conexão" mora DENTRO
    // do círculo do avatar, e este arquivo afirma que o círculo não tem letra.
    matchId: 1, overallScore: 60, userSeen: false,
    specialtyScore: 90, objectivesScore: 80, incomeScore: 70, locationScore: 60, valuesScore: 50,
    aiInsight: null, city: "Lisboa", country: "PT", primarySpecialty: "tech",
    seekingTypes: [], businessInterests: [], values: [], sector: null,
    // Preenchido DE PROPÓSITO nos casos anônimos: é o que prova que a tela não
    // vaza nem quando o servidor manda o que não devia.
    displayName: NOME_SECRETO,
    connectionId: null, connectionStatus: null, souDestinataria: null,
    ...extra,
  };
}

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
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

describe("cartão de match — anônimo até o interesse mútuo", () => {
  it("não desenha o nome em lugar nenhum, nem como inicial, nem em atributo", () => {
    render(<Dashboard />);

    // Camada 1+2: nome impossível de colidir, varrido no HTML inteiro (que cobre
    // title/aria-label, onde `textContent` não chegaria).
    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(document.body.innerHTML).not.toContain("Quindim");

    // Camada 3: asserção POSITIVA sobre o que está no lugar. Procurar a letra "Z"
    // solta seria frágil; exigir que o avatar anônimo não tenha texto nenhum mata
    // a inicial sem depender disso.
    const avatar = screen.getAllByLabelText("Identidade oculta")[0];
    expect(avatar.textContent?.trim()).toBe("");

    // Camada 5: o cartão RENDERIZOU — senão as negativas acima passariam por vazio.
    expect(screen.getByRole("heading", { name: "Membro da rede" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Demonstrar Interesse" })).toBeInTheDocument();
  });

  it("interesse enviado: o botão vira espera e não dá para pedir de novo", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "pending", souDestinataria: false })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    const espera = screen.getByRole("button", { name: /Interesse enviado/ });
    expect(espera).toBeDisabled();
    // Antes desta PR o botão continuava clicável e o segundo clique devolvia
    // erro vermelho de conflito.
    expect(screen.queryByRole("button", { name: "Demonstrar Interesse" })).not.toBeInTheDocument();
  });

  it("pedido recebido: oferece aceitar e revelar, e ainda assim não mostra quem é", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "pending", souDestinataria: true })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getByRole("heading", { name: "Membro da rede" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceitar e revelar" })).toBeInTheDocument();
    expect(screen.getByText("Demonstrou interesse em você")).toBeInTheDocument();
  });

  it("recusado continua anônimo, mesmo que o servidor mande o nome", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "declined", souDestinataria: true })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getByRole("button", { name: "Interesse não aceito" })).toBeDisabled();
  });

  // ── A TRAVA ANTI-VACUIDADE ──────────────────────────────────────────────
  // Se a fixtura parar de chegar ao componente — prop renomeada, dublê defasado,
  // tela que não renderiza —, é ESTE teste que fica vermelho. Sem ele, todas as
  // negativas acima passariam por não haver nada na tela.
  it("aceito: o nome APARECE, com o aviso de que a outra pessoa também vê o seu", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "accepted", souDestinataria: true })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).toContain("Zoroastra");
    expect(screen.getByRole("heading", { name: NOME_SECRETO })).toBeInTheDocument();
    expect(screen.getByText("Identidade revelada")).toBeInTheDocument();
    expect(screen.getByText(/A outra pessoa também vê seu nome/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Identidade oculta")).not.toBeInTheDocument();
  });

  it("aba Conexões: pedido pendente não mostra nome nem inicial", async () => {
    duble.respostas["connections.list"] = {
      data: [{ id: 7, status: "pending", souDestinataria: true, outraParteId: null, displayName: null, primarySpecialty: "finance", city: "Porto", message: null }],
    };
    render(<Dashboard />);
    // O nome acessível da aba traz a contagem; sem ela, casaria também com o
    // cartão de estatística de mesmo rótulo.
    fireEvent.click(screen.getByRole("button", { name: "Conexões (1)" }));

    expect(await screen.findByRole("button", { name: "Aceitar e revelar" }, ESPERA)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getAllByText("Membro da rede").length).toBeGreaterThan(0);
    expect(screen.getByText(/os dois lados passam a ver o nome/i)).toBeInTheDocument();
  });
});

// ── O passo do distribuidor ─────────────────────────────────────────────────
// Quem pediu vê "em análise" e depois, se for o caso, "não encaminhado". A
// destinatária não vê nada (o servidor nem manda a linha), a não ser que ela
// também tenha clicado — aí é "em análise" dos dois lados, nunca "Aceitar e
// revelar": a revelação é do distribuidor. Em nenhum desses estados há nome.
describe("cartão de match — o passo do distribuidor", () => {
  it("em análise (quem pediu): botão desabilitado, sem nome, sem pedir de novo e sem dispensar", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "in_review", souDestinataria: false })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getByRole("button", { name: "Em análise pelo distribuidor" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Demonstrar Interesse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar e revelar" })).not.toBeInTheDocument();
    // Não dá para sumir com o cartão enquanto alguém está decidindo sobre ele.
    expect(screen.queryByRole("button", { name: "✕" })).not.toBeInTheDocument();
  });

  it("não encaminhado: botão desabilitado, sem nome; o cartão pode ser dispensado", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "not_forwarded", souDestinataria: false })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getByRole("button", { name: "Interesse não encaminhado" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Demonstrar Interesse" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
  });

  it("em análise e recíproco (a destinatária também clicou): 'em análise', nunca 'Aceitar e revelar', e sem nome", () => {
    duble.respostas["matches.list"] = {
      data: [cartao({ connectionId: 7, connectionStatus: "in_review", souDestinataria: true })],
    };
    render(<Dashboard />);

    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getByRole("button", { name: "Em análise pelo distribuidor" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Aceitar e revelar" })).not.toBeInTheDocument();
    expect(screen.queryByText("Demonstrou interesse em você")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Membro da rede" })).toBeInTheDocument();
  });

  it("aba Conexões: em análise e não encaminhado têm badge própria, sem nome e sem 'Aceitar e revelar'", async () => {
    duble.respostas["connections.list"] = {
      data: [
        { id: 7, status: "in_review", souDestinataria: false, outraParteId: null, displayName: null, primarySpecialty: "finance", city: "Porto", message: null },
        { id: 8, status: "not_forwarded", souDestinataria: false, outraParteId: null, displayName: null, primarySpecialty: "tech", city: "Lisboa", message: null },
      ],
    };
    render(<Dashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Conexões (2)" }));

    expect(await screen.findByText("🔎 Em análise", {}, ESPERA)).toBeInTheDocument();
    expect(screen.getByText("✕ Não encaminhado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar e revelar" })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("Zoroastra");
    expect(screen.getAllByText("Membro da rede").length).toBe(2);
  });
});
