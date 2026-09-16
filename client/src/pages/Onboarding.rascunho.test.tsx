import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, fireEvent, act } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * Lista do Nicolas na PR #135 (15/09):
 *  - item 10, "A bio importada é apagada ao concluir o cadastro": o
 *    pré-preenchimento só copiava nome, cidade e país do perfil, e o envio
 *    mandava `bio: ""` sempre; as contas da carga
 *    (scripts/importar-participantes.mjs) chegavam com bio e a perdiam ao
 *    concluir. Agora a bio salva aparece na etapa 1 e, vazia, o campo não é
 *    enviado (o servidor preserva a que existe). A carga insere a bio sem
 *    limite e o zod de completeOnboarding aceita até 1000: a bio importada
 *    maior que isso entra cortada, sem partir emoji, para a conta conseguir
 *    concluir;
 *  - janela C, "Não perder o cadastro quando o Termo não está publicado": sem
 *    versão vigente o botão final trava e fechar a aba perdia as 8 etapas. O
 *    formulário vira rascunho em localStorage por usuária, volta ao abrir de
 *    novo e é apagado ao concluir com sucesso.
 *
 * Ressalvas da revisão do rascunho (privacidade, mesma razão da nota V-03 em
 * _core/hooks/useAuth.ts): faixa de renda, capacidade de investimento e Número
 * de Cadastro Empresarial não ficam no localStorage (a pessoa redigita); o
 * rascunho leva `salvoEm` e vale 7 dias; sair da conta apaga todos os
 * rascunhos do navegador.
 */

const pt = ptBR as unknown as {
  onboarding: { specialties: Record<string, string>; income: Record<string, string>; workStyle: Record<string, string>; sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string> };
  oQueBusca: { opcoes: Record<string, { titulo: string; descricao: string }> } & Record<string, unknown>;
  profile: { business: Record<string, string> };
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  // O que profile.get devolve: a referência é estável entre renders, como no
  // React Query, para o efeito de pré-preenchimento rodar uma vez só.
  perfil: null as unknown,
  status: { data: undefined as unknown, isLoading: false, isError: false },
  chamadas: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    // Só o que useAuth (real, não mockado) precisa para o teste do logout.
    auth: {
      me: { useQuery: () => ({ data: USUARIA_7, isLoading: false, error: null, refetch: () => Promise.resolve() }) },
      logout: {
        useMutation: () => ({
          mutateAsync: async () => { duble.chamadas.push(["auth.logout", undefined]); },
          isPending: false,
          error: null,
        }),
      },
    },
    profile: {
      get: { useQuery: () => ({ data: duble.perfil, isLoading: false }) },
      completeOnboarding: {
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
      auth: {
        me: {
          setData: () => {},
          invalidate: () => Promise.resolve(),
        },
      },
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
import { useAuth } from "@/_core/hooks/useAuth";

const TERMO = {
  id: "termo-v3",
  type: "termo_geral_de_uso",
  version: 3,
  text: "# TERMO GERAL DE USO\n\n1.1. Este instrumento regula o acesso.\n",
  publishedAt: new Date("2026-09-15T12:00:00Z"),
};

const USUARIA_7 = { id: 7, name: "Fulana", email: "fulana@exemplo.com", role: "bronze", onboardingCompleted: false };
const CHAVE_DA_7 = "mmm.onboarding.rascunho.7";

const perfilDe = (user: { id: number; name: string }, profile: Record<string, unknown> | null) => ({ user, profile });

const campo = (placeholder: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => c.placeholder === placeholder);

const campoNome = () => campo(pt.onboarding.fields.displayNamePlaceholder)!;
const campoCidade = () => campo(pt.onboarding.fields.cityPlaceholder)!;
const campoBio = () => campo(pt.onboarding.fields.bioPlaceholder)!;
const campoCadastroEmpresarial = () => campo(pt.profile.business.registrationNumberPlaceholder)!;

const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });
const botaoFinal = () => screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) });

function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

function irAteAUltimaEtapa() {
  fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
  fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
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
}

function concluir() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(botaoFinal());
}

const perfilEnviado = () => {
  const chamada = duble.chamadas.find(([nome]) => nome === "profile.completeOnboarding");
  expect(chamada, "profile.completeOnboarding não foi chamado").toBeTruthy();
  return chamada![1] as Record<string, unknown>;
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  window.localStorage.clear();
  duble.perfil = perfilDe(USUARIA_7, null);
  duble.status = { data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null }, isLoading: false, isError: false };
  duble.chamadas.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("item 10 — a bio já salva no perfil não se perde ao concluir", () => {
  it("a bio de uma conta importada aparece no campo da etapa 1", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "Consultora X" });
    render(<Onboarding />);

    expect(campoBio()).toHaveValue("Consultora X");
    expect(campoNome()).toHaveValue("Fulana Importada");
  });

  it("concluir envia a bio que veio do perfil, e não uma bio vazia", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "Consultora X" });
    render(<Onboarding />);
    irAteAUltimaEtapa();
    concluir();

    expect(perfilEnviado().bio).toBe("Consultora X");
  });

  it("bio em branco não vai no pedido: o servidor preserva a que já existe", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();
    concluir();

    // `bio: ""` apagava a bio importada; ausente, o UPDATE não toca na coluna.
    expect(perfilEnviado().bio).toBeUndefined();
  });

  it("o que a pessoa escreveu na bio vence o que estava no perfil", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "Consultora X" });
    render(<Onboarding />);
    fireEvent.change(campoBio(), { target: { value: "  Consultora de exportação  " } });
    irAteAUltimaEtapa();
    concluir();

    expect(perfilEnviado().bio).toBe("Consultora de exportação");
  });
});

describe("janela C — rascunho do cadastro em localStorage, por usuária", () => {
  it("fechar e abrir de novo devolve o que já tinha sido preenchido", () => {
    const { unmount } = render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
    fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
    avancar();
    clicarCartao(pt.onboarding.specialties.tech);
    unmount();

    render(<Onboarding />);
    expect(campoNome()).toHaveValue("Fulana de Teste");
    expect(campoCidade()).toHaveValue("Brasília");
    // A especialidade marcada na etapa 2 também volta.
    avancar();
    expect(screen.getByText(pt.onboarding.specialties.tech).closest("button")).toHaveClass("border-[#c98f70]");
  });

  it("o rascunho vence o pré-preenchimento do perfil", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "Consultora X" });
    const { unmount } = render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana Corrigida" } });
    unmount();

    render(<Onboarding />);
    expect(campoNome()).toHaveValue("Fulana Corrigida");
    expect(campoBio()).toHaveValue("Consultora X");
  });

  it("concluir com sucesso apaga o rascunho", () => {
    render(<Onboarding />);
    irAteAUltimaEtapa();
    expect(window.localStorage.getItem(CHAVE_DA_7), "o rascunho devia existir antes de concluir").not.toBeNull();

    concluir();

    expect(duble.chamadas.some(([nome]) => nome === "profile.completeOnboarding")).toBe(true);
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
  });

  it("a caixa do Termo Geral não entra no rascunho: o aceite é ato da sessão que conclui", () => {
    const { unmount } = render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(botaoFinal()).toBeEnabled();
    unmount();

    render(<Onboarding />);
    // O rascunho já preencheu as 7 primeiras etapas: só "Continuar" até a
    // última — fora a faixa de renda, que não fica no rascunho e a etapa 3
    // exige de novo.
    avancar(); // 1 → 2
    avancar(); // 2 → 3
    clicarCartao(pt.onboarding.income.under_3k);
    for (let etapa = 3; etapa < 8; etapa++) avancar();
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(botaoFinal()).toBeDisabled();
  });

  it("o rascunho de uma usuária não aparece para outra no mesmo navegador", () => {
    const { unmount } = render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
    unmount();

    duble.perfil = perfilDe({ id: 8, name: "Beltrana" }, null);
    render(<Onboarding />);
    expect(campoNome()).toHaveValue("Beltrana");
    expect(window.localStorage.getItem(CHAVE_DA_7)).toContain("Fulana de Teste");
  });

  it("sem usuária carregada nada é gravado (evita rascunho sem dona)", () => {
    duble.perfil = null;
    render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });

    expect(window.localStorage.length).toBe(0);
  });

  it("rascunho corrompido ou de outra forma é ignorado sem quebrar a tela", () => {
    window.localStorage.setItem(CHAVE_DA_7, "{{{ não é JSON");
    const { unmount } = render(<Onboarding />);
    expect(campoNome()).toHaveValue("Fulana");
    unmount();

    // Campo com a forma errada (array virando string, número no lugar de lista)
    // fica de fora; o que tem a forma certa entra.
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ displayName: "Fulana Salva", primarySpecialties: "tech", seekingTypes: null, values: 3, salvoEm: Date.now() }));
    render(<Onboarding />);
    expect(campoNome()).toHaveValue("Fulana Salva");
    fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
    avancar();
    expect(screen.getByText(pt.onboarding.specialties.tech)).toBeInTheDocument();
  });
});

describe("revisão do rascunho — o que não pode ficar no localStorage, e por quanto tempo", () => {
  const DIA_MS = 24 * 60 * 60 * 1000;

  it("faixa de renda, capacidade de investimento e Número de Cadastro Empresarial ficam fora do rascunho", () => {
    const { unmount } = render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
    fireEvent.change(campoCidade(), { target: { value: "Brasília" } });
    avancar();
    clicarCartao(pt.onboarding.specialties.tech);
    clicarCartao(pt.profile.business.legalEntity);
    fireEvent.change(campoCadastroEmpresarial(), { target: { value: "12.345.678/0001-90" } });
    avancar();
    clicarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
    clicarCartao(pt.onboarding.income.under_3k);

    const bruto = window.localStorage.getItem(CHAVE_DA_7)!;
    const gravado = JSON.parse(bruto) as Record<string, unknown>;
    expect(gravado.displayName).toBe("Fulana de Teste");
    expect(gravado).not.toHaveProperty("incomeRange");
    expect(gravado).not.toHaveProperty("investmentCapacity");
    expect(gravado).not.toHaveProperty("companyCnpj");
    expect(bruto).not.toContain("12345678000190");
    expect(bruto).not.toContain("under_3k");
    expect(typeof gravado.salvoEm, "o rascunho leva a data em que foi gravado").toBe("number");

    // Ao voltar, a pessoa redigita: o cadastro empresarial está em branco e a
    // renda não vem marcada (o resto do rascunho volta normalmente).
    unmount();
    render(<Onboarding />);
    avancar();
    expect(screen.getByText(pt.profile.business.legalEntity).closest("button")).toHaveClass("border-[#c98f70]");
    expect(campoCadastroEmpresarial()).toHaveValue("");
    fireEvent.change(campoCadastroEmpresarial(), { target: { value: "12.345.678/0001-90" } });
    avancar();
    expect(screen.getByText(pt.onboarding.income.under_3k).closest("button")).not.toHaveClass("border-[#c98f70]");
  });

  it("rascunho com mais de 7 dias, ou sem data, é ignorado: o campo volta vazio", () => {
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ city: "Recife", salvoEm: Date.now() - 8 * DIA_MS }));
    const { unmount } = render(<Onboarding />);
    expect(campoCidade()).toHaveValue("");
    unmount();

    // Sem `salvoEm` não dá para saber a idade: também fica de fora.
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ city: "Recife" }));
    render(<Onboarding />);
    expect(campoCidade()).toHaveValue("");
  });

  it("rascunho de 6 dias ainda vale", () => {
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ city: "Recife", salvoEm: Date.now() - 6 * DIA_MS }));
    render(<Onboarding />);
    expect(campoCidade()).toHaveValue("Recife");
  });
});

describe("item 10 — bio importada maior que o teto de 1000 do servidor", () => {
  it("bio de 1200 caracteres em profile.get aparece com 1000 e deixa continuar", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "a".repeat(1200) });
    render(<Onboarding />);

    expect(campoBio()).toHaveValue("a".repeat(1000));
    // Antes, `form.bio.length > LIMITE_BIO` travava o "Continuar" da etapa 1.
    expect(botaoContinuar()).toBeEnabled();
  });

  it("o corte não parte um emoji ao meio e cabe no teto do zod (que conta unidades UTF-16)", () => {
    const bio = "Consultora " + "😀".repeat(1200);
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio });
    render(<Onboarding />);

    // "Consultora " tem 11 unidades; cada emoji, 2: cabem 494 (11 + 988 = 999).
    // Um `slice(0, 1000)` deixaria meio emoji no fim; 1000 code points estourariam o zod.
    expect(campoBio()).toHaveValue("Consultora " + "😀".repeat(494));
    expect(botaoContinuar()).toBeEnabled();
  });

  it("concluir sem tocar no campo não manda a bio: o texto cortado não apaga o resto do que está salvo", () => {
    // Validação de 16/09 na #135: a carga grava até 2000 caracteres, o formulário mostra 1000,
    // e concluir enviava esses 1000 por cima — 400 caracteres destruídos em silêncio.
    const bioLonga = "Consultora tributária com 15 anos de estrada. " + "a".repeat(1400);
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: bioLonga });
    render(<Onboarding />);
    expect(campoBio()).toHaveValue(bioLonga.slice(0, 1000));

    irAteAUltimaEtapa();
    concluir();
    // Sem valor: o zod de completeOnboarding trata como ausente e o upsert não toca na coluna.
    expect(perfilEnviado().bio).toBeUndefined();
  });

  it("a bio editada continua indo, mesmo quando a salva era maior que o teto", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: "a".repeat(1400) });
    render(<Onboarding />);
    fireEvent.change(campoBio(), { target: { value: "Consultora de exportação para o Mercosul" } });

    irAteAUltimaEtapa();
    concluir();
    expect(perfilEnviado().bio).toBe("Consultora de exportação para o Mercosul");
  });
});

describe("sair da conta apaga os rascunhos do cadastro (computador compartilhado)", () => {
  it("o logout limpa toda chave mmm.onboarding.rascunho.* e deixa o resto do localStorage", async () => {
    const { unmount } = render(<Onboarding />);
    fireEvent.change(campoNome(), { target: { value: "Fulana de Teste" } });
    unmount();
    window.localStorage.setItem("mmm.onboarding.rascunho.8", JSON.stringify({ displayName: "Beltrana", salvoEm: Date.now() }));
    window.localStorage.setItem("i18nextLng", "pt-BR");
    expect(window.localStorage.getItem(CHAVE_DA_7)).toContain("Fulana de Teste");

    const { result } = renderHook(() => useAuth());
    await act(async () => { await result.current.logout(); });

    expect(duble.chamadas).toContainEqual(["auth.logout", undefined]);
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.localStorage.getItem("mmm.onboarding.rascunho.8")).toBeNull();
    expect(window.localStorage.getItem("i18nextLng")).toBe("pt-BR");
  });
});
