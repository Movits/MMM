import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * A etapa "O que preciso — Demandas e necessidades" dentro do Onboarding
 * (Rosber, 14/09 21:24; "conexões", não "Match", 21:34): título e subtítulo
 * mantidos, texto explicativo novo e frase discreta, os 17 cartões, Voltar e
 * Continuar preservados, categoria marcada sem demanda detalhada não avança, e o
 * cadastro manda cada demanda separada em `whatINeedDetails`.
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; workStyle: Record<string, string>; sectors: Record<string, string>; nav: Record<string, string>; steps: Record<string, string> };
  oQueBusca: { opcoes: Record<string, { titulo: string }> };
  oQuePreciso: { campos: Record<string, string> };
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  chamadas: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: {
        useMutation: () => ({ mutate: (vars: unknown) => { duble.chamadas.push(["profile.completeOnboarding", vars]); }, isPending: false }),
      },
    },
    consent: {
      accept: {
        useMutation: () => ({
          mutate: (vars: { type: string }, opcoes?: Opcoes) => { duble.chamadas.push(["consent.accept", vars]); opcoes?.onSuccess?.(); },
          isPending: false,
        }),
      },
      status: {
        useQuery: () => ({
          data: { document: { id: "termo-v1", type: "termo_geral_de_uso", version: 1, text: "# TERMO\n\n1.1. Texto.", publishedAt: new Date() }, accepted: false },
          isLoading: false, isError: false, refetch: () => Promise.resolve(),
        }),
      },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({}),
  },
}));
vi.mock("wouter", () => ({ useLocation: () => ["/onboarding", vi.fn()], Link: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

import Onboarding from "./Onboarding";

const campo = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).find(c => re.test(c.placeholder || ""));
const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });
function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}
const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);
const cartaoDoQuePreciso = (titulo: string) => screen.getAllByRole("button").find(b => b.hasAttribute("aria-expanded") && b.textContent?.includes(titulo))!;

function irAteOQuePreciso() {
  fireEvent.change(campo(/nome|apelido/i)!, { target: { value: "Fulana de Teste" } });
  fireEvent.change(campo(/S[ãa]o Paulo/i)!, { target: { value: "Brasília" } });
  avancar();
  clicarCartao(pt.onboarding.specialties.tech);
  avancar();
  clicarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
  clicarCartao(pt.onboarding.income.under_3k);
  avancar();
  fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
  // Setor → O que tenho → O que preciso (a do meio é opcional).
  for (let i = 0; i < 10 && screen.getByRole("heading", { level: 1 }).textContent !== pt.onboarding.steps.s9_title; i++) avancar();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  duble.chamadas.length = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe("Onboarding — O que preciso", () => {
  it("mantém título e subtítulo, troca o texto explicativo e mostra a frase discreta sem 'Match'", () => {
    render(<Onboarding />);
    irAteOQuePreciso();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("O que preciso");
    expect(screen.getByText("Demandas e necessidades", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Marque o que você precisa para crescer, conectar ou expandir seus negócios.")).toBeInTheDocument();
    expect(screen.getByText("Quanto mais específico você for, mais inteligentes serão as suas conexões.")).toBeInTheDocument();
    expect(screen.queryByText("Consultoria")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").filter(b => b.hasAttribute("aria-expanded"))).toHaveLength(17);
    const etapa = screen.getByRole("heading", { level: 1 }).closest("div")!.parentElement!;
    expect(etapa.textContent).not.toMatch(/match/i);
    // Voltar e Continuar continuam; sem nada marcado, a etapa segue opcional.
    expect(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.back) })).toBeInTheDocument();
    expect(botaoContinuar()).toBeEnabled();
  });

  it("categoria marcada sem demanda detalhada não avança; detalhada, avança e o cadastro grava cada demanda", () => {
    render(<Onboarding />);
    irAteOQuePreciso();

    fireEvent.click(cartaoDoQuePreciso("Investidores"));
    expect(botaoContinuar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(pt.oQuePreciso.campos.valorAproximado), { target: { value: "R$ 2 milhões" } });
    fireEvent.click(screen.getByRole("button", { name: "Equity" }));
    expect(botaoContinuar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(new RegExp(pt.oQuePreciso.campos.descricaoDoProjeto)), { target: { value: "Ampliar a fábrica e dobrar a capacidade" } });
    expect(botaoContinuar()).toBeEnabled();

    // Segunda categoria marcada e não detalhada: trava de novo.
    fireEvent.click(cartaoDoQuePreciso("Especialistas / Serviços"));
    expect(botaoContinuar()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tributário" }));
    fireEvent.change(screen.getByLabelText(/Descreva exatamente o serviço de que você precisa\./), { target: { value: "Procuro assessoria tributária para indústria" } });
    expect(botaoContinuar()).toBeEnabled();

    avancar(); // → Revisão
    avancar(); // → Termo Geral de Uso
    fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.aceite }));
    fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.maioridade }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) }));

    const perfil = duble.chamadas.find(([nome]) => nome === "profile.completeOnboarding")![1] as Record<string, unknown>;
    expect(perfil.whatINeed).toEqual(["investidores", "especialistas_servicos"]);
    expect(perfil.whatINeedDetails).toEqual([
      expect.objectContaining({ category: "investidores", subcategory: "equity", estimatedValue: "R$ 2 milhões", description: "Ampliar a fábrica e dobrar a capacidade" }),
      expect.objectContaining({ category: "especialistas_servicos", service: "tributario", description: "Procuro assessoria tributária para indústria" }),
    ]);
  });
});
