import { UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { BancoIndisponivel, MENSAGEM_BANCO_INDISPONIVEL } from "../banco-indisponivel";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

/**
 * Banco fora do ar chega aqui como BancoIndisponivel, lançada por exigirDb()
 * (server/db.ts) de dentro de qualquer helper, serviço ou router. O tRPC
 * embrulharia a exceção num INTERNAL_SERVER_ERROR com a mensagem crua; este
 * middleware é o ÚNICO lugar que a traduz, para todo procedimento, público
 * ou protegido, responder o mesmo código e a mesma frase em português. Antes
 * cada router decidia sozinho, e a decisão mais comum era devolver lista vazia.
 */
const traduzBancoIndisponivel = t.middleware(async ({ path, next }) => {
  const resultado = await next();
  if (!resultado.ok && resultado.error.cause instanceof BancoIndisponivel) {
    console.error(`[Banco] indisponível em ${path}`);
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
