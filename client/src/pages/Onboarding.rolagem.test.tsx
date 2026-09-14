import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

/**
 * Achado do Rosber em 09/09, por áudio: "quando você muda de um fichário pro
 * outro (...) a página não abre no topo. Ela abre no meio ou no final, então
 * você tem que ficar rolando a página pra baixo".
 *
 * O cadastro tem nove passos numa página só; sem levar a rolagem de volta ao
 * topo, cada passo novo aparece na altura em que o anterior ficou.
 */

const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ consent: { status: { invalidate } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Onboarding from "./Onboarding";

describe("Onboarding — cada passo começa do topo", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollTo = vi.fn();
    // jsdom não implementa window.scrollTo; o componente checa antes de chamar.
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true, configurable: true });
    if (document.scrollingElement) {
      (document.scrollingElement as HTMLElement).scrollTop = 0;
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("leva a rolagem ao topo ao avançar de passo", () => {
    render(<Onboarding />);

    // Passo 1 exige nome com 2+ letras e cidade com 2+ letras para liberar o avanço.
    const porPlaceholder = (re: RegExp) =>
      Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
        .find(c => re.test(c.placeholder || ""));
    const nome = porPlaceholder(/nome|apelido/i);
    // Cidade: qualquer campo com "cidade", "city", "localiz", "locat" (cobre várias línguas)
    const cidade = porPlaceholder(/cidade|city|localiz|locat|s[ãa]o paulo/i);
    expect(nome, "campo de nome não encontrado").toBeTruthy();
    expect(cidade, "campo de cidade não encontrado").toBeTruthy();
    fireEvent.change(nome!, { target: { value: "Fulana de Teste" } });
    fireEvent.change(cidade!, { target: { value: "Brasília" } });

    // A pessoa rolou o formulário para baixo antes de avançar.
    const raiz = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    raiz.scrollTop = 900;
    scrollTo.mockClear();

    const avancar = screen.getAllByRole("button").find(b => /continuar|continue|pr[óo]ximo|avan[çc]ar/i.test(b.textContent || ""));
    expect(avancar, "botão de avançar não encontrado").toBeTruthy();
    fireEvent.click(avancar!);

    // A troca de passo é atrasada de propósito pela animação (220 ms).
    act(() => { vi.advanceTimersByTime(300); });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(raiz.scrollTop).toBe(0);
  });
});
