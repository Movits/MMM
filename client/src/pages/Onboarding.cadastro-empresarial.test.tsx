import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

/**
 * Pedido do usuário (PR #133): no cadastro, passo 2 "Sua especialidade", bloco
 * "Tipo de pessoa", quem escolhe Pessoa Jurídica, MEI ou Sem fins lucrativos vê
 * o campo "Número do cadastro empresarial" (não mais "CNPJ"), sem máscara nem
 * hífen e sem o limite de 14 dígitos do CNPJ. O campo continua obrigatório para
 * esses três tipos: vazio, o botão de avançar não libera.
 *
 * O campo não corta o que se digita ou cola; o teto de 255 letras e números
 * (CADASTRO_EMPRESARIAL_MAX) só existe no servidor, contra abuso.
 */

const invalidate = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    consent: { accept: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    useUtils: () => ({ consent: { status: { invalidate } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Onboarding from "./Onboarding";

const ROTULO = "Número do cadastro empresarial";
// "12.345.678/0001-90-98765 4321" sem tudo que não é letra ou número.
const DIGITADO_LONGO = "12.345.678/0001-90-98765 4321";
const ESPERADO_LONGO = "12345678000190987654321";

function botaoAvancar(): HTMLButtonElement {
  const botao = screen
    .getAllByRole("button")
    .find(b => /continuar/i.test(b.textContent || "")) as HTMLButtonElement | undefined;
  expect(botao, "botão de avançar não encontrado").toBeTruthy();
  return botao!;
}

function tituloDoPasso(): string {
  return screen.getByRole("heading", { level: 1 }).textContent || "";
}

function avancarAoPasso2() {
  const porPlaceholder = (re: RegExp) =>
    Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
      .find(c => re.test(c.placeholder || ""));
  const nome = porPlaceholder(/nome|apelido/i);
  const cidade = porPlaceholder(/S[ãa]o Paulo|cidade|city/i);
  expect(nome, "campo de nome não encontrado").toBeTruthy();
  expect(cidade, "campo de cidade não encontrado").toBeTruthy();
  fireEvent.change(nome!, { target: { value: "Fulana de Teste" } });
  fireEvent.change(cidade!, { target: { value: "Brasília" } });

  fireEvent.click(botaoAvancar());
  // A troca de passo é atrasada de propósito pela animação (220 ms).
  act(() => { vi.advanceTimersByTime(300); });
  expect(tituloDoPasso()).toBe("Sua especialidade");
}

/** O rótulo não tem htmlFor: o campo é o input irmão dentro do mesmo bloco. */
function campoDoCadastro(): HTMLInputElement {
  const rotulo = screen.getByText(new RegExp(`^${ROTULO}`), { selector: "label" });
  const campo = rotulo.parentElement?.querySelector("input");
  expect(campo, "campo do número do cadastro empresarial não encontrado").toBeTruthy();
  return campo as HTMLInputElement;
}

describe("Onboarding — número do cadastro empresarial no lugar do CNPJ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom não implementa window.scrollTo; o componente chama ao trocar de passo.
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    ["Pessoa Jurídica"],
    ["Microempreendedor Individual (MEI)"],
    ["Sem fins lucrativos"],
  ])("%s: rótulo novo, sem máscara, sem limite de 14 e obrigatório para avançar", (tipo) => {
    render(<Onboarding />);
    avancarAoPasso2();

    // Sem especialidade o passo 2 não libera; com uma, e sem tipo de pessoa, libera.
    expect(botaoAvancar()).toBeDisabled();
    fireEvent.click(screen.getByText("Tecnologia & Software"));
    expect(botaoAvancar()).toBeEnabled();

    // O campo só existe depois de escolher um tipo com cadastro empresarial.
    expect(screen.queryByText(new RegExp(`^${ROTULO}`), { selector: "label" })).toBeNull();
    fireEvent.click(screen.getByText(tipo, { selector: "div" }));

    // Rótulo novo na tela.
    const campo = campoDoCadastro();
    expect(campo.value).toBe("");

    // "CNPJ" não aparece em lugar nenhum: nem no texto, nem em atributos.
    expect(document.body.textContent || "").not.toMatch(/CNPJ/i);
    expect(document.body.innerHTML).not.toMatch(/CNPJ/i);
    const placeholders = Array.from(document.querySelectorAll<HTMLInputElement>("input, textarea"))
      .map(c => c.placeholder);
    expect(placeholders).not.toContain("00.000.000/0000-00");

    // Obrigatório: vazio, o botão trava e o clique não troca de passo.
    expect(botaoAvancar()).toBeDisabled();

    // Letras são aceitas; hífen sai.
    fireEvent.change(campo, { target: { value: "AB-12" } });
    expect(campoDoCadastro().value).toBe("AB12");
    expect(botaoAvancar()).toBeEnabled();

    // Número maior que o CNPJ, com pontuação, barra, hífen e espaço.
    fireEvent.change(campoDoCadastro(), { target: { value: DIGITADO_LONGO } });
    const valor = campoDoCadastro().value;
    expect(valor).toBe(ESPERADO_LONGO);
    expect(valor.length).toBeGreaterThan(14);
    expect(valor).not.toContain("-");
    expect(valor).not.toMatch(/[^0-9A-Za-z]/);
    // Sem corte ao digitar ou colar: nem maxlength no input, nem slice no onChange.
    expect(campoDoCadastro().hasAttribute("maxlength")).toBe(false);
    const coladoComPontuacao = Array.from({ length: 120 }, (_, i) => `${i % 10}.-`).join("");
    fireEvent.change(campoDoCadastro(), { target: { value: coladoComPontuacao } });
    expect(campoDoCadastro().value).toHaveLength(120);
    expect(botaoAvancar()).toBeEnabled();

    // Algarismos de outros teclados (árabe-índico, devanágari, largura cheia) viram 0-9 em vez de sumir.
    fireEvent.change(campoDoCadastro(), { target: { value: "١٢٣-४५६ ７８９" } });
    expect(campoDoCadastro().value).toBe("123456789");
    expect(botaoAvancar()).toBeEnabled();

    // Só pontuação normaliza para vazio: volta a travar e o clique não avança.
    fireEvent.change(campoDoCadastro(), { target: { value: "-./ " } });
    expect(campoDoCadastro().value).toBe("");
    expect(botaoAvancar()).toBeDisabled();
    fireEvent.click(botaoAvancar());
    act(() => { vi.advanceTimersByTime(300); });
    expect(tituloDoPasso()).toBe("Sua especialidade");

    // Preenchido, o clique avança de passo.
    fireEvent.change(campoDoCadastro(), { target: { value: DIGITADO_LONGO } });
    expect(botaoAvancar()).toBeEnabled();
    fireEvent.click(botaoAvancar());
    act(() => { vi.advanceTimersByTime(300); });
    expect(tituloDoPasso()).not.toBe("Sua especialidade");
  });
});
