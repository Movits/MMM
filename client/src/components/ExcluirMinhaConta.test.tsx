import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExcluirMinhaConta } from "./ExcluirMinhaConta";

/**
 * A zona de risco do perfil (cartão "Não existe caminho para excluir os dados
 * de uma usuária"). O que este teste protege:
 *
 * A. A dona vê o que vai embora ANTES de confirmar — as cinco linhas da lista.
 *    "Excluir a conta" não avisa que a rede de contatos e as reuniões
 *    transcritas somem com ela.
 * B. O botão de confirmar só liga com a palavra E a senha preenchidas: um
 *    envio pela metade viraria erro do servidor depois do susto.
 * C. Conta sem senha e última administradora são recusas do SERVIDOR; a tela
 *    as antecipa e nem abre o formulário, senão a dona digita tudo para ouvir
 *    "não".
 *
 * O tRPC vira dublê (molde: Contexts.test.tsx). O i18n dos testes é fixado em
 * pt-BR por client/src/test/setup.ts, então as asserções são no texto real.
 */

const duble = vi.hoisted(() => ({
  requisitos: vi.fn(),
  mutate: vi.fn(),
  navegou: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/profile", (para: string) => duble.navegou.push(para)] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { setData: vi.fn() } } }),
    conta: {
      requisitosDaExclusao: { useQuery: () => duble.requisitos() },
      excluirMinhaConta: {
        useMutation: () => ({ mutate: duble.mutate, isPending: false }),
      },
    },
  },
}));

const LIBERADA = { data: { confirmacaoEsperada: "dona@exemplo.com", temSenha: true, ultimaAdministradora: false } };

beforeEach(() => {
  duble.requisitos.mockReset();
  duble.mutate.mockReset();
  duble.navegou.length = 0;
  duble.requisitos.mockReturnValue(LIBERADA);
});

const abrir = () => fireEvent.click(screen.getByRole("button", { name: /Excluir minha conta/i }));
const confirmar = () => screen.getByRole("button", { name: /Excluir definitivamente/i });

describe("A) a dona vê o que vai embora antes de confirmar", () => {
  it("lista os cinco módulos e o aviso de que não há volta", () => {
    render(<ExcluirMinhaConta />);
    abrir();
    expect(screen.getByText(/rede particular de contatos/i)).toBeInTheDocument();
    expect(screen.getByText(/gravações e as transcrições/i)).toBeInTheDocument();
    expect(screen.getByText(/salas de negociação/i)).toBeInTheDocument();
    expect(screen.getByText(/documentos de verificação/i)).toBeInTheDocument();
    expect(screen.getByText(/não tem como desfazê-la/i)).toBeInTheDocument();
  });

  it("diz exatamente o que digitar, com o e-mail que o servidor espera", () => {
    render(<ExcluirMinhaConta />);
    abrir();
    expect(screen.getByText(/digite: dona@exemplo\.com/i)).toBeInTheDocument();
  });
});

describe("B) o botão de confirmar exige a palavra e a senha", () => {
  it("começa desligado e só liga com os dois campos", () => {
    render(<ExcluirMinhaConta />);
    abrir();
    expect(confirmar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/digite:/i), { target: { value: "dona@exemplo.com" } });
    expect(confirmar()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Sua senha/i), { target: { value: "minha-senha" } });
    expect(confirmar()).toBeEnabled();
  });

  it("envia a senha e a confirmação como a dona digitou", () => {
    render(<ExcluirMinhaConta />);
    abrir();
    fireEvent.change(screen.getByLabelText(/digite:/i), { target: { value: "dona@exemplo.com" } });
    fireEvent.change(screen.getByLabelText(/Sua senha/i), { target: { value: "minha-senha" } });
    fireEvent.click(confirmar());
    expect(duble.mutate).toHaveBeenCalledWith({ senha: "minha-senha", confirmacao: "dona@exemplo.com" });
  });

  it("a senha não aparece na tela", () => {
    render(<ExcluirMinhaConta />);
    abrir();
    expect(screen.getByLabelText(/Sua senha/i)).toHaveAttribute("type", "password");
  });
});

describe("C) a tela antecipa as recusas do servidor", () => {
  it("última administradora: explica e não deixa abrir", () => {
    duble.requisitos.mockReturnValue({ data: { ...LIBERADA.data, ultimaAdministradora: true } });
    render(<ExcluirMinhaConta />);
    expect(screen.getByText(/Promova outra membra a Ouro/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excluir minha conta/i })).toBeDisabled();
  });

  it("conta sem senha: manda criar uma pelo esqueci-minha-senha", () => {
    duble.requisitos.mockReturnValue({ data: { ...LIBERADA.data, temSenha: false } });
    render(<ExcluirMinhaConta />);
    expect(screen.getByText(/Esqueci minha senha/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excluir minha conta/i })).toBeDisabled();
  });

  it("enquanto a consulta não volta, o botão não promete o que não sabe", () => {
    duble.requisitos.mockReturnValue({ data: undefined });
    render(<ExcluirMinhaConta />);
    abrir();
    expect(screen.getByText(/digite:/i)).toBeInTheDocument();
    expect(confirmar()).toBeDisabled();
  });
});
