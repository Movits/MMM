import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import MeuNetworkInteligente from "./MeuNetworkInteligente";

/**
 * Meu Network Inteligente — o painel (pedido do Nicolas, 13/09/2026, item 19).
 *
 * O que se trava:
 * - os números são os que o servidor manda, cada um levando à tela dele;
 * - sem o termo do Smart Match o cartão de matches mostra um traço e o convite,
 *   nunca um número;
 * - "Precisa de mais tempo? Amplie seus minutos de reunião." aparece sem botão,
 *   link nem preço, com o aviso de que a ampliação ainda não existe;
 * - o que não existe (disponibilizados, rede global, intermediações, negócios,
 *   comissões) não aparece nem com zero;
 * - contatos incompletos: o alerta do pedido, o que falta e o atalho para o
 *   detalhe do contato;
 * - erro de consulta é erro, nunca "nenhum contato".
 *
 * O tRPC vira um dublê (molde de Meetings.test.tsx) e o AppHeader fica de fora.
 */

const duble = vi.hoisted(() => ({ resumo: vi.fn() }));

vi.mock("@/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: { networkInteligente: { resumo: { useQuery: (...args: unknown[]) => duble.resumo(...args) } } },
}));

type Resumo = {
  reunioes: { total: number; transcritas: number; emAndamento: number; comFalha: number };
  minutos: { segundosEmReunioesGuardadas: number; limitePorReuniaoSegundos: number };
  contatos: { total: number; incompletos: number; amostraIncompletos: { id: number; fullName: string; faltando: string[] }[] };
  matchesInternos: { termoAceito: true; novos: number; total: number } | { termoAceito: false };
};

const AMOSTRA = [
  { id: 12, fullName: "Bia Souza", faltando: ["telefone", "preciso"] },
  { id: 14, fullName: "Duda Lima", faltando: ["telefone", "email", "tenho"] },
  { id: 15, fullName: "Eva Rocha", faltando: ["telefone"] },
  { id: 16, fullName: "Fabi Reis", faltando: ["email"] },
  { id: 17, fullName: "Gil Prado", faltando: ["preciso"] },
];

function dados(parcial: Partial<Resumo> = {}): Resumo {
  return {
    reunioes: { total: 6, transcritas: 3, emAndamento: 1, comFalha: 2 },
    minutos: { segundosEmReunioesGuardadas: 1530, limitePorReuniaoSegundos: 600 },
    contatos: { total: 9, incompletos: 7, amostraIncompletos: AMOSTRA },
    matchesInternos: { termoAceito: true, novos: 2, total: 4 },
    ...parcial,
  };
}

const refetch = vi.fn();
function servidorResponde(resposta: Resumo) {
  duble.resumo.mockReturnValue({ data: resposta, isLoading: false, isError: false, error: null, refetch });
}

/** O cartão de um indicador: o link, quando leva a algum lugar; senão, o bloco. */
function cartao(rotulo: string): HTMLElement {
  const elemento = screen.getByText(rotulo);
  return (elemento.closest("a") ?? elemento.parentElement!.parentElement!) as HTMLElement;
}

const MAIS_TEMPO = "Precisa de mais tempo? Amplie seus minutos de reunião.";
const ALERTA = "Faltam informações importantes para tornar este contato mais útil para o seu Network Inteligente.";

beforeEach(async () => {
  await i18n.changeLanguage("pt-BR");
});

describe("Meu Network Inteligente — os números do servidor", () => {
  it("reuniões, contatos, incompletos e matches internos, cada um levando à sua tela", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);

    const reunioes = cartao("Minhas reuniões");
    expect(reunioes).toHaveAttribute("href", "/meetings");
    expect(within(reunioes).getByText("6")).toBeInTheDocument();
    expect(within(reunioes).getByText("Transcritas: 3")).toBeInTheDocument();

    const contatos = cartao("Meus contatos");
    expect(contatos).toHaveAttribute("href", "/network");
    expect(within(contatos).getByText("9")).toBeInTheDocument();

    expect(within(cartao("Informações incompletas")).getByText("7")).toBeInTheDocument();

    const matches = cartao("Matches internos");
    expect(matches).toHaveAttribute("href", "/intelligent-matches");
    expect(within(matches).getByText("4")).toBeInTheDocument();
    expect(within(matches).getByText("Novos: 2")).toBeInTheDocument();
  });

  it("minutos: a duração guardada e o limite gratuito que o servidor aplica", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    // 1530 s = 25,5 min
    expect(screen.getByText("26 min")).toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("Limite gratuito por reunião")).toBeInTheDocument();
  });

  it("sem o termo do Smart Match: traço e convite, nunca número", () => {
    servidorResponde(dados({ matchesInternos: { termoAceito: false } }));
    render(<MeuNetworkInteligente />);
    const matches = cartao("Matches internos");
    expect(within(matches).getByText("—")).toBeInTheDocument();
    expect(within(matches).getByText("Ative as Conexões Inteligentes para ver")).toBeInTheDocument();
    expect(matches).toHaveAttribute("href", "/intelligent-matches");
    expect(within(matches).queryByText(/\d/)).not.toBeInTheDocument();
  });
});

describe("Meu Network Inteligente — nada é simulado", () => {
  it("a chamada para ampliar minutos não é botão, link nem preço, e diz que ainda não existe", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    const chamada = screen.getByText(MAIS_TEMPO);
    expect(chamada.closest("a")).toBeNull();
    expect(chamada.closest("button")).toBeNull();
    expect(screen.getByText("A ampliação de minutos por mensalidade ainda não está disponível. Por enquanto, cada reunião pode ter até 10 minutos.")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByText(/R\$|US\$|€|por mês|\/mês|plano /i)).not.toBeInTheDocument();
  });

  it("o que ainda não existe não aparece, nem com zero", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    for (const ausente of [/disponibiliz/i, /rede global/i, /intermedia/i, /negócios em andamento/i, /negócios concluídos/i, /comiss/i]) {
      expect(screen.queryByText(ausente)).not.toBeInTheDocument();
    }
  });

  it("gravar: o aviso de consentimento antes de gravar e o limite do servidor no atalho", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    const aviso = screen.getByText("Antes de gravar, você é responsável por obter o consentimento de todas as pessoas participantes e por cumprir as regras de privacidade aplicáveis.");
    const atalho = aviso.closest("a")!;
    expect(atalho).toHaveAttribute("href", "/meetings");
    expect(within(atalho).getByText("Até 10 minutos por reunião, com transcrição e sugestão dos contatos citados.")).toBeInTheDocument();
    expect(screen.getByText("Pesquisar meu network").closest("a")).toHaveAttribute("href", "/memory");
  });
});

describe("Meu Network Inteligente — contatos com informações faltando", () => {
  it("alerta do pedido, o que falta em cada contato e o atalho para o detalhe dele", () => {
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    expect(screen.getByText(ALERTA)).toBeInTheDocument();

    const bia = screen.getByText("Bia Souza").closest("li")!;
    expect(within(bia).getByText("Faltando: Telefone, O Que Preciso")).toBeInTheDocument();
    expect(within(bia).getByRole("link", { name: /Completar informações/ })).toHaveAttribute("href", "/network?contato=12");

    const duda = screen.getByText("Duda Lima").closest("li")!;
    expect(within(duda).getByText("Faltando: Telefone, E-mail, O Que Tenho")).toBeInTheDocument();

    expect(screen.getByText(/Mostrando 5 de 7\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos os contatos" })).toHaveAttribute("href", "/network");
  });

  it("todos completos: sem alerta, sem atalho de completar", () => {
    servidorResponde(dados({ contatos: { total: 9, incompletos: 0, amostraIncompletos: [] } }));
    render(<MeuNetworkInteligente />);
    expect(screen.getByText("Todos os seus contatos têm Quem Sou, O Que Tenho e O Que Preciso preenchidos.")).toBeInTheDocument();
    expect(screen.queryByText(ALERTA)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Completar informações/ })).not.toBeInTheDocument();
  });

  it("sem contatos: convite a gravar ou cadastrar, sem alerta", () => {
    servidorResponde(dados({ contatos: { total: 0, incompletos: 0, amostraIncompletos: [] } }));
    render(<MeuNetworkInteligente />);
    expect(screen.getByText("Você ainda não tem contatos. Grave uma reunião ou cadastre o primeiro contato.")).toBeInTheDocument();
    expect(screen.queryByText(ALERTA)).not.toBeInTheDocument();
  });

  it("amostra inteira: sem o 'Mostrando X de Y'", () => {
    servidorResponde(dados({ contatos: { total: 9, incompletos: 2, amostraIncompletos: AMOSTRA.slice(0, 2) } }));
    render(<MeuNetworkInteligente />);
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument();
  });
});

describe("Meu Network Inteligente — carregando e erro", () => {
  it("erro de consulta: mensagem do servidor e tentar de novo, sem nenhum número", () => {
    duble.resumo.mockReturnValue({
      data: undefined, isLoading: false, isError: true, refetch,
      error: { message: "Banco de dados indisponível. Tente de novo em instantes.", data: { code: "INTERNAL_SERVER_ERROR" } },
    });
    render(<MeuNetworkInteligente />);
    const alerta = screen.getByRole("alert");
    expect(within(alerta).getByText("Banco de dados indisponível. Tente de novo em instantes.")).toBeInTheDocument();
    fireEvent.click(within(alerta).getByRole("button"));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByText("Minhas reuniões")).not.toBeInTheDocument();
    expect(screen.queryByText("Você ainda não tem contatos. Grave uma reunião ou cadastre o primeiro contato.")).not.toBeInTheDocument();
  });

  it("carregando: indicador de status, sem números nem estado vazio", () => {
    duble.resumo.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch });
    render(<MeuNetworkInteligente />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("Minhas reuniões")).not.toBeInTheDocument();
  });

  it("em inglês, a tela inteira troca de idioma", async () => {
    await i18n.changeLanguage("en");
    servidorResponde(dados());
    render(<MeuNetworkInteligente />);
    expect(screen.getByText("Need more time? Expand your meeting minutes.")).toBeInTheDocument();
    expect(screen.getByText("Missing: Phone, What I Need")).toBeInTheDocument();
    for (const pt of ["Minhas reuniões", MAIS_TEMPO, ALERTA, "Completar informações"]) {
      expect(screen.queryByText(pt)).not.toBeInTheDocument();
    }
  });
});
