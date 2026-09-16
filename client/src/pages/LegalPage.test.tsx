import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * As duas páginas públicas do rodapé.
 *
 * O defeito que este arquivo guarda: /termos dizia, em texto escrito no código,
 * que os termos "estão em elaboração com a assessoria jurídica e serão
 * publicados nesta página antes da abertura ao público" — enquanto o cadastro
 * já exigia o aceite do Termo Geral de Uso do Dr. Ronei na última etapa. Quem
 * clicava no rodapé lia o contrário do que a plataforma fazia, e quem ainda não
 * tinha conta não tinha como ler o que ia aceitar.
 *
 * Agora a página mostra o documento PUBLICADO. Os testes abaixo cobrem os três
 * estados que existem de verdade: com versão vigente, sem versão publicada e
 * carregando.
 */

const duble = vi.hoisted(() => ({
  resposta: { data: undefined as unknown, isLoading: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    consent: {
      termoGeralPublico: { useQuery: () => duble.resposta },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// O Streamdown é carregado por import() dentro de lazy(): no teste basta o
// texto cru, que é o mesmo fallback que a usuária vê enquanto ele baixa.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

import { PrivacyPage, TermsPage } from "./LegalPage";

const TERMO = {
  version: 3,
  text: "# TERMO GERAL DE USO\n\n1.1. A plataforma conecta pessoas empreendedoras.\n\n☐ LI E ACEITO integralmente",
  publishedAt: "2026-09-16T00:00:00.000Z",
};

describe("página pública de Termos", () => {
  it("mostra o texto e a versão do documento vigente", async () => {
    duble.resposta = { data: TERMO, isLoading: false };

    render(<TermsPage />);

    await waitFor(() => expect(screen.getByText(/TERMO GERAL DE USO/)).toBeInTheDocument());
    expect(screen.getByText(/Vers[ãa]o 3/)).toBeInTheDocument();
    expect(screen.getByText(/A plataforma conecta pessoas empreendedoras/)).toBeInTheDocument();
  });

  it("não promete mais um termo futuro quando o termo já existe", async () => {
    duble.resposta = { data: TERMO, isLoading: false };

    render(<TermsPage />);

    await waitFor(() => expect(screen.getByText(/TERMO GERAL DE USO/)).toBeInTheDocument());
    expect(document.body.textContent ?? "").not.toMatch(/em elabora[çc][ãa]o/i);
  });

  it("tira a linha da caixa de aceite, que na tela é a caixa de verdade do cadastro", async () => {
    duble.resposta = { data: TERMO, isLoading: false };

    render(<TermsPage />);

    await waitFor(() => expect(screen.getByText(/TERMO GERAL DE USO/)).toBeInTheDocument());
    expect(document.body.textContent ?? "").not.toMatch(/LI E ACEITO/);
  });

  it("sem versão publicada, diz que não há o que mostrar em vez de inventar um texto", () => {
    duble.resposta = { data: null, isLoading: false };

    render(<TermsPage />);

    expect(screen.getByText(/ainda n[ãa]o est[áa] publicada/i)).toBeInTheDocument();
  });

  it("enquanto carrega, avisa que está buscando o termo vigente", () => {
    duble.resposta = { data: undefined, isLoading: true };

    render(<TermsPage />);

    expect(screen.getByText(/Carregando o termo vigente/i)).toBeInTheDocument();
  });
});

describe("página pública de Privacidade", () => {
  it("aponta para o Termo Geral, que é o documento em vigor hoje", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/Termo Geral de Uso, Prote[çc][ãa]o de Dados e Intermedia[çc][ãa]o Digital/)).toBeInTheDocument();
  });

  it("continua dizendo a verdade sobre a política própria, que ainda não existe", () => {
    render(<PrivacyPage />);

    expect(screen.getByText(/est[áa] sendo redigida/i)).toBeInTheDocument();
  });
});
