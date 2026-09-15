import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewOpportunity from "./NewOpportunity";

/**
 * Nova oportunidade — descrição acima de 5.000 caracteres.
 *
 * O maxLength={5000} do Textarea só barra digitação e colagem. O "Gravar áudio"
 * e a revisão aceita do AssistenteDeTexto põem o valor por código e passam do
 * limite; o Publicar mandava assim mesmo, o servidor recusava com
 * z.string().max(5000) e o toast mostrava o array de issues do zod em inglês.
 *
 * O que se trava aqui: acima do teto a tela avisa com texto traduzido e NÃO
 * chama a mutação; no teto exato (medido no texto aparado, que é o que sobe)
 * ela publica.
 */

const duble = vi.hoisted(() => ({
  criar: vi.fn(),
  analisar: vi.fn(),
  /** Texto que o dublê do assistente acrescenta, como faria o ditado. */
  ditado: "",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "silver" } }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    opportunities: {
      analyzeForCompliance: { useMutation: () => ({ mutate: duble.analisar, isPending: false }) },
      create: { useMutation: () => ({ mutate: duble.criar, isPending: false }) },
    },
  },
}));
// A página importa só o selo de ./Opportunities; a lista inteira não interessa aqui.
vi.mock("./Opportunities", () => ({ FTSBadge: () => null }));
// O assistente real grava áudio e chama a IA. O dublê faz o que importa para
// o defeito: acrescenta texto ao campo por código, sem passar pelo maxLength.
vi.mock("@/components/AssistenteDeTexto", () => ({
  AssistenteDeTexto: ({ valor, onChange }: { valor: string; onChange: (novo: string) => void }) => (
    <button type="button" onClick={() => onChange(`${valor} ${duble.ditado}`)}>
      ditar
    </button>
  ),
}));
// O Select do Radix não abre no jsdom; um <select> nativo exercita o mesmo onValueChange.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select data-testid="select" value={value} onChange={e => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

const TITULO = "Busco distribuidoras na Europa";

function preencher(descricao: string) {
  render(<NewOpportunity />);
  fireEvent.change(screen.getByPlaceholderText(/Busco distribuidoras no mercado europeu/), { target: { value: TITULO } });
  fireEvent.change(screen.getAllByTestId("select")[0], { target: { value: "offer" } });
  fireEvent.change(screen.getByPlaceholderText(/Conte o que você oferece ou busca/), { target: { value: descricao } });
}

function publicar() {
  fireEvent.click(screen.getByRole("button", { name: /Enviar para análise e publicação/ }));
}

describe("NewOpportunity: teto da descrição", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    duble.ditado = "";
  });

  it("ditado que leva a descrição acima de 5.000 avisa em português e não publica", () => {
    preencher("a".repeat(4600));
    duble.ditado = "d".repeat(900);
    fireEvent.click(screen.getByRole("button", { name: "ditar" }));

    const tamanho = 4600 + 1 + 900;
    expect(screen.getByText(`${tamanho}/5000`)).toBeInTheDocument();

    publicar();

    expect(duble.criar).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      `Descrição muito longa (máximo 5000 caracteres; agora tem ${tamanho})`,
    );
  });

  it("no teto exato, medido no texto aparado, publica", () => {
    // " " + 4.998 digitados, e o ditado junta " x ": 5.002 no campo (contador
    // vermelho), 5.000 depois do trim, que é o que sobe e o servidor aceita.
    preencher(" " + "a".repeat(4998));
    duble.ditado = "x ";
    fireEvent.click(screen.getByRole("button", { name: "ditar" }));

    publicar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(duble.criar).toHaveBeenCalledTimes(1);
    const enviado = duble.criar.mock.calls[0][0] as { description: string; title: string; type: string };
    expect(enviado.description).toHaveLength(5000);
    expect(enviado.title).toBe(TITULO);
    expect(enviado.type).toBe("offer");
  });
});
