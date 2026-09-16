import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArquivoDeCidades } from "@shared/cidade";
import CampoDeCidade from "@/components/CampoDeCidade";

// A busca em si é provada em client/src/lib/busca-de-cidades.test.ts, contra o
// arquivo real do Brasil. Aqui o que está em jogo é o CAMPO: o que ele grava
// quando a pessoa escolhe da lista, o que ele grava quando ela só digita, e o
// que ele faz num país que ainda não tem lista. Por isso só o carregamento do
// arquivo é dublado — `buscarCidades` continua sendo a de verdade.
vi.mock("@/lib/busca-de-cidades", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/busca-de-cidades")>();
  return { ...real, paisTemLista: vi.fn(), carregarCidadesDoPais: vi.fn() };
});

import { carregarCidadesDoPais, paisTemLista } from "@/lib/busca-de-cidades";

const BRASIL: ArquivoDeCidades = {
  pais: "BR",
  fonte: "IBGE — municípios brasileiros (dado público)",
  fonteUrl: "https://www.ibge.gov.br",
  idiomas: [],
  ordem: "alfabetica",
  admins: { SP: "SP", PI: "PI", RS: "RS" },
  cidades: [
    ["Bom Jesus", "PI", "bom jesus"],
    ["Bom Jesus", "RS", "bom jesus"],
    ["São Paulo", "SP", "sao paulo"],
  ],
};

const ALEMANHA: ArquivoDeCidades = {
  pais: "DE",
  fonte: "GeoNames cities5000 (CC BY 4.0)",
  fonteUrl: "https://www.geonames.org",
  idiomas: [],
  ordem: "populacao-desc",
  admins: { "02": "Bayern" },
  cidades: [["München", "02", "munchen|munich|munique"]],
};

const POR_PAIS: Record<string, ArquivoDeCidades> = { BR: BRASIL, DE: ALEMANHA };

/** Casca com estado, para o teste ler o que FICOU gravado no campo. */
function Formulario({
  pais,
  inicial = "",
}: {
  pais: string;
  inicial?: string;
}) {
  const [cidade, setCidade] = useState(inicial);
  return (
    <div>
      <CampoDeCidade
        valor={cidade}
        pais={pais}
        onChange={setCidade}
        rotulo="Sua cidade"
      />
      <output data-testid="gravado">{cidade}</output>
    </div>
  );
}

const campo = () => screen.getByRole("combobox");
const gravado = () => screen.getByTestId("gravado").textContent;
const digitar = (texto: string) =>
  fireEvent.change(campo(), { target: { value: texto } });

beforeEach(() => {
  vi.mocked(paisTemLista).mockImplementation(pais => pais in POR_PAIS);
  vi.mocked(carregarCidadesDoPais).mockImplementation(pais =>
    Promise.resolve(POR_PAIS[pais] ?? null)
  );
});

describe("CampoDeCidade — escolher da lista", () => {
  it("sugere mostrando 'Cidade (UF)' e grava só o nome canônico", async () => {
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    digitar("sao pau");
    const sugestao = await screen.findByRole("option", {
      name: "São Paulo (SP)",
    });
    fireEvent.mouseDown(sugestao);

    // O que vai para o banco é "São Paulo", nunca "São Paulo (SP)".
    expect(gravado()).toBe("São Paulo");
    expect(campo()).toHaveValue("São Paulo");
  });

  it("acha a cidade pelo nome em outro idioma e grava o nome canônico", async () => {
    render(<Formulario pais="DE" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("DE")
    );

    digitar("Munich");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "München (Bayern)" })
    );

    expect(gravado()).toBe("München");
  });

  it("mostra a UF para distinguir homônimos, e cada escolha grava o mesmo nome", async () => {
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    digitar("bom jesus");
    expect(
      await screen.findByRole("option", { name: "Bom Jesus (PI)" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Bom Jesus (RS)" })
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("option", { name: "Bom Jesus (RS)" }));
    expect(gravado()).toBe("Bom Jesus");
  });

  it("fecha a lista depois de escolher", async () => {
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    digitar("sao pau");
    fireEvent.mouseDown(
      await screen.findByRole("option", { name: "São Paulo (SP)" })
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("CampoDeCidade — digitação livre", () => {
  it("guarda o que foi digitado quando a pessoa não escolhe da lista", async () => {
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    // Distrito que não é município: não está na lista, e ainda assim tem de valer.
    digitar("Vila Fictícia do Norte");
    expect(gravado()).toBe("Vila Fictícia do Norte");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("nunca arranca parênteses do que a pessoa escreveu", async () => {
    // O campo antigo rodava um replace de " (UF)" A CADA TECLA e comia o texto.
    //
    // ATENÇÃO ao que este teste prova e ao que não prova: o replace nunca morou
    // aqui dentro, morava no PONTO DE CHAMADA, no Onboarding
    // (`onChange={v => set("city", v.replace(/\s\([A-Z]{2}\)$/, ""))}`). Um
    // componente novo passa neste caso mesmo que a tela continue comendo o
    // texto. Quem prova o conserto de verdade é
    // client/src/pages/Onboarding.cidade.test.tsx, que monta a tela inteira.
    // Este caso fica como guarda do componente, não como prova da correção.
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    digitar("Campinas (SP)");
    expect(gravado()).toBe("Campinas (SP)");
  });
});

describe("CampoDeCidade — crédito da fonte", () => {
  /**
   * Os dados do GeoNames são CC BY 4.0: uso comercial liberado, atribuição
   * VISÍVEL obrigatória, com link. O crédito sai do cabeçalho do arquivo do
   * país, então cada país credita quem forneceu a lista e um país novo já chega
   * creditado.
   */
  it("credita o GeoNames com link na tela que usa a lista alemã", async () => {
    render(<Formulario pais="DE" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("DE")
    );

    const credito = await screen.findByRole("link", {
      name: "GeoNames cities5000 (CC BY 4.0)",
    });
    expect(credito).toHaveAttribute("href", "https://www.geonames.org");
    expect(screen.getByText(/Dados de cidades/i)).toBeInTheDocument();
  });

  it("credita o IBGE na lista brasileira, e não o GeoNames", async () => {
    render(<Formulario pais="BR" />);
    const credito = await screen.findByRole("link", {
      name: /IBGE/,
    });
    expect(credito).toHaveAttribute("href", "https://www.ibge.gov.br");
    expect(screen.queryByText(/GeoNames/)).not.toBeInTheDocument();
  });

  it("não credita ninguém em país sem lista: nenhum dado de terceiro foi usado", async () => {
    render(<Formulario pais="PT" />);
    expect(screen.queryByText(/Dados de cidades/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("CampoDeCidade — país sem lista", () => {
  it("cai no campo livre, sem sugerir nada e sem tentar carregar arquivo", async () => {
    render(<Formulario pais="PT" />);

    digitar("Lisboa");

    expect(carregarCidadesDoPais).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(gravado()).toBe("Lisboa");
    expect(screen.getByText(/lista deste país/i)).toBeInTheDocument();
  });

  it("sem país escolhido, explica que o país vem primeiro", () => {
    render(<Formulario pais="" />);
    expect(screen.getByText(/país primeiro/i)).toBeInTheDocument();
    expect(carregarCidadesDoPais).not.toHaveBeenCalled();
  });

  it("avisa quando o país tem lista mas nada casa com o que foi digitado", async () => {
    render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    digitar("Zzzzzz");
    expect(
      await screen.findByText(/Nenhuma cidade encontrada/i)
    ).toBeInTheDocument();
    expect(gravado()).toBe("Zzzzzz");
  });
});

describe("CampoDeCidade — troca de país", () => {
  it("descarta a lista anterior, para não sugerir município brasileiro em outro país", async () => {
    const { rerender } = render(<Formulario pais="BR" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("BR")
    );

    rerender(<Formulario pais="DE" />);
    await waitFor(() =>
      expect(carregarCidadesDoPais).toHaveBeenCalledWith("DE")
    );

    digitar("sao pau");
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: /São Paulo/ })
      ).not.toBeInTheDocument()
    );
  });
});
