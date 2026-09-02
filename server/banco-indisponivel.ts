import { DrizzleError, DrizzleQueryError } from "drizzle-orm";

/**
 * Banco fora do ar.
 *
 * Existe como tipo próprio porque a diferença entre "não há dado" e "não
 * consegui perguntar ao banco" decide coisas: no consentimento, ela decidia se
 * o cruzamento libera ou barra, e as duas situações eram `null`, o que fazia a
 * queda do banco liberar todo mundo. Nos helpers de `server/db.ts`, a mesma
 * ambiguidade fazia banco fora do ar parecer "sem dados" na tela.
 *
 * A queda real chega por DOIS caminhos, e este módulo reconhece os dois:
 *
 * 1. `exigirDb()` (server/db.ts) lança `BancoIndisponivel` quando não há
 *    conexão configurada (DATABASE_URL ausente). Só acontece em dev e teste.
 * 2. Em produção a variável existe sempre; `drizzle(url)` cria um pool do mysql2
 *    SEM conectar, e a queda do Aiven aparece na primeira query como erro do
 *    driver: um `DrizzleQueryError` cuja `cause` tem `code` ECONNREFUSED,
 *    ETIMEDOUT, PROTOCOL_CONNECTION_LOST, ER_CON_COUNT_ERROR... É
 *    `ehErroDeBancoIndisponivel()` que os reconhece; sem ela, o caminho 1
 *    nunca dispararia em produção.
 *
 * Quem traduz para a usuária é o middleware de `server/_core/trpc.ts`, que
 * converte qualquer um dos dois num TRPCError INTERNAL_SERVER_ERROR com
 * `MENSAGEM_BANCO_INDISPONIVEL`. O errorFormatter do mesmo arquivo mascara os
 * demais erros do driver (`ehErroDoDriverDeBanco`) com
 * `MENSAGEM_ERRO_DE_CONSULTA`, para o SQL nunca chegar ao navegador.
 *
 * O módulo é separado de propósito: db.ts e routers/consent.ts precisam os
 * dois da classe, e um importar do outro viraria ciclo.
 */
export const MENSAGEM_BANCO_INDISPONIVEL = "Banco de dados indisponível; tente de novo em instantes";

/** Erro do driver que NÃO é queda do banco (tabela ausente, chave duplicada, SQL inválido). */
export const MENSAGEM_ERRO_DE_CONSULTA = "Erro ao consultar o banco de dados";

export class BancoIndisponivel extends Error {
  constructor() {
    super(MENSAGEM_BANCO_INDISPONIVEL);
    this.name = "BancoIndisponivel";
  }
}

// Códigos que significam "não consegui falar com o servidor", e não "o
// servidor recusou esta consulta". Erro de SQL, de constraint ou de tabela
// (ER_NO_SUCH_TABLE, ER_DUP_ENTRY, ER_BAD_FIELD_ERROR, ER_PARSE_ERROR...) fica
// de fora de propósito: com o banco de pé, ele é bug nosso, não queda.
const CODIGOS_DE_CONEXAO = new Set([
  // Rede e socket (Node)
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND",
  "EAI_AGAIN", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  // Protocolo do mysql2 (conexão perdida ou já encerrada)
  "PROTOCOL_CONNECTION_LOST", "PROTOCOL_SEQUENCE_TIMEOUT",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", "PROTOCOL_ENQUEUE_AFTER_QUIT",
  "PROTOCOL_ENQUEUE_AFTER_DESTROY",
  // Servidor MySQL recusando ou encerrando conexões
  "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS", "ER_SERVER_SHUTDOWN",
  "ER_OUT_OF_RESOURCES",
  // Biblioteca cliente do MySQL (CR_*), caso o driver os repasse
  "CR_CONNECTION_ERROR", "CR_CONN_HOST_ERROR", "CR_SERVER_GONE_ERROR", "CR_SERVER_LOST",
]);

// Os mesmos, em número (errno), para o caso de o driver não preencher `code`.
const ERRNOS_DE_CONEXAO = new Set([1040, 1041, 1053, 1203, 2002, 2003, 2006, 2013]);

// Erros que o mysql2 cria como `new Error(mensagem)` sem `code` nenhum
// (lib/base/connection.js e lib/base/pool.js).
const MENSAGENS_DE_CONEXAO = [
  /connection is in closed state/i,
  /can't write in closed state/i,
  /connection lost/i,
  /pool is closed/i,
  /queue limit reached/i,
  /too many connections/i,
];

type ErroInspecionavel = {
  name?: unknown;
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  sqlState?: unknown;
  sqlMessage?: unknown;
  query?: unknown;
  cause?: unknown;
  errors?: unknown;
};

/**
 * O erro e a cadeia de `cause` dele (e os `errors` de um AggregateError, que
 * é como o Node reporta ECONNREFUSED em host com IPv4 e IPv6), em ordem.
 * Limitada e sem repetir objeto, para uma cadeia circular não travar o
 * servidor.
 */
function cadeiaDeCausas(erro: unknown): ErroInspecionavel[] {
  const elos: ErroInspecionavel[] = [];
  const vistos = new Set<unknown>();
  const fila: unknown[] = [erro];
  while (fila.length > 0 && elos.length < 12) {
    const atual = fila.shift();
    if (!atual || typeof atual !== "object" || vistos.has(atual)) continue;
    vistos.add(atual);
    const elo = atual as ErroInspecionavel;
    elos.push(elo);
    if (elo.cause !== undefined) fila.push(elo.cause);
    if (Array.isArray(elo.errors)) fila.push(...elo.errors);
  }
  return elos;
}

function eloEhBancoIndisponivel(elo: ErroInspecionavel): boolean {
  if (elo instanceof BancoIndisponivel || elo.name === "BancoIndisponivel") return true;
  if (typeof elo.code === "string" && CODIGOS_DE_CONEXAO.has(elo.code)) return true;
  if (typeof elo.errno === "number" && ERRNOS_DE_CONEXAO.has(elo.errno)) return true;
  if (typeof elo.message === "string" && MENSAGENS_DE_CONEXAO.some((re) => re.test(elo.message as string))) {
    return true;
  }
  return false;
}

/**
 * O erro (ou algo na cadeia de `cause` dele) diz que o banco está fora do ar?
 *
 * Reconhece `BancoIndisponivel` e os erros de conexão do driver mysql2, em
 * qualquer profundidade: o tRPC embrulha num TRPCError, o Drizzle embrulha num
 * DrizzleQueryError, e o código de rede está na `cause` da `cause`.
 * Erro de SQL ou de constraint devolve false: o banco respondeu.
 */
export function ehErroDeBancoIndisponivel(erro: unknown): boolean {
  for (const elo of cadeiaDeCausas(erro)) {
    if (eloEhBancoIndisponivel(elo)) return true;
  }
  return false;
}

function eloEhDoDriver(elo: ErroInspecionavel): boolean {
  if (elo instanceof DrizzleQueryError || elo instanceof DrizzleError) return true;
  // O mesmo DrizzleQueryError vindo de outra cópia do pacote (duck typing).
  if (typeof elo.query === "string" && typeof elo.message === "string" && elo.message.startsWith("Failed query")) {
    return true;
  }
  if (typeof elo.code === "string" && /^(ER_|PROTOCOL_|HANDSHAKE_|CR_)/.test(elo.code)) return true;
  if (typeof elo.sqlState === "string" || typeof elo.sqlMessage === "string") return true;
  return false;
}

/**
 * O erro veio do Drizzle ou do driver MySQL (de qualquer tipo, queda incluída)?
 *
 * Serve ao errorFormatter do tRPC: a mensagem de um DrizzleQueryError é o SQL
 * completo, com nomes de colunas, e não pode chegar ao navegador.
 */
export function ehErroDoDriverDeBanco(erro: unknown): boolean {
  for (const elo of cadeiaDeCausas(erro)) {
    if (eloEhDoDriver(elo)) return true;
  }
  return false;
}

/**
 * Descrição compacta para o log do servidor: nome, código e mensagem de cada
 * elo. Do DrizzleQueryError sai só o SQL, sem os parâmetros: eles podem
 * carregar e-mail, hash de senha ou dado pessoal de contato.
 */
export function descreverErroDeBanco(erro: unknown): string {
  const partes: string[] = [];
  for (const elo of cadeiaDeCausas(erro)) {
    const nome = typeof elo.name === "string" ? elo.name : "Error";
    const codigo = [elo.code, elo.errno].filter((v) => v !== undefined && v !== null).join("/");
    const mensagem = typeof elo.query === "string"
      ? `Failed query: ${elo.query}`
      : typeof elo.message === "string" ? elo.message : "";
    partes.push(`${nome}${codigo ? `[${codigo}]` : ""}: ${mensagem}`);
  }
  return partes.join(" <- ") || String(erro);
}
