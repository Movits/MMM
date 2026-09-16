import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ConexaoRegistrada, referenciaDaConexao, type ConexaoNaTela } from "./ConexoesRegistradas";

/**
 * Conexão registrada vista por quem participa (Meu Network Inteligente e perfil
 * do contato). O que se trava: descartar é irreversível no servidor
 * (avancarConexao recusa qualquer etapa depois do descarte de quem pede), então
 * o botão "Descartar" só abre a confirmação; a mutação sai no botão do diálogo.
 * Avançar para a próxima etapa continua num clique.
 */

type OpcoesDaMutacao = { onSuccess?: (resultado: { aguardandoOutroLado: boolean }) => void; onError?: () => void };

const duble = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  opcoes: {} as { onSuccess?: (resultado: { aguardandoOutroLado: boolean }) => void; onError?: () => void },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      networkInteligente: { conexoes: { invalidate: vi.fn() }, contato: { invalidate: vi.fn() } },
    }),
    networkInteligente: {
      avancarConexao: {
        useMutation: (opcoes: OpcoesDaMutacao) => {
          duble.opcoes = opcoes;
          return { mutate: duble.mutate, isPending: duble.isPending };
        },
      },
    },
  },
}));

const conexao = (extra: Partial<ConexaoNaTela> = {}): ConexaoNaTela => ({
  id: "c-1",
  origem: "PRIVATE_NETWORK_MATCH",
  pontuacao: 100,
  itens: [{ tem: "Vinho", precisa: "Vinho", deCodigo: "NW-AAAAAA", paraCodigo: "NW-BBBBBB" }],
  status: "identificada",
  statusComissao: "sem_negocio",
  criadaEm: Date.UTC(2026, 8, 14),
  fechamentoConfirmadoPorMim: false,
  lados: [
    { lado: "a", tipo: "contato", contactId: null, codigoAnonimo: "NW-AAAAAA", meu: false, originador: false, statusComissaoOriginador: null },
    { lado: "b", tipo: "contato", contactId: null, codigoAnonimo: "NW-BBBBBB", meu: false, originador: false, statusComissaoOriginador: null },
  ],
  ...extra,
});

const renderizar = (c: ConexaoNaTela) => render(<ul><ConexaoRegistrada conexao={c} /></ul>);

beforeEach(() => {
  duble.mutate.mockClear();
  duble.isPending = false;
  duble.opcoes = {};
});

describe("Conexão registrada — descartar pede confirmação", () => {
  it("clicar em Descartar não descarta: abre o diálogo que avisa que não há volta", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    expect(duble.mutate).not.toHaveBeenCalled();
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Descartar esta conexão?")).toBeInTheDocument();
    expect(within(dialogo).getByText(/não pode ser desfeito/)).toBeInTheDocument();
  });

  it("cancelar fecha o diálogo sem gravar nada", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(duble.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirmar descarta esta conexão e o diálogo fecha quando o servidor aceita", () => {
    renderizar(conexao({ id: "c-negociacao", status: "negociacao" }));

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Descartar conexão" }));

    expect(duble.mutate).toHaveBeenCalledTimes(1);
    expect(duble.mutate).toHaveBeenCalledWith({ conexaoId: "c-negociacao", etapa: "descartada" });

    act(() => duble.opcoes.onSuccess?.({ aguardandoOutroLado: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("avançar de etapa segue num clique, sem diálogo", () => {
    renderizar(conexao());

    fireEvent.click(screen.getByRole("button", { name: "Registrar apresentação" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(duble.mutate).toHaveBeenCalledWith({ conexaoId: "c-1", etapa: "apresentacao" });
  });

  it("conexão fechada ou já descartada não oferece Descartar", () => {
    const { unmount } = renderizar(conexao({ status: "fechada" }));
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
    unmount();

    renderizar(conexao({ status: "descartada" }));
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument();
  });
});

/**
 * PLATFORM_MATCH: os dois lados são membras e nenhum tem código anônimo — o
 * servidor não manda contactId nem codigoAnonimo para conta alheia, e não deve
 * mandar mesmo. Sem mais nada na tela, dois pares registrados na mesma rodada
 * viram dois cartões iguais, e o descarte (que não volta atrás) vira sorteio.
 *
 * O que identifica o par sem ferir a privacidade: a REFERÊNCIA da conexão (id
 * da linha, que o cliente já tem) e a nota, que é número. As duas atravessam
 * os 10 idiomas; o `motivo` do servidor é português fixo e ficou fora da tela
 * de quem usa (ele segue no Painel Ouro, que é em português por decisão).
 */
describe("Conexão entre duas membras — qual cartão é qual", () => {
  const ladosDeMembras: ConexaoNaTela["lados"] = [
    { lado: "a", tipo: "membro", contactId: null, codigoAnonimo: null, meu: true, originador: false, statusComissaoOriginador: null },
    { lado: "b", tipo: "membro", contactId: null, codigoAnonimo: null, meu: false, originador: false, statusComissaoOriginador: null },
  ];
  const entreMembras = (extra: Partial<ConexaoNaTela> = {}) =>
    conexao({ origem: "PLATFORM_MATCH", itens: [], lados: ladosDeMembras, ...extra });

  // Duas conexões da MESMA rodada: a nota arredonda para o mesmo inteiro e o
  // registro cai no mesmo minuto. É o pior caso, e é o caso comum.
  const MESMA_RODADA = { pontuacao: 72, criadaEm: Date.UTC(2026, 8, 14, 15, 22) };
  const PAR_A = "0b3f0e4e-0000-4000-8000-0000000000a1";
  const PAR_B = "0b3f0e4e-0000-4000-8000-0000000000b2";

  afterEach(async () => {
    await i18n.changeLanguage("pt-BR");
  });

  it("o lado de quem olha não sai com o mesmo rótulo do lado alheio", () => {
    renderizar(entreMembras());

    expect(screen.getByText("Seu lado")).toBeInTheDocument();
    expect(screen.getByText("Membra da plataforma")).toBeInTheDocument();
  });

  it("dois pares da mesma rodada, com a mesma nota e o mesmo minuto, ainda assim se separam", () => {
    render(
      <ul>
        <ConexaoRegistrada conexao={entreMembras({ id: PAR_A, ...MESMA_RODADA })} />
        <ConexaoRegistrada conexao={entreMembras({ id: PAR_B, ...MESMA_RODADA })} />
      </ul>,
    );

    const referencias = [referenciaDaConexao(PAR_A), referenciaDaConexao(PAR_B)];
    expect(new Set(referencias).size).toBe(2);
    for (const referencia of referencias) {
      expect(screen.getByText(`Referência ${referencia}`)).toBeInTheDocument();
    }
  });

  it("a tela não mostra o texto em português que o servidor grava no motivo", () => {
    // O motivo é frase fixa em pt-BR gravada na linha; esta tela roda em 10
    // idiomas. Mesmo que ele venha no pedido, não pode ser desenhado.
    const motivo = "Conexão sugerida pelo motor de perfis entre duas membras da plataforma, com o termo do Smart Match aceito pelas duas: compatibilidade de 72%.";
    renderizar({ ...entreMembras({ id: PAR_A, ...MESMA_RODADA }), motivo } as unknown as ConexaoNaTela);

    expect(screen.queryByText(motivo)).not.toBeInTheDocument();
    expect(screen.getByText(`Referência ${referenciaDaConexao(PAR_A)}`)).toBeInTheDocument();
    // E nenhum percentual: a comissão é status, e o cartão promete que não há percentual.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("em japonês, o que identifica o cartão continua na tela e traduzido", async () => {
    await i18n.changeLanguage("ja");
    renderizar(entreMembras({ id: PAR_A, ...MESMA_RODADA }));

    expect(screen.getByText(`参照番号 ${referenciaDaConexao(PAR_A)}`)).toBeInTheDocument();
    // Nada de português na tela de quem lê em japonês.
    expect(screen.queryByText(/compatibilidade de/i)).not.toBeInTheDocument();
  });

  it("o outro lado retirou a autorização: o aviso é texto da tela, traduzido", () => {
    renderizar(entreMembras({ id: PAR_A, ...MESMA_RODADA, outroLadoSemAutorizacao: true }));

    expect(screen.getByText(/retirou a autorização para a rede/)).toBeInTheDocument();
  });

  it("a confirmação diz qual conexão vai ser descartada", () => {
    renderizar(entreMembras({ id: PAR_A, ...MESMA_RODADA }));

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Entre membras da plataforma")).toBeInTheDocument();
    expect(within(dialogo).getByText(`Referência ${referenciaDaConexao(PAR_A)}`)).toBeInTheDocument();
    expect(duble.mutate).not.toHaveBeenCalled();
  });
});
