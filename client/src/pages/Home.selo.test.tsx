import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { CODIGOS } from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Home from "./Home";

/**
 * Selo do Hero para leitor de tela (validação da #116 pelo Roberto, 14/09;
 * ad81480, portado para a entrega de 16/09): o selo mostra trechos separados
 * por " • " e esconde os marcadores visíveis com aria-hidden, mas o `sr-only`
 * lia o t("hero.badge") cru, então o leitor de tela falava os dois "•"
 * ("ponto", "bullet"...). Agora o `sr-only` recebe os trechos separados por
 * vírgula.
 *
 * O teste renderiza a Home de verdade nos 10 idiomas e prova três coisas pela
 * tela: o texto lido tem os trechos separados por vírgula; nenhum `sr-only` da
 * página contém "•"; e a parte visível continua igual (um marcador antes de
 * cada trecho). A premissa de cada idioma é que o selo TEM " • " — sem ela o
 * teste passaria mesmo com o `sr-only` cru.
 *
 * Dublês: tRPC responde "sem dados" a qualquer consulta (a Home pública não
 * precisa de mais que isso para montar o hero), o globo 3D vira nada e o jsdom
 * ganha `matchMedia` e `IntersectionObserver`, que ele não tem.
 */

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/GloboDoMundo", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => {
  // Funções comuns, não vi.fn: o `mockReset` do projeto client zeraria as
  // respostas antes de cada teste.
  const procedimento = {
    useQuery: () => ({ data: undefined, isLoading: false, isPending: false, isError: false, error: null, refetch: () => undefined }),
    useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false, isError: false, error: null, data: undefined }),
  };
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const trpc = new Proxy({}, {
    get: (_, router) => ignorar(router) ? undefined : new Proxy({}, { get: (_, proc) => ignorar(proc) ? undefined : procedimento }),
  });
  return { trpc };
});

beforeAll(() => {
  // `matches: true` = "prefers-reduced-motion": o fundo não anima no teste.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await i18n.changeLanguage("pt-BR");
});

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    user: null, loading: false, error: null, isAuthenticated: false, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

describe("selo do Hero — o leitor de tela lê os trechos, não os marcadores", () => {
  it.each(CODIGOS)("%s: sr-only com vírgulas, parte visível com um • antes de cada trecho", async (codigo) => {
    await i18n.changeLanguage(codigo);
    const selo = i18n.t("hero.badge");
    const trechos = selo.split(" • ");
    // Premissa: o selo deste idioma usa o separador. Sem ela, nada abaixo prova o conserto.
    expect(trechos.length, `hero.badge em ${codigo}: ${selo}`).toBeGreaterThanOrEqual(2);

    const { container } = render(<Home />);

    const leitura = screen.getByText(trechos.join(", "));
    expect(leitura).toHaveClass("sr-only");
    expect(leitura.textContent).not.toContain("•");

    const visivel = leitura.nextElementSibling;
    expect(visivel).toHaveAttribute("aria-hidden", "true");
    expect(visivel?.textContent).toBe(trechos.map(trecho => `•${trecho}`).join(""));

    const srOnlyComMarcador = [...container.querySelectorAll(".sr-only")].filter(el => el.textContent?.includes("•"));
    expect(srOnlyComMarcador).toEqual([]);
  });
});
