import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A cadeia de migrações de drizzle/ precisa ser uma fila única: journal com
 * idx 0..n-1, um .sql e um snapshot por entrada, e cada snapshot apontando
 * (prevId) para o anterior.
 *
 * Por que isto é teste e não confiança no `pnpm db:generate` do CI: duas
 * branches que geram a "próxima" migração a partir da mesma main (a #121 com
 * 0012_metas-do-perfil e a #133 com 0012_cadastro-empresarial-sem-limite, as
 * duas com prevId na 0011) conflitam no merge. Resolver o conflito à mão,
 * mantendo as duas, deixa dois snapshots com o mesmo pai, e o drizzle-kit
 * nesse caso imprime "collision" e sai com código 0 SEM criar arquivo
 * (node_modules/drizzle-kit/bin.cjs, `if (abort) process.exit(0)`). O passo
 * "Schema e migrações concordam" do CI só olha se apareceu arquivo, então
 * passaria; o banco do zero aplicaria as duas e também passaria. O defeito só
 * apareceria para a próxima pessoa que tentasse gerar migração. O certo é a que
 * entrar por último refazer a base na main e regenerar com `pnpm db:generate`.
 */

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

type Entrada = { idx: number; tag: string; when: number };
type Snapshot = { id: string; prevId: string };

function lerJson<T>(caminho: string): T {
  return JSON.parse(readFileSync(caminho, "utf8").replace(/^﻿/, "")) as T;
}

/** Lista os defeitos da cadeia de migrações da pasta (vazio = cadeia íntegra). */
function defeitosDaCadeia(pasta: string): string[] {
  const defeitos: string[] = [];
  const meta = join(pasta, "meta");
  const { entries } = lerJson<{ entries: Entrada[] }>(join(meta, "_journal.json"));
  const num = (n: number) => String(n).padStart(4, "0");

  entries.forEach((e, i) => {
    if (e.idx !== i) defeitos.push(`journal: a entrada ${i} (${e.tag}) tem idx ${e.idx}; esperado ${i}`);
    if (!e.tag.startsWith(`${num(i)}_`)) defeitos.push(`journal: a entrada ${i} tem tag ${e.tag}; esperado prefixo ${num(i)}_`);
    if (i > 0 && !(e.when > entries[i - 1].when)) {
      defeitos.push(`journal: ${e.tag} tem "when" ${e.when}, que não é posterior ao de ${entries[i - 1].tag}`);
    }
  });

  const prefixos = new Map<string, string[]>();
  for (const e of entries) {
    const p = e.tag.slice(0, 4);
    prefixos.set(p, [...(prefixos.get(p) ?? []), e.tag]);
  }
  for (const [p, tags] of prefixos) {
    if (tags.length > 1) defeitos.push(`journal: duas migrações com o número ${p}: ${tags.join(", ")}`);
  }

  const tags = new Set(entries.map(e => e.tag));
  const sqls = readdirSync(pasta).filter(f => f.endsWith(".sql")).map(f => f.slice(0, -4));
  for (const t of tags) if (!sqls.includes(t)) defeitos.push(`${t}.sql não existe em drizzle/`);
  for (const s of sqls) if (!tags.has(s)) defeitos.push(`${s}.sql não consta do journal`);

  const esperados = entries.map(e => `${num(e.idx)}_snapshot.json`);
  const arquivos = readdirSync(meta).filter(f => f.endsWith("_snapshot.json"));
  for (const f of arquivos) if (!esperados.includes(f)) defeitos.push(`meta/${f} não corresponde a nenhuma entrada do journal`);

  const snapshots: Array<Snapshot & { arquivo: string }> = [];
  for (const f of esperados) {
    if (!arquivos.includes(f)) {
      defeitos.push(`meta/${f} não existe`);
      continue;
    }
    snapshots.push({ ...lerJson<Snapshot>(join(meta, f)), arquivo: f });
  }

  const filhosDe = new Map<string, string[]>();
  for (const s of snapshots) filhosDe.set(s.prevId, [...(filhosDe.get(s.prevId) ?? []), s.arquivo]);
  for (const [pai, filhos] of filhosDe) {
    if (filhos.length > 1) defeitos.push(`snapshots ${filhos.join(", ")} apontam para o mesmo pai ${pai} (colisão)`);
  }
  snapshots.forEach((s, i) => {
    const pai = i === 0 ? UUID_ZERO : snapshots[i - 1].id;
    if (s.prevId !== pai) defeitos.push(`meta/${s.arquivo} tem prevId ${s.prevId}; esperado ${pai}`);
  });

  return defeitos;
}

const DRIZZLE = join(__dirname, "..", "drizzle");

describe("cadeia de migrações de drizzle/", () => {
  it("é uma fila única: idx em ordem, um .sql e um snapshot por entrada, prevId encadeado", () => {
    expect(defeitosDaCadeia(DRIZZLE)).toEqual([]);
  });
});

describe("defeitosDaCadeia reconhece o merge à mão de duas migrações irmãs", () => {
  let pasta: string;

  // Cadeia mínima: 0000 -> 0001 -> 0002, com ids e datas em ordem.
  function montar(entradas: Array<Entrada & { id: string; prevId: string; arquivo?: string }>) {
    pasta = mkdtempSync(join(tmpdir(), "cadeia-"));
    mkdirSync(join(pasta, "meta"));
    writeFileSync(
      join(pasta, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "mysql", entries: entradas.map(({ idx, tag, when }) => ({ idx, version: "5", when, tag, breakpoints: true })) }),
    );
    for (const e of entradas) {
      writeFileSync(join(pasta, `${e.tag}.sql`), "SELECT 1;");
      writeFileSync(join(pasta, "meta", e.arquivo ?? `${String(e.idx).padStart(4, "0")}_snapshot.json`), JSON.stringify({ id: e.id, prevId: e.prevId }));
    }
  }

  afterEach(() => {
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  const base = [
    { idx: 0, tag: "0000_fundacao", when: 1, id: "a", prevId: UUID_ZERO },
    { idx: 1, tag: "0001_um", when: 2, id: "b", prevId: "a" },
  ];

  it("cadeia íntegra não tem defeito", () => {
    montar([...base, { idx: 2, tag: "0002_metas", when: 3, id: "c", prevId: "b" }]);
    expect(defeitosDaCadeia(pasta)).toEqual([]);
  });

  it("duas 0002 no journal (conflito resolvido mantendo as duas) é defeito", () => {
    montar([
      ...base,
      { idx: 2, tag: "0002_metas", when: 3, id: "c", prevId: "b" },
      { idx: 2, tag: "0002_cadastro", when: 4, id: "d", prevId: "b", arquivo: "0002b_snapshot.json" },
    ]);
    const defeitos = defeitosDaCadeia(pasta).join("\n");
    expect(defeitos).toContain("duas migrações com o número 0002");
    expect(defeitos).toContain("colisão");
  });

  it("renumerar a irmã para 0003 sem regenerar deixa o prevId na 0001: colisão que o drizzle-kit não reprova", () => {
    montar([
      ...base,
      { idx: 2, tag: "0002_metas", when: 3, id: "c", prevId: "b" },
      { idx: 3, tag: "0003_cadastro", when: 4, id: "d", prevId: "b" },
    ]);
    expect(defeitosDaCadeia(pasta)).toEqual([
      "snapshots 0002_snapshot.json, 0003_snapshot.json apontam para o mesmo pai b (colisão)",
      "meta/0003_snapshot.json tem prevId b; esperado c",
    ]);
  });

  it("migração da main que fica depois de outra mais nova (\"when\" fora de ordem) é defeito", () => {
    montar([
      ...base,
      { idx: 2, tag: "0002_metas", when: 9, id: "c", prevId: "b" },
      { idx: 3, tag: "0003_cadastro", when: 5, id: "d", prevId: "c" },
    ]);
    expect(defeitosDaCadeia(pasta)).toEqual([
      'journal: 0003_cadastro tem "when" 5, que não é posterior ao de 0002_metas',
    ]);
  });

  it("snapshot ou .sql sem entrada no journal é defeito", () => {
    montar([...base]);
    writeFileSync(join(pasta, "0002_orfa.sql"), "SELECT 1;");
    writeFileSync(join(pasta, "meta", "0002_snapshot.json"), JSON.stringify({ id: "c", prevId: "b" }));
    expect(defeitosDaCadeia(pasta)).toEqual([
      "0002_orfa.sql não consta do journal",
      "meta/0002_snapshot.json não corresponde a nenhuma entrada do journal",
    ]);
  });
});
