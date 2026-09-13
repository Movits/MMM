import { and, eq, ne, notExists } from "drizzle-orm";
import { contactContexts, contextMedia, contextParticipants, contexts, enrichmentSuggestions, meetings } from "../drizzle/schema";
import type { getDb, UndoSnapshot } from "./db";

/**
 * Limpeza dos contextos que o fluxo antigo do chat de enriquecimento criava
 * como efeito colateral (PR #88, que fechou a issue #29 — os comentários
 * internos do código, em server/db.ts e nos testes de contextos, citam só
 * "#29" porque foi aberto como issue antes de virar PR #88).
 *
 * O bug: "como vocês se conheceram" sem contexto correspondente CRIAVA um
 * contexto novo com os 100 primeiros caracteres da resposta como nome. A
 * correção parou de criar (server/db.ts, aplicarRespostaAoContato), mas os
 * contextos já criados continuam no banco — e "Desfazer" no histórico nunca
 * os apaga (só o vínculo; ver undoEnrichmentSuggestion).
 *
 * Fonte da verdade para identificar um registro incorreto: SÓ o
 * `enrichment_suggestions.undo_snapshot` com kind "how_met" e
 * `contextoCriado: true`. Nunca o nome/texto do contexto — dois contextos
 * legítimos podem ter nomes parecidos ("Feira de Milão" / "Feira de Bolonha",
 * ver enriquecimento-aplicacao.test.ts), e a identificação por texto os
 * confundiria.
 *
 * O nome também não é lido: é a frase livre que a dona respondeu no chat e
 * pode citar terceiros ("apresentadas pela Maria da embaixada"). O relatório
 * vai para o terminal de quem roda e para qualquer log em volta dele; os ids
 * bastam para conferir no banco.
 */

// Mesmo tipo usado em toda a base para funções que recebem a conexão já aberta
// (ver aplicarRespostaAoContato, acharContextoPeloNome em server/db.ts).
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type CandidatoLimpeza = {
  contextId: string;
  ownerId: string;
  criadoEm: number;
  sugestaoId: string;
  vinculoId: string | null;
  motivo: string;
};

export type ItemRevisaoManual = {
  contextId: string;
  sugestaoId: string;
  motivo: string;
};

export type ResultadoLimpeza = {
  modo: "dry_run" | "executar";
  snapshotsAnalisados: number;
  candidatosBrutos: number;
  candidatos: CandidatoLimpeza[];
  revisaoManual: ItemRevisaoManual[];
  jaAusentes: number;
  removidos: string[];
  ignoradosNaExecucao: { contextId: string; motivo: string }[];
  erros: { contextId: string; erro: string }[];
};

/**
 * O banco em que o script vai mexer, sem usuário nem senha: `host[:porta]/banco`.
 * É o que o relatório mostra e o que `--confirmar-banco` precisa repetir.
 * null quando a URL não diz host e banco.
 */
export function alvoDoBanco(databaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const banco = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !banco) return null;
  return `${url.hostname}${url.port ? `:${url.port}` : ""}/${banco}`;
}

export type DecisaoDeModo =
  | { modo: "dry_run" | "executar"; alvo: string }
  | { recusa: string };

/**
 * A trava da execução real. Sem `--executar` é sempre dry-run. Com ele, só
 * executa se `--confirmar-banco=<alvo>` repetir exatamente o banco de
 * DATABASE_URL, como o dry-run o mostrou: quem apaga precisa ter lido para onde
 * está apontando. Não substitui a autorização do Roberto para rodar contra
 * produção (CLAUDE.md); impede o `--executar` com o .env apontado para o lugar
 * errado. A recusa acontece antes de abrir conexão.
 */
export function decidirModo(argv: string[], databaseUrl: string | undefined): DecisaoDeModo {
  if (!databaseUrl) return { recusa: "DATABASE_URL não definida." };
  const alvo = alvoDoBanco(databaseUrl);
  if (!alvo) {
    return { recusa: "DATABASE_URL não diz host e banco (esperado mysql://usuario:senha@host:porta/banco)." };
  }
  if (!argv.includes("--executar")) return { modo: "dry_run", alvo };
  const prefixo = "--confirmar-banco=";
  const confirmacao = argv.find(a => a.startsWith(prefixo))?.slice(prefixo.length);
  if (confirmacao !== alvo) {
    return { recusa: `--executar exige --confirmar-banco=${alvo} (o banco de DATABASE_URL). Nada foi lido nem apagado.` };
  }
  return { modo: "executar", alvo };
}

/**
 * Lê enrichment_suggestions (field_type = how_met) e devolve, por contextId
 * candidato, a sugestão-fonte usada para reconhecê-lo. Um mesmo contexto pode
 * ser citado por mais de uma sugestão (nova pergunta reaplicada); mantém a
 * primeira encontrada — o id do contexto é o mesmo, então não muda o
 * resultado da limpeza.
 */
function extrairCandidatosBrutos(sugestoes: { id: string; ownerId: string| null; undoSnapshot: unknown }[]) {
  const porContexto = new Map<string, { sugestaoId: string; ownerId: string; vinculoId: string | null }>();
  for (const sug of sugestoes) {if (!sug.ownerId) continue;
    const snap = sug.undoSnapshot as UndoSnapshot | null;
    if (!snap || typeof snap !== "object" || !("kind" in snap)) continue;
    if (snap.kind !== "how_met") continue;
    // Requisito 4 dos testes: contextoCriado=false nunca entra aqui.
    if (snap.contextoCriado !== true) continue;
    // Requisito: snapshot sem id não move nada sozinho.
    if (!snap.contextoId) continue;
    if (!porContexto.has(snap.contextoId)) {
      porContexto.set(snap.contextoId, { sugestaoId: sug.id, ownerId: sug.ownerId, vinculoId: snap.vinculoId ?? null });
    }
  }
  return porContexto;
}

/**
 * Investiga (sempre; não escreve nada) e, se modo = "executar", apaga o que
 * passou em todas as checagens. Devolve o mesmo relatório nos dois modos —
 * quem chama decide o que logar/mostrar.
 */
export async function limparContextosHowMet(
  db: Db,
  modo: "dry_run" | "executar",
): Promise<ResultadoLimpeza> {
  const sugestoes = await db.select({
    id: enrichmentSuggestions.id,
    ownerId: enrichmentSuggestions.ownerId,
    undoSnapshot: enrichmentSuggestions.undoSnapshot,
  }).from(enrichmentSuggestions).where(eq(enrichmentSuggestions.fieldType, "how_met"));

  const brutos = extrairCandidatosBrutos(sugestoes);

  const candidatos: CandidatoLimpeza[] = [];
  const revisaoManual: ItemRevisaoManual[] = [];
  let jaAusentes = 0;

  for (const [contextId, info] of Array.from(brutos.entries())) {
    const [ctx] = await db.select({
      id: contexts.id, ownerId: contexts.ownerId, isCustom: contexts.isCustom, createdAt: contexts.createdAt,
    }).from(contexts).where(eq(contexts.id, contextId)).limit(1);

    if (!ctx) { jaAusentes++; continue; } // já removido (manualmente ou execução anterior) — idempotente

    if (ctx.ownerId !== info.ownerId) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: "dono do contexto não corresponde ao dono da sugestão" });
      continue;
    }
    if (!ctx.isCustom) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: "contexto não é isCustom — não é o padrão do contexto criado pelo chat" });
      continue;
    }

    const vinculos = await db.select({ id: contactContexts.id })
      .from(contactContexts).where(eq(contactContexts.contextId, contextId));
    if (vinculos.length > 1) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: `contexto tem ${vinculos.length} vínculos — pode estar em uso além do que o bug criou` });
      continue;
    }
    if (vinculos.length === 1 && vinculos[0].id !== info.vinculoId) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: "o único vínculo existente não é o vínculo registrado no snapshot" });
      continue;
    }

    const participantes = await db.select({ id: contextParticipants.id })
      .from(contextParticipants).where(eq(contextParticipants.contextId, contextId));
    if (participantes.length > 0) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: `contexto tem ${participantes.length} participante(s) cadastrados` });
      continue;
    }

    const midias = await db.select({ id: contextMedia.id })
      .from(contextMedia).where(eq(contextMedia.contextId, contextId));
    if (midias.length > 0) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: `contexto tem ${midias.length} anexo(s) de mídia` });
      continue;
    }

    const reunioes = await db.select({ id: meetings.id })
      .from(meetings).where(eq(meetings.contextId, contextId));
    if (reunioes.length > 0) {
      revisaoManual.push({ contextId, sugestaoId: info.sugestaoId, motivo: `contexto está referenciado por ${reunioes.length} reunião(ões)` });
      continue;
    }

    candidatos.push({
      contextId, ownerId: info.ownerId, criadoEm: ctx.createdAt,
      sugestaoId: info.sugestaoId, vinculoId: info.vinculoId,
      motivo: "undo_snapshot how_met com contextoCriado=true; sem vínculo extra, participante, mídia ou reunião — nenhum uso além do que o bug criou",
    });
  }

  const removidos: string[] = [];
  const ignoradosNaExecucao: { contextId: string; motivo: string }[] = [];
  const erros: { contextId: string; erro: string }[] = [];

  if (modo === "executar") {
    for (const cand of candidatos) {
      try {
        // A investigação acima pode estar velha quando a exclusão chega: a dona
        // pode ter vinculado alguém, anexado uma foto ou marcado uma reunião no
        // meio. Por isso a checagem de uso é repetida DENTRO do próprio DELETE
        // (NOT EXISTS), na mesma instrução que apaga. O contexto sai primeiro
        // porque é esse DELETE que decide; o vínculo do snapshot sai depois, na
        // mesma transação: se ele falhar, o rollback devolve o contexto, e nunca
        // sobra meio caminho.
        const apagou = await db.transaction(async (tx) => {
          const [r] = await tx.delete(contexts).where(and(
            eq(contexts.id, cand.contextId), eq(contexts.ownerId, cand.ownerId), eq(contexts.isCustom, true),
            notExists(tx.select({ id: contactContexts.id }).from(contactContexts).where(and(
              eq(contactContexts.contextId, cand.contextId),
              cand.vinculoId ? ne(contactContexts.id, cand.vinculoId) : undefined,
            ))),
            notExists(tx.select({ id: contextParticipants.id }).from(contextParticipants)
              .where(eq(contextParticipants.contextId, cand.contextId))),
            notExists(tx.select({ id: contextMedia.id }).from(contextMedia)
              .where(eq(contextMedia.contextId, cand.contextId))),
            notExists(tx.select({ id: meetings.id }).from(meetings)
              .where(eq(meetings.contextId, cand.contextId))),
          ));
          if (!(((r as any)?.affectedRows ?? 0) > 0)) return false;
          if (cand.vinculoId) {
            await tx.delete(contactContexts).where(and(
              eq(contactContexts.id, cand.vinculoId), eq(contactContexts.contextId, cand.contextId),
            ));
          }
          return true;
        });
        if (apagou) {
          removidos.push(cand.contextId);
        } else {
          // Sumiu (outra execução, remoção manual) ou passou a ter uso entre a
          // investigação e a exclusão. Não é erro, e nada foi tocado.
          ignoradosNaExecucao.push({ contextId: cand.contextId, motivo: "não apagado: sumiu ou passou a ter uso (vínculo, participante, mídia ou reunião) depois da investigação" });
        }
      } catch (e) {
        erros.push({ contextId: cand.contextId, erro: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return {
    modo,
    snapshotsAnalisados: sugestoes.length,
    candidatosBrutos: brutos.size,
    candidatos,
    revisaoManual,
    jaAusentes,
    removidos,
    ignoradosNaExecucao,
    erros,
  };
}
