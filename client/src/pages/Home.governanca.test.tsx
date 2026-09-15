import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { LANGUAGES } from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Home from "./Home";

/**
 * Home — seção Governança com o conceito novo de Bronze, Prata e Ouro (spec da
 * Glenda de 14/09, prompt "GOVERNANÇA").
 *
 * O que se trava aqui, e que não se vê lendo o JSX:
 * - os números de membros por nível saíram da página pública (a spec manda
 *   mostrá-los só no Dashboard): o dublê de stats.platform devolve contagens
 *   e nenhuma pode aparecer, nem a consulta pode ser feita;
 * - os textos de Bronze, Prata e Ouro são os da spec, palavra por palavra;
 * - Bronze e Prata aparecem sem mensalidade, com a participação da plataforma
 *   só nos negócios concretizados; Ouro aparece como categoria premium
 *   mediante mensalidade — e NENHUM número na seção (nem preço nem percentual);
 * - o conceito antigo ("não se compra, se conquista", "concedido por mérito")
 *   sumiu, inclusive da FAQ, que o contradiria;
 * - os 10 idiomas renderizam a seção sem chave crua.
 */

const consultas = vi.hoisted(() => ({
  platform: vi.fn(() => ({ data: { users: 26, opportunities: 11, connections: 42, countries: 7, bronze: 8, silver: 25, gold: 3 } })),
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

function secaoGovernanca() {
  const { container } = render(<Home />);
  const secao = container.querySelector<HTMLElement>("section#governanca");
  if (!secao) throw new Error("a seção #governanca sumiu");
  return secao;
}

/** O cartão de um nível: o bloco que contém o h3 com aquele título. */
function cartao(secao: HTMLElement, titulo: string) {
  const h3 = within(secao).getByRole("heading", { level: 3, name: titulo });
  const bloco = h3.parentElement;
  if (!bloco) throw new Error("h3 sem cartão: " + titulo);
  return within(bloco);
}

beforeEach(async () => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverFalso);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  consultas.platform.mockClear();
  vi.mocked(useAuth).mockReturnValue({
    user: null, loading: false, error: null, isAuthenticated: false, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  await i18n.changeLanguage("pt-BR");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("pt-BR");
});

describe("Home — Governança (Bronze, Prata e Ouro)", () => {
  it("a mensagem principal e o subtítulo são os novos, e o conceito antigo sumiu", () => {
    const s = within(secaoGovernanca());
    expect(s.getByRole("heading", { level: 2, name: "Quanto mais a plataforma conhece você, mais precisas se tornam suas conexões." })).toBeInTheDocument();
    expect(s.getByText("Qualifique seu perfil, amplie suas possibilidades e escolha até onde você quer chegar.")).toBeInTheDocument();

    expect(screen.queryByText(/regras claras e confiança/)).not.toBeInTheDocument();
    expect(screen.queryByText(/não se compra/)).not.toBeInTheDocument();
    expect(screen.queryByText(/concedido exclusivamente por mérito/)).not.toBeInTheDocument();
  });

  it("não mostra quantos membros há em cada nível, nem consulta esses números", () => {
    const secao = secaoGovernanca();
    expect(consultas.platform).not.toHaveBeenCalled();
    // Nenhum algarismo na seção: nem contagem de membros, nem preço, nem percentual.
    expect(secao.textContent).not.toMatch(/\d/);
  });

  it("três cartões, na ordem Bronze, Prata, Ouro, com a etapa de cada um", () => {
    const secao = secaoGovernanca();
    const titulos = within(secao).getAllByRole("heading", { level: 3 }).map(h => h.textContent);
    expect(titulos).toEqual(["MEMBRO BRONZE", "MEMBRO PRATA", "STATUS OURO"]);
    expect(cartao(secao, "MEMBRO BRONZE").getByText("Perfil em construção")).toBeInTheDocument();
    expect(cartao(secao, "MEMBRO PRATA").getByText("Perfil qualificado")).toBeInTheDocument();
    expect(cartao(secao, "STATUS OURO").getByText("Experiência premium + acesso estratégico")).toBeInTheDocument();
  });

  it("Membro Bronze traz chamada, texto e destaque da spec", () => {
    const bronze = cartao(secaoGovernanca(), "MEMBRO BRONZE");
    expect(bronze.getByText("Seu ponto de partida.")).toBeInTheDocument();
    expect(bronze.getByText("Você já faz parte da rede. Agora, quanto mais completo e qualificado estiver o seu perfil, maior será a capacidade da nossa inteligência de identificar conexões compatíveis com você.")).toBeInTheDocument();
    expect(bronze.getByText("Complete Quem Sou, O Que Tenho e O Que Preciso para aumentar a precisão do seu Business Match.")).toBeInTheDocument();
  });

  it("Membro Prata traz chamada, texto e destaque da spec", () => {
    const prata = cartao(secaoGovernanca(), "MEMBRO PRATA");
    expect(prata.getByText("Mais informação. Mais precisão. Melhores conexões.")).toBeInTheDocument();
    expect(prata.getByText("Um perfil qualificado permite que nossa inteligência compreenda melhor quem você é, o que pode oferecer e o que procura — aumentando a precisão das conexões e oportunidades apresentadas a você.")).toBeInTheDocument();
    expect(prata.getByText("Perfil qualificado para conexões estratégicas e um Business Match mais preciso.")).toBeInTheDocument();
  });

  it("Bronze e Prata: sem mensalidade, e a plataforma participa só dos negócios concretizados", () => {
    const secao = secaoGovernanca();
    const aviso = within(secao).getByText("Sem mensalidade. A plataforma participa dos negócios efetivamente concretizados por sua intermediação, conforme as condições aplicáveis a cada operação.");
    // O aviso vale para os dois níveis de qualificação, não para o Ouro.
    const ouro = within(secao).getByRole("heading", { level: 3, name: "STATUS OURO" }).parentElement as HTMLElement;
    expect(ouro).not.toContainElement(aviso);
  });

  it("Status Ouro: premium mediante mensalidade, com os cinco benefícios, destaque e fechamento da spec", () => {
    const ouro = cartao(secaoGovernanca(), "STATUS OURO");
    expect(ouro.getByText("Esteja onde as grandes oportunidades chegam primeiro.")).toBeInTheDocument();
    expect(ouro.getByText("O Status Ouro oferece uma experiência premium para quem deseja estar mais próximo das melhores oportunidades, conexões e ambientes estratégicos da nossa rede nacional e internacional.")).toBeInTheDocument();
    expect(ouro.getAllByRole("listitem").map(li => li.textContent)).toEqual([
      "Acesso em primeira mão a oportunidades selecionadas de negócios nacionais e internacionais.",
      "Acesso privilegiado a conexões e oportunidades estratégicas disponibilizadas pela rede.",
      "Convites e acesso a encontros estratégicos nacionais e internacionais promovidos ou selecionados pela rede.",
      "Experiências e ambientes de relacionamento de alto nível.",
      "Prioridade na comunicação de oportunidades exclusivas destinadas à categoria Ouro.",
    ]);
    expect(ouro.getByText("Algumas oportunidades não chegam a todos ao mesmo tempo.")).toBeInTheDocument();
    expect(ouro.getByText("Ouro é estar mais perto de onde as conexões e os grandes negócios acontecem.")).toBeInTheDocument();
    expect(ouro.getByText("Categoria premium mediante mensalidade.")).toBeInTheDocument();
    // Nada de checkout: o cartão não tem botão nem link.
    expect(ouro.queryAllByRole("button")).toHaveLength(0);
    expect(ouro.queryAllByRole("link")).toHaveLength(0);
  });

  it("a FAQ dos níveis acompanha o conceito novo", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /Quais são os níveis de membro da plataforma/ }));
    const niveis = screen.getByText(/^São três: Bronze, Prata e Ouro\./);
    expect(niveis).toHaveTextContent("Nenhum dos dois tem mensalidade.");
    expect(niveis).toHaveTextContent("mediante mensalidade");
    expect(niveis).not.toHaveTextContent(/verificação de identidade/);

    fireEvent.click(screen.getByRole("button", { name: /O que é o nível Ouro e como consigo/ }));
    const ouro = screen.getByText(/^O Status Ouro é a categoria premium da rede/);
    expect(ouro).toHaveTextContent("não é uma evolução automática do Prata");
    expect(ouro).not.toHaveTextContent(/mérito/);
  });

  it.each(LANGUAGES.map(l => l.code))("em %s a seção renderiza inteira, sem chave crua", async (idioma) => {
    await i18n.changeLanguage(idioma);
    const secao = secaoGovernanca();
    expect(secao.textContent).not.toMatch(/governance\./);
    expect(within(secao).getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(within(secao).getAllByRole("listitem")).toHaveLength(5);
  });
});
