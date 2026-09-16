import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/i18n";

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
    consent: {
      accept: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      // Termo Geral de Uso da última etapa; aqui o teste nem chega lá.
      status: { useQuery: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }) },
    },
    // "Gravar áudio" e "Revisar texto" do campo "Quem é você em uma frase?".
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
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

/**
 * Acha um campo pelo placeholder que a CHAVE do i18n resolve no idioma da vez.
 *
 * A versão anterior procurava por uma lista de palavras (`/São Paulo|cidade|
 * city/i`): placeholder é texto de tela, e toda reescrita do texto — ou a
 * primeira asserção rodando fora do pt-BR — derrubava o teste com "campo não
 * encontrado", um vermelho que nada tem a ver com a rolagem que ele protege
 * (achado do Gabriel na validação da PR #92). Alargar a lista de palavras
 * adiaria o problema e ainda aceitaria o campo errado.
 *
 * A comparação é EXATA e a chave tem de resolver mesmo: chave ausente devolve
 * o próprio nome da chave, e aceitar isso (ou aceitar placeholder vazio) faria
 * o teste "achar" qualquer input — a guarda ficaria mais frouxa, não mais firme.
 */
function campoPelaChave(chave: string): HTMLInputElement | HTMLTextAreaElement | undefined {
  const esperado = i18n.t(chave);
  if (!esperado || esperado === chave) return undefined;
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(campo => campo.placeholder === esperado);
}

const CHAVE_DO_NOME = "onboarding.fields.displayNamePlaceholder";
const CHAVE_DA_CIDADE = "onboarding.fields.cityPlaceholder";

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

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // setup.ts fixa pt-BR uma vez por arquivo; quem troca, devolve.
    await i18n.changeLanguage("pt-BR");
  });

  it("leva a rolagem ao topo ao avançar de passo", () => {
    render(<Onboarding />);

    // Passo 1 exige nome com 2+ letras e cidade com 2+ letras para liberar o avanço.
    const nome = campoPelaChave(CHAVE_DO_NOME);
    const cidade = campoPelaChave(CHAVE_DA_CIDADE);
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

  // Achado do Gabriel na validação da PR #92: achar o campo por uma lista de
  // palavras ("cidade|city|São Paulo") é frágil — o placeholder é TEXTO DE
  // TELA, muda de idioma e de redação, e quando muda o teste falha por "campo
  // não encontrado", que não é o defeito que ele protege. Alargar a lista de
  // palavras não resolve: só adia. O campo é achado pela CHAVE do i18n.
  it("acha os campos do passo 1 em qualquer idioma, porque procura pela chave e não pela palavra", async () => {
    await i18n.changeLanguage("ja");
    render(<Onboarding />);

    expect(campoPelaChave(CHAVE_DO_NOME), "campo de nome não encontrado").toBeTruthy();
    expect(campoPelaChave(CHAVE_DA_CIDADE), "campo de cidade não encontrado").toBeTruthy();
    // A guarda não afrouxou: chave que não existe continua não achando campo
    // nenhum, em vez de casar com o primeiro input da tela.
    expect(campoPelaChave("onboarding.fields.chaveQueNaoExiste")).toBeUndefined();
  });
});
