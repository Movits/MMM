/**
 * Diferença palavra a palavra entre o texto enviado ao "Revisar texto" e a
 * sugestão, para a tela destacar o que muda antes de a pessoa aceitar
 * (BotaoRevisarTexto). A guarda do servidor (revisaoPreservaConteudo) barra o
 * que dá para barrar com regra; o resto — a troca por palavra de grafia
 * parecida, por exemplo — só a pessoa vê, e por isso a mudança fica à vista.
 *
 * A comparação é por palavra com a pontuação colada ("Africa." × "África."),
 * exata, com acento e caixa: toda correção aparece, inclusive a de acento.
 */
export type TrechoDaRevisao = { tipo: "igual" | "removido" | "incluido"; texto: string };

/** Acima disso a tabela da subsequência comum pesa demais no navegador: marca o miolo inteiro como trocado. */
const LIMITE_DE_CELULAS = 4_000_000;

const palavrasComEspaco = (texto: string) => texto.match(/\S+\s*/g) ?? [];

export function diferencasDaRevisao(original: string, revisado: string): TrechoDaRevisao[] {
  const antes = palavrasComEspaco(original);
  const depois = palavrasComEspaco(revisado);
  const chave = (palavra: string) => palavra.trimEnd();
  const chavesAntes = antes.map(chave);
  const chavesDepois = depois.map(chave);
  const trechos: TrechoDaRevisao[] = [];
  const empurrar = (tipo: TrechoDaRevisao["tipo"], texto: string) => {
    const ultimo = trechos[trechos.length - 1];
    if (ultimo && ultimo.tipo === tipo) ultimo.texto += texto;
    else trechos.push({ tipo, texto });
  };
  // Palavra removida não tem espaço próprio no texto revisado: sai separada por espaço simples.
  const removida = (i: number) => {
    const anterior = trechos[trechos.length - 1]?.texto ?? "";
    return `${anterior && !/\s$/.test(anterior) ? " " : ""}${chavesAntes[i]} `;
  };

  const inicioDoRevisado = revisado.match(/^\s*/)?.[0] ?? "";
  if (inicioDoRevisado) empurrar("igual", inicioDoRevisado);

  let comeco = 0;
  while (comeco < antes.length && comeco < depois.length && chavesAntes[comeco] === chavesDepois[comeco]) comeco++;
  let fimAntes = antes.length;
  let fimDepois = depois.length;
  while (fimAntes > comeco && fimDepois > comeco && chavesAntes[fimAntes - 1] === chavesDepois[fimDepois - 1]) {
    fimAntes--;
    fimDepois--;
  }

  for (let i = 0; i < comeco; i++) empurrar("igual", depois[i]);

  const n = fimAntes - comeco;
  const m = fimDepois - comeco;
  if (n * m > LIMITE_DE_CELULAS) {
    for (let i = comeco; i < fimAntes; i++) empurrar("removido", removida(i));
    for (let j = comeco; j < fimDepois; j++) empurrar("incluido", depois[j]);
  } else {
    // comum[i][j] = tamanho da maior subsequência comum de antes[i..] e depois[j..].
    const largura = m + 1;
    const comum = new Uint16Array((n + 1) * largura);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        comum[i * largura + j] = chavesAntes[comeco + i] === chavesDepois[comeco + j]
          ? comum[(i + 1) * largura + j + 1] + 1
          : Math.max(comum[(i + 1) * largura + j], comum[i * largura + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && chavesAntes[comeco + i] === chavesDepois[comeco + j]) {
        empurrar("igual", depois[comeco + j]);
        i++;
        j++;
      } else if (j >= m || (i < n && comum[(i + 1) * largura + j] >= comum[i * largura + j + 1])) {
        empurrar("removido", removida(comeco + i));
        i++;
      } else {
        empurrar("incluido", depois[comeco + j]);
        j++;
      }
    }
  }

  for (let j = fimDepois; j < depois.length; j++) empurrar("igual", depois[j]);
  return trechos;
}
