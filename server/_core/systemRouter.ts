import { sql } from "drizzle-orm";
import { z } from "zod";
import { descreverErroDeBanco } from "../banco-indisponivel";
import { getDb } from "../db";
import { publicProcedure, router } from "./trpc";

// O Render injeta RENDER_GIT_COMMIT no ambiente do serviço. Expor o SHA curto
// no health check dá ao exame de produção a resposta para "o deploy já saiu?"
// em um comando, em vez de comparar hashes de bundle. Fora do Render vem null.
export function commitNoAr(): string | null {
  const sha = (process.env.RENDER_GIT_COMMIT || "").trim();
  return sha ? sha.slice(0, 7) : null;
}

export const systemRouter = router({
  // Exceção deliberada ao exigirDb(): o health check existe para DIZER se o
  // banco está de pé, então banco fora do ar responde ok:false com erro no log,
  // em vez de lançar BancoIndisponivel e esconder a informação que a checagem
  // existe para dar. Todo o resto do servidor lança.
  //
  // Além do { ok: false }, a resposta sai com HTTP 503: é o que um monitor
  // externo (Render, UptimeRobot) lê sem abrir o corpo. O adaptador do tRPC só
  // sobrescreve o status quando ele ainda é 200 (writeResponse), então o 503
  // definido aqui sobrevive.
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) {
        console.error("[System] Banco de dados indisponível no health check (sem conexão configurada).");
        ctx.res.status(503);
        return { ok: false };
      }
      try {
        await db.execute(sql`SELECT 1`);
        return { ok: true, commit: commitNoAr() };
      } catch (error) {
        console.error(`[System] Banco de dados indisponível no health check: ${descreverErroDeBanco(error)}`);
        ctx.res.status(503);
        return { ok: false };
      }
    }),
});
