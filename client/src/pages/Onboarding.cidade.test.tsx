import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * O campo de cidade DA TELA DE CADASTRO, montado inteiro.
 *
 * Por que este arquivo existe, e por que o teste do componente não bastava: o
 * defeito antigo não morava dentro do campo, morava no PONTO DE CHAMADA. O
 * Onboarding fazia
 *
 *     onChange={v => set("city", v.replace(/\s\([A-Z]{2}\)$/, ""))}
 *
 * para arrancar a UF que a própria lista mostrava, A CADA TECLA — e com isso
 * comia o "(SP)" que a pessoa tivesse escrito de propósito. Um componente novo
 * e correto passa em qualquer teste de componente enquanto a tela continuar
 * fazendo isso; só montando a tela é que a prova vale.
 *
 * Aqui o `CampoDeCidade` é o de verdade e a busca é a de verdade, sobre o
 * BR.json versionado: o único dublê é a camada de rede (tRPC), o roteador e o
 * toast, que a tela exige para renderizar.
 */

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    // O dublê acompanha a tela do cadastro: a etapa do Termo Geral consulta o
    // consentimento e os campos de texto oferecem ditar e revisar. Sem eles a
    // tela nem monta, e o teste da CIDADE morreria por um motivo que não tem
    // nada a ver com cidade.
    consent: {
      accept: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      status: { useQuery: () => ({ data: null, isLoading: false, refetch: () => Promise.resolve() }) },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({
      auth: { me: { setData: vi.fn(), invalidate: () => Promise.resolve() } },
      consent: { status: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Onboarding from "./Onboarding";

/** O campo de cidade do passo 1, achado pelo placeholder da própria tela. */
const campoDeCidade = () =>
  screen.getByPlaceholderText(/S[ãa]o Paulo, Rio de Janeiro/i);

const digitar = (texto: string) =>
  fireEvent.change(campoDeCidade(), { target: { value: texto } });

/** O país do cadastro já nasce "BR", então a lista brasileira carrega sozinha. */
const esperarALista = async () => {
  digitar("sao paulo");
  await screen.findByRole("option", { name: "São Paulo (SP)" });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cadastro — o campo de cidade não mexe no que a pessoa escreveu", () => {
  it("guarda 'Campinas (SP)' com o parêntese, que o campo antigo comia a cada tecla", () => {
    render(<Onboarding />);

    digitar("Campinas (SP)");

    // Com o replace antigo no onChange, aqui apareceria "Campinas".
    expect(campoDeCidade()).toHaveValue("Campinas (SP)");
  });

  it("guarda o texto livre inteiro, inclusive de lugar que não é município", () => {
    render(<Onboarding />);

    digitar("Vila Fictícia do Norte (RS)");

    expect(campoDeCidade()).toHaveValue("Vila Fictícia do Norte (RS)");
  });
});

describe("cadastro — escolher da lista grava o nome canônico", () => {
  it("escolher 'São Paulo (SP)' grava 'São Paulo', sem a UF", async () => {
    render(<Onboarding />);
    await esperarALista();

    fireEvent.mouseDown(screen.getByRole("option", { name: "São Paulo (SP)" }));

    expect(campoDeCidade()).toHaveValue("São Paulo");
  });

  it("acha 'Xique-Xique' digitado emendado e grava o nome oficial, com o hífen", async () => {
    render(<Onboarding />);
    await esperarALista();

    digitar("xiquexique");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "Xique-Xique (BA)" })
    );

    expect(campoDeCidade()).toHaveValue("Xique-Xique");
  });
});

describe("cadastro — crédito da fonte da lista", () => {
  it("mostra na tela quem forneceu a lista de cidades, com link", async () => {
    render(<Onboarding />);
    await esperarALista();

    expect(screen.getByText(/Dados de cidades/i)).toBeInTheDocument();
    const credito = screen.getByRole("link", { name: /IBGE/ });
    expect(credito).toHaveAttribute("href", "https://www.ibge.gov.br");
  });
});
