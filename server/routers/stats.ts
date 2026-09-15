import { eq, sql } from "drizzle-orm";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { exigirDb, getDb } from "../db";
import { users, opportunities, connections } from "../../drizzle/schema";

export type MembrosPorNivel = { bronze: number; silver: number; gold: number };

/**
 * Soma as linhas de `COUNT(*) ... GROUP BY role` nos três níveis que a rede
 * mostra. Ouro inclui presidente e admin: é a regra "Ouro = Presidente =
 * administradora" (CLAUDE.md), e o Painel Ouro é o mesmo para as três.
 * Papel desconhecido não entra em nível nenhum.
 */
export function somarMembrosPorNivel(linhas: Array<{ role: unknown; total: unknown }>): MembrosPorNivel {
  const niveis: MembrosPorNivel = { bronze: 0, silver: 0, gold: 0 };
  for (const { role, total } of linhas) {
    const n = Number(total) || 0;
    if (role === "bronze") niveis.bronze += n;
    else if (role === "silver") niveis.silver += n;
    else if (role === "gold" || role === "president" || role === "admin") niveis.gold += n;
  }
  return niveis;
}

// ============================================================
// ESTATÍSTICAS PÚBLICAS DA PLATAFORMA
// Números reais exibidos na página inicial — nunca valores fictícios.
// ============================================================
/**
 * Só países de verdade entram nas contagens públicas.
 *
 * "XX" é a opção "outro país" do Onboarding (quem não achou o próprio país na
 * lista) — é a ausência de país, não um país. O globo já o excluía desde a #52;
 * o contador da home não, e somava +1 ao número de países assim que a primeira
 * pessoa marcasse "outro". As duas consultas passam a usar este mesmo predicado
 * para não voltarem a divergir.
 *
 * É função, e não constante, para cada consulta receber o seu próprio
 * fragmento em vez de compartilhar o mesmo objeto.
 */
const paisDeVerdade = () =>
  sql`${users.country} IS NOT NULL AND ${users.country} <> '' AND ${users.country} <> 'XX'`;

export const statsRouter = router({
  platform: publicProcedure.query(async () => {
    // As contagens Bronze/Prata/Ouro saíram daqui (Governança, 14/09/2026): a
    // Home deixou de mostrá-las e elas moram em `membrosPorNivel`, só para quem
    // está logada. Esta consulta é pública; o que ela não devolve, ninguém de
    // fora lê pela API.
    const empty = { users: 0, opportunities: 0, connections: 0, countries: 0 };
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

      const [totalUsers, activeOpps, acceptedConns, countries] = await Promise.all([
        count(db.select({ n: sql`COUNT(*)` }).from(users)),
        count(db.select({ n: sql`COUNT(*)` }).from(opportunities).where(eq(opportunities.status, "active"))),
        count(db.select({ n: sql`COUNT(*)` }).from(connections).where(eq(connections.status, "accepted"))),
        count(db.select({ n: sql`COUNT(DISTINCT ${users.country})` }).from(users).where(paisDeVerdade())),
      ]);

      return { users: totalUsers, opportunities: activeOpps, connections: acceptedConns, countries };
    } catch (error) {
      console.warn("[Stats] Falha ao apurar estatísticas públicas:", error);
      return empty;
    }
  }),

  // Membros Bronze, Prata e Ouro: Governança, itens 1 e 12 da spec de 14/09.
  // Os números saíram da Home e só aparecem no Dashboard, então a consulta é
  // de quem está logada (protectedProcedure), não pública. Só contagens por
  // nível saem daqui, nenhuma coluna de pessoa. Diferente de `platform`, não
  // degrada para zeros: banco fora do ar é erro, e o Dashboard mostra o traço.
  membrosPorNivel: protectedProcedure.query(async (): Promise<MembrosPorNivel> => {
    const db = await exigirDb();
    const linhas = await db
      .select({ role: users.role, total: sql`COUNT(*)` })
      .from(users)
      .groupBy(users.role);
    return somarMembrosPorNivel(linhas);
  }),

  // Presença agregada POR PAÍS — nunca por pessoa: só a sigla ISO e a
  // contagem saem daqui. É o que o globo da home desenha no lugar das praças
  // inventadas do protótipo (PR #52). Mesmo recorte de paisDeVerdade() do
  // contador acima, para o mapa e o número nunca contarem coisas diferentes.
  // Mesma exceção deliberada ao exigirDb() do platform acima: a home é pública
  // e degrada para vazio com erro no log — sem praças o planeta continua inteiro.
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
        .where(paisDeVerdade())
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
