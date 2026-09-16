import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutorizacaoAcervoOuro } from "./AutorizacaoAcervoOuro";

/**
 * Achado do Nicolas (14/09/2026): o termo do acervo Ouro promete à dona que ela
 * pode "revogar esta autorização por inteiro", e a tela onde ela autoriza não
 * tinha botão nenhum para isso — a promessa só existia no texto.
 *
 * O que este teste protege:
 *
 * A. Com a autorização ativa, a tela oferece revogar.
 * B. Revogar passa por confirmação, e a confirmação DIZ O EFEITO: o acervo
 *    deixa de ser visível para contas Ouro. Um clique solto num botão de
 *    revogar, sem isso, desliga o acervo sem a dona entender o que perdeu.
 * C. Quem ainda não autorizou não vê botão de revogar.
 *
 * O tRPC vira dublê (molde: ExcluirMinhaConta.test.tsx). O i18n dos testes é
 * fixado em pt-BR por client/src/test/setup.ts, então as asserções são no texto
 * real de tela.
 */

const duble = vi.hoisted(() => ({
  status: vi.fn(),
  aceitar: vi.fn(),
  revogar: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ consent: { status: { invalidate: vi.fn() } } }),
    consent: {
      status: { useQuery: () => duble.status() },
      accept: { useMutation: () => ({ mutate: duble.aceitar, isPending: false }) },
      revoke: { useMutation: () => ({ mutate: duble.revogar, isPending: false }) },
    },
  },
}));

const TERMO = { id: "doc-1", type: "termo_acesso_ouro", version: 1, text: "Texto do termo." };
const AUTORIZADA = { data: { document: TERMO, accepted: true }, isLoading: false };
const PENDENTE = { data: { document: TERMO, accepted: false }, isLoading: false };

beforeEach(() => {
  duble.status.mockReset();
  duble.aceitar.mockReset();
  duble.revogar.mockReset();
  duble.status.mockReturnValue(AUTORIZADA);
});

const abrirConfirmacao = () =>
  fireEvent.click(screen.getByRole("button", { name: /Revogar autorização/i }));

describe("A) com a autorização ativa, a tela oferece revogar", () => {
  it("mostra o botão de revogar ao lado do aviso de que já autorizou", () => {
    render(<AutorizacaoAcervoOuro />);
    expect(screen.getByText(/Você já autorizou/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Revogar autorização/i })).toBeInTheDocument();
  });
});

describe("B) revogar passa por confirmação e explica o efeito", () => {
  it("o clique no botão abre a confirmação, sem revogar nada ainda", () => {
    render(<AutorizacaoAcervoOuro />);
    abrirConfirmacao();
    expect(duble.revogar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a confirmação diz que o acervo deixa de ser visível para contas Ouro", () => {
    render(<AutorizacaoAcervoOuro />);
    abrirConfirmacao();
    expect(screen.getByText(/deixa de ser visível para contas Ouro/i)).toBeInTheDocument();
  });

  it("cancelar fecha a confirmação sem revogar", () => {
    render(<AutorizacaoAcervoOuro />);
    abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }));
    expect(duble.revogar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirmar revoga o termo do acervo Ouro, e só ele", () => {
    render(<AutorizacaoAcervoOuro />);
    abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: /Sim, revogar/i }));
    expect(duble.revogar).toHaveBeenCalledWith({ type: "termo_acesso_ouro" });
  });
});

describe("C) quem ainda não autorizou não vê botão de revogar", () => {
  it("a tela pendente só oferece autorizar", () => {
    duble.status.mockReturnValue(PENDENTE);
    render(<AutorizacaoAcervoOuro />);
    expect(screen.getByRole("button", { name: /^Autorizar$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Revogar/i })).not.toBeInTheDocument();
  });
});
