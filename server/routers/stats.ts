import { eq, sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, opportunities, connections } from "../../drizzle/schema";

// ============================================================
// ESTATÍSTICAS PÚBLICAS DA PLATAFORMA
// Números reais exibidos na página inicial — nunca valores fictícios.
// ============================================================
export const statsRouter = router({
  platform: publicProcedure.query(async () => {
    const empty = { users: 0, opportunities: 0, connections: 0, countries: 0, bronze: 0, silver: 0, gold: 0 };
    const db = await getDb();
    if (!db) return empty;

    try {
      const count = async (query: Promise<Array<{ n: unknown }>>) =>
        Number((await query)[0]?.n ?? 0);

      const [totalUsers, activeOpps, acceptedConns, countries, bronze, silver, gold] = await Promise.all([
        count(db.select({ n: sql`COUNT(*)` }).from(users)),
        count(db.select({ n: sql`COUNT(*)` }).from(opportunities).where(eq(opportunities.status, "active"))),
        count(db.select({ n: sql`COUNT(*)` }).from(connections).where(eq(connections.status, "accepted"))),
        count(db.select({ n: sql`COUNT(DISTINCT ${users.country})` }).from(users).where(sql`${users.country} IS NOT NULL AND ${users.country} <> ''`)),
        count(db.select({ n: sql`COUNT(*)` }).from(users).where(eq(users.role, "bronze"))),
        count(db.select({ n: sql`COUNT(*)` }).from(users).where(eq(users.role, "silver"))),
        // Ouro inclui os papéis herdados president/admin, que compartilham o mesmo nível de acesso.
        count(db.select({ n: sql`COUNT(*)` }).from(users).where(sql`${users.role} IN ('gold','president','admin')`)),
      ]);

      return { users: totalUsers, opportunities: activeOpps, connections: acceptedConns, countries, bronze, silver, gold };
    } catch (error) {
      console.warn("[Stats] Falha ao apurar estatísticas públicas:", error);
      return empty;
    }
  }),
});
