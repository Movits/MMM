import { UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  descreverErroDeBanco,
  ehErroDeBancoIndisponivel,
  ehErroDoDriverDeBanco,
  MENSAGEM_BANCO_INDISPONIVEL,
  MENSAGEM_ERRO_DE_CONSULTA,
} from "../banco-indisponivel";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  /**
   * Última porta antes do navegador. O tRPC embrulha qualquer exceção num
   * INTERNAL_SERVER_ERROR com a mensagem crua, e a mensagem de um
   * DrizzleQueryError é o SQL inteiro, com nomes de colunas (passwordHash
   * incluído) — e em dev a `stack` também vai no `data`. Aqui a mensagem e a
   * stack de erro do driver viram uma frase neutra; o detalhe fica no log.
   *
   * Só mexe em INTERNAL_SERVER_ERROR: um FORBIDDEN ou BAD_REQUEST lançado de
   * propósito por um router passa intacto.
   */
  errorFormatter({ shape, error, path }) {
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
    // A stack sai por omissão da chave: `stack: undefined` viraria null na
    // serialização, e o que importa é a primeira linha dela, que repete o SQL.
    const { stack: _stackDoDriver, ...dados } = shape.data;
    if (ehErroDeBancoIndisponivel(error)) {
      // O middleware abaixo já traduziu e registrou; isto cobre o que passar
      // fora dele e garante que a stack do driver não vá junto.
      return { ...shape, message: MENSAGEM_BANCO_INDISPONIVEL, data: dados };
    }
    if (ehErroDoDriverDeBanco(error)) {
      console.error(`[Banco] erro de consulta em ${path ?? "?"}: ${descreverErroDeBanco(error)}`);
      return { ...shape, message: MENSAGEM_ERRO_DE_CONSULTA, data: dados };
    }
    return shape;
  },
});

export const router = t.router;

/**
 * Banco fora do ar chega aqui de dois jeitos: como BancoIndisponivel, lançada
 * por exigirDb() (server/db.ts) quando não há conexão configurada, ou como
 * erro do driver mysql2 (ECONNREFUSED, ETIMEDOUT, PROTOCOL_CONNECTION_LOST...)
 * dentro de um DrizzleQueryError, que é como a queda real do Aiven aparece em
 * produção — drizzle(url) só cria o pool, a conexão acontece na primeira
 * query. `ehErroDeBancoIndisponivel` reconhece os dois na cadeia de `cause`.
 *
 * Este middleware é o ÚNICO lugar que traduz, para todo procedimento, público
 * ou protegido, responder o mesmo código e a mesma frase em português. Antes
 * cada router decidia sozinho, e a decisão mais comum era devolver lista vazia.
 */
const traduzBancoIndisponivel = t.middleware(async ({ path, next }) => {
  const resultado = await next();
  if (!resultado.ok && ehErroDeBancoIndisponivel(resultado.error)) {
    console.error(`[Banco] indisponível em ${path}: ${descreverErroDeBanco(resultado.error.cause ?? resultado.error)}`);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: MENSAGEM_BANCO_INDISPONIVEL,
      cause: resultado.error.cause,
    });
  }
  return resultado;
});

export const publicProcedure = t.procedure.use(traduzBancoIndisponivel);

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    // A sessão pode não ter sido lida porque o banco caiu (ver createContext).
    // Responder "não autenticada" mandaria uma usuária logada para a tela de
    // login; a resposta certa é a mesma de qualquer outra queda do banco.
    if (ctx.bancoIndisponivel) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: MENSAGEM_BANCO_INDISPONIVEL });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireUser);
