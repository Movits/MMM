import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutorizacaoAcervoOuro } from "./AutorizacaoAcervoOuro";

/**
 * Achado do Gabriel na validação da PR #92 (13/09/2026), que ficou aberto porque
 * a correção parou na PR #105: a consulta de consentimento (`consent.status`)
 * não tratava erro.
 *
 * O estrago é silencioso. Com a consulta em erro, `data` vem `undefined`, o
 * texto do termo sai vazio e o componente caía no mesmo `return null` de "não há
 * termo publicado". A dona marcava o contato como "Autorizadas (Ouro)" e
 * salvava achando que tinha autorizado — e o servidor, que reavalia o termo a
 * cada leitura, simplesmente não mostra aquele contato no acervo. Banco fora do
 * ar é ERRO, nunca "sem dados" (a mesma regra do servidor), e a tela tem de
 * dizer isso.
 *
 * A distinção que este teste protege:
 *
 * A. consulta em ERRO → o bloco de erro do projeto (`ErroDeConsulta`), com a
 *    mensagem do servidor e o botão que refaz a consulta;
 * B. consulta SÃ e sem documento publicado → segue sem desenhar nada, que é o
 *    comportamento correto (nesse estado o acervo lê por omissão e não há o que
 *    consentir). Sem esta segunda metade, "tratar erro" viraria um aviso em toda
 *    instalação sem termo.
 *
 * O tRPC vira dublê (molde: AutorizacaoAcervoOuro.test.tsx). O i18n dos testes
 * é fixado em pt-BR por client/src/test/setup.ts.
 */

const duble = vi.hoisted(() => ({
  status: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ consent: { status: { invalidate: vi.fn() } } }),
    consent: {
      status: { useQuery: () => duble.status() },
      accept: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

const MENSAGEM_DO_SERVIDOR = "Banco de dados indisponível. Tente de novo em instantes.";
const erroDoServidor = { message: MENSAGEM_DO_SERVIDOR, data: { code: "INTERNAL_SERVER_ERROR" } };

const EM_ERRO = {
  data: undefined,
  isLoading: false,
  isError: true,
  error: erroDoServidor,
  refetch: duble.refetch,
};
const SEM_TERMO_PUBLICADO = {
  data: { document: null, accepted: true, pendingText: true },
  isLoading: false,
  isError: false,
  error: null,
  refetch: duble.refetch,
};

beforeEach(() => {
  duble.status.mockReset();
  duble.refetch.mockReset();
  duble.status.mockReturnValue(EM_ERRO);
});

describe("A) consulta de consentimento em erro", () => {
  it("mostra o alerta com a mensagem do servidor, em vez de sumir da tela", () => {
    const { container } = render(<AutorizacaoAcervoOuro />);

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toHaveTextContent(MENSAGEM_DO_SERVIDOR);
  });

  it("não deixa a dona achar que autorizou: nem o aviso de já autorizado, nem o botão de autorizar", () => {
    render(<AutorizacaoAcervoOuro />);

    expect(screen.queryByText(/Você já autorizou/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Autorizar$/i })).not.toBeInTheDocument();
  });

  it("o botão de tentar de novo refaz a consulta", () => {
    render(<AutorizacaoAcervoOuro />);

    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(duble.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("B) consulta sã e sem termo publicado continua sem desenhar nada", () => {
  it("não inventa alerta onde não há erro", () => {
    duble.status.mockReturnValue(SEM_TERMO_PUBLICADO);
    const { container } = render(<AutorizacaoAcervoOuro />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
