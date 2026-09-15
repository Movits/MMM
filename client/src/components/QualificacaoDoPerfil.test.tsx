import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { QualificacaoDoPerfil } from "./QualificacaoDoPerfil";

/**
 * Governança (14/09/2026): a membra Bronze vê, item a item, o que falta para
 * a Prata — pela MESMA régua que o servidor aplica ao salvar
 * (shared/qualificacao-do-perfil.ts). Prata, Ouro e staff não veem o cartão.
 */

const QUALIFICADO = {
  displayName: "Ana Souza",
  city: "Lisboa",
  activityArea: "Comércio exterior",
  bio: "Advogada tributarista, atendo empresas familiares que exportam café para a Europa.",
  whatIHave: ["canais_comerciais"],
  whatINeed: ["fornecedores"],
};

afterEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("QualificacaoDoPerfil", () => {
  it.each(["silver", "gold", "president", "admin", undefined])("%s não vê o cartão", (role) => {
    const { container } = render(<QualificacaoDoPerfil role={role} perfil={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Bronze com perfil incompleto vê exatamente o que falta, e que não há mensalidade", () => {
    render(<QualificacaoDoPerfil role="bronze" perfil={{ ...QUALIFICADO, bio: "empresa empresa empresa", whatINeed: [] }} />);

    expect(screen.getByRole("heading", { name: "Membro Bronze: seu perfil está em qualificação" })).toBeInTheDocument();
    const itens = screen.getAllByRole("listitem").map(li => li.textContent);
    expect(itens).toEqual([
      "Uma apresentação com pelo menos 6 palavras que digam quem você é e o que faz",
      "Pelo menos um item em O que preciso",
    ]);
    expect(screen.getByText(/não têm mensalidade/)).toBeInTheDocument();
  });

  it("Bronze sem perfil nenhum vê as seis pendências", () => {
    render(<QualificacaoDoPerfil role="bronze" perfil={null} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });

  it("Bronze com perfil que já atende: sem lista, com o convite a salvar", () => {
    render(<QualificacaoDoPerfil role="bronze" perfil={QUALIFICADO} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/já atende aos critérios de Membro Prata/)).toBeInTheDocument();
  });

  it("o botão abre a edição; sem onCompletar (já editando), não há botão", () => {
    const onCompletar = vi.fn();
    const { rerender } = render(<QualificacaoDoPerfil role="bronze" perfil={null} onCompletar={onCompletar} />);
    fireEvent.click(screen.getByRole("button", { name: "Completar perfil" }));
    expect(onCompletar).toHaveBeenCalledTimes(1);

    rerender(<QualificacaoDoPerfil role="bronze" perfil={null} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("acompanha o idioma", async () => {
    await i18n.changeLanguage("en");
    render(<QualificacaoDoPerfil role="bronze" perfil={{ ...QUALIFICADO, city: "" }} />);
    expect(screen.getByRole("heading", { name: "Bronze Member: your profile is being qualified" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("City");
  });
});
