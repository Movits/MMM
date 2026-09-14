import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Home from "./Home";

/**
 * A seção "Oportunidades" da Home deixou de ser um catálogo de tipos de
 * networking (Sociedade, Mentoria, Emprego...) e passou a falar de negócio:
 * internacionalizar, vender produtos, vender serviços, investimento, parcerias
 * e oportunidades.
 *
 * O que este teste guarda, e que não se vê lendo o JSX:
 *
 *  1. Os seis cartões, na ordem pedida, e nenhum dos seis antigos. Uma chave
 *     de tradução esquecida apareceria como o caminho da chave
 *     ("opportunities.jobs.label"), e o teste pega isso também.
 *  2. O botão do fechamento NÃO é um CTA novo: mesmo texto do botão da Hero
 *     (lê a mesma chave) e mesma rota — /register para quem não entrou,
 *     /dashboard para quem entrou. Se alguém trocar a rota de um e esquecer o
 *     outro, este teste quebra.
 */

const duble = vi.hoisted(() => {
  const procedimento = () => ({
    useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, data: undefined }),
  });
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const trpc = new Proxy({}, {
    get: (_, router) => ignorar(router) ? undefined : new Proxy({}, {
      get: (_, proc) => ignorar(proc) ? undefined : procedimento(),
    }),
  });
  return { trpc };
});

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
// O planeta é three.js em WebGL, que o jsdom não tem; a seção não depende dele.
vi.mock("@/components/GloboDoMundo", () => ({ default: () => null }));

beforeAll(() => {
  // O jsdom não traz IntersectionObserver nem matchMedia. O observador entrega
  // "visível" na hora, que é o que acontece quando a seção entra na tela.
  class ObservadorSempreVisivel {
    constructor(private aviso: IntersectionObserverCallback) {}
    observe(alvo: Element) {
      this.aviso([{ isIntersecting: true, target: alvo } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", ObservadorSempreVisivel);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});

function entrar(isAuthenticated: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    user: isAuthenticated ? { id: 1, name: "Ana", role: "silver" } : null,
    loading: false, error: null, isAuthenticated, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

function secaoOportunidades() {
  const { container } = render(<Home />);
  const secao = container.querySelector<HTMLElement>("section#oportunidades");
  if (!secao) throw new Error("a seção #oportunidades sumiu (o menu rola até ela pelo id)");
  return within(secao);
}

beforeEach(() => entrar(false));

describe("seção Oportunidades da Home", () => {
  it("tem o título, o subtítulo e os seis cartões novos, na ordem pedida", () => {
    const secao = secaoOportunidades();

    expect(secao.getByRole("heading", { level: 2, name: "Até onde o seu próximo negócio pode chegar?" })).toBeInTheDocument();
    expect(secao.getByText("Conecte-se às pessoas certas para vender, expandir, investir e transformar oportunidades em negócios — no Brasil e no mundo.")).toBeInTheDocument();

    const cartoes = secao.getAllByRole("heading", { level: 3 }).map(h => h.textContent);
    expect(cartoes).toEqual([
      "Internacionalize seu negócio",
      "Venda seus produtos",
      "Venda seus serviços",
      "Encontre investimentos",
      "Construa parcerias estratégicas",
      "Encontre oportunidades",
    ]);
  });

  it("não mostra nenhum dos cartões antigos nem caminho de chave sem tradução", () => {
    const secao = secaoOportunidades();
    // Por texto exato, não por papel de título: os cartões antigos eram <div>,
    // e uma busca por heading passaria mesmo com eles na tela.
    for (const antigo of ["Sociedade", "Investimento", "Mentoria", "Parceria", "Projetos", "Emprego"]) {
      expect(secao.queryByText(antigo), antigo).not.toBeInTheDocument();
    }
    expect(secao.queryByText(/opportunities\./)).not.toBeInTheDocument();
  });

  it("mostra o alcance, da cidade ao mercado novo, e a frase de fechamento", () => {
    const secao = secaoOportunidades();
    const marcos = secao.getAllByRole("listitem").map(li => li.textContent);
    expect(marcos).toEqual(["Na sua cidade", "Em outro estado", "Em outro país", "Em novos mercados"]);
    expect(secao.getByText("Você diz onde quer chegar. Nossa inteligência encontra quem pode ajudar você a chegar lá.")).toBeInTheDocument();
  });

  it("o botão é o mesmo CTA da Hero: mesmo texto e mesma rota, para quem não entrou", () => {
    const secao = secaoOportunidades();
    const botao = secao.getByRole("button", { name: "ENCONTRE SEU BUSINESS MATCH" });
    expect(botao.closest("a")).toHaveAttribute("href", "/register");

    // O da Hero, fora da seção, com o mesmo texto e o mesmo destino.
    const todos = screen.getAllByRole("button", { name: "ENCONTRE SEU BUSINESS MATCH" });
    expect(todos.length).toBeGreaterThan(1);
    expect(new Set(todos.map(b => b.closest("a")?.getAttribute("href")))).toEqual(new Set(["/register"]));
  });

  it("para quem já entrou, o mesmo botão leva ao Dashboard", () => {
    entrar(true);
    const secao = secaoOportunidades();
    const botao = secao.getByRole("button", { name: "ENCONTRE SEU BUSINESS MATCH" });
    expect(botao.closest("a")).toHaveAttribute("href", "/dashboard");
  });
});
