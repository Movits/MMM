import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { BancoIndisponivel } from "../banco-indisponivel";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * A sessão não pôde ser lida porque o banco caiu, e não porque não há
   * sessão. Quem consome é o protectedProcedure (server/_core/trpc.ts), que
   * então responde "banco indisponível" em vez de "não autenticada".
   */
  bancoIndisponivel?: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let bancoIndisponivel = false;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
    // Banco fora do ar não é "sem sessão". Não se relança daqui de propósito:
    // os procedimentos públicos (estatísticas da página inicial, login)
    // precisam continuar respondendo; o contexto só anota o motivo.
    if (error instanceof BancoIndisponivel) {
      bancoIndisponivel = true;
      console.error("[Auth] Banco de dados indisponível ao ler a sessão.");
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    bancoIndisponivel,
  };
}
