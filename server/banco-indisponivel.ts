/**
 * Banco fora do ar.
 *
 * Existe como tipo próprio porque a diferença entre "não há dado" e "não
 * consegui perguntar ao banco" decide coisas: no consentimento, ela decidia se
 * o cruzamento libera ou barra, e as duas situações eram `null`, o que fazia a
 * queda do banco liberar todo mundo. Nos helpers de `server/db.ts`, a mesma
 * ambiguidade fazia banco fora do ar parecer "sem dados" na tela.
 *
 * Quem lança é `exigirDb()` (server/db.ts). Quem traduz para a usuária é o
 * middleware de `server/_core/trpc.ts`, que a converte num TRPCError
 * INTERNAL_SERVER_ERROR com `MENSAGEM_BANCO_INDISPONIVEL`.
 *
 * O módulo é separado de propósito: db.ts e routers/consent.ts precisam os
 * dois da classe, e um importar do outro viraria ciclo.
 */
export const MENSAGEM_BANCO_INDISPONIVEL = "Banco de dados indisponível; tente de novo em instantes";

export class BancoIndisponivel extends Error {
  constructor() {
    super(MENSAGEM_BANCO_INDISPONIVEL);
    this.name = "BancoIndisponivel";
  }
}
