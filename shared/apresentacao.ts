/**
 * A apresentação ("Sobre você") tem DOIS tetos, e a diferença entre eles é a
 * origem do apagamento que a revisão da #135 registrou no item 10:
 *
 * - `LIMITE_DA_BIO_NO_CADASTRO` é o que o formulário do cadastro mostra e o que
 *   ele aceita escrever;
 * - `LIMITE_DA_BIO_GRAVADA` é o que já existe gravado: a carga da planilha
 *   (scripts/importacao/planilha.mjs) escreve até esse tamanho.
 *
 * Como o segundo é maior, existe bio que o formulário não consegue mostrar
 * inteira. Quem edita o Perfil precisa conseguir salvar (e encurtar) esse texto
 * — por isso `profile.update` usa o teto gravado, não o do cadastro.
 */
export const LIMITE_DA_BIO_NO_CADASTRO = 1000;
export const LIMITE_DA_BIO_GRAVADA = 2000;

/**
 * Corta o texto para caber em `limite` unidades UTF-16 (a medida de `.length`,
 * a mesma do zod no servidor) sem partir um emoji ao meio: percorre por code
 * point (Array.from) e para antes do que não cabe.
 *
 * Fica em shared porque o servidor precisa reconhecer EXATAMENTE o corte que a
 * tela faz: é assim que `completeOnboarding` distingue "o formulário mandou de
 * volta o texto que ele mesmo cortou" de "a pessoa editou a apresentação".
 */
export function cortarSemPartirEmoji(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  let cortado = "";
  for (const caractere of Array.from(texto)) {
    if (cortado.length + caractere.length > limite) break;
    cortado += caractere;
  }
  return cortado;
}
