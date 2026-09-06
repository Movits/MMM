import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/_core/hooks/useAuth";
import Contexts from "./Contexts";

/**
 * Revisão da PR #29 — vincular contato ao contexto, do lado da tela.
 *
 * O modal não dizia quem já estava vinculado, então a dona reencontrava a Ana
 * na busca e a selecionava de novo achando que era um vínculo novo. O botão
 * "profissional" já vinha pré-marcado, e essa escolha que ninguém fez subia
 * na mutação e apagava o "pessoal" gravado meses antes. No fim, um toast
 * dizia "vinculada!" para algo que só tinha sido atualizado.
 *
 * O que se trava aqui: contato já vinculado fora da busca, nenhum tipo
 * pré-marcado (o corpo da mutação vai SEM relationshipType), e a mensagem
 * seguindo o `created` que o servidor devolve.
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

/** O contexto aberto, com a Ana JÁ vinculada como "pessoal". */
function detalheComAnaVinculada() {
  return {
    id: "ctx-1", name: "CPHI 2024", isCustom: true, typeName: null,
    eventDate: null, city: null, country: null, notes: null,
    links: [{ id: "vinc-1", contactId: ANA.id, contactName: ANA.fullName, relationshipType: "pessoal" }],
    participants: [], media: [],
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
 * detalhe — procurar na tela inteira acharia essa e não provaria nada.
 */
function dentroDoModal() {
  return within(screen.getByText("Vincular Contato").closest("div")!.parentElement!);
}

/** Digita na busca e deixa o debounce de 300ms passar. */
function buscar(termo: string) {
  fireEvent.change(screen.getByPlaceholderText("Buscar contato por nome..."), { target: { value: termo } });
  act(() => { vi.advanceTimersByTime(350); });
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

describe("Modal de vincular — quem já está no contexto não volta na busca", () => {
  it("a Ana já vinculada some da lista; a Bruna, não", () => {
    abrirModalDeVincular();
    buscar("a");

    const modal = dentroDoModal();
    expect(modal.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(modal.getByText("Bruna Lima")).toBeInTheDocument();
  });

  it("se TODOS os achados já estão vinculados, a busca mostra o vazio em vez de uma lista enganosa", () => {
    duble.contatos.mockReturnValue({ data: { data: [ANA], total: 1 } });
    abrirModalDeVincular();
    buscar("ana");

    const modal = dentroDoModal();
    expect(modal.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(modal.getByText("Nenhum contato encontrado.")).toBeInTheDocument();
  });

  it("contexto sem ninguém vinculado ainda: a busca continua mostrando todo mundo", () => {
    duble.get.mockReturnValue({
      data: { ...detalheComAnaVinculada(), links: [] },
      isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    abrirModalDeVincular();
    buscar("a");

    const modal = dentroDoModal();
    expect(modal.getByText("Ana Souza")).toBeInTheDocument();
    expect(modal.getByText("Bruna Lima")).toBeInTheDocument();
  });
});

describe("Modal de vincular — nenhum tipo vem pré-marcado", () => {
  it("sem tocar nos botões, a mutação sobe SEM relationshipType", () => {
    abrirModalDeVincular();
    buscar("bruna");
    fireEvent.click(screen.getByText("Bruna Lima"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    expect(duble.vincular).toHaveBeenCalledTimes(1);
    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.relationshipType).toBeUndefined();
    expect(corpo).toMatchObject({ contextId: "ctx-1", contactId: BRUNA.id });
  });

  it("tocando em 'Pessoal', é esse tipo que sobe — a escolha explícita continua valendo", () => {
    abrirModalDeVincular();
    buscar("bruna");
    fireEvent.click(screen.getByText("Bruna Lima"));
    fireEvent.click(screen.getByRole("button", { name: "Pessoal" }));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    const corpo = duble.vincular.mock.calls[0][0] as Record<string, unknown>;
    expect(corpo.relationshipType).toBe("pessoal");
  });
});

describe("Modal de vincular — a mensagem segue o que o servidor fez", () => {
  it("created=true: 'vinculada'", () => {
    abrirModalDeVincular();
    buscar("bruna");
    fireEvent.click(screen.getByText("Bruna Lima"));
    act(() => { duble.opcoesDoVincular?.onSuccess?.({ id: "vinc-2", created: true }); });

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("vinculada"));
  });

  it("created=false: 'atualizado', e nunca 'vinculada'", () => {
    abrirModalDeVincular();
    buscar("bruna");
    fireEvent.click(screen.getByText("Bruna Lima"));
    act(() => { duble.opcoesDoVincular?.onSuccess?.({ id: "vinc-1", created: false }); });

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("atualizado"));
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining("vinculada"));
  });
});
