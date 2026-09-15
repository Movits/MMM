import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ptBR from "@/i18n/locales/pt-BR.json";
import type { DemandaDetalhada } from "@shared/o-que-preciso";

/**
 * "O que preciso — Demandas e necessidades" (Rosber, 14/09 21:24 e 21:34): os
 * 17 cartões e a segunda camada de detalhamento, no componente que o
 * Onboarding e o Perfil usam.
 */

const ditado = vi.hoisted(() => ({ transcrever: async () => ({ texto: "" }) as { texto: string } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    assistenteTexto: {
      revisar: { useMutation: () => ({ mutateAsync: async () => ({ revisado: "", mudou: false }), isPending: false }) },
      transcrever: { useMutation: () => ({ mutateAsync: () => ditado.transcrever(), isPending: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DemandasDoPerfil, EditorDoQuePreciso, type ValorDoQuePreciso } from "./OQuePreciso";

const pt = ptBR as unknown as { oQuePreciso: { categorias: Record<string, { titulo: string; descricao: string; pergunta: string; exemplo: string }>; campos: Record<string, string> } };
const cat = pt.oQuePreciso.categorias;

let ultimo: ValorDoQuePreciso = { categorias: [], demandas: [] };
function Controlado({ inicial, toleradas }: { inicial?: ValorDoQuePreciso; toleradas?: string[] }) {
  const [valor, setValor] = useState<ValorDoQuePreciso>(inicial ?? { categorias: [], demandas: [] });
  ultimo = valor;
  return <EditorDoQuePreciso valor={valor} onChange={proximo => { ultimo = proximo; setValor(proximo); }} toleradas={toleradas} />;
}

const cartoes = () => screen.getAllByRole("button").filter(botao => botao.hasAttribute("aria-expanded"));
const cartao = (titulo: string) => cartoes().find(botao => botao.textContent?.includes(titulo))!;
const painel = (titulo: string) => screen.getByRole("region", { name: titulo });
const descricao = (rotulo: string) => screen.getByLabelText(new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))) as HTMLTextAreaElement;

describe("os cartões", () => {
  it("são as 17 categorias da mensagem, na ordem, com emoji, título e descrição; sem 'Consultoria' nem 'match'", () => {
    render(<Controlado />);
    const esperado: Array<[string, string, string]> = [
      ["🛒", "Compradores / Clientes", "Encontrar quem precisa do que eu vendo ou ofereço."],
      ["📦", "Distribuidores / Representantes", "Distribuição, representação comercial e canais de venda."],
      ["🏭", "Fornecedores / Fabricantes", "Produtos, insumos, indústria e produção."],
      ["🤝", "Parceiros Estratégicos", "Joint ventures, alianças, sócios e parceiros comerciais."],
      ["💰", "Investidores", "Investimento, equity, fundos e capital privado."],
      ["🏦", "Crédito / Financiamento", "Bancos, linhas de crédito e financiamento de projetos."],
      ["🌎", "Expansão / Internacionalização", "Entrar em novos estados, países ou mercados."],
      ["🏛️", "Conexões Institucionais", "Entidades, associações, câmaras de comércio e interlocução institucional."],
      ["📋", "Licenças / Regulação", "Licenças, registros, certificações e aprovações."],
      ["💡", "Tecnologia / Inovação", "Sistemas, IA, tecnologia, inovação e transformação digital."],
      ["👩‍💼", "Especialistas / Serviços", "Jurídico, tributário, contábil, regulatório, marketing, comércio exterior e outros serviços especializados."],
      ["👥", "Talentos / Equipe", "Executivos, profissionais e competências específicas."],
      ["🏢", "Imóveis / Estrutura", "Áreas, imóveis, plantas industriais, escritórios e infraestrutura."],
      ["🚚", "Logística / Comércio Exterior", "Transporte, armazenagem, importação, exportação e operações internacionais."],
      ["📣", "Mídia / Visibilidade", "Comunicação, eventos, imprensa, posicionamento e divulgação."],
      ["🎓", "Conhecimento / Mentoria", "Especialistas, capacitação, conselho e experiência."],
      ["➕", "Outra necessidade", "Descreva livremente o que você procura."],
    ];
    expect(cartoes().map(botao => botao.textContent)).toEqual(esperado.map(([emoji, titulo, desc]) => `${emoji}${titulo}${desc}`));
    expect(screen.queryByText("Consultoria")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/match/i);
    // Nenhum campo de detalhamento antes de marcar.
    expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  });

  it("seleção múltipla com contador; marcar abre só a camada daquela categoria", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Investidores"));
    expect(cartao("Investidores")).toHaveAttribute("aria-pressed", "true");
    expect(within(painel("Investidores")).getByText(cat.investidores.pergunta)).toBeInTheDocument();
    expect(screen.getByText(/◈ 1 demanda selecionada/)).toBeInTheDocument();

    fireEvent.click(cartao("Compradores / Clientes"));
    expect(screen.getByText(/◈ 2 demandas selecionadas/)).toBeInTheDocument();
    expect(cartao("Investidores")).toHaveAttribute("aria-pressed", "true");
    // Uma camada aberta por vez: a de Investidores fechou e a de Compradores abriu, com os campos dela.
    expect(screen.queryByRole("region", { name: "Investidores" })).not.toBeInTheDocument();
    const compradores = painel("Compradores / Clientes");
    expect(within(compradores).getByText(cat.compradores.pergunta)).toBeInTheDocument();
    for (const rotulo of ["produtoOuServico", "tipoDeComprador", "setor", "paisRegiaoDeInteresse", "volumeOuCapacidade"]) {
      expect(within(compradores).getByLabelText(pt.oQuePreciso.campos[rotulo])).toBeInTheDocument();
    }
    expect(within(compradores).getByPlaceholderText(cat.compradores.exemplo)).toBeInTheDocument();
    expect(screen.queryByText(cat.investidores.pergunta)).not.toBeInTheDocument();
  });
});

describe("a segunda camada", () => {
  it("Especialistas / Serviços pergunta o serviço e a descrição exata; sem os dois, a categoria fica pendente", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Especialistas / Serviços"));
    const camada = painel("Especialistas / Serviços");
    expect(within(camada).getByText("Qual serviço ou especialista você precisa contratar?")).toBeInTheDocument();
    const opcoes = within(within(camada).getByRole("group")).getAllByRole("button").map(botao => botao.textContent);
    expect(opcoes).toEqual(["Jurídico", "Tributário", "Contábil", "Regulatório", "Comércio Exterior", "Marketing", "Tecnologia", "Estratégia", "Financeiro", "Recursos Humanos", "Engenharia", "Arquitetura", "Outro"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Para continuar, detalhe: Especialistas / Serviços.");

    fireEvent.change(descricao("Descreva exatamente o serviço de que você precisa."), { target: { value: "Procuro escritório de advocacia especializado em recuperação de créditos tributários para indústria no Brasil." } });
    expect(within(camada).getByText(ptBR.oQuePreciso.servicoObrigatorio)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(within(camada).getByRole("button", { name: "Tributário" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(ultimo.demandas).toEqual([expect.objectContaining({
      category: "especialistas_servicos", service: "tributario",
      description: "Procuro escritório de advocacia especializado em recuperação de créditos tributários para indústria no Brasil.",
    })]);
  });

  it("a descrição curta não basta: a seleção sozinha não gera conexão", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Fornecedores / Fabricantes"));
    fireEvent.change(screen.getByLabelText(pt.oQuePreciso.campos.produtoInsumo), { target: { value: "Vidro" } });
    fireEvent.change(descricao(pt.oQuePreciso.campos.descricao), { target: { value: "Vidro" } });
    expect(screen.getByText("Descreva com pelo menos 10 caracteres.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(descricao(pt.oQuePreciso.campos.descricao), { target: { value: "Embalagens de vidro certificadas para alimentos" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("mais de uma demanda na mesma categoria, guardadas separadamente", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Expansão / Internacionalização"));
    fireEvent.change(screen.getByLabelText(pt.oQuePreciso.campos.paisRegiaoDeDestino), { target: { value: "Moçambique" } });
    fireEvent.click(screen.getByRole("button", { name: "Instalar operação" }));
    fireEvent.change(descricao(pt.oQuePreciso.campos.descricao), { target: { value: "Expandir operação farmacêutica para Moçambique." } });

    fireEvent.click(screen.getByRole("button", { name: /Adicionar outra demanda/ }));
    // A primeira vira resumo; a segunda abre vazia.
    const camada = painel("Expansão / Internacionalização");
    expect(within(camada).getByText("Demanda 1")).toBeInTheDocument();
    expect(within(camada).getByText("Expandir operação farmacêutica para Moçambique.")).toBeInTheDocument();
    fireEvent.change(descricao(pt.oQuePreciso.campos.descricao), { target: { value: "Encontrar distribuidor na Nigéria." } });
    fireEvent.click(screen.getByRole("button", { name: "Distribuir" }));

    const demandas = ultimo.demandas.filter(d => d.category === "expansao_internacionalizacao");
    expect(demandas).toHaveLength(2);
    expect(new Set(demandas.map(d => d.id)).size).toBe(2);
    expect(demandas.map(d => [d.description, d.objective, d.region])).toEqual([
      ["Expandir operação farmacêutica para Moçambique.", "instalar_operacao", "Moçambique"],
      ["Encontrar distribuidor na Nigéria.", "distribuir", undefined],
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Outra necessidade abre 'Conte-nos exatamente o que você precisa.'", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Outra necessidade"));
    expect(descricao("Conte-nos exatamente o que você precisa.")).toBeInTheDocument();
  });

  it("Conexões Institucionais fala em conexão legítima e profissional", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Conexões Institucionais"));
    expect(within(painel("Conexões Institucionais")).getByText(ptBR.oQuePreciso.institucionalAviso)).toBeInTheDocument();
  });

  it("desmarcar a categoria tira as demandas dela; fechar descarta a demanda em branco", () => {
    render(<Controlado />);
    fireEvent.click(cartao("Tecnologia / Inovação"));
    fireEvent.click(screen.getByRole("button", { name: "Desmarcar categoria" }));
    expect(ultimo).toEqual({ categorias: [], demandas: [] });

    fireEvent.click(cartao("Mídia / Visibilidade"));
    expect(ultimo.demandas).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);
    expect(ultimo).toEqual({ categorias: ["midia_visibilidade"], demandas: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("Mídia / Visibilidade");
  });

  it("ditado que termina depois de a demanda fechar entra nela sem desfazer o que a pessoa marcou enquanto transcrevia", async () => {
    // O "Gravar áudio" entrega o texto mesmo com o campo fora da tela; a troca
    // tem de partir do valor ATUAL do editor, não do da hora em que o campo saiu.
    class GravadorFalso {
      static isTypeSupported = () => true;
      mimeType = "audio/webm";
      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((evento: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["som"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", GravadorFalso);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }) },
    });
    let responder: ((resposta: { texto: string }) => void) | undefined;
    ditado.transcrever = () => new Promise(resolve => { responder = resolve; });

    try {
      render(<Controlado />);
      fireEvent.click(cartao("Expansão / Internacionalização"));
      fireEvent.change(screen.getByLabelText(pt.oQuePreciso.campos.paisRegiaoDeDestino), { target: { value: "Moçambique" } });
      const camada = painel("Expansão / Internacionalização");
      await act(async () => { fireEvent.click(within(camada).getByRole("button", { name: /Gravar áudio/ })); });
      await act(async () => { fireEvent.click(await within(camada).findByRole("button", { name: /Parar e transcrever/ })); });
      await waitFor(() => expect(responder).toBeDefined());

      fireEvent.click(cartao("Investidores"));
      expect(screen.queryByRole("region", { name: "Expansão / Internacionalização" })).not.toBeInTheDocument();
      await act(async () => { responder!({ texto: "Expandir operação farmacêutica para Moçambique." }); });

      expect(ultimo.categorias).toEqual(["expansao_internacionalizacao", "investidores"]);
      expect(ultimo.demandas).toEqual([
        expect.objectContaining({ category: "expansao_internacionalizacao", region: "Moçambique", description: "Expandir operação farmacêutica para Moçambique." }),
        expect.objectContaining({ category: "investidores" }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      ditado.transcrever = async () => ({ texto: "" });
    }
  });
});

describe("perfis gravados antes da mudança", () => {
  it("'consultoria' aparece como marcada antes da nova lista e pode ser removida; categoria tolerada não trava", () => {
    render(<Controlado inicial={{ categorias: ["consultoria", "fornecedores"], demandas: [] }} toleradas={["consultoria", "fornecedores"]} />);
    expect(screen.getByText(ptBR.oQuePreciso.categoriasAnteriores)).toBeInTheDocument();
    expect(screen.getByText("Consultoria")).toBeInTheDocument();
    expect(cartao("Fornecedores / Fabricantes")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover Consultoria" }));
    expect(ultimo.categorias).toEqual(["fornecedores"]);
  });

  it("a leitura do Perfil mostra a categoria com as demandas e a chave antiga pelo rótulo", () => {
    const detalhes: DemandaDetalhada[] = [
      { id: "a", category: "distribuidores", region: "África Oriental", exclusivity: "sim", description: "Busco parceiro para distribuir medicamentos na África Oriental" },
      { id: "b", category: "distribuidores", description: "curta" }, // inválida: não aparece
    ];
    render(<DemandasDoPerfil whatINeed={["distribuidores", "consultoria", "especialistas_servicos"]} whatINeedDetails={detalhes} />);
    expect(screen.getByText("Distribuidores / Representantes")).toBeInTheDocument();
    expect(screen.getByText("Busco parceiro para distribuir medicamentos na África Oriental")).toBeInTheDocument();
    expect(screen.getByText("País/região: África Oriental · Exclusividade: Sim")).toBeInTheDocument();
    expect(screen.queryByText("curta")).not.toBeInTheDocument();
    expect(screen.getByText("Consultoria")).toBeInTheDocument();
    expect(screen.getByText("Especialistas / Serviços")).toBeInTheDocument();
    expect(screen.getByText(ptBR.oQuePreciso.semDemandaDetalhada)).toBeInTheDocument();
  });
});
