import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Profile from "./Profile";

/**
 * O esqueleto de carregamento do Perfil tem a MESMA largura da tela carregada.
 *
 * Validação da #110 pelo Roberto (14/09/2026, item 3): a #110 levou o conteúdo
 * do Perfil para max-w-6xl, a largura padrão das telas de app, e o esqueleto
 * ficou em max-w-2xl. A página abria numa coluna estreita e pulava para a
 * largura cheia quando o perfil chegava. A comparação é entre as duas telas
 * renderizadas, e não contra um número fixo: se a largura padrão mudar, o teste
 * cobra que as duas mudem juntas.
 */

type Resposta = { data?: unknown; isLoading?: boolean };

// Dublê do tRPC no molde de Dashboard.anonimato.test.tsx.
const duble = vi.hoisted(() => {
  const respostas: Record<string, Resposta> = {};
  const ignorar = (prop: string | symbol) => typeof prop === "symbol" || prop === "then" || prop === "$$typeof";
  const procedimento = (caminho: string) => ({
    useQuery: () => ({ data: undefined as unknown, isLoading: false, isPending: false, isError: false, error: null, refetch: vi.fn(), ...(respostas[caminho] ?? {}) }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null, data: undefined }),
  });
  const utils = new Proxy({}, {
    get: (_, r) => ignorar(r) ? undefined : new Proxy({}, {
      get: (_, p) => ignorar(p) ? undefined : new Proxy({}, { get: (_, m) => ignorar(m) ? undefined : vi.fn(async () => undefined) }),
    }),
  });
  const trpc = new Proxy({}, {
    get: (_, router) => {
      if (ignorar(router)) return undefined;
      if (router === "useUtils") return () => utils;
      return new Proxy({}, { get: (_, proc) => ignorar(proc) ? undefined : procedimento(`${String(router)}.${String(proc)}`) });
    },
  });
  return { respostas, trpc };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: duble.trpc }));
vi.mock("@/components/ExcluirMinhaConta", () => ({ ExcluirMinhaConta: () => null }));

// O que decide a largura do bloco: a largura máxima e o recuo lateral.
const larguras = (el: Element | null | undefined) =>
  Array.from(el?.classList ?? []).filter(c => /^(max-w-|px-|sm:px-)/.test(c)).sort();

beforeEach(() => {
  for (const chave of Object.keys(duble.respostas)) delete duble.respostas[chave];
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Ana", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

describe("Perfil — o esqueleto tem a largura da tela carregada", () => {
  it("carregando e carregado usam a mesma largura máxima e o mesmo recuo lateral", () => {
    duble.respostas["profile.get"] = { isLoading: true };
    const carregando = render(<Profile />);
    const blocos = carregando.container.querySelectorAll("[data-slot='skeleton']");
    // O esqueleto renderizou: sem isto a comparação abaixo passaria por vazio.
    expect(blocos).toHaveLength(3);
    const doEsqueleto = larguras(blocos[0].parentElement);
    carregando.unmount();

    duble.respostas["profile.get"] = { data: { profile: { displayName: "Ana Perfil", city: "Lisboa", country: "PT" } } };
    const carregado = render(<Profile />);
    expect(carregado.container.querySelectorAll("[data-slot='skeleton']")).toHaveLength(0);
    // O bloco do conteúdo vem logo depois da barra de navegação, com o cabeçalho do perfil.
    const conteudo = carregado.container.querySelector("nav")?.nextElementSibling;
    expect(conteudo?.textContent).toContain("Ana Perfil");
    const daTela = larguras(conteudo);

    expect(daTela).toContain("max-w-6xl");
    expect(doEsqueleto).toEqual(daTela);
  });
});
