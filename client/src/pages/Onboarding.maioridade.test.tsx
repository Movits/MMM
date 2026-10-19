import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { toast } from "sonner";
import ptBR from "@/i18n/locales/pt-BR.json";
import { MENSAGEM_MAIORIDADE_NAO_DECLARADA } from "@shared/maioridade";

/**
 * Cadastro só para maiores de 18 anos (Roberto, 16/09: "Corrija o sistema para
 * 18 anos"; cláusula 3.4 do Termo Geral de Uso).
 *
 * Na última etapa, ao lado do aceite do Termo, a caixa obrigatória "Declaro que
 * tenho 18 anos ou mais.". Prova que:
 *   1. o botão final só habilita com as DUAS caixas marcadas;
 *   2. concluir envia `declaraMaioridade: true` ao servidor;
 *   3. a caixa não vai para os rascunhos (localStorage e sessionStorage) e não
 *      volta marcada de um rascunho, nem de um que traga a chave;
 *   4. se o servidor recusar pela declaração, a tela mostra a mensagem
 *      traduzida (e não a do servidor, em português) e desmarca a caixa;
 *   5. os 10 idiomas têm a frase traduzida de verdade.
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string>; errorMsg: string };
  oQueBusca: { opcoes: Record<string, { titulo: string; descricao: string }> } & Record<string, unknown>;
  termoGeral: Record<string, string>;
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  perfil: null as unknown,
  status: { data: undefined as unknown, isLoading: false, isError: false },
  chamadas: [] as Array<[string, unknown]>,
  // Quando preenchido, completeOnboarding responde com este erro em vez de sucesso.
  recusaDoServidor: null as null | { message: string },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: duble.perfil, isLoading: false }) },
      completeOnboarding: {
        useMutation: (opcoesDoHook?: { onSuccess?: () => void; onError?: (erro: { message: string }) => void }) => ({
          mutate: (vars: unknown) => {
            duble.chamadas.push(["profile.completeOnboarding", vars]);
            if (duble.recusaDoServidor) opcoesDoHook?.onError?.(duble.recusaDoServidor);
            else opcoesDoHook?.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
    consent: {
      accept: {
        useMutation: () => ({
          mutate: (vars: { type: string }, opcoes?: Opcoes) => {
            duble.chamadas.push(["consent.accept", vars]);
            opcoes?.onSuccess?.();
          },
          isPending: false,
        }),
      },
      status: {
        useQuery: () => ({ ...duble.status, refetch: () => Promise.resolve() }),
      },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({
      auth: { me: { setData: () => {}, invalidate: () => Promise.resolve() } },
    }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", () => {}],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O leitor de Markdown puxa KaTeX (CSS) e não roda no jsdom; aqui basta o texto.
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

import Onboarding from "./Onboarding";

const TERMO = {
  id: "termo-v3",
  type: "termo_geral_de_uso",
  version: 3,
  text: "# TERMO GERAL DE USO\n\n3.4. O USUÁRIO pessoa física deve ser maior de 18 (dezoito) anos.\n",
  publishedAt: new Date("2026-09-15T12:00:00Z"),
};

const USUARIA_7 = { id: 7, name: "Fulana", email: "fulana@exemplo.com", role: "bronze", onboardingCompleted: false };
const CHAVE_DA_7 = "mmm.onboarding.rascunho.7";

const campo = (placeholder: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => c.placeholder === placeholder)!;

const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });
const botaoFinal = () => screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) });
const caixaDoAceite = () => screen.getByRole("checkbox", { name: pt.termoGeral.aceite });
const caixaDaMaioridade = () => screen.getByRole("checkbox", { name: pt.termoGeral.maioridade });

function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

function irAteAUltimaEtapa() {
  fireEvent.change(campo(pt.onboarding.fields.displayNamePlaceholder), { target: { value: "Fulana de Teste" } });
  fireEvent.change(campo(pt.onboarding.fields.cityPlaceholder), { target: { value: "Brasília" } });
  avancar();
  clicarCartao(pt.onboarding.specialties.tech);
  avancar();
  clicarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
  clicarCartao(pt.onboarding.income.under_3k);
  avancar();
  fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
  avancar(); // 4 → 5 (O que tenho)
  avancar(); // 5 → 6 (O que preciso)
  avancar(); // 6 → 7 (revisão)
  avancar(); // 7 → 8: Termo Geral de Uso
  expect(screen.getByText("8 / 8")).toBeInTheDocument();
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "");
  duble.perfil = { user: USUARIA_7, profile: null };
  duble.status = { data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null }, isLoading: false, isError: false };
  duble.chamadas.length = 0;
  duble.recusaDoServidor = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("última etapa — a caixa 'Declaro que tenho 18 anos ou mais.'", () => {
  it("aparece ao lado do aceite, desmarcada, com o texto da declaração", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();

    expect(pt.termoGeral.maioridade).toBe("Declaro que tenho 18 anos ou mais.");
    expect(caixaDaMaioridade()).not.toBeChecked();
    expect(caixaDoAceite()).not.toBeChecked();
    expect(screen.getByText(pt.termoGeral.maioridadeObrigatoria)).toBeInTheDocument();
  });

  it("o botão final só habilita com as duas caixas marcadas", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();
    expect(botaoFinal()).toBeDisabled();

    // Só o aceite do termo: não basta.
    fireEvent.click(caixaDoAceite());
    expect(botaoFinal()).toBeDisabled();
    fireEvent.click(botaoFinal());
    expect(duble.chamadas).toEqual([]);

    // Só a declaração de maioridade: também não.
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    expect(botaoFinal()).toBeDisabled();

    // As duas: habilita. Desmarcar a de maioridade trava de novo.
    fireEvent.click(caixaDoAceite());
    expect(botaoFinal()).toBeEnabled();
    fireEvent.click(caixaDaMaioridade());
    expect(botaoFinal()).toBeDisabled();
    expect(screen.getByText(pt.termoGeral.maioridadeObrigatoria)).toBeInTheDocument();
  });

  it("concluir envia a declaração ao servidor, depois do aceite do termo", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    fireEvent.click(botaoFinal());

    expect(duble.chamadas.map(([nome]) => nome)).toEqual(["consent.accept", "profile.completeOnboarding"]);
    const perfil = duble.chamadas[1][1] as Record<string, unknown>;
    expect(perfil.declaraMaioridade).toBe(true);
    // A tela continua sem pedir idade.
    expect(perfil).not.toHaveProperty("age");
  });
});

describe("a declaração não fica em rascunho nenhum", () => {
  it("marcada, não é gravada no localStorage nem no sessionStorage", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDaMaioridade());
    expect(caixaDaMaioridade()).toBeChecked();
    // Os rascunhos existem e seguem sendo gravados a cada mudança...
    fireEvent.click(caixaDoAceite());
    const local = window.localStorage.getItem(CHAVE_DA_7);
    const daAba = window.sessionStorage.getItem(CHAVE_DA_7);
    expect(local, "o rascunho devia existir").not.toBeNull();
    expect(daAba, "o rascunho da aba devia existir").not.toBeNull();
    // ...mas nenhum deles leva a declaração.
    expect(local).not.toMatch(/maioridade/i);
    expect(daAba).not.toMatch(/maioridade/i);
  });

  it("recarregar a aba volta à última etapa com a caixa desmarcada, mesmo com um rascunho que traga a chave", () => {
    const { unmount } = render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    expect(botaoFinal()).toBeEnabled();
    unmount();

    // Um rascunho de outra versão da tela (ou adulterado) com a declaração marcada.
    for (const armazenamento of [window.localStorage, window.sessionStorage]) {
      const gravado = JSON.parse(armazenamento.getItem(CHAVE_DA_7)!) as Record<string, unknown>;
      armazenamento.setItem(CHAVE_DA_7, JSON.stringify({ ...gravado, declaraMaioridade: true, declarouMaioridade: true }));
    }

    render(<Onboarding />);
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(caixaDaMaioridade()).not.toBeChecked();
    expect(botaoFinal()).toBeDisabled();
  });
});

describe("recusa do servidor", () => {
  it("pela declaração: mostra a mensagem traduzida, não a do servidor, e desmarca a caixa", () => {
    duble.recusaDoServidor = { message: MENSAGEM_MAIORIDADE_NAO_DECLARADA };
    render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    fireEvent.click(botaoFinal());

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(pt.termoGeral.maioridadeRecusada);
    expect(caixaDaMaioridade()).not.toBeChecked();
    expect(botaoFinal()).toBeDisabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("por outro motivo: segue a mensagem genérica com o texto do servidor, e a caixa fica marcada", () => {
    duble.recusaDoServidor = { message: "Informe o Número de Cadastro Empresarial." };
    render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    fireEvent.click(botaoFinal());

    expect(toast.error).toHaveBeenCalledWith(`${pt.onboarding.errorMsg} Informe o Número de Cadastro Empresarial.`);
    expect(caixaDaMaioridade()).toBeChecked();
  });
});

describe("a frase nos 10 idiomas", () => {
  const locais = import.meta.glob<{ termoGeral: Record<string, string> }>("../i18n/locales/*.json", { eager: true, import: "default" });
  const CHAVES = ["maioridade", "maioridadeObrigatoria", "maioridadeRecusada"] as const;

  it("existe em todos, diz 18 e não é a frase em português copiada", () => {
    const idiomas = Object.keys(locais);
    expect(idiomas).toHaveLength(10);
    for (const [arquivo, conteudo] of Object.entries(locais)) {
      for (const chave of CHAVES) {
        const texto = conteudo.termoGeral[chave];
        expect(texto, `${arquivo} termoGeral.${chave}`).toMatch(/18/);
        if (!arquivo.endsWith("pt-BR.json")) {
          expect(texto, `${arquivo} termoGeral.${chave} ainda em português`).not.toBe(pt.termoGeral[chave]);
        }
      }
    }
  });
});
