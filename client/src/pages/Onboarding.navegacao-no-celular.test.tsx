import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * Relatos do Rosber de 16/09/2026 (áudios no grupo), sobre o cadastro no celular,
 * na véspera do lançamento:
 *
 *  1. "Quando você passa para a próxima tela, ela não vai para o topo" — já havia
 *     um scrollTo, mas herdava o `scroll-behavior: smooth` do index.css;
 *  2. "Quando você clica em voltar (...) do browser ou do celular, ele não volta
 *     uma tela, ele volta para a primeira tela de cadastro";
 *  3. "Você arrastar para baixo (...) ele gira o botãozinho de atualizar e acaba
 *     voltando para a primeira tela do cadastro e (...) desmarca a maioria das
 *     coisas que você marcou".
 *
 * Remontar o componente sem limpar o sessionStorage nem o histórico é o
 * RECARREGAR da mesma aba (o jsdom mantém os dois, como o navegador).
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string>; steps: Record<string, string> };
  oQueBusca: { opcoes: Record<string, { titulo: string }> };
  termoGeral: Record<string, string>;
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  perfil: null as unknown,
  perfilCarregando: false,
  navegacoes: [] as Array<{ destino: string; opcoes?: unknown }>,
  status: { data: undefined as unknown, isLoading: false, isError: false },
  chamadas: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: duble.perfil, isLoading: duble.perfilCarregando }) },
      completeOnboarding: {
        useMutation: (opcoesDoHook?: { onSuccess?: () => void }) => ({
          mutate: (vars: unknown) => {
            duble.chamadas.push(["profile.completeOnboarding", vars]);
            opcoesDoHook?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    consent: {
      accept: {
        useMutation: () => ({
          mutate: (vars: unknown, opcoes?: Opcoes) => {
            duble.chamadas.push(["consent.accept", vars]);
            opcoes?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      status: { useQuery: () => ({ ...duble.status, refetch: () => Promise.resolve() }) },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({ auth: { me: { setData: () => {}, invalidate: () => Promise.resolve() } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", (destino: string, opcoes?: unknown) => { duble.navegacoes.push({ destino, opcoes }); }],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

import Onboarding from "./Onboarding";

const TERMO = { id: "termo-v1", type: "termo_geral_de_uso", version: 1, text: "# TERMO\n\n1.1. Texto.\n", publishedAt: new Date("2026-09-15T12:00:00Z") };
const CHAVE_DA_7 = "mmm.onboarding.rascunho.7";
const CLASSE_SEM_PUXAR = "cadastro-sem-puxar-para-atualizar";

const campo = (placeholder: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).find(c => c.placeholder === placeholder);
const campoNome = () => campo(pt.onboarding.fields.displayNamePlaceholder)!;
const campoCidade = () => campo(pt.onboarding.fields.cityPlaceholder)!;
const titulo = () => screen.getByRole("heading", { level: 1 });
const contador = (etapa: number) => screen.getByText(`${etapa} / 8`);
const marcado = (texto: string) => screen.getByText(texto).closest("button")!.className.includes("border-[#c98f70]");

/** Deixa rodar a animação da troca (220 ms) e o popstate, que o jsdom entrega num timer. */
const esperarATroca = () => act(() => { vi.advanceTimersByTime(300); });

function continuar() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) }));
  esperarATroca();
}

function voltarNaTela() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.back) }));
  esperarATroca();
}

function voltarNoNavegador() {
  window.history.back();
  esperarATroca();
}

function avancarNoNavegador() {
  window.history.forward();
  esperarATroca();
}

/** Etapas 1 a 3 preenchidas, parando na etapa 4 (setor). */
function irAteAEtapa4() {
  fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
  fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
  continuar();
  fireEvent.click(screen.getByText(pt.onboarding.specialties.tech).closest("button")!);
  continuar();
  fireEvent.click(screen.getByText(pt.oQueBusca.opcoes.expandir_negocio.titulo).closest("button")!);
  fireEvent.click(screen.getByText(pt.onboarding.income.under_3k).closest("button")!);
  continuar();
}

let chamadasDeRolagem: Array<{ opcoes: unknown; tituloNaHora: string | null; comportamentoNaHora: string }>;

beforeEach(() => {
  vi.useFakeTimers();
  chamadasDeRolagem = [];
  // jsdom não implementa scrollTo: o dublê registra COMO e QUANDO foi chamado.
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    writable: true,
    value: (opcoes: unknown) => {
      chamadasDeRolagem.push({
        opcoes,
        tituloNaHora: document.querySelector("h1")?.textContent ?? null,
        comportamentoNaHora: document.documentElement.style.scrollBehavior,
      });
    },
  });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "");
  duble.perfil = { user: { id: 7, name: "Fulana" }, profile: null };
  duble.perfilCarregando = false;
  duble.navegacoes.length = 0;
  duble.status = { data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null }, isLoading: false, isError: false };
  duble.chamadas.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1 — cada etapa nova começa do topo, com o foco no título", () => {
  it("avançar rola ao topo NA HORA (instant, com o smooth do html desligado), depois de a etapa nova estar na tela", () => {
    render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
    fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
    const raiz = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    raiz.scrollTop = 900;
    chamadasDeRolagem = [];

    continuar();

    expect(chamadasDeRolagem).toHaveLength(1);
    const [chamada] = chamadasDeRolagem;
    // "auto" herdaria o `scroll-behavior: smooth` do index.css.
    expect(chamada.opcoes).toMatchObject({ top: 0, behavior: "instant" });
    expect(chamada.comportamentoNaHora).toBe("auto");
    // Rolou com o título da etapa 2 já no DOM, e não antes da troca.
    expect(chamada.tituloNaHora).toBe(pt.onboarding.steps.s2_title);
    expect(raiz.scrollTop).toBe(0);
    // O html volta ao que era: a rolagem suave do resto do site não muda.
    expect(document.documentElement.style.scrollBehavior).toBe("");
    expect(titulo()).toHaveTextContent(pt.onboarding.steps.s2_title);
    expect(document.activeElement).toBe(titulo());
  });

  it("voltar (na tela ou no navegador) também leva ao topo e ao título", () => {
    render(<Onboarding />);
    irAteAEtapa4();
    chamadasDeRolagem = [];

    voltarNaTela();
    expect(chamadasDeRolagem.at(-1)?.tituloNaHora).toBe(pt.onboarding.steps.s3_title);
    expect(document.activeElement).toBe(titulo());

    voltarNoNavegador();
    expect(chamadasDeRolagem.at(-1)?.tituloNaHora).toBe(pt.onboarding.steps.s2_title);
    expect(document.activeElement).toBe(titulo());
  });
});

describe("2 — o voltar do navegador volta UMA etapa", () => {
  it("cada etapa é uma entrada do histórico, na mesma URL", () => {
    render(<Onboarding />);
    const urlAntes = window.location.href;

    irAteAEtapa4();

    // (history.length não serve: o jsdom, como o Chrome, limita a pilha a 50.)
    expect(contador(4)).toBeInTheDocument();
    for (const etapa of [4, 3, 2, 1]) {
      expect(window.history.state, `entrada da etapa ${etapa}`).toMatchObject({ etapaDoCadastro: etapa });
      expect(window.location.href).toBe(urlAntes);
      if (etapa > 1) voltarNoNavegador();
    }
    expect(contador(1)).toBeInTheDocument();
  });

  it("voltar do navegador: 4 → 3 → 2, com as respostas no lugar; avançar do navegador refaz o caminho", () => {
    render(<Onboarding />);
    irAteAEtapa4();

    voltarNoNavegador();
    expect(contador(3)).toBeInTheDocument();
    expect(marcado(pt.onboarding.income.under_3k)).toBe(true);

    voltarNoNavegador();
    expect(contador(2)).toBeInTheDocument();
    expect(marcado(pt.onboarding.specialties.tech)).toBe(true);

    avancarNoNavegador();
    expect(contador(3)).toBeInTheDocument();
  });

  it("o Voltar da tela anda no histórico, em vez de empilhar entrada nova", () => {
    render(<Onboarding />);
    irAteAEtapa4();

    voltarNaTela();

    expect(contador(3)).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ etapaDoCadastro: 3 });
    // A entrada da 4 continua À FRENTE (empilhar teria apagado): o avançar do
    // navegador leva de volta a ela.
    avancarNoNavegador();
    expect(contador(4)).toBeInTheDocument();
  });

  it("avançar do navegador não pula etapa que deixou de estar completa", () => {
    render(<Onboarding />);
    irAteAEtapa4();
    voltarNoNavegador(); // 4 → 3
    // Desmarca a única busca: a etapa 3 deixa de estar completa.
    fireEvent.click(screen.getByText(pt.oQueBusca.opcoes.expandir_negocio.titulo).closest("button")!);

    avancarNoNavegador();

    expect(contador(3)).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ etapaDoCadastro: 3 });
  });
});

describe("3 — recarregar (inclusive o puxar para atualizar) não perde a etapa nem as respostas", () => {
  it("reabre na etapa em que estava, com a renda (que não fica no localStorage) marcada", () => {
    const { unmount } = render(<Onboarding />);
    irAteAEtapa4();
    voltarNoNavegador(); // está na 3
    unmount();

    render(<Onboarding />);
    esperarATroca();

    expect(contador(3)).toBeInTheDocument();
    expect(marcado(pt.onboarding.income.under_3k)).toBe(true);
    expect(marcado(pt.oQueBusca.opcoes.expandir_negocio.titulo)).toBe(true);
    // E o voltar do navegador continua voltando uma etapa depois de recarregar.
    voltarNoNavegador();
    expect(contador(2)).toBeInTheDocument();
    expect(marcado(pt.onboarding.specialties.tech)).toBe(true);
  });

  it("aberta numa entrada nova da mesma aba, reabre na etapa e refaz a pilha do histórico", () => {
    // A aba saiu do cadastro e voltou por outra rota (o ProtectedRoute manda de
    // volta a /onboarding): a entrada é nova, mas o rascunho da aba continua.
    const { unmount } = render(<Onboarding />);
    irAteAEtapa4();
    unmount();
    window.history.replaceState(null, "");

    render(<Onboarding />);
    esperarATroca();

    expect(contador(4)).toBeInTheDocument();
    voltarNoNavegador();
    expect(contador(3)).toBeInTheDocument();
    voltarNoNavegador();
    expect(contador(2)).toBeInTheDocument();
  });

  it("não reabre além do que as respostas permitem: falta o setor, abre na etapa 4", () => {
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({
      displayName: "Fulana", city: "Recife", primarySpecialties: ["tech"], seekingTypes: ["expandir_negocio"], salvoEm: Date.now(),
    }));
    window.sessionStorage.setItem(CHAVE_DA_7, JSON.stringify({ etapa: 6, incomeRange: "under_3k", salvoEm: Date.now() }));

    render(<Onboarding />);
    esperarATroca();

    expect(contador(4)).toBeInTheDocument();
    expect(window.history.state).toMatchObject({ etapaDoCadastro: 4 });
  });

  it("o rascunho da aba não abre etapa para outra usuária no mesmo navegador", () => {
    window.sessionStorage.setItem(CHAVE_DA_7, JSON.stringify({ etapa: 3, incomeRange: "under_3k", salvoEm: Date.now() }));
    duble.perfil = { user: { id: 8, name: "Beltrana Silva" }, profile: { city: "Recife" } };

    render(<Onboarding />);
    esperarATroca();

    expect(contador(1)).toBeInTheDocument();
  });

  it("o rascunho da aba some ao concluir o cadastro", () => {
    render(<Onboarding />);
    irAteAEtapa4();
    fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
    continuar(); // 5
    continuar(); // 6
    continuar(); // 7
    continuar(); // 8
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toContain("\"etapa\":8");

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) }));

    expect(duble.chamadas.some(([nome]) => nome === "profile.completeOnboarding")).toBe(true);
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
  });

  it("enquanto o cadastro está aberto, o html desliga o puxar para atualizar; ao sair, volta", () => {
    const { unmount } = render(<Onboarding />);
    expect(document.documentElement).toHaveClass(CLASSE_SEM_PUXAR);
    unmount();
    expect(document.documentElement).not.toHaveClass(CLASSE_SEM_PUXAR);
  });
});

describe("4 — revisão de 16/09: recarregar, concluir e voltar rápido", () => {
  const RASCUNHO_ATE_A_ETAPA_4 = {
    displayName: "Fulana", city: "Recife", primarySpecialties: ["tech"], seekingTypes: ["expandir_negocio"],
    sector: pt.onboarding.sectors.technology,
  };
  const carregando = () => screen.queryByText(pt.onboarding.nav.carregando);

  it("recarregar com o perfil ainda chegando mostra o carregando, nunca a etapa 1 vazia", () => {
    // Estava na etapa 5, com as respostas, e recarregou; o profile.get ainda não voltou.
    window.history.replaceState({ etapaDoCadastro: 5 }, "");
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ ...RASCUNHO_ATE_A_ETAPA_4, salvoEm: Date.now() }));
    window.sessionStorage.setItem(CHAVE_DA_7, JSON.stringify({ etapa: 5, incomeRange: "under_3k", salvoEm: Date.now() }));
    duble.perfil = undefined;
    duble.perfilCarregando = true;

    const { rerender } = render(<Onboarding />);

    expect(carregando()).toBeInTheDocument();
    expect(screen.queryByText("1 / 8")).not.toBeInTheDocument();
    expect(campoNome(), "nenhum campo para tocar enquanto o rascunho não voltou").toBeUndefined();

    duble.perfil = { user: { id: 7, name: "Fulana" }, profile: null };
    duble.perfilCarregando = false;
    rerender(<Onboarding />);

    expect(carregando()).not.toBeInTheDocument();
    expect(contador(5)).toBeInTheDocument();
  });

  it("concluir tira as etapas do caminho do voltar: a pilha volta à entrada 1 e o Dashboard toma o lugar dela", () => {
    render(<Onboarding />);
    irAteAEtapa4();
    fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
    continuar(); continuar(); continuar(); continuar();
    expect(window.history.state).toMatchObject({ etapaDoCadastro: 8 });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) }));
    // A ida ao Dashboard espera o history.go chegar à entrada 1.
    expect(duble.navegacoes).toEqual([]);
    esperarATroca();

    expect(window.history.state).toMatchObject({ etapaDoCadastro: 1 });
    // replace: o Dashboard OCUPA a entrada 1, e o voltar dele sai do cadastro.
    expect(duble.navegacoes).toEqual([{ destino: "/dashboard", opcoes: { replace: true } }]);
    // A rede de segurança de 1 s não navega de novo, e o recolhimento não trocou de etapa nem regravou rascunho.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(duble.navegacoes).toHaveLength(1);
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
  });

  it("entrada de etapa de um cadastro já concluído, sem rascunho da aba, vai ao Dashboard em vez de reabrir", () => {
    // O voltar do Dashboard caiu numa etapa que ficou na pilha (a página tinha recarregado no meio do cadastro).
    window.history.replaceState({ etapaDoCadastro: 3 }, "");
    duble.perfil = { user: { id: 7, name: "Fulana", onboardingCompleted: true }, profile: { displayName: "Fulana", city: "Recife" } };

    render(<Onboarding />);

    expect(duble.navegacoes).toEqual([{ destino: "/dashboard", opcoes: { replace: true } }]);
    expect(campoNome()).toBeUndefined();
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
  });

  it("'Refazer cadastro' (entrada nova) e recarregar no meio dele continuam abrindo o cadastro", () => {
    duble.perfil = { user: { id: 7, name: "Fulana", onboardingCompleted: true }, profile: null };
    const { unmount } = render(<Onboarding />);
    expect(contador(1)).toBeInTheDocument();
    irAteAEtapa4();
    unmount();

    render(<Onboarding />);
    esperarATroca();

    expect(contador(4)).toBeInTheDocument();
    expect(duble.navegacoes).toEqual([]);
  });

  it("três voltar rápidos (antes dos 220 ms da troca) gravam a etapa de destino, e sair reabre nela", () => {
    const { unmount } = render(<Onboarding />);
    irAteAEtapa4();

    for (let i = 0; i < 3; i++) {
      window.history.back();
      act(() => { vi.advanceTimersByTime(50); });
    }

    expect(window.history.state).toMatchObject({ etapaDoCadastro: 1 });
    expect(JSON.parse(window.sessionStorage.getItem(CHAVE_DA_7)!)).toMatchObject({ etapa: 1 });
    esperarATroca();
    unmount();
    // Saiu e voltou ao cadastro por outra rota (entrada nova): abre na 1, e não na 4 de onde tinha saído.
    window.history.replaceState(null, "");
    render(<Onboarding />);
    esperarATroca();
    expect(contador(1)).toBeInTheDocument();
  });

  it("rascunho da aba vencido (mais de 7 dias) ou sem data é ignorado: nem etapa nem renda voltam", () => {
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ ...RASCUNHO_ATE_A_ETAPA_4, salvoEm: Date.now() }));
    for (const daAba of [
      { etapa: 4, incomeRange: "under_3k", salvoEm: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      { etapa: 4, incomeRange: "under_3k" },
    ]) {
      window.sessionStorage.setItem(CHAVE_DA_7, JSON.stringify(daAba));
      window.history.replaceState(null, "");
      const { unmount } = render(<Onboarding />);
      esperarATroca();
      expect(contador(1)).toBeInTheDocument();
      unmount();
    }
  });

  it("enquanto o cadastro está aberto, o navegador não devolve a rolagem da entrada (scrollRestoration manual)", () => {
    window.history.scrollRestoration = "auto";
    const { unmount } = render(<Onboarding />);
    expect(window.history.scrollRestoration).toBe("manual");
    unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });
});
