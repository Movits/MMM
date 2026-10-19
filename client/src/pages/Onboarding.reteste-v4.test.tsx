import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * Reteste v4 do cadastro (Roberto, 15/09), itens 5 e 10:
 *
 *  - item 5: "Capacidade de investimento disponível" abria já em "Sem capital
 *    disponível" (o INITIAL trazia "none") embora a lista tenha "Selecione...".
 *    Quem passava direto gravava um dado que não declarou. O campo passa a
 *    começar VAZIO, continua opcional para avançar, e só vai no envio quando
 *    escolhido — o zod do servidor é `optional()` e recusaria string vazia.
 *
 *  - item 10: no bloco "Tipo de pessoa" o mesmo texto de apoio saía duas vezes
 *    (subtítulo do bloco e dica do campo de Número de Cadastro Empresarial), e
 *    o rótulo "Microempreendedor Individual (MEI)" transbordava para o cartão
 *    vizinho, com altura desigual na fileira.
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; workStyle: Record<string, string>; sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string>; investment: Record<string, string> };
  profile: { business: Record<string, string> };
  termoGeral: Record<string, string>;
  oQueBusca: { opcoes: Record<string, { titulo: string; descricao: string }> };
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  status: { data: undefined as unknown, isLoading: false, isError: false },
  chamadas: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
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
          mutate: (vars: { type: string }, opcoes?: Opcoes) => {
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
  useLocation: () => ["/onboarding", () => {}],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

import Onboarding from "./Onboarding";

const TERMO = {
  id: "termo-v3",
  type: "termo_geral_de_uso",
  version: 3,
  text: "# TERMO GERAL DE USO\n\n1.1. Este instrumento regula o acesso.\n",
  publishedAt: new Date("2026-09-15T12:00:00Z"),
};

const campo = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => re.test(c.placeholder || ""));

const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });

function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

function preencherPasso1() {
  fireEvent.change(campo(/nome|apelido/i)!, { target: { value: "Fulana de Teste" } });
  fireEvent.change(campo(/S[ãa]o Paulo/i)!, { target: { value: "Brasília" } });
}

function irAtePasso2() {
  preencherPasso1();
  avancar();
}

function irAtePasso3() {
  irAtePasso2();
  clicarCartao(pt.onboarding.specialties.tech);
  avancar();
}

/** O `select` de um SelectInput, achado pelo rótulo dele. */
const selectDe = (rotulo: string) => screen.getByText(rotulo).parentElement!.querySelector("select")!;

/** Os obrigatórios do passo 3 (a capacidade de investimento não é um deles; o
 *  estilo de trabalho era, e saiu do cadastro — Rosber, 14/09 21:08). */
function preencherPasso3() {
  clicarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
  clicarCartao(pt.onboarding.income.under_3k);
}

/** Do passo 3 já preenchido até o envio; devolve o que foi mandado ao servidor. */
function concluirDoPasso3() {
  avancar();
  fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
  avancar(); // 4 → 5 (O que tenho)
  avancar(); // 5 → 6 (O que preciso)
  avancar(); // 6 → 7 (revisão)
  avancar(); // 7 → 8 (Termo Geral de Uso)
  fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.aceite }));
  fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.maioridade }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) }));
  return duble.chamadas.find(([nome]) => nome === "profile.completeOnboarding")![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  duble.status = { data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null }, isLoading: false, isError: false };
  duble.chamadas.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("item 5 — capacidade de investimento começa vazia", () => {
  it("abre em 'Selecione...', não em 'Sem capital disponível'", () => {
    render(<Onboarding />);
    irAtePasso3();

    const select = selectDe(pt.onboarding.fields.investmentCapacity);
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe(pt.onboarding.fields.selectPlaceholder);
    // "Sem capital disponível" continua sendo uma escolha possível, só não a inicial.
    expect(Array.from(select.options).map(o => o.value)).toContain("none");
  });

  it("sem escolher, o campo não trava o avanço e não vai no envio", () => {
    render(<Onboarding />);
    irAtePasso3();
    preencherPasso3();
    expect(botaoContinuar()).toBeEnabled();

    const perfil = concluirDoPasso3();
    expect(perfil.investmentCapacity).toBeUndefined();
    // String vazia seria recusada pelo z.enum do servidor.
    expect(perfil).not.toHaveProperty("investmentCapacity", "");
  });

  it("escolhida, vai no envio com a chave escolhida", () => {
    render(<Onboarding />);
    irAtePasso3();
    preencherPasso3();
    fireEvent.change(selectDe(pt.onboarding.fields.investmentCapacity), { target: { value: "10k_50k" } });

    expect(concluirDoPasso3().investmentCapacity).toBe("10k_50k");
  });
});

describe("item 10 — bloco 'Tipo de pessoa'", () => {
  it("o texto de apoio aparece uma vez só, com o campo de cadastro aberto", () => {
    render(<Onboarding />);
    irAtePasso2();
    clicarCartao(pt.profile.business.legalEntity);

    expect(screen.getByText(pt.profile.business.registrationNumber)).toBeInTheDocument();
    expect(screen.getAllByText(pt.profile.business.registrationNumberHint)).toHaveLength(1);
  });

  it("o rótulo do cartão quebra linha dentro do cartão e a fileira fica com a mesma altura", () => {
    render(<Onboarding />);
    irAtePasso2();

    const rotulo = screen.getByText(pt.profile.business.mei);
    expect(pt.profile.business.mei).toMatch(/Microempreendedor Individual/);
    // Sem quebra, "Microempreendedor" (palavra única maior que o cartão)
    // transborda para o cartão vizinho.
    expect(rotulo.className).toMatch(/\bbreak-words\b/);
    // Altura igual na fileira: o cartão ocupa a linha inteira da grade.
    expect(rotulo.closest("button")!.className).toMatch(/\bh-full\b/);
  });
});
