import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Contexts from "./Contexts";

/**
 * Revisão da PR #29 — vincular contato ao contexto, do lado da tela.
 *
 * O botão "profissional" já vinha pré-marcado, e essa escolha que ninguém fez
 * subia na mutação e apagava o "pessoal" gravado meses antes. No fim, um toast
 * dizia "vinculada!" para algo que só tinha sido atualizado.
 *
 * Revisão da PR #82 — editar o vínculo existente. A correção anterior tirava da
 * busca quem já estava vinculado, e isso fechou o único caminho da tela para
 * editar tipo, data, cidade ou notas de um vínculo. O filtro ainda rodava no
 * navegador DEPOIS do limite de 10 do servidor: uma página inteira de
 * vinculadas virava "nenhum contato encontrado" havendo gente na seguinte.
 *
 * O que se trava aqui: quem já está no contexto aparece na busca, marcado;
 * selecioná-lo abre o vínculo com os dados atuais e salva pelo mesmo
 * linkContact (o servidor atualiza em vez de duplicar); nenhum tipo
 * pré-marcado num vínculo novo, e o tipo de um vínculo existente só sobe se a
 * dona o trocar; a mensagem segue o `created` que o servidor devolve.
 *
 * Revisão da PR #122 — campo esvaziado na edição sobe null (o servidor apaga);
 * vazio num vínculo novo sobe undefined (o servidor não mexe no que houver).
 */

type Opcoes = { onSuccess?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => unknown };

const duble = vi.hoisted(() => {
  const registrar = () => ({ useMutation: (_opcoes?: Opcoes) => ({ mutate: vi.fn(), isPending: false }) });
  return {
    registrar,
    list: vi.fn(),
    get: vi.fn(),
    contatos: vi.fn(),
    vincular: vi.fn(),
    opcoesDoVincular: null as Opcoes | null,
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    contexts: {
      listTypes: { useQuery: () => ({ data: [] }) },
      list: { useQuery: (...args: unknown[]) => duble.list(...args) },
      get: { useQuery: (...args: unknown[]) => duble.get(...args) },
      create: duble.registrar(),
      update: duble.registrar(),
      delete: duble.registrar(),
      linkContact: {
        useMutation: (opcoes?: Opcoes) => {
          duble.opcoesDoVincular = opcoes ?? null;
          return { mutate: duble.vincular, isPending: false };
        },
      },
      unlinkContact: duble.registrar(),
      addParticipant: duble.registrar(),
      uploadMedia: duble.registrar(),
      deleteMedia: duble.registrar(),
    },
    network: { list: { useQuery: (...args: unknown[]) => duble.contatos(...args) } },
  },
}));

const ANA = { id: 42, fullName: "Ana Souza", jobTitle: null, company: null };
const BRUNA = { id: 43, fullName: "Bruna Lima", jobTitle: null, company: null };

/** O vínculo da Ana como está gravado: "pessoal", com data, cidade e notas. */
const VINCULO_DA_ANA = {
  id: "vinc-1", contactId: ANA.id, contactName: ANA.fullName, relationshipType: "pessoal",
  eventDate: "2024-10-08", city: "Milão", country: null, notes: "Conheci no estande da Itália",
};

/** O contexto aberto, com a Ana JÁ vinculada. */
function detalheComAnaVinculada(links: unknown[] = [VINCULO_DA_ANA]) {
  return {
    id: "ctx-1", name: "CPHI 2024", isCustom: true, typeName: null,
    eventDate: null, city: null, country: null, notes: null,
    links, participants: [], media: [],
  };
}

/**
 * Abre o card do contexto e depois o modal de vincular. "Adicionar" aparece
 * também na seção de participantes, então o botão é procurado DENTRO do bloco
 * de "Contatos Vinculados" — e não pelo rótulo solto.
 */
function abrirModalDeVincular() {
  render(<Contexts />);
  fireEvent.click(screen.getByText("CPHI 2024"));
  const secao = screen.getByText(/Contatos Vinculados/).closest("div")!.parentElement!;
  const adicionar = [...secao.querySelectorAll("button")]
    .find(b => b.textContent?.includes("Adicionar"))!;
  fireEvent.click(adicionar);
}

/**
 * Só o modal. A Ana também aparece atrás dele, na lista de vinculados do
 * detalhe — procurar na tela inteira acharia essa e não provaria nada. O título
 * muda no modo de edição, por isso os dois são aceitos.
 */
function dentroDoModal() {
  return within(screen.getByText(/^(Vincular Contato|Editar Vínculo)$/).closest("div")!.parentElement!);
}

/** A linha de um contato nos resultados da busca (o botão que o seleciona). */
function linhaDoResultado(nome: string) {
  return dentroDoModal().getByText(nome).closest("button")!;
}

/** Digita na busca e deixa o debounce de 300ms passar. */
function buscar(termo: string) {
  fireEvent.change(screen.getByPlaceholderText("Buscar contato por nome..."), { target: { value: termo } });
  act(() => { vi.advanceTimersByTime(350); });
}

/** Seleciona um contato nos resultados da busca. */
function selecionar(nome: string) {
  fireEvent.click(linhaDoResultado(nome));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, name: "Dona", role: "silver" },
    loading: false, error: null, isAuthenticated: true, refresh: vi.fn(), logout: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  duble.list.mockReturnValue({
    data: { data: [{ id: "ctx-1", name: "CPHI 2024", isCustom: true, contactCount: 1, eventDate: null, city: null, country: null, notes: null }], total: 1 },
    isLoading: false, isError: false, error: null, isSuccess: true, fetchStatus: "idle", refetch: vi.fn(),
  });
  duble.get.mockReturnValue({
    data: detalheComAnaVinculada(), isLoading: false, isError: false, error: null, refetch: vi.fn(),
  });
  duble.contatos.mockReturnValue({ data: { data: [ANA, BRUNA], total: 2 } });
  duble.vincular.mockClear();
  duble.opcoesDoVincular = null;
  vi.mocked(toast.success).mockClear();
});

describe("Modal de vincular — quem já está no contexto aparece na busca, marcado", () => {
  it("a Ana já vinculada continua na lista com 'Já vinculado'; a Bruna aparece sem a marca", () => {
    abrirModalDeVincular();
    buscar("a");

    expect(within(linhaDoResultado("Ana Souza")).getByText("Já vinculado")).toBeInTheDocument();
    expect(within(linhaDoResultado("Bruna Lima")).queryByText("Já vinculado")).not.toBeInTheDocument();
  });

  it("uma página inteira de vinculadas não vira 'nenhum contato encontrado'", () => {
    // O servidor devolve os 10 primeiros de 25; todos os 10 já estão no contexto.
    const dez = Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, fullName: `Pessoa ${i + 1}`, jobTitle: null, company: null }));
    duble.get.mockReturnValue({
      data: detalheComAnaVinculada(dez.map(c => ({ ...VINCULO_DA_ANA, id: `vinc-${c.id}`, contactId: c.id, contactName: c.fullName }))),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    duble.contatos.mockReturnValue({ data: { data: dez, total: 25 } });
    abrirModalDeVincular();
    buscar("pessoa");

    const modal = dentroDoModal();
    expect(modal.queryByText("Nenhum contato encontrado.")).not.toBeInTheDocument();
    expect(modal.getAllByText("Já vinculado")).toHaveLength(10);
  });

  it("quando o servidor não acha ninguém, o vazio continua aparecendo", () => {
    duble.contatos.mockReturnValue({ data: { data: [], total: 0 } });
    abrirModalDeVincular();
    buscar("zzz");

    expect(dentroDoModal().getByText("Nenhum contato encontrado.")).toBeInTheDocument();
  });

  it("contexto sem ninguém vinculado ainda: todo mundo aparece, sem marca", () => {
    duble.get.mockReturnValue({
      data: detalheComAnaVinculada([]),
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    abrirModalDeVincular();
    buscar("a");

    const modal = dentroDoModal();
    expect(modal.getByText("Ana Souza")).toBeInTheDocument();
    expect(modal.getByText("Bruna Lima")).toBeInTheDocument();
    expect(modal.queryByText("Já vinculado")).not.toBeInTheDocument();
  });
});

describe("Modal de vincular — editar o vínculo que já existe", () => {
  it("selecionar a Ana abre o vínculo com data, cidade, notas e tipo atuais, em modo de edição", () => {
    abrirModalDeVincular();
    buscar("ana");
    selecionar("Ana Souza");

    const modal = dentroDoModal();
    expect(modal.getByText("Editar Vínculo")).toBeInTheDocument();
    expect(modal.getByDisplayValue("2024-10-08")).toBeInTheDocument();
    expect(modal.getByDisplayValue("Milão")).toBeInTheDocument();
    expect(modal.getByDisplayValue("Conheci no estande da Itália")).toBeInTheDocument();
    expect(modal.getByRole("button", { name: "Pessoal" })).toHaveClass("bg-amber-500");
    expect(modal.getByRole("button", { name: "Profissional" })).not.toHaveClass("bg-amber-500");
    expect(modal.getByRole("button", { name: "✓ Salvar" })).toBeInTheDocument();
    expect(modal.queryByRole("button", { name: "Vincular" })).not.toBeInTheDocument();
  });

  it("salvar sem mexer em nada: mesmo contato e contexto, dados atuais, e o tipo NÃO sobe", () => {
    abrirModalDeVincular();
    buscar("ana");
    selecionar("Ana Souza");
    fireEvent.click(dentroDoModal().getByRole("button", { name: "✓ Salvar" }));

    expect(duble.vincular).toHaveBeenCalledTimes(1);
    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo).toMatchObject({
      contextId: "ctx-1", contactId: ANA.id,
      eventDate: "2024-10-08", city: "Milão", notes: "Conheci no estande da Itália",
    });
    expect(corpo.relationshipType).toBeUndefined();
  });

  it("trocando o tipo e a cidade, sobem os valores novos", () => {
    abrirModalDeVincular();
    buscar("ana");
    selecionar("Ana Souza");
    const modal = dentroDoModal();
    fireEvent.click(modal.getByRole("button", { name: "Ambos" }));
    fireEvent.change(modal.getByDisplayValue("Milão"), { target: { value: "Bolonha" } });
    fireEvent.click(modal.getByRole("button", { name: "✓ Salvar" }));

    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo).toMatchObject({ contactId: ANA.id, city: "Bolonha", relationshipType: "ambos" });
  });

  it("apagar 'Milão' e salvar sobe city: null — é o que manda o servidor apagar; o resto segue gravado", () => {
    abrirModalDeVincular();
    buscar("ana");
    selecionar("Ana Souza");
    const modal = dentroDoModal();
    fireEvent.change(modal.getByDisplayValue("Milão"), { target: { value: "" } });
    fireEvent.click(modal.getByRole("button", { name: "✓ Salvar" }));

    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.city).toBeNull();
    expect(corpo).toMatchObject({ contactId: ANA.id, eventDate: "2024-10-08", notes: "Conheci no estande da Itália" });
  });

  it("desistir da edição e escolher a Bruna: o vínculo novo não leva os dados da Ana", () => {
    abrirModalDeVincular();
    buscar("a");
    selecionar("Ana Souza");
    // O X do cartão do contato selecionado, dentro do modal.
    const cartao = dentroDoModal().getByText("Ana Souza").parentElement!;
    fireEvent.click(cartao.querySelector("button")!);
    selecionar("Bruna Lima");

    const modal = dentroDoModal();
    expect(modal.getByText("Vincular Contato")).toBeInTheDocument();
    expect(modal.queryByDisplayValue("Milão")).not.toBeInTheDocument();
    fireEvent.click(modal.getByRole("button", { name: "Vincular" }));

    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo).toMatchObject({ contactId: BRUNA.id });
    // Vazio num vínculo NOVO é undefined, não null: se a Bruna já estiver
    // vinculada no servidor (lista desatualizada), nada do que existe é apagado.
    expect(corpo.eventDate).toBeUndefined();
    expect(corpo.city).toBeUndefined();
    expect(corpo.notes).toBeUndefined();
    expect(corpo.relationshipType).toBeUndefined();
  });
});

describe("Modal de vincular — nenhum tipo vem pré-marcado num vínculo novo", () => {
  it("sem tocar nos botões, a mutação sobe SEM relationshipType", () => {
    abrirModalDeVincular();
    buscar("bruna");
    selecionar("Bruna Lima");
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    expect(duble.vincular).toHaveBeenCalledTimes(1);
    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.relationshipType).toBeUndefined();
    expect(corpo).toMatchObject({ contextId: "ctx-1", contactId: BRUNA.id });
  });

  it("tocando em 'Pessoal', é esse tipo que sobe — a escolha explícita continua valendo", () => {
    abrirModalDeVincular();
    buscar("bruna");
    selecionar("Bruna Lima");
    fireEvent.click(screen.getByRole("button", { name: "Pessoal" }));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.relationshipType).toBe("pessoal");
  });
});

describe("Modal de vincular — a mensagem segue o que o servidor fez", () => {
  it("created=true: 'criado'", () => {
    abrirModalDeVincular();
    buscar("bruna");
    selecionar("Bruna Lima");
    act(() => { duble.opcoesDoVincular?.onSuccess?.({ id: "vinc-2", created: true }); });

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("criado"));
  });

  it("created=false: 'atualizado', e nunca 'criado'", () => {
    abrirModalDeVincular();
    buscar("ana");
    selecionar("Ana Souza");
    act(() => { duble.opcoesDoVincular?.onSuccess?.({ id: "vinc-1", created: false }); });

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("atualizado"));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining("criado"));
  });
});
