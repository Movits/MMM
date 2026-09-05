import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import i18n from "@/i18n";
import { ErroDeConsulta } from "./ErroDeConsulta";

/**
 * O bloco de erro de consulta (revisão da PR-A): o que a usuária lê é a
 * mensagem do servidor quando ela existe (envelope tRPC) e, fora disso, um
 * genérico traduzido — nunca "Failed to fetch" nem o texto do ErrorBoundary,
 * que promete "nossa equipe foi notificada".
 */
const GENERICO_PT = "O servidor não respondeu. Tente de novo em instantes.";
const EQUIPE_NOTIFICADA = /equipe foi notificada/;

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("ErroDeConsulta — o texto que a usuária lê", () => {
  it("erro sem envelope ('Failed to fetch'): o genérico da chave nova, sem o texto técnico nem o do ErrorBoundary", () => {
    const erro = new TRPCClientError("Failed to fetch", { cause: new TypeError("Failed to fetch") });
    render(<ErroDeConsulta erro={erro} />);

    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Algo inesperado aconteceu");
    expect(alerta).toHaveTextContent(GENERICO_PT);
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    expect(screen.queryByText(EQUIPE_NOTIFICADA)).not.toBeInTheDocument();
    // Sem aoTentarDeNovo não há botão prometendo algo que não existe.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("erro do servidor (data.code): a mensagem dele, e o botão chama aoTentarDeNovo", () => {
    const erro = TRPCClientError.from({
      error: { code: -32603, message: "Banco de dados indisponível. Tente de novo em instantes.", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    });
    const tentarDeNovo = vi.fn();
    render(<ErroDeConsulta erro={erro} aoTentarDeNovo={tentarDeNovo} />);

    expect(screen.getByText("Banco de dados indisponível. Tente de novo em instantes.")).toBeInTheDocument();
    expect(screen.queryByText(GENERICO_PT)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "↻ Tentar novamente" }));
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("o genérico acompanha o idioma: em inglês sai a versão em inglês", async () => {
    await i18n.changeLanguage("en");
    render(<ErroDeConsulta erro={{ message: "Unable to transform response from server" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not respond. Please try again in a moment.");
    expect(screen.queryByText("Unable to transform response from server")).not.toBeInTheDocument();
  });
});
