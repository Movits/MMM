import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";

/**
 * Pedidos do Rosber gravados em vídeo na noite de 14/09 (transcrição conferida
 * em 15/09), todos sobre o CADASTRO:
 *
 *  - 21:08 "suprimi esse estilo de trabalho preferido, seus valores principais,
 *    idiomas que você fala. Isso não está dentro do escopo do projeto.";
 *  - 21:09 "retirar essa limitação de até quatro, Setores de interesse";
 *  - 21:10 "aberto a remoto, disponível para viagens. Isso está mais voltado
 *    para busca de empregos, então também está fora.";
 *  - 21:13 "ele dá a opção de qualquer tamanho, mas não deixa eu selecionar dois
 *    tamanhos específicos. Eu quero fazer só com média e pequena.";
 *  - 21:15 "essa tela aqui do quem sou, pra você lançar a rede institucional,
 *    suprimi.";
 *  - 21:17 "a gente precisa inserir nesse 'o que tenho' um botão 'outros', para
 *    a pessoa poder digitar".
 *
 * Mais os dois consertos da rodada anterior: "Interesses de negócio" volta a
 * gravar a CHAVE do setor (e não o rótulo traduzido), e a caixa alta fica só nos
 * títulos dos cartões de categoria das listas de seleção.
 *
 * O SERVIDOR continua aceitando os campos suprimidos (dados antigos ficam no
 * banco): o que os testes cobrem é que a tela não os pede mais e que o envio não
 * os carrega — a mesma regra aplicada à idade em 14/09.
 */

const pt = ptBR as unknown as {
  onboarding: {
    specialties: Record<string, string>; income: Record<string, string>; workStyle: Record<string, string>;
    sectors: Record<string, string>; fields: Record<string, string>; nav: Record<string, string>;
    steps: Record<string, string>; misc: Record<string, string>; companySize: Record<string, string>;
    values: Record<string, string>; languages: Record<string, string>;
  };
  setores: Record<string, string>;
  oQueBusca: { opcoes: Record<string, { titulo: string }> };
  oQuePreciso: { categorias: Record<string, { titulo: string }> };
  termoGeral: Record<string, string>;
};

type Opcoes = { onSuccess?: () => void; onError?: (erro: unknown) => void };

const duble = vi.hoisted(() => ({
  chamadas: [] as Array<[string, unknown]>,
  perfil: null as unknown,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
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
        useQuery: () => ({
          data: { document: TERMO, accepted: false, acceptedAt: null, pendingText: false, previousVersion: null },
          isLoading: false,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
    },
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: async () => ({ texto: "" }), isPending: false }) },
    },
    useUtils: () => ({ auth: { me: { setData: () => {}, invalidate: () => Promise.resolve() } } }),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding", () => {}],
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

const TERMO = {
  id: "termo-v3",
  type: "termo_geral_de_uso",
  version: 3,
  text: "# TERMO GERAL DE USO\n\n1.1. Este instrumento regula o acesso.\n",
  publishedAt: new Date("2026-09-15T12:00:00Z"),
};

import Onboarding from "./Onboarding";

const campo = (re: RegExp) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
    .find(c => re.test(c.placeholder || ""));

const botaoContinuar = () => screen.getByRole("button", { name: new RegExp(`^${pt.onboarding.nav.continue}`) });
const botaoFinal = () => screen.getByRole("button", { name: new RegExp(pt.onboarding.nav.findMatches) });

function avancar() {
  fireEvent.click(botaoContinuar());
  act(() => { vi.advanceTimersByTime(300); });
}

const clicarCartao = (texto: string) => fireEvent.click(screen.getByText(texto).closest("button")!);

// Sem a etapa "Quem sou" são 8: 1 dados, 2 especialidade, 3 o que busca,
// 4 mundo dos negócios, 5 o que tenho, 6 o que preciso, 7 revisão, 8 termo.
// O cabeçalho do celular mostra "N / 8" em toda etapa.
const passoAtual = () => Number(screen.getByText(/^\d+ \/ 8$/).textContent!.split("/")[0]);

const marcado = (texto: string) => screen.getByText(texto).closest("button")!.className.includes("#c98f70");

/** A pílula de um setor em "Setores de interesse". O mesmo rótulo também está
 *  no <option> do campo "Setor" logo acima, que não é botão. */
const pilulaDoSetor = (rotulo: string) =>
  screen.getAllByText(rotulo).map(elemento => elemento.closest("button")).find(Boolean)!;
/** Marca o cartão se ainda não estiver marcado: clicar de novo desmarcaria. */
const marcarCartao = (texto: string) => { if (!marcado(texto)) clicarCartao(texto); };

// Cada função preenche o mínimo que libera o "Continuar" daquele passo, e não
// desfaz o que já está preenchido: pode ser chamada quantas vezes for.
const preencherPasso1 = () => {
  const nome = campo(/nome|apelido/i) as HTMLInputElement;
  if (!nome.value) fireEvent.change(nome, { target: { value: "Fulana de Teste" } });
  const cidade = campo(/S[ãa]o Paulo/i) as HTMLInputElement;
  if (!cidade.value) fireEvent.change(cidade, { target: { value: "Brasília" } });
};
const preencherPasso2 = () => marcarCartao(pt.onboarding.specialties.tech);
const preencherPasso3 = () => {
  marcarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
  marcarCartao(pt.onboarding.income.under_3k);
};
const preencherPasso4 = () => {
  const setor = document.querySelector("select") as HTMLSelectElement;
  if (!setor.value) fireEvent.change(setor, { target: { value: pt.setores.tecnologia } });
};
const PREENCHIMENTOS = [preencherPasso1, preencherPasso2, preencherPasso3, preencherPasso4];

/** Avança do passo em que a tela estiver até o passo `n`, preenchendo o mínimo. */
function irAtePasso(n: number) {
  for (let voltas = 0; passoAtual() < n; voltas++) {
    expect(voltas, "o cadastro travou antes do passo pedido").toBeLessThan(8);
    PREENCHIMENTOS[passoAtual() - 1]?.();
    avancar();
  }
}

/** Vai até o fim, aceita o termo e devolve o que foi enviado ao servidor. */
function concluir(): Record<string, unknown> {
  irAtePasso(8);
  fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.aceite }));
  fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.maioridade }));
  fireEvent.click(botaoFinal());
  const envio = duble.chamadas.find(([nome]) => nome === "profile.completeOnboarding");
  expect(envio, "o cadastro não chegou a ser enviado").toBeTruthy();
  return envio![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
  duble.chamadas.length = 0;
  duble.perfil = null;
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("21:08 — estilo de trabalho, valores e idiomas saem do cadastro", () => {
  it("o passo 3 não mostra os três campos e avança sem estilo de trabalho", () => {
    render(<Onboarding />);
    irAtePasso(3);

    expect(screen.queryByText(pt.onboarding.fields.workStyle)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.workStyle.remote)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.fields.values)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.values.innovation)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.fields.languages)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.languages.portuguese)).not.toBeInTheDocument();

    // Antes, "Continuar" só liberava com um estilo de trabalho escolhido.
    marcarCartao(pt.oQueBusca.opcoes.expandir_negocio.titulo);
    marcarCartao(pt.onboarding.income.under_3k);
    expect(botaoContinuar()).toBeEnabled();
  });

  it("o envio não leva workStyle, values nem languages", () => {
    render(<Onboarding />);
    const enviado = concluir();
    expect(enviado).not.toHaveProperty("workStyle");
    expect(enviado).not.toHaveProperty("values");
    expect(enviado).not.toHaveProperty("languages");
  });
});

describe("21:09 — 'Setores de interesse' sem o teto de quatro", () => {
  it("marca seis setores e todos vão no envio, pela CHAVE", () => {
    render(<Onboarding />);
    irAtePasso(4);

    expect(screen.queryByText(pt.onboarding.fields.upTo4)).not.toBeInTheDocument();
    const chaves = ["agronegocio", "construcao", "educacao", "energia", "juridico", "logistica"];
    for (const chave of chaves) fireEvent.click(pilulaDoSetor(pt.setores[chave]));

    const enviado = concluir();
    expect(enviado.businessInterests).toEqual(chaves);
  });
});

describe("(A) 'Interesses de negócio' gravam a chave, não o rótulo traduzido", () => {
  it("o rascunho gravado com o rótulo antigo continua marcado na tela", () => {
    duble.perfil = { user: { id: 7, name: "Fulana de Teste" }, profile: null };
    window.localStorage.setItem(
      "mmm.onboarding.rascunho.7",
      JSON.stringify({ businessInterests: [pt.setores.construcao], salvoEm: Date.now() }),
    );
    render(<Onboarding />);
    irAtePasso(4);
    expect(pilulaDoSetor(pt.setores.construcao).className, "a seleção antiga (rótulo) sumiu da tela").toMatch(/#c98f70/);

    // O que já estava gravado fica como está (ninguém migra dado por baixo da
    // usuária); o que ela marcar agora vai pela chave.
    fireEvent.click(pilulaDoSetor(pt.setores.juridico));
    expect(concluir().businessInterests).toEqual([pt.setores.construcao, "juridico"]);
  });

  it("desmarcar o que foi gravado com o rótulo antigo tira mesmo da lista", () => {
    duble.perfil = { user: { id: 7, name: "Fulana de Teste" }, profile: null };
    window.localStorage.setItem(
      "mmm.onboarding.rascunho.7",
      JSON.stringify({ businessInterests: [pt.setores.construcao], salvoEm: Date.now() }),
    );
    render(<Onboarding />);
    irAtePasso(4);
    fireEvent.click(pilulaDoSetor(pt.setores.construcao));
    expect(pilulaDoSetor(pt.setores.construcao).className).not.toMatch(/#c98f70/);
    expect(concluir().businessInterests).toEqual([]);
  });
});

describe("21:10 — 'Aberto a remoto' e 'Disponível para viagens' saem do cadastro", () => {
  it("o passo 4 não mostra os dois cartões e o envio não os carrega", () => {
    render(<Onboarding />);
    irAtePasso(4);
    expect(screen.queryByText(pt.onboarding.fields.openToRemote)).not.toBeInTheDocument();
    expect(screen.queryByText(pt.onboarding.fields.availableForTravel)).not.toBeInTheDocument();

    const enviado = concluir();
    expect(enviado).not.toHaveProperty("openToRemote");
    expect(enviado).not.toHaveProperty("availableForTravel");
  });
});

describe("21:13 — porte da empresa em seleção múltipla", () => {
  it("pequena e média juntas: as duas ficam marcadas e as duas são gravadas", () => {
    render(<Onboarding />);
    irAtePasso(4);
    clicarCartao(pt.onboarding.companySize.small);
    clicarCartao(pt.onboarding.companySize.medium);

    expect(screen.getByText(pt.onboarding.companySize.small).closest("button")!.className).toMatch(/#c98f70/);
    expect(screen.getByText(pt.onboarding.companySize.medium).closest("button")!.className).toMatch(/#c98f70/);

    expect(concluir().preferredCompanySize).toBe("small,medium");
  });

  it("o porte já gravado volta marcado, no formato antigo (um só) e no novo (lista)", () => {
    const portesMarcados = () =>
      [pt.onboarding.companySize.micro, pt.onboarding.companySize.small, pt.onboarding.companySize.medium, pt.onboarding.companySize.large]
        .filter(marcado);

    duble.perfil = { user: { id: 7 }, profile: { preferredCompanySize: "medium" } };
    const { unmount } = render(<Onboarding />);
    irAtePasso(4);
    expect(portesMarcados()).toEqual([pt.onboarding.companySize.medium]);
    unmount();

    // Visita nova, em outra aba: sem o rascunho guardado, sem o da aba e sem a
    // entrada do histórico (que reabriria na etapa em que o teste parou).
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "");
    duble.perfil = { user: { id: 7 }, profile: { preferredCompanySize: "small,medium" } };
    render(<Onboarding />);
    irAtePasso(4);
    expect(portesMarcados()).toEqual([pt.onboarding.companySize.small, pt.onboarding.companySize.medium]);
  });

  it("'Qualquer tamanho' limpa a seleção, e nenhum porte marcado grava 'any'", () => {
    render(<Onboarding />);
    irAtePasso(4);
    clicarCartao(pt.onboarding.companySize.small);
    clicarCartao(pt.onboarding.companySize.any);
    expect(screen.getByText(pt.onboarding.companySize.small).closest("button")!.className).not.toMatch(/#c98f70/);
    expect(screen.getByText(pt.onboarding.companySize.any).closest("button")!.className).toMatch(/#c98f70/);

    expect(concluir().preferredCompanySize).toBe("any");
  });
});

describe("21:15 — a etapa 'Quem sou' (rede institucional) sai do cadastro", () => {
  it("são 8 etapas e a rede institucional não é pedida em nenhuma delas", () => {
    const semRedeInstitucional = (passo: number) =>
      expect(screen.queryByText(pt.onboarding.misc.institutionalNetwork), `passo ${passo}`).not.toBeInTheDocument();

    render(<Onboarding />);
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
    // O painel lateral lista as etapas: "Quem sou" não é uma delas.
    expect(screen.queryByText(pt.onboarding.steps.s7_title)).not.toBeInTheDocument();

    for (let passo = 1; passo <= 8; passo++) {
      semRedeInstitucional(passo);
      if (passo < 8) irAtePasso(passo + 1);
    }

    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pt.termoGeral.etapaTitulo);
    fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.aceite }));
    fireEvent.click(screen.getByRole("checkbox", { name: ptBR.termoGeral.maioridade }));
    fireEvent.click(botaoFinal());
    const enviado = duble.chamadas.find(([nome]) => nome === "profile.completeOnboarding")![1] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty("institutionalNetwork");
  });
});

describe("21:17 — 'Outros' em 'O que tenho' abre campo de texto livre", () => {
  it("sem texto não avança; com texto, ele vira item de 'O que tenho'", () => {
    render(<Onboarding />);
    irAtePasso(5);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(pt.onboarding.steps.s8_title);

    clicarCartao(pt.onboarding.misc.outrosAtivo);
    const texto = campo(new RegExp(pt.onboarding.misc.outrosAtivoPlaceholder.slice(0, 12), "i"));
    expect(texto, "o campo de texto de 'Outros' não apareceu").toBeTruthy();
    expect(botaoContinuar()).toBeDisabled();

    fireEvent.change(texto!, { target: { value: "Galpão refrigerado no porto de Santos" } });
    expect(botaoContinuar()).toBeEnabled();

    clicarCartao("Logística");
    const enviado = concluir();
    // "outros" é a porta do texto livre, não um ativo: só o texto é gravado.
    expect(enviado.whatIHave).toEqual(["logistica", "Galpão refrigerado no porto de Santos"]);
  });
});

// (C) A caixa alta dos títulos — só nos cartões de categoria de "O que tenho" e
// "O que preciso", inclusive no cabeçalho da segunda camada, e por CSS — tem
// arquivo próprio: Onboarding.caixa-dos-titulos.test.tsx.
