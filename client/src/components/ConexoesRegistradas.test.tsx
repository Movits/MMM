import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConexaoRegistrada, type ConexaoNaTela } from "./ConexoesRegistradas";

/**
 * Conexão registrada vista por quem participa (Meu Network Inteligente e perfil
 * do contato). O que se trava: descartar é irreversível no servidor
 * (avancarConexao recusa qualquer etapa depois do descarte de quem pede), então
 * o botão "Descartar" só abre a confirmação; a mutação sai no botão do diálogo.
 * Avançar para a próxima etapa continua num clique.
 */

type OpcoesDaMutacao = { onSuccess?: (resultado: { aguardandoOutroLado: boolean }) => void; onError?: () => void };

const duble = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  opcoes: {} as { onSuccess?: (resultado: { aguardandoOutroLado: boolean }) => void; onError?: () => void },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      networkInteligente: { conexoes: { invalidate: vi.fn() }, contato: { invalidate: vi.fn() } },
    }),
    networkInteligente: {
      avancarConexao: {
        useMutation: (opcoes: OpcoesDaMutacao) => {
          duble.opcoes = opcoes;
          return { mutate: duble.mutate, isPending: duble.isPending };
        },
      },
    },
  },
}));

const conexao = (extra: Partial<ConexaoNaTela> = {}): ConexaoNaTela => ({
  id: "c-1",
  origem: "PRIVATE_NETWORK_MATCH",
  itens: [{ tem: "Vinho", precisa: "Vinho", deCodigo: "NW-AAAAAA", paraCodigo: "NW-BBBBBB" }],
  status: "identificada",
  statusComissao: "sem_negocio",
  criadaEm: Date.UTC(2026, 8, 14),
  fechamentoConfirmadoPorMim: false,
  lados: [
    { lado: "a", tipo: "contato", contactId: null, codigoAnonimo: "NW-AAAAAA", meu: false, originador: false, statusComissaoOriginador: null },
    { lado: "b", tipo: "contato", contactId: null, codigoAnonimo: "NW-BBBBBB", meu: false, originador: false, statusComissaoOriginador: null },
  ],
  ...extra,
});

const renderizar = (c: ConexaoNaTela) => render(<ul><ConexaoRegistrada conexao={c} /></ul>);

beforeEach(() => {
  duble.mutate.mockClear();
  duble.isPending = false;
  duble.opcoes = {};
});

describe("Conexão registrada — descartar pede confirmação", () => {
  it("clicar em Descartar não descarta: abre o diálogo que avisa que não há volta", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(duble.mutate).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Descartar esta conexão?")).toBeInTheDocument();
    expect(within(dialogo).getByText(/não pode ser desfeito/)).toBeInTheDocument();
  });

  it("cancelar fecha o diálogo sem gravar nada", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(duble.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirmar descarta esta conexão e o diálogo fecha quando o servidor aceita", () => {
    renderizar(conexao({ id: "c-negociacao", status: "negociacao" }));

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar conexão" }));

    expect(duble.mutate).toHaveBeenCalledTimes(1);
    expect(duble.mutate).toHaveBeenCalledWith({ conexaoId: "c-negociacao", etapa: "descartada" });

    act(() => duble.opcoes.onSuccess?.({ aguardandoOutroLado: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("avançar de etapa segue num clique, sem diálogo", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Registrar apresentação" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(duble.mutate).toHaveBeenCalledWith({ conexaoId: "c-1", etapa: "apresentacao" });
  });

  it("conexão fechada ou já descartada não oferece Descartar", () => {
    const { unmount } = renderizar(conexao({ status: "fechada" }));
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
    unmount();

    renderizar(conexao({ status: "descartada" }));
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });
});
