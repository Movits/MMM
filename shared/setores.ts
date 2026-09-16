// Fonte ÚNICA de setores do app (reteste v4, item 7).
//
// Antes existiam três listas diferentes, e o que estava numa faltava na outra:
//   1. o cadastro (Onboarding, passo 4) usava 15 rótulos em `onboarding.sectors`;
//   2. os "Setores de interesse" (Profile) usavam 23 rótulos fixos em pt-BR,
//      copiados numa constante morta homônima dentro do próprio Onboarding;
//   3. "Nova Oportunidade" usava outras 23 chaves em client/src/lib/opportunity-sectors.ts.
// Resultado prático: quem se cadastrava em "Tecnologia & Software" não achava o
// próprio setor na lista de interesses, e "Sustentabilidade & ESG" não existia
// em lugar nenhum. CHAVES_DE_SETOR abaixo é a UNIÃO das três listas — nenhum
// setor que existia se perdeu — mais "sustentabilidade", que faltava nas três.
//
// COMO CADA TELA GRAVA (não mude sem migrar o dado já gravado):
//   - "Nova Oportunidade" grava a CHAVE (`tecnologia`), para o filtro por setor
//     de server/db.ts achar a oportunidade em qualquer idioma (correção da #55).
//   - Cadastro e "Setores de interesse" gravam o RÓTULO traduzido; é o que
//     server/matching.ts normaliza em `chaveDoSetor`. Os rótulos dos 14 setores
//     que vieram do cadastro são os MESMOS de antes, byte a byte, justamente
//     para esse mapa continuar valendo.
//   - "Interesses de negócio" (cadastro, coluna businessInterests) grava a
//     CHAVE: o valor tem de ser o mesmo em qualquer idioma, senão duas usuárias
//     com o mesmo interesse declarado em línguas diferentes nunca se cruzam.
//     Ali convivem três vocabulários — as chaves novas ("construcao"), as
//     antigas em inglês ("technology", de onboarding.sectors) e o RÓTULO
//     traduzido, gravado por engano entre 14 e 15/09 —, e `interesseEhDoSetor`
//     abaixo reconhece os três para a seleção da usuária não sumir da tela.
//   - Por isso `rotuloDoSetor` devolve intacto tudo o que não for chave
//     conhecida: perfil e oportunidade antigos continuam aparecendo na tela.
//
// ONDE FICAM OS RÓTULOS: no espaço i18n próprio `setores.*`, e NÃO dentro de
// `onboarding.sectors`. Tentar juntar os dois quebra outra tela: o Dashboard
// resolve qualquer valor de opção varrendo `onboarding.<especialidades|setores|
// ...>.<valor>` (optionLabel), e com "tecnologia" também morando em
// onboarding.sectors a ESPECIALIDADE "tecnologia" de uma conexão passava a ser
// exibida como "Tecnologia & Software". Por isso `onboarding.sectors` fica como
// está — com as 14 chaves antigas em inglês (`technology`, `financial`…) e
// "other" —, que é o vocabulário do dado JÁ GRAVADO: "Interesses de negócio" de
// perfis antigos guarda essas chaves e o cartão de match as traduz por ali.
//
// DIRETRIZ DE TRADUÇÃO (reteste v4, item 14): "Commodities" fica em inglês em
// pt-BR e es — é termo consagrado do mercado, e traduzir por "Matérias-primas"
// afasta o termo que a usuária procura. Nos idiomas que já têm palavra própria
// e corrente (de "Rohstoffe", fr "Matières premières", ja "コモディティ") vale a
// tradução local. Vale só para este termo; o resto da lista é traduzido normal.
export const CHAVES_DE_SETOR = [
  "agronegocio", "alimentacao", "belezaCosmeticos", "commodities", "construcao",
  "consultoria", "educacao", "energia", "entretenimento", "exportacao",
  "farmaceutico", "financas", "governo", "imobiliario", "importacao",
  "industria", "infraestrutura", "juridico", "logistica", "marketing",
  "moda", "saude", "servicos", "sustentabilidade", "tecnologia",
  "telecom", "turismo", "varejo",
] as const;

export type ChaveDeSetor = typeof CHAVES_DE_SETOR[number];

/** Assinatura mínima do `t` do i18next — evita o client e o servidor dependerem do tipo dele. */
export type TradutorDeSetor = (chave: string, opcoes?: { defaultValue: string }) => string;

export function ehChaveDeSetor(valor: string): valor is ChaveDeSetor {
  return (CHAVES_DE_SETOR as readonly string[]).includes(valor);
}

/** Chave i18n do rótulo de um setor. Os 10 idiomas têm todas elas (conferir-locales.mjs). */
export function chaveI18nDoSetor(chave: string): string {
  return `setores.${chave}`;
}

/**
 * Rótulo traduzido de um setor. Valor que não é chave conhecida — o rótulo que o
 * cadastro sempre gravou, ou a oportunidade anterior à #55 — volta como está.
 */
export function rotuloDoSetor(t: TradutorDeSetor, valor: string | null | undefined): string {
  if (!valor) return "";
  if (!ehChaveDeSetor(valor)) return valor;
  return t(chaveI18nDoSetor(valor), { defaultValue: valor });
}

/** A lista inteira, traduzida, na ordem de CHAVES_DE_SETOR. Cada tela ordena como quiser. */
export function setoresTraduzidos(t: TradutorDeSetor): { chave: ChaveDeSetor; rotulo: string }[] {
  return CHAVES_DE_SETOR.map(chave => ({ chave, rotulo: rotuloDoSetor(t, chave) }));
}

/**
 * O valor gravado é ESTE setor? Casa com a CHAVE (o que se grava hoje) e com o
 * RÓTULO traduzido do idioma em que a tela está (o que o cadastro gravou por
 * engano entre 14 e 15/09). Sem isso a usuária voltava ao cadastro e via os
 * próprios interesses desmarcados, perdendo a seleção ao salvar de novo.
 */
export function interesseEhDoSetor(gravado: string, setor: { chave: string; rotulo: string }): boolean {
  const valor = gravado.trim();
  return valor === setor.chave || valor === setor.rotulo.trim();
}

/**
 * Rótulos da lista atual MAIS o que a usuária já tinha gravado e não está mais
 * nela (ex.: o antigo "Tecnologia", hoje "Tecnologia & Software"). Sem isso o
 * Perfil perderia a seleção antiga só por ela não bater com nenhum rótulo novo.
 */
export function rotulosComLegado(t: TradutorDeSetor, gravados: readonly string[]): string[] {
  const rotulos = setoresTraduzidos(t).map(s => s.rotulo);
  const conhecidos = new Set(rotulos);
  for (const gravado of gravados) {
    const rotulo = rotuloDoSetor(t, gravado);
    if (rotulo && !conhecidos.has(rotulo)) {
      conhecidos.add(rotulo);
      rotulos.push(rotulo);
    }
  }
  return rotulos;
}
