import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { toast } from "sonner";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * Pedidos do grupo "Projetos IA" em 14/09 para o cadastro:
 *  - Dr. Ronei (19:59): o Termo Geral de Uso vira a ÚLTIMA etapa, com o texto da
 *    versão publicada e um único checkbox; sem aceite (ou sem termo publicado)
 *    não conclui, e o aceite vai antes de salvar o perfil;
 *  - Rosber (21:34): a etapa "Termos e Condições" (contrato de comissão) é
 *    substituída pelo Termo Geral: o cadastro tem UMA etapa de termos e não
 *    registra mais o aceite do contrato_comissao;
 *  - Rosber (20:31): "Sua idade" sai do primeiro passo;
 *  - Rosber (20:44): "CNPJ" vira "Número de Cadastro Empresarial" na tela,
 *    mantendo as duas dicas (sem máscara: detalhes em
 *    Onboarding.cadastro-empresarial.test.tsx);
 *  - Rosber (19:10) e Roberto: "Gravar áudio" e "Revisar texto" em "Quem é você
 *    em uma frase?";
 *  - Lucas (20:58): as 12 opções de "O que você busca?", com "Outra necessidade"
 *    exigindo texto.
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; workStyle: Record<string, string>; sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string> };
  profile: { business: Record<string, string> };
  termoGeral: Record<string, string>;
  oQueBusca: { opcoes: Record<string, { titulo: string; descricao: string }> } & Record<string, unknown>;
  assistenteTexto: Record<string, string>;
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => {
  const d = {
    status: { data: undefined as unknown, isLoading: false, isError: false },
    chamadas: [] as Array<[string, unknown]>,
    responderAceite: null as null | ((vars: { type: string }, opcoes?: Opcoes) => void),
    // O que concluir gravou no auth.me em cache, e o que já havia sido gravado
    // quando a tela navegou (a ordem importa: navegar antes volta a /onboarding).
    authMe: [] as unknown[],
    navegacoes: [] as Array<{ destino: string; authMeNaHora: unknown[] }>,
    navigate: (_destino: string) => {},
  };
  d.navigate = destino => { d.navegacoes.push({ destino, authMeNaHora: [...d.authMe] }); };
  return d;
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    profile: {
      get: { useQuery: () => ({ data: null, isLoading: false }) },
      completeOnboarding: {
        // Responde sucesso: o que a tela faz DEPOIS de salvar o perfil também
        // entra em `chamadas` (antes ela ainda registrava o contrato_comissao).
        useMutation: (opcoesDoHook?: { onSuccess?: () => void }) => ({
          mutate: (vars: unknown) => {
            duble.chamadas.push(["profile.completeOnboarding", vars]);
            opcoesDoHook?.onSuccess?.();
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
            duble.responderAceite?.(vars, opcoes);
          },
          isPending: false,
        }),
      },
      status: {
        useQuery: (input: unknown) => ({
          ...duble.status,
          refetch: () => { duble.chamadas.push(["consent.status.refetch", input]); return Promise.resolve(); },
        }),
      },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    // Concluir marca o cadastro no auth.me em cache: o dublê aplica o atualizador
    // a uma sessão ainda incompleta e guarda o resultado.
    useUtils: () => ({
      auth: {
        me: {
          setData: (_entrada: undefined, atualizar: (atual: unknown) => unknown) => {
            duble.authMe.push(atualizar({ id: 7, role: "bronze", onboardingCompleted: false }));
          },
          invalidate: () => Promise.resolve(),
        },
      },
    }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", duble.navigate],
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
  text: "# TERMO GERAL DE USO\n\n## 1. IDENTIFICAÇÃO DAS PARTES\n\n1.1. Este instrumento regula o acesso.\n\n☐ LI E ACEITO integralmente este Termo Geral de Uso, Proteção de Dados e Intermediação Digital.\n",
  publishedAt: new Date("2026-09-15T12:00:00Z"),
};

const campo = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => re.test(c.placeholder || ""));

const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });

function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

function preencherPasso1() {
  fireEvent.change(campo(/nome|apelido/i)!, { target: { value: "Fulana de Teste" } });
  fireEvent.change(campo(/S[ãa]o Paulo/i)!, { target: { value: "Brasília" } });
}

function irAteAUltimaEtapa() {
  preencherPasso1();
  avancar();
  clicarCartao(pt.onboarding.specialties.tech);
  avancar();
  clicarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
  clicarCartao(pt.onboarding.income.under_3k);
  clicarCartao(pt.onboarding.workStyle.remote);
  avancar();
  fireEvent.change(document.querySelector("select")!, { target: { value: pt.onboarding.sectors.technology } });
  avancar(); // 4 → 5
  avancar(); // 5 → 6
  avancar(); // 6 → 7
  avancar(); // 7 → 8
  avancar(); // 8 → 9: o Termo Geral de Uso, sem etapa de contrato de comissão antes
}

const botaoFinal = () => screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) });

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  duble.status = { data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null }, isLoading: false, isError: false };
  duble.chamadas.length = 0;
  duble.responderAceite = null;
  duble.authMe.length = 0;
  duble.navegacoes.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("passo 1 — Vamos começar pelo básico", () => {
  it("não pede mais a idade, e a frase de apresentação tem Gravar áudio e Revisar texto", () => {
    render(<Onboarding />);
    expect(screen.queryByText("Sua idade")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ajuda a encontrar conexões mais alinhadas/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="number"]')).toBeNull();

    const bio = screen.getByText(pt.onboarding.fields.bio).closest("div")!;
    expect(within(bio).getByRole("button", { name: new RegExp(pt.assistenteTexto.gravar) })).toBeInTheDocument();
    expect(within(bio).getByRole("button", { name: new RegExp(pt.assistenteTexto.revisar) })).toBeInTheDocument();
  });
});

describe("passo 2 — Número de Cadastro Empresarial", () => {
  it("o rótulo diz 'Número de Cadastro Empresarial', a palavra CNPJ some da tela e as duas dicas ficam", () => {
    render(<Onboarding />);
    preencherPasso1();
    avancar();
    clicarCartao(pt.profile.business.legalEntity);

    expect(screen.getByText("Número de Cadastro Empresarial")).toBeInTheDocument();
    expect(screen.getAllByText(pt.profile.business.registrationNumberHint)).toHaveLength(2);
    expect(pt.profile.business.registrationNumberHint).toMatch(/Número de Cadastro Empresarial/);
    expect(document.body.textContent).not.toMatch(/CNPJ/);
    // A máscara do CNPJ saiu (PR #133): o campo aceita letras e números de qualquer país.
    expect(campo(/00\.000\.000\/0000-00/)).toBeFalsy();
    expect(campo(new RegExp(pt.profile.business.registrationNumberPlaceholder))).toBeTruthy();
  });
});

describe("uma etapa de termos só — o Termo Geral substituiu 'Termos e Condições'", () => {
  it("são 9 etapas, nenhuma chamada 'Termos e Condições', e o Termo Geral é a última", () => {
    render(<Onboarding />);

    expect(screen.getByText("1 / 9")).toBeInTheDocument();
    expect(screen.queryByText("Termos e Condições")).not.toBeInTheDocument();
    expect(screen.queryByText(/Acordo de Comissionamento/)).not.toBeInTheDocument();
    // O painel lateral lista as etapas; a última é a do Termo Geral.
    expect(screen.getByText(pt.termoGeral.etapaTitulo)).toBeInTheDocument();

    irAteAUltimaEtapa();
    expect(screen.getByText("9 / 9")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pt.termoGeral.etapaTitulo);
  });

  it("concluir registra só o aceite do Termo Geral: nenhum contrato_comissao depois de salvar o perfil", () => {
    duble.responderAceite = (vars, opcoes) => { if (vars.type === "termo_geral_de_uso") opcoes?.onSuccess?.(); };
    vi.mocked(toast.success).mockClear();
    render(<Onboarding />);
    irAteAUltimaEtapa();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(botaoFinal());

    const aceites = duble.chamadas.filter(([nome]) => nome === "consent.accept").map(([, vars]) => (vars as { type: string }).type);
    expect(aceites).toEqual(["termo_geral_de_uso"]);
    expect(toast.success).toHaveBeenCalled();
  });

  it("concluir marca o cadastro concluído no auth.me em cache ANTES de ir ao Dashboard", () => {
    // Sem isto o ProtectedRoute do /dashboard lia o onboardingCompleted false
    // do cache e devolvia a pessoa a /onboarding logo depois de concluir.
    duble.responderAceite = (vars, opcoes) => { if (vars.type === "termo_geral_de_uso") opcoes?.onSuccess?.(); };
    render(<Onboarding />);
    irAteAUltimaEtapa();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(botaoFinal());

    const concluido = { id: 7, role: "bronze", onboardingCompleted: true };
    expect(duble.authMe).toEqual([concluido]);
    expect(duble.navegacoes).toEqual([{ destino: "/dashboard", authMeNaHora: [concluido] }]);
  });
});

describe("passo 3 — O que você busca?", () => {
  it("mostra as 12 opções na ordem pedida, com título e descrição", () => {
    render(<Onboarding />);
    preencherPasso1();
    avancar();
    clicarCartao(pt.onboarding.specialties.tech);
    avancar();

    const chaves = [
      "expandir_negocio", "parceiro_estrategico", "investimento_capital", "clientes_compradores",
      "fornecedores_produtos", "internacionalizacao", "conexoes_institucionais", "tecnologia_solucoes",
      "talentos_especialistas", "servico_especializado", "visibilidade_posicionamento", "outra_necessidade",
    ];
    const titulos = chaves.map(chave => pt.oQueBusca.opcoes[chave].titulo);
    expect(titulos[0]).toBe("Expandir meu negócio");
    const grade = screen.getByText(titulos[0]).closest("button")!.parentElement!;
    const naTela = within(grade).getAllByRole("button").map(b => chaves.find(c => b.textContent?.includes(pt.oQueBusca.opcoes[c].titulo)));
    expect(naTela).toEqual(chaves);
    expect(screen.getByText("Jurídico, tributário, regulatório, marketing etc.")).toBeInTheDocument();
    // As antigas saíram.
    expect(screen.queryByText("Emprego/Projeto")).not.toBeInTheDocument();
  });

  it("'Outra necessidade' abre um campo obrigatório: sem texto não avança", () => {
    render(<Onboarding />);
    preencherPasso1();
    avancar();
    clicarCartao(pt.onboarding.specialties.tech);
    avancar();
    clicarCartao(pt.onboarding.income.under_3k);
    clicarCartao(pt.onboarding.workStyle.remote);
    clicarCartao("Outra necessidade");

    const texto = campo(/armazém refrigerado/i);
    expect(texto, "campo de Outra necessidade não apareceu").toBeTruthy();
    expect(botaoContinuar()).toBeDisabled();

    fireEvent.change(texto!, { target: { value: "Armazém refrigerado em Santos" } });
    expect(botaoContinuar()).toBeEnabled();

    // Seleção múltipla: marcar outra opção não desmarca a primeira.
    clicarCartao(pt.oQueBusca.opcoes.internacionalizacao.titulo);
    expect(campo(/armazém refrigerado/i)).toBeTruthy();
  });
});

describe("última etapa — Termo Geral de Uso", () => {
  it("mostra o texto da versão publicada (sem a linha ☐ do docx) e um único checkbox", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();

    expect(screen.getByText(pt.termoGeral.titulo)).toBeInTheDocument();
    const texto = screen.getByTestId("texto-do-termo-geral");
    expect(texto.textContent).toMatch(/1\.1\. Este instrumento regula o acesso\./);
    expect(texto.textContent).not.toMatch(/☐/);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(pt.termoGeral.aceite)).toBeInTheDocument();
    expect(botaoFinal()).toBeDisabled();
  });

  it("sem versão publicada, diz que o termo não está disponível e não deixa concluir", () => {
    duble.status = { data: { document: null, accepted: true, acceptedAt: null, pendingText: true, previousVersion: null }, isLoading: false, isError: false };
    render(<Onboarding />);
    irAteAUltimaEtapa();

    expect(screen.getByRole("alert")).toHaveTextContent(pt.termoGeral.naoPublicado);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(botaoFinal()).toBeDisabled();
    fireEvent.click(botaoFinal());
    expect(duble.chamadas.filter(([nome]) => nome !== "consent.status.refetch")).toEqual([]);
  });

  it("marcado: registra o aceite DA VERSÃO EXIBIDA e só depois salva o perfil", () => {
    duble.responderAceite = (vars, opcoes) => { if (vars.type === "termo_geral_de_uso") opcoes?.onSuccess?.(); };
    render(<Onboarding />);
    irAteAUltimaEtapa();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(botaoFinal()).toBeEnabled();
    fireEvent.click(botaoFinal());

    expect(duble.chamadas.map(([nome]) => nome)).toEqual(["consent.accept", "profile.completeOnboarding"]);
    expect(duble.chamadas[0][1]).toEqual({ type: "termo_geral_de_uso", documentVersionId: "termo-v3" });
    const perfil = duble.chamadas[1][1] as Record<string, unknown>;
    expect(perfil).not.toHaveProperty("age");
    expect(perfil.seekingTypes).toEqual(["expandir_negocio"]);
    expect(perfil.seekingOtherNeed).toBeUndefined();
  });

  it("versão exibida trocada por refetch depois de marcar: a caixa desmarca e o aceite só sai para a versão marcada", () => {
    // Marcou na v3, a v4 foi publicada e o consent.status refez a consulta
    // (voltar à etapa, reconectar): a caixa marcada na v3 não vale para a v4.
    duble.responderAceite = (vars, opcoes) => { if (vars.type === "termo_geral_de_uso") opcoes?.onSuccess?.(); };
    const { rerender } = render(<Onboarding />);
    irAteAUltimaEtapa();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(botaoFinal()).toBeEnabled();

    const v4 = { ...TERMO, id: "termo-v4", version: 4, text: "# TERMO GERAL DE USO\n\n1.1. Texto da versão 4.\n" };
    duble.status = { data: { document: v4, accepted: false, acceptedAt: null, pendingText: false, previousVersion: 3 }, isLoading: false, isError: false };
    rerender(<Onboarding />);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(botaoFinal()).toBeDisabled();
    fireEvent.click(botaoFinal());
    expect(duble.chamadas.some(([nome]) => nome === "consent.accept")).toBe(false);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(botaoFinal());
    expect(duble.chamadas[0]).toEqual(["consent.accept", { type: "termo_geral_de_uso", documentVersionId: "termo-v4" }]);
  });

  it("versão trocada enquanto lia (CONFLICT): não salva o perfil, desmarca e recarrega o termo", () => {
    duble.responderAceite = (_vars, opcoes) => opcoes?.onError?.({ data: { code: "CONFLICT" } });
    render(<Onboarding />);
    irAteAUltimaEtapa();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(botaoFinal());

    expect(duble.chamadas.some(([nome]) => nome === "profile.completeOnboarding")).toBe(false);
    expect(duble.chamadas.some(([nome]) => nome === "consent.status.refetch")).toBe(true);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(toast.error).toHaveBeenCalledWith(pt.termoGeral.versaoMudou);
  });
});
