import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAuth } from "@/_core/hooks/useAuth";
import Home from "./Home";

/**
 * O botão "Movimento ligado/desligado" da home (decisão do dono, 16/09): a Rede
 * viva não tem animação própria, então DESLIGADO quer dizer globo PARADO — o
 * planeta inteiro com o Brasil de frente e a rede acesa, sem acompanhar a
 * rolagem. E o botão abre LIGADO, sem palpite pelo aparelho; só a escolha
 * guardada ou o `prefers-reduced-motion` o abrem desligado.
 *
 * Antes, o botão só parava os pulsos: sem eles, não mudava nada no globo, e
 * celulares com até 4 núcleos abriam dizendo "desligado" com o globo girando.
 * Os outros testes da Home trocam o globo por nada e não viam isso; aqui o
 * dublê do globo guarda as props que recebe.
 */

const globo = vi.hoisted(() => ({ props: [] as Array<{ vistaParada?: boolean }> }));
vi.mock("@/components/GloboDoMundo", () => ({
  default: (props: { vistaParada?: boolean }) => {
    globo.props.push(props);
    return null;
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => {
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

// A preferência do sistema, controlável pelo teste, com aviso de mudança.
const sistema = { menosMovimento: false, ouvintes: new Set<() => void>() };
function mudarPreferenciaDoSistema(menosMovimento: boolean) {
  sistema.menosMovimento = menosMovimento;
  act(() => sistema.ouvintes.forEach(ouvinte => ouvinte()));
}

beforeAll(async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? sistema.menosMovimento : false;
    },
    media: query, onchange: null,
    addEventListener: (_: string, ouvinte: () => void) => sistema.ouvintes.add(ouvinte),
    removeEventListener: (_: string, ouvinte: () => void) => sistema.ouvintes.delete(ouvinte),
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  }));
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  });
  // Aparelho modesto: antes, isto sozinho abria o botão desligado.
  Object.defineProperty(navigator, "hardwareConcurrency", { value: 4, configurable: true });
  await i18n.changeLanguage("pt-BR");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  globo.props.length = 0;
  sistema.menosMovimento = false;
  sistema.ouvintes.clear();
  localStorage.clear();
  vi.mocked(useAuth).mockReturnValue({
    user: null, loading: false, error: null, isAuthenticated: false, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

/** As props da última vez que o globo foi desenhado. */
function ultimoGlobo() {
  if (!globo.props.length) throw new Error("o globo ainda não foi desenhado");
  return globo.props[globo.props.length - 1];
}

/** Espera o globo (carregado com lazy) receber a vista esperada. */
async function esperarVistaParada(esperada: boolean) {
  await waitFor(() => expect(ultimoGlobo().vistaParada).toBe(esperada));
}

describe("Home — o botão de movimento manda no globo", () => {
  it("abre LIGADO mesmo num aparelho de 4 núcleos: o globo acompanha a rolagem", async () => {
    render(<Home />);
    expect(screen.getByRole("button", { name: "Movimento ligado" })).toHaveAttribute("aria-pressed", "true");
    await esperarVistaParada(false);
  });

  it("desligar deixa o globo parado; ligar de novo volta a acompanhar; a escolha fica guardada", async () => {
    render(<Home />);
    await esperarVistaParada(false);

    fireEvent.click(screen.getByRole("button", { name: "Movimento ligado" }));
    expect(screen.getByRole("button", { name: "Movimento desligado" })).toHaveAttribute("aria-pressed", "false");
    await esperarVistaParada(true);
    expect(localStorage.getItem("mmm:movimento-do-fundo")).toBe("off");

    fireEvent.click(screen.getByRole("button", { name: "Movimento desligado" }));
    await esperarVistaParada(false);
    expect(localStorage.getItem("mmm:movimento-do-fundo")).toBe("on");
  });

  it("quem pediu menos movimento no sistema abre com o globo parado, e o botão vence o sistema", async () => {
    sistema.menosMovimento = true;
    render(<Home />);
    expect(screen.getByRole("button", { name: "Movimento desligado" })).toBeInTheDocument();
    await esperarVistaParada(true);

    fireEvent.click(screen.getByRole("button", { name: "Movimento desligado" }));
    await esperarVistaParada(false);
  });

  it("a escolha guardada vence a preferência do sistema, nos dois sentidos", async () => {
    sistema.menosMovimento = true;
    localStorage.setItem("mmm:movimento-do-fundo", "on");
    const { unmount } = render(<Home />);
    await esperarVistaParada(false);
    unmount();

    globo.props.length = 0;
    sistema.menosMovimento = false;
    localStorage.setItem("mmm:movimento-do-fundo", "off");
    render(<Home />);
    await esperarVistaParada(true);
  });

  it("sem escolha guardada, mudar a preferência do sistema com a página aberta muda o botão e o globo", async () => {
    render(<Home />);
    expect(screen.getByRole("button", { name: "Movimento ligado" })).toBeInTheDocument();
    await esperarVistaParada(false);

    mudarPreferenciaDoSistema(true);
    await esperarVistaParada(true);
    expect(screen.getByRole("button", { name: "Movimento desligado" })).toBeInTheDocument();

    mudarPreferenciaDoSistema(false);
    await esperarVistaParada(false);
    expect(screen.getByRole("button", { name: "Movimento ligado" })).toBeInTheDocument();
  });

  it("sem armazenamento (modo privado), o clique ainda vence as mudanças do sistema nesta visita", async () => {
    const bloqueado = () => {
      throw new DOMException("armazenamento bloqueado", "SecurityError");
    };
    const lerGuardado = vi.spyOn(Storage.prototype, "getItem").mockImplementation(bloqueado);
    const gravar = vi.spyOn(Storage.prototype, "setItem").mockImplementation(bloqueado);
    try {
      render(<Home />);
      await esperarVistaParada(false);

      fireEvent.click(screen.getByRole("button", { name: "Movimento ligado" }));
      await esperarVistaParada(true);

      mudarPreferenciaDoSistema(true);
      mudarPreferenciaDoSistema(false);
      expect(screen.getByRole("button", { name: "Movimento desligado" })).toBeInTheDocument();
      await esperarVistaParada(true);
    } finally {
      lerGuardado.mockRestore();
      gravar.mockRestore();
    }
  });

  it("com escolha guardada, a mudança no sistema não passa por cima dela", async () => {
    localStorage.setItem("mmm:movimento-do-fundo", "on");
    render(<Home />);
    await esperarVistaParada(false);

    mudarPreferenciaDoSistema(true);
    expect(screen.getByRole("button", { name: "Movimento ligado" })).toBeInTheDocument();
    await esperarVistaParada(false);
  });
});
