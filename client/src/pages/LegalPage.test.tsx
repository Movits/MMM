import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyPage, TermsPage } from "./LegalPage";

// Teste de fumaça do runner de front: as duas páginas são estáticas e sem
// dependência de rede ou de nível, então servem para provar que jsdom, JSX,
// aliases e jest-dom estão de pé.
describe("LegalPage", () => {
  it("PrivacyPage renderiza o título e o link de voltar", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Política de Privacidade" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /voltar/i })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("TermsPage renderiza o título e o link de voltar", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Termos de Uso" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /voltar/i })).toHaveAttribute(
      "href",
      "/"
    );
  });
});
