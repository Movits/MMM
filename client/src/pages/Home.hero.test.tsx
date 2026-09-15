import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Home from "./Home";

/**
 * Home — a primeira tela (Hero) conforme a spec da Glenda de 14/09, com as
 * decisões do Roberto e do grupo por cima dela:
 *
 * - selo: "Rede mundial de negócios entre membros • +30 países • infinitas
 *   possibilidades" (a spec dizia +33; o Rosber pediu 30 em 14/09);
 * - título: "Inteligência que conecta negócios que acontecem" (Rosber, 14/09),
 *   no lugar de "Grandes negócios começam com acesso às pessoas certas.";
 * - os demais textos da spec, palavra por palavra, com "mais de 30 países";
 * - UM só CTA "ENCONTRE SEU BUSINESS MATCH", na mesma rota do antigo
 *   "Criar meu perfil" (/register sem sessão, /dashboard com sessão);
 * - os quatro indicadores da plataforma NÃO aparecem mais na página pública,
 *   e a Home nem consulta stats.platform (os números moram no Dashboard).
 *
 * O globo 3D vira dublê (o jsdom não tem WebGL) e o tRPC também: o teste é da
 * tela, não do banco.
 */

const consultas = vi.hoisted(() => ({
  platform: vi.fn(() => ({ data: { users: 26, opportunities: 11, connections: 42, countries: 7, bronze: 4, silver: 25, gold: 1 } })),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/GloboDoMundo", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    stats: {
      platform: { useQuery: consultas.platform },
      presencaPorPais: { useQuery: () => ({ data: undefined }) },
    },
    faq: { ask: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, data: undefined }) } },
  },
}));

class IntersectionObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

function comSessao(isAuthenticated: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    user: isAuthenticated ? { id: 1, name: "Ana", role: "silver" } : null,
    loading: false, error: null, isAuthenticated, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

/** A Hero é a seção que contém o único h1 da página. */
function hero() {
  render(<Home />);
  const secao = screen.getByRole("heading", { level: 1 }).closest("section");
  if (!secao) throw new Error("o h1 saiu de dentro da seção da Hero");
  return secao;
}

beforeEach(async () => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverFalso);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  consultas.platform.mockClear();
  await i18n.changeLanguage("pt-BR");
  comSessao(false);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("pt-BR");
});

describe("Home — Hero", () => {
  it("o selo traz a frase inteira com +30 países, e o ponto luminoso continua antes dela", () => {
    const secao = hero();
    const frase = "Rede mundial de negócios entre membros • +30 países • infinitas possibilidades";
    // Leitor de tela recebe a frase inteira; na tela ela vem em três trechos
    // (a quebra do celular cai entre eles).
    const inteira = within(secao).getByText(frase);
    expect(inteira).toHaveClass("sr-only");
    const selo = inteira.parentElement as HTMLElement;
    const ponto = selo.firstElementChild as HTMLElement;
    expect(ponto.tagName).toBe("SPAN");
    expect(ponto).toHaveClass("animate-pulse");
    expect(within(selo).getByText("+30 países")).toBeInTheDocument();
    expect(within(selo).getByText("infinitas possibilidades")).toBeInTheDocument();
  });

  it("o título é o novo, e o título da spec não aparece mais", () => {
    const secao = hero();
    const titulo = within(secao).getByRole("heading", { level: 1 });
    expect(titulo).toHaveTextContent(/^Inteligência que conecta negócios que acontecem$/);
    expect(screen.queryByText(/Grandes negócios começam com acesso/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Encontre as oportunidades certas para você/)).not.toBeInTheDocument();
  });

  it("os demais textos da Hero são os da spec, palavra por palavra, com mais de 30 países", () => {
    const s = within(hero());
    for (const texto of [
      "Imagine uma rede capaz de identificar quem você precisa conhecer — e quem precisa conhecer você.",
      "Nossa inteligência artificial cruza perfis, interesses, necessidades e oportunidades para revelar conexões estratégicas que talvez você nunca encontrasse sozinho.",
      "Seu próximo grande negócio pode já estar aqui.",
      "Descubra quem, onde e qual oportunidade combina com você.",
      "Encontre o seu Business Match.",
    ]) {
      expect(s.getByText(texto), texto).toBeInTheDocument();
    }
    // Esta frase é montada em três pedaços (o país vem em negrito), por isso
    // se confere o parágrafo inteiro pelo texto corrido.
    const alcance = s.getByText("mais de 30 países").closest("p");
    expect(alcance).toHaveTextContent(/^Com embaixadoras em mais de 30 países, conectamos você a pessoas, oportunidades e negócios em uma rede global sem fronteiras\.$/);
  });

  it("nenhum lugar da página fala em match, fora o nome próprio Business Match (troca por 'conexão', 14/09)", () => {
    render(<Home />);
    const texto = document.body.textContent ?? "";
    // Anti-vacuidade: a página renderizou e o nome próprio continua lá.
    expect(texto).toMatch(/Business Match/);
    expect(texto.replace(/Smart Match|Business Match(es)?/gi, "")).not.toMatch(/match/i);
  });

  it("nenhum lugar da página fala em 33 países", () => {
    render(<Home />);
    expect(document.body.textContent).not.toMatch(/33 países|\+33|33\+/);
    expect(document.body.textContent).toMatch(/mais de 30 países/);
  });

  it("há um só CTA principal, ENCONTRE SEU BUSINESS MATCH, na rota de sempre do cadastro", () => {
    const s = within(hero());
    const ctas = s.getAllByRole("button", { name: /ENCONTRE SEU BUSINESS MATCH/ });
    expect(ctas).toHaveLength(1);
    expect(ctas[0].closest("a")).toHaveAttribute("href", "/register");
    expect(screen.queryByText(/Criar meu perfil/)).not.toBeInTheDocument();
  });

  it("com sessão, o mesmo CTA leva ao Dashboard, como o botão antigo", () => {
    comSessao(true);
    const s = within(hero());
    const cta = s.getByRole("button", { name: /ENCONTRE SEU BUSINESS MATCH/ });
    expect(cta.closest("a")).toHaveAttribute("href", "/dashboard");
  });

  it("os indicadores da plataforma não aparecem na Home, e ela nem consulta stats.platform", () => {
    render(<Home />);
    for (const rotulo of ["Pessoas cadastradas", "Oportunidades ativas", "Conexões realizadas", "Países representados"]) {
      expect(screen.queryByText(rotulo), rotulo).not.toBeInTheDocument();
    }
    // O dublê devolveria 26, 11, 42 e 7: se a consulta voltasse a ser lida e
    // exibida, algum desses números apareceria.
    expect(consultas.platform).not.toHaveBeenCalled();
    for (const numero of ["26", "11", "42"]) {
      expect(screen.queryByText(numero), numero).not.toBeInTheDocument();
    }
  });

  it("o selo e o título mudam de idioma junto com a página (sem chave crua)", async () => {
    await i18n.changeLanguage("en");
    const s = within(hero());
    expect(s.getByRole("heading", { level: 1 })).toHaveTextContent("Intelligence that connects deals that happen");
    expect(s.getByText("Global business network among members • +30 countries • endless possibilities")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/hero\.\w/);
  });
});
