import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import ptBR from "@/i18n/locales/pt-BR.json";
import ja from "@/i18n/locales/ja.json";
import ar from "@/i18n/locales/ar.json";
import zh from "@/i18n/locales/zh.json";
import { CATEGORIAS_O_QUE_PRECISO } from "@shared/o-que-preciso";

/**
 * Caixa dos títulos do cadastro. O Rosber mandou as 17 categorias de "O que
 * preciso" em CAIXA ALTA e a tela mostrava caixa normal.
 *
 * REGRA (revisão de 15/09, depois de a caixa alta escorrer para os demais
 * cartões e para o Perfil): caixa alta SÓ nos títulos das categorias das duas
 * listas de seleção — "O que tenho" e "O que preciso" —, e com o mesmo
 * tratamento em todas elas, inclusive no cabeçalho da segunda camada, que
 * repete o título da categoria. Os outros cartões do cadastro (especialidade,
 * tipo de pessoa, o que busca, faixa de renda, porte da empresa) ficam em caixa
 * normal.
 *
 * A padronização é de EXIBIÇÃO: classe `uppercase` no título, nunca texto
 * reescrito nos 10 JSONs. Esta é a parte que o teste anterior não provava: em
 * árabe, chinês e japonês NÃO EXISTE caixa, `String.toUpperCase()` devolve o
 * mesmo texto e qualquer comparação de maiúsculas passa sem significar nada.
 * Aqui os três idiomas são renderizados de verdade, e o que se exige é (a) a
 * classe no elemento — o comportamento vive no CSS — e (b) o texto na tela
 * IDÊNTICO ao do JSON, o que prova que ninguém tentou "subir a caixa" no dado.
 */

const pt = ptBR as unknown as {
  onboarding: {
    specialties: Record<string, string>; income: Record<string, string>;
    companySize: Record<string, string>; sectors: Record<string, string>;
    fields: Record<string, string>; nav: Record<string, string>; steps: Record<string, string>;
    seeking: Record<string, string>; misc: Record<string, string>;
  };
  profile: { business: Record<string, string> };
  oQueBusca: { opcoes: Record<string, { titulo: string }> };
  oQuePreciso: { categorias: Record<string, { titulo: string }> };
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
    consent: {
      accept: { useMutation: () => ({ mutate: (_vars: unknown, opcoes?: Opcoes) => opcoes?.onSuccess?.(), isPending: false }) },
      status: { useQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: () => Promise.resolve() }) },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({ auth: { me: { setData: () => {}, invalidate: () => Promise.resolve() } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", () => {}],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

import Onboarding from "./Onboarding";

const campo = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => re.test(c.placeholder || ""));

/** O passo em que a tela está: o cabeçalho do celular mostra "N / 8". */
const passoAtual = () => Number(screen.getByText(/^\d+ \/ 8$/).textContent!.split("/")[0]);

function avancar() {
  const continuar = screen.getAllByRole("button").find(b => /→$/.test(b.textContent ?? ""))!;
  fireEvent.click(continuar);
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

/** O título do cartão: o elemento que mostra exatamente aquele texto. */
const tituloDoCartao = (texto: string) => screen.getByText(texto);

// O mínimo que libera o "Continuar" de cada passo, no idioma em que a tela
// estiver: os rótulos vêm do JSON daquele idioma, não do pt-BR.
function preencherPasso(passo: number, idioma: typeof pt) {
  if (passo === 1) {
    const campos = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    // Passo 1: cidade e "como quer ser chamada" são os dois campos de texto.
    for (const entrada of campos) fireEvent.change(entrada, { target: { value: "Brasília" } });
  }
  if (passo === 2) clicarCartao(idioma.onboarding.specialties.tech);
  if (passo === 3) {
    clicarCartao(idioma.oQueBusca.opcoes.expandir_negocio.titulo);
    clicarCartao(idioma.onboarding.income.under_3k);
  }
  if (passo === 4) {
    fireEvent.change(document.querySelector("select")!, { target: { value: idioma.onboarding.sectors.technology } });
  }
}

/** Vai do passo atual até `n`, no idioma em que a tela estiver. */
function irAtePasso(n: number, idioma: typeof pt = pt) {
  for (let voltas = 0; passoAtual() < n; voltas++) {
    expect(voltas, "o cadastro travou antes do passo pedido").toBeLessThan(8);
    preencherPasso(passoAtual(), idioma);
    avancar();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await i18n.changeLanguage("pt-BR");
});

describe("as 17 categorias de 'O que preciso'", () => {
  it("saem em caixa alta por CSS, uma a uma", () => {
    render(<Onboarding />);
    irAtePasso(6);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pt.onboarding.steps.s9_title);

    expect(CATEGORIAS_O_QUE_PRECISO).toHaveLength(17);
    for (const categoria of CATEGORIAS_O_QUE_PRECISO) {
      const titulo = pt.oQuePreciso.categorias[categoria.chave].titulo;
      expect(tituloDoCartao(titulo).className, titulo).toMatch(/\buppercase\b/);
    }
  });

  it("a segunda camada repete o título da categoria com o mesmo tratamento", () => {
    render(<Onboarding />);
    irAtePasso(6);
    const titulo = pt.oQuePreciso.categorias.compradores.titulo;
    fireEvent.click(tituloDoCartao(titulo).closest("button")!);

    // Agora o título aparece duas vezes: no cartão e no cabeçalho do painel.
    const ocorrencias = screen.getAllByText(titulo);
    expect(ocorrencias.length, "o painel da segunda camada não abriu").toBeGreaterThan(1);
    for (const ocorrencia of ocorrencias) expect(ocorrencia.className).toMatch(/\buppercase\b/);
  });

  it("em árabe, chinês e japonês o comportamento é a classe CSS, e o texto do JSON fica intacto", async () => {
    // `text-transform: uppercase` não toca esses três alfabetos; um rótulo
    // "em maiúsculas" gravado no JSON não faria nada por eles e estragaria os
    // idiomas latinos. Por isso a regra é de CSS, e é isso que se exige aqui.
    for (const [codigo, idioma] of [["ja", ja], ["ar", ar], ["zh", zh]] as const) {
      await i18n.changeLanguage(codigo);
      const traduzido = idioma as unknown as typeof pt;
      const { unmount } = render(<Onboarding />);
      irAtePasso(6, traduzido);

      for (const categoria of CATEGORIAS_O_QUE_PRECISO) {
        const rotulo = traduzido.oQuePreciso.categorias[categoria.chave].titulo;
        // O texto na tela é o do JSON, caractere por caractere: ninguém tentou
        // "subir a caixa" do dado (o que nesses alfabetos não teria efeito).
        const naTela = tituloDoCartao(rotulo);
        expect(naTela.textContent, `${codigo}/${categoria.chave}`).toBe(rotulo);
        expect(naTela.className, `${codigo}/${categoria.chave}`).toMatch(/\buppercase\b/);
      }
      unmount();
    }
  });
});

describe("'O que tenho' — a outra lista de seleção", () => {
  it("os cartões de categoria saem em caixa alta", () => {
    render(<Onboarding />);
    irAtePasso(5);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pt.onboarding.steps.s8_title);
    expect(tituloDoCartao("Indústria").className).toMatch(/\buppercase\b/);
    expect(tituloDoCartao("Rede de Investidores").className).toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.onboarding.misc.outrosAtivo).className).toMatch(/\buppercase\b/);
  });
});

describe("os demais cartões do cadastro ficam em caixa normal", () => {
  it("especialidade e tipo de pessoa (passo 2)", () => {
    render(<Onboarding />);
    irAtePasso(2);
    expect(tituloDoCartao(pt.onboarding.specialties.tech).className).not.toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.profile.business.mei).className).not.toMatch(/\buppercase\b/);
  });

  it("o que busca, faixa de renda e os cartões de um botão só (passo 3)", () => {
    render(<Onboarding />);
    irAtePasso(3);
    expect(tituloDoCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo).className).not.toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.onboarding.income.under_3k).className).not.toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.onboarding.seeking.be_mentor).className).not.toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.onboarding.fields.lookingForInvestment).className).not.toMatch(/\buppercase\b/);
  });

  it("porte da empresa (passo 4)", () => {
    render(<Onboarding />);
    irAtePasso(4);
    expect(tituloDoCartao(pt.onboarding.companySize.micro).className).not.toMatch(/\buppercase\b/);
    expect(tituloDoCartao(pt.onboarding.companySize.any).className).not.toMatch(/\buppercase\b/);
  });
});
