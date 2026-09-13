import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PresidentPanel from "./PresidentPanel";

/**
 * Painel Ouro — aba "Distribuição" (distribuidor do Smart Match, parte 1: o poder).
 *
 * O poder de distribuição (`users.isDistributor`) acumula com qualquer nível.
 * Ouro/presidente/admin veem "Quem distribui" (conceder e revogar); quem só
 * distribui, sem Ouro, entra no painel mas vê apenas a aba Distribuição, com o
 * aviso — e a tela NÃO consulta `distribuicao.listar`, que é da presidência e
 * devolveria 403. Sem Ouro e sem o poder: "Acesso Restrito".
 *
 * O tRPC é um dublê explícito (molde de PresidentPanel.test.tsx): registra as
 * consultas feitas e o que as mutações receberam.
 */

const duble = vi.hoisted(() => ({
  usuaria: { id: 1, role: "president", name: "Presidente", isDistributor: false } as Record<string, unknown>,
  consultas: [] as string[],
  distribuidores: [] as unknown[],
  membros: { users: [] as unknown[], total: 0 },
  conceder: vi.fn(),
  revogar: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: duble.usuaria, loading: false, isAuthenticated: true }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/president", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/trpc", () => {
  const consulta = (nome: string, dados: () => unknown) => ({
    useQuery: () => { duble.consultas.push(nome); return { data: dados(), isLoading: false, refetch: vi.fn() }; },
  });
  const mutacao = (fn: () => (entrada: unknown) => void) => ({
    useMutation: () => ({ mutate: (entrada: unknown) => fn()(entrada), isPending: false }),
  });
  return {
    trpc: {
      useUtils: () => ({}),
      president: {
        getGovernanceStats: consulta("president.getGovernanceStats", () => undefined),
        getGoldGrants: consulta("president.getGoldGrants", () => []),
        listLeaders: consulta("president.listLeaders", () => []),
        getLeaderOpportunities: consulta("president.getLeaderOpportunities", () => undefined),
        listAllUsers: consulta("president.listAllUsers", () => duble.membros),
        grantGold: mutacao(() => vi.fn()),
        revokeGold: mutacao(() => vi.fn()),
        nominateLeader: mutacao(() => vi.fn()),
        revokeLeader: mutacao(() => vi.fn()),
      },
      distribuicao: {
        listar: consulta("distribuicao.listar", () => duble.distribuidores),
        conceder: mutacao(() => duble.conceder),
        revogar: mutacao(() => duble.revogar),
      },
    },
  };
});

const dina = { id: 8, name: "Dina Já-Distribui", email: "dina@exemplo.com", role: "silver", isActive: true };
const dora = { id: 7, name: "Dora Candidata", email: "dora@exemplo.com", role: "gold", country: null };

const abas = () => screen.getAllByRole("button").map(b => b.textContent?.trim()).filter(t =>
  ["Visão Geral", "Gestão Ouro", "Líderes", "Validações", "Compliance", "Distribuição"].includes(t ?? ""));

beforeEach(() => {
  duble.consultas = [];
  duble.distribuidores = [];
  duble.membros = { users: [], total: 0 };
  duble.conceder.mockReset();
  duble.revogar.mockReset();
  duble.usuaria = { id: 1, role: "president", name: "Presidente", isDistributor: false };
});

describe("quem entra no painel", () => {
  it("Prata sem o poder: Acesso Restrito, e nenhuma consulta sai", () => {
    duble.usuaria = { id: 2, role: "silver", name: "Prata", isDistributor: false };
    render(<PresidentPanel />);
    expect(screen.getByText("Acesso Restrito")).toBeInTheDocument();
    expect(duble.consultas).toEqual([]);
  });

  it("Prata COM o poder entra, vê só a aba Distribuição com o aviso, e NÃO consulta distribuicao.listar", () => {
    duble.usuaria = { id: 2, role: "silver", name: "Prata", isDistributor: true };
    render(<PresidentPanel />);
    expect(screen.queryByText("Acesso Restrito")).not.toBeInTheDocument();
    expect(abas()).toEqual(["Distribuição"]);
    expect(screen.getByText("Você tem o poder de distribuição")).toBeInTheDocument();
    expect(screen.getByText("Distribuidor")).toBeInTheDocument();
    expect(screen.queryByText("Quem distribui hoje")).not.toBeInTheDocument();
    expect(duble.consultas).toEqual([]);
  });

  it("presidente vê as cinco abas de sempre mais Distribuição, e a badge Ouro", () => {
    render(<PresidentPanel />);
    expect(abas()).toEqual(["Visão Geral", "Gestão Ouro", "Líderes", "Validações", "Compliance", "Distribuição"]);
    expect(screen.getByText("Ouro")).toBeInTheDocument();
    expect(screen.queryByText("Distribuidor")).not.toBeInTheDocument();
  });

  it("presidente que também distribui vê as duas badges", () => {
    duble.usuaria = { id: 1, role: "president", name: "Presidente", isDistributor: true };
    render(<PresidentPanel />);
    expect(screen.getByText("Ouro")).toBeInTheDocument();
    expect(screen.getByText("Distribuidor")).toBeInTheDocument();
  });
});

describe("aba Distribuição para Ouro/presidente/admin — Quem distribui", () => {
  function abrir() {
    render(<PresidentPanel />);
    fireEvent.click(screen.getByRole("button", { name: /distribuição/i }));
  }

  it("lista quem distribui hoje (nome, e-mail, nível) vindo de distribuicao.listar", () => {
    duble.distribuidores = [dina];
    abrir();
    expect(duble.consultas).toContain("distribuicao.listar");
    expect(screen.getByText("Dina Já-Distribui")).toBeInTheDocument();
    expect(screen.getByText(/dina@exemplo.com · Prata/)).toBeInTheDocument();
  });

  it("sem ninguém: diz que ninguém tem o poder", () => {
    abrir();
    expect(screen.getByText("Ninguém tem o poder de distribuição no momento.")).toBeInTheDocument();
  });

  it("candidatas vêm de president.listAllUsers e quem já distribui sai da lista", () => {
    duble.distribuidores = [dina];
    duble.membros = { users: [dora, { ...dina, country: null }], total: 2 };
    abrir();
    expect(screen.getByText("Dora Candidata")).toBeInTheDocument();
    // Dina aparece uma vez só: em "Quem distribui hoje", não entre as candidatas.
    expect(screen.getAllByText("Dina Já-Distribui")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /conceder poder/i })).toHaveLength(1);
  });

  it("Conceder poder → confirmar chama conceder({ userId }) com o motivo opcional", () => {
    duble.membros = { users: [dora], total: 1 };
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /conceder poder/i }));
    expect(screen.getByText("Conceder poder de distribuição")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Motivo \(opcional/), { target: { value: "  Primeira distribuidora  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar concessão" }));
    expect(duble.conceder).toHaveBeenCalledWith({ userId: 7, reason: "Primeira distribuidora" });
  });

  it("sem motivo, conceder manda reason undefined (o servidor aceita)", () => {
    duble.membros = { users: [dora], total: 1 };
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /conceder poder/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar concessão" }));
    expect(duble.conceder).toHaveBeenCalledWith({ userId: 7, reason: undefined });
  });

  it("Revogar exige motivo com 10 caracteres; depois chama revogar({ userId, reason })", () => {
    duble.distribuidores = [dina];
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
    const confirmar = screen.getByRole("button", { name: "Confirmar revogação" });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Motivo da revogação/), { target: { value: "curto" } });
    expect(confirmar).toBeDisabled();
    fireEvent.click(confirmar);
    expect(duble.revogar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/Motivo da revogação/), { target: { value: "Saiu da equipe de distribuição" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    expect(duble.revogar).toHaveBeenCalledWith({ userId: 8, reason: "Saiu da equipe de distribuição" });
  });
});
