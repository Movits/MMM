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

const caixaDoAceite = () => screen.getByRole("checkbox", { name: ptBR.termoGeral.aceite });
const caixaDaMaioridade = () => screen.getByRole("checkbox", { name: ptBR.termoGeral.maioridade });

function concluir() {
  fireEvent.click(caixaDoAceite());
  fireEvent.click(caixaDaMaioridade());
  fireEvent.click(botaoFinal());
}

/**
 * Fechar a aba e abrir o cadastro de novo, numa aba nova: o localStorage fica,
 * mas o sessionStorage e a entrada do histórico são da aba que fechou. Sem isto,
 * o remontar do teste é um RECARREGAR da mesma aba, que reabre na etapa em que a
 * pessoa estava (ver Onboarding.navegacao-no-celular.test.tsx).
 */
function fecharAAba() {
  window.sessionStorage.clear();
  window.history.replaceState(null, "");
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
  window.sessionStorage.clear();
  window.history.replaceState(null, "");
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
    fecharAAba();

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
    expect(window.sessionStorage.getItem(CHAVE_DA_7), "o rascunho da aba devia existir antes de concluir").not.toBeNull();

    concluir();

    expect(duble.chamadas.some(([nome]) => nome === "profile.completeOnboarding")).toBe(true);
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toBeNull();
  });

  it("as caixas do Termo Geral e da maioridade não entram no rascunho: são atos da sessão que conclui", () => {
    const { unmount } = render(<Onboarding />);
    irAteAUltimaEtapa();
    fireEvent.click(caixaDoAceite());
    fireEvent.click(caixaDaMaioridade());
    expect(botaoFinal()).toBeEnabled();
    unmount();

    // Recarregar a mesma aba reabre direto na última etapa (16/09), e mesmo
    // assim as caixas voltam desmarcadas: nem o rascunho da aba guarda o aceite
    // ou a declaração.
    const { unmount: fecharDeNovo } = render(<Onboarding />);
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(caixaDoAceite()).not.toBeChecked();
    expect(caixaDaMaioridade()).not.toBeChecked();
    expect(botaoFinal()).toBeDisabled();
    fecharDeNovo();
    fecharAAba();

    render(<Onboarding />);
    // Numa aba nova, o rascunho já preencheu as 7 primeiras etapas: só
    // "Continuar" até a última — fora a faixa de renda, que não fica no
    // localStorage e a etapa 3 exige de novo.
    avancar(); // 1 → 2
    avancar(); // 2 → 3
    clicarCartao(pt.onboarding.income.under_3k);
    for (let etapa = 3; etapa < 8; etapa++) avancar();
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(caixaDoAceite()).not.toBeChecked();
    expect(caixaDaMaioridade()).not.toBeChecked();
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
    expect(window.sessionStorage.length).toBe(0);
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

  it("faixa de renda, capacidade de investimento e Número de Cadastro Empresarial ficam fora do localStorage", () => {
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

    // Os três ficam só no rascunho DA ABA (sessionStorage, 16/09), que some ao
    // fechar a aba: é o que deixa o recarregar voltar à etapa 3 sem pedir de novo.
    const daAba = JSON.parse(window.sessionStorage.getItem(CHAVE_DA_7)!) as Record<string, unknown>;
    expect(daAba).toMatchObject({ etapa: 3, incomeRange: "under_3k", companyCnpj: "12345678000190" });
    expect(daAba).not.toHaveProperty("displayName");

    // Numa aba nova, a pessoa redigita: o cadastro empresarial está em branco e
    // a renda não vem marcada (o resto do rascunho volta normalmente).
    unmount();
    fecharAAba();
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

describe("item 10 — a apresentação já gravada não se perde no cadastro", () => {
  const BIO_DA_CARGA = "Consultora tributária com 15 anos de estrada. " + "a".repeat(1400);

  it("a apresentação entra INTEIRA no campo, mesmo acima do teto do cadastro", () => {
    // Mostrar só o começo fazia qualquer edição destruir, em silêncio, o resto
    // que a pessoa nunca viu — o mesmo dano do relato, com o gatilho invertido.
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: BIO_DA_CARGA });
    render(<Onboarding />);

    expect(campoBio()).toHaveValue(BIO_DA_CARGA);
    // Antes, `form.bio.length > LIMITE_BIO` travava o "Continuar" da etapa 1.
    expect(botaoContinuar()).toBeEnabled();
  });

  it("emoji no fim do texto continua inteiro: nada é cortado", () => {
    const bio = "Consultora " + "😀".repeat(1200);
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio });
    render(<Onboarding />);

    expect(campoBio()).toHaveValue(bio);
  });

  it("concluir sem tocar no campo devolve a apresentação inteira — nada se perde", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: BIO_DA_CARGA });
    render(<Onboarding />);

    irAteAUltimaEtapa();
    concluir();

    expect(perfilEnviado().bio).toBe(BIO_DA_CARGA);
  });

  it("a bio editada continua indo, mesmo quando a salva era maior que o teto", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: BIO_DA_CARGA });
    render(<Onboarding />);
    fireEvent.change(campoBio(), { target: { value: "Consultora de exportação para o Mercosul" } });

    irAteAUltimaEtapa();
    concluir();

    expect(perfilEnviado().bio).toBe("Consultora de exportação para o Mercosul");
  });

  it("na segunda visita, o rascunho traz a apresentação inteira de volta", () => {
    // O rascunho guarda a bio a cada mudança; como o campo mostra o texto
    // inteiro, o que ele guarda também é inteiro.
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: BIO_DA_CARGA });
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ bio: BIO_DA_CARGA, salvoEm: Date.now() }));

    render(<Onboarding />);
    expect(campoBio()).toHaveValue(BIO_DA_CARGA);
    irAteAUltimaEtapa();
    concluir();

    expect(perfilEnviado().bio).toBe(BIO_DA_CARGA);
  });

  it("rascunho NOVO vence o perfil, mesmo com o perfil trazendo updatedAt", () => {
    // A regra do "rascunho mais novo" precisa ler o salvoEm do localStorage: ele
    // não volta em lerRascunho (que devolve só campos do formulário), e lê-lo de
    // lá dava sempre 0 — com qualquer perfil gravado, o texto digitado sumia.
    duble.perfil = perfilDe(USUARIA_7, {
      displayName: "Fulana Importada", city: "Recife", country: "BR",
      bio: "Apresentação antiga que veio da carga de participantes",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ bio: "Apresentação que eu acabei de escrever no cadastro", salvoEm: Date.now() }));

    render(<Onboarding />);

    expect(campoBio()).toHaveValue("Apresentação que eu acabei de escrever no cadastro");
  });

  it("rascunho VELHO não sobrescreve a apresentação editada depois no Perfil", () => {
    // O rascunho nasce sozinho: abrir a tela uma vez já grava o que ela
    // pré-preencheu. Quem depois arruma a apresentação no Perfil e volta ao
    // cadastro tinha o texto novo trocado pelo antigo, sem tocar no campo.
    const ontem = Date.now() - 24 * 60 * 60 * 1000;
    duble.perfil = perfilDe(USUARIA_7, {
      displayName: "Fulana Importada", city: "Recife", country: "BR",
      bio: "Apresentação corrigida agora no Perfil, com bastante conteúdo novo",
      updatedAt: new Date(Date.now() - 1000).toISOString(),
    });
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ bio: "Texto velho do rascunho", salvoEm: ontem }));

    render(<Onboarding />);

    expect(campoBio()).toHaveValue("Apresentação corrigida agora no Perfil, com bastante conteúdo novo");
  });

  it("rascunho com texto de verdade vence a bio salva", () => {
    duble.perfil = perfilDe(USUARIA_7, { displayName: "Fulana Importada", city: "Recife", country: "BR", bio: BIO_DA_CARGA });
    window.localStorage.setItem(CHAVE_DA_7, JSON.stringify({ bio: "Consultora de exportação para o Mercosul", salvoEm: Date.now() }));

    render(<Onboarding />);
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
    window.sessionStorage.setItem("mmm.onboarding.rascunho.8", JSON.stringify({ etapa: 3, incomeRange: "under_3k" }));
    window.sessionStorage.setItem("outra.chave.da.aba", "fica");
    expect(window.localStorage.getItem(CHAVE_DA_7)).toContain("Fulana de Teste");
    expect(window.sessionStorage.getItem(CHAVE_DA_7), "o rascunho da aba da 7 devia existir").not.toBeNull();

    const { result } = renderHook(() => useAuth());
    await act(async () => { await result.current.logout(); });

    expect(duble.chamadas).toContainEqual(["auth.logout", undefined]);
    expect(window.localStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.localStorage.getItem("mmm.onboarding.rascunho.8")).toBeNull();
    expect(window.localStorage.getItem("i18nextLng")).toBe("pt-BR");
    // O rascunho da aba (etapa, renda, cadastro empresarial) vai junto.
    expect(window.sessionStorage.getItem(CHAVE_DA_7)).toBeNull();
    expect(window.sessionStorage.getItem("mmm.onboarding.rascunho.8")).toBeNull();
    expect(window.sessionStorage.getItem("outra.chave.da.aba")).toBe("fica");
  });
});
