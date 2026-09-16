import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArquivoDeCidades, SugestaoDeCidade } from "@shared/cidade";
import { Input } from "@/components/ui/input";
import {
  buscarCidades,
  carregarCidadesDoPais,
  LIMITE_DE_SUGESTOES,
  paisTemLista,
} from "@/lib/busca-de-cidades";

// Campo de cidade com sugestão, usado pelo cadastro (Onboarding) e pelo perfil
// (Profile) — as duas telas passaram a chamar o MESMO componente, porque antes o
// cadastro sugeria só município brasileiro e o perfil não sugeria nada.
//
// Três decisões que valem mais que o código:
//
// 1. DIGITAR LIVRE CONTINUA VALENDO. A sugestão ajuda, não obriga: quem mora em
//    distrito, vila ou país que ainda não tem lista digita o nome e segue. Perder
//    o cadastro por causa de uma lista incompleta seria trocar um problema
//    pequeno por um grande.
// 2. O QUE VAI PARA O BANCO É O NOME CANÔNICO. Escolher "São Paulo (SP)" na
//    lista grava "São Paulo", nunca "São Paulo (SP)". O campo antigo mostrava a
//    UF e a arrancava com um replace A CADA TECLA — o que também apagava um
//    "(SP)" que a pessoa tivesse escrito de propósito, e tornava impossível
//    saber se ela escolheu da lista ou digitou.
// 3. O <datalist> saiu. Ele não avisa se a pessoa escolheu da lista, não mostra
//    o rótulo do estado e se comporta mal no celular. Aqui a lista é do próprio
//    componente, e a escolha é um evento de verdade.
//
// O campo é o <Input> do shadcn, e não um <input> cru, por causa do IME: quem
// digita 東京 ou 北京 confirma a composição com Enter, e o Input já engole esse
// Enter (client/src/hooks/useComposition.ts). Num <input> cru, esse Enter cairia
// na navegação da lista e escolheria uma sugestão no meio da digitação — o
// defeito apareceria justamente nos idiomas que este campo veio atender.

export interface CampoDeCidadeProps {
  valor: string;
  /** Código ISO do país já escolhido. Sem ele não há o que sugerir. */
  pais: string;
  onChange: (cidade: string) => void;
  rotulo?: string;
  placeholder?: string;
  /** Classe do <input>, para cada tela manter o próprio visual. */
  classeDoCampo?: string;
  /** Classe do rótulo, pelo mesmo motivo. */
  classeDoRotulo?: string;
}

export default function CampoDeCidade({
  valor,
  pais,
  onChange,
  rotulo,
  placeholder,
  // Padrão: o visual do cadastro (Onboarding). O "h-auto" desfaz a altura fixa
  // do Input do shadcn, para o py-3 valer como valia no campo antigo.
  classeDoCampo = "h-auto w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/25 focus-visible:ring-0 focus:border-[#c98f70]/60 transition-all duration-200 text-sm",
  classeDoRotulo = "block text-sm font-medium text-white/70 mb-2",
}: CampoDeCidadeProps) {
  const { t } = useTranslation();
  const idDaLista = useId();
  const [arquivo, setArquivo] = useState<ArquivoDeCidades | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [destacado, setDestacado] = useState(-1);
  const fechamento = useRef<ReturnType<typeof setTimeout> | null>(null);

  const temLista = paisTemLista(pais);

  // Carrega a lista do país escolhido. Trocar de país descarta a anterior: a
  // usuária que muda de Brasil para Portugal não pode continuar vendo município
  // brasileiro na sugestão.
  useEffect(() => {
    setArquivo(null);
    setAberto(false);
    if (!temLista) return;
    let vivo = true;
    setCarregando(true);
    carregarCidadesDoPais(pais)
      .then(carregado => {
        if (vivo) setArquivo(carregado);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [pais, temLista]);

  useEffect(
    () => () => {
      if (fechamento.current) clearTimeout(fechamento.current);
    },
    []
  );

  const sugestoes = useMemo<SugestaoDeCidade[]>(
    () => (arquivo ? buscarCidades(arquivo, valor, LIMITE_DE_SUGESTOES) : []),
    [arquivo, valor]
  );

  const escolher = (sugestao: SugestaoDeCidade) => {
    onChange(sugestao.nome);
    setAberto(false);
    setDestacado(-1);
  };

  const aoTeclar = (evento: React.KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === "Escape") {
      setAberto(false);
      setDestacado(-1);
      return;
    }
    if (!aberto || !sugestoes.length) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setDestacado(anterior => (anterior + 1) % sugestoes.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setDestacado(anterior =>
        anterior <= 0 ? sugestoes.length - 1 : anterior - 1
      );
    } else if (evento.key === "Enter" && destacado >= 0) {
      evento.preventDefault();
      escolher(sugestoes[destacado]);
    }
  };

  const mostrandoLista = aberto && sugestoes.length > 0;

  // CRÉDITO DA FONTE, e não enfeite: os dados do GeoNames são CC BY 4.0, que
  // libera o uso comercial e exige atribuição VISÍVEL, com link. O texto sai do
  // cabeçalho do próprio arquivo do país (`fonte` e `fonteUrl`), então cada país
  // credita quem de fato forneceu a lista — o Brasil credita o IBGE, a Alemanha
  // creditará o GeoNames — e um país novo chega já creditado, sem ninguém
  // lembrar de mexer aqui. Só aparece quando há lista carregada: sem lista
  // nenhum dado de terceiro foi usado, e crédito de dado que não se usou é ruído.
  const credito = arquivo?.fonte ? (
    <p className="text-[11px] text-white/25 mt-1">
      {t("city.credit")}{" "}
      {arquivo.fonteUrl ? (
        <a
          href={arquivo.fonteUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline hover:text-white/40"
        >
          {arquivo.fonte}
        </a>
      ) : (
        arquivo.fonte
      )}
    </p>
  ) : null;
  // A dica embaixo do campo explica o silêncio. Antes, país diferente do Brasil
  // simplesmente não sugeria nada e parecia defeito.
  const dica = !pais
    ? t("city.chooseCountry")
    : carregando
      ? t("city.loading")
      : !temLista
        ? t("city.noList")
        : aberto && valor.trim() && !sugestoes.length
          ? t("city.noResults")
          : "";

  return (
    <div>
      {rotulo && <label className={classeDoRotulo}>{rotulo}</label>}
      <div className="relative">
        <Input
          type="text"
          value={valor}
          onChange={evento => {
            onChange(evento.target.value);
            setAberto(true);
            setDestacado(-1);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => {
            // O clique numa sugestão dispara o blur antes do clique; o adiamento
            // dá tempo de o clique acontecer.
            fechamento.current = setTimeout(() => setAberto(false), 120);
          }}
          onKeyDown={aoTeclar}
          placeholder={placeholder}
          className={classeDoCampo}
          autoComplete="off"
          role="combobox"
          aria-expanded={mostrandoLista}
          aria-controls={idDaLista}
          aria-autocomplete="list"
        />
        {mostrandoLista && (
          <ul
            id={idDaLista}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#1b1714] py-1 shadow-xl"
          >
            {sugestoes.map((sugestao, indice) => (
              <li key={`${sugestao.nome}-${sugestao.rotulo}-${indice}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={indice === destacado}
                  // onMouseDown, e não onClick: o mousedown chega antes do blur
                  // do campo, então a escolha não se perde no fechamento.
                  onMouseDown={evento => {
                    evento.preventDefault();
                    escolher(sugestao);
                  }}
                  onMouseEnter={() => setDestacado(indice)}
                  className={`block w-full px-4 py-2 text-left text-sm text-white hover:bg-white/10 ${
                    indice === destacado ? "bg-white/10" : ""
                  }`}
                >
                  {sugestao.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dica && <p className="text-xs text-white/30 mt-1">{dica}</p>}
      {credito}
    </div>
  );
}
