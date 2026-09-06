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
    // Exceção deliberada ao exigirDb(): esta consulta alimenta a página inicial,
    // pública. Banco fora do ar vira zeros com erro no log, em vez de derrubar a
    // home para quem nem entrou. Todo o resto do servidor lança BancoIndisponivel.
    const db = await getDb();
    if (!db) {
      console.error("[Stats] Banco de dados indisponível; a página inicial mostra zeros.");
      return empty;
    }

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

  // Presença agregada POR PAÍS — nunca por pessoa: só a sigla ISO e a
  // contagem saem daqui. É o que o globo da home desenha no lugar das praças
  // inventadas do protótipo (PR #52). "XX" é o "outro país" do Onboarding e
  // não tem lugar no mapa. Mesma exceção deliberada ao exigirDb() do
  // platform acima: a home é pública e degrada para vazio com erro no log —
  // sem praças o planeta continua inteiro.
  presencaPorPais: publicProcedure.query(async (): Promise<Array<{ pais: string; total: number }>> => {
    const db = await getDb();
    if (!db) {
      console.error("[Stats] Banco de dados indisponível; o globo da home fica sem praças.");
      return [];
    }
    try {
      const linhas = await db
        .select({ pais: users.country, total: sql`COUNT(*)` })
        .from(users)
        .where(sql`${users.country} IS NOT NULL AND ${users.country} <> '' AND ${users.country} <> 'XX'`)
        .groupBy(users.country);
      return linhas
        .map(l => ({ pais: String(l.pais).toUpperCase(), total: Number(l.total) }))
        .sort((a, b) => b.total - a.total);
    } catch (error) {
      console.warn("[Stats] Falha ao apurar presença por país:", error);
      return [];
    }
  }),
});
