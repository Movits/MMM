import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { publicProcedure, router } from "./trpc";

export const systemRouter = router({
  // Exceção deliberada ao exigirDb(): o health check existe para DIZER se o
  // banco está de pé, então banco fora do ar responde ok:false com erro no log,
  // em vez de lançar BancoIndisponivel e esconder a informação que a checagem
  // existe para dar. Todo o resto do servidor lança.
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(async () => {
      const db = await getDb();
      if (!db) {
        console.error("[System] Banco de dados indisponível no health check (sem conexão configurada).");
        return { ok: false };
      }
      try {
        await db.execute(sql`SELECT 1`);
        return { ok: true };
      } catch (error) {
        console.error("[System] Banco de dados indisponível no health check:", error);
        return { ok: false };
      }
    }),
});
