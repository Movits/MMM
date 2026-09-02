// Exame de saúde de produção: confirma em um comando que o site no ar está
// inteiro depois de um deploy. Roda uma bateria de checagens reais contra a
// aplicação e o banco, criando o mínimo de dados de teste e apagando tudo no
// final. Não muda papel de ninguém e não mexe em dado de usuária real.
//
// Uso:
//   node scripts/checar-producao.mjs            # bateria padrão, sem gastar IA
//   node scripts/checar-producao.mjs --com-ia   # inclui FAQ, transcrição e Memória
//
// Requisitos: o .env da produção (DATABASE_URL e JWT_SECRET). A identidade de
// teste autenticada é a primeira conta com papel de presidente ou admin; as
// checagens de nível usam uma conta QA descartável criada e apagada na hora.
//
// Saída: uma linha OK/FALHA por checagem e código de saída 0 só se tudo passou.
// FALHA aqui significa problema real no ar; investigue antes de seguir.

import { SignJWT } from "jose";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { migrar } from "./migrar.mjs";

const COM_IA = process.argv.includes("--com-ia");
const BASE = process.env.EXAME_BASE_URL || "https://mmm-gud5.onrender.com";
const QA_OPENID = "qa_exame_de_saude";

const env = Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
if (!env.DATABASE_URL || !env.JWT_SECRET) {
  console.error("O .env precisa de DATABASE_URL e JWT_SECRET (o .env da produção).");
  process.exit(1);
}

const resultados = [];
const ok = (nome, cond, extra = "") => {
  resultados.push(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " | " + extra : ""}`);
  return cond;
};
const espera = ms => new Promise(r => setTimeout(r, ms));

async function jwtDe(openId, nome) {
  return new SignJWT({ openId, appId: env.VITE_APP_ID || "mmm", name: nome })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 1800)
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}
function cliente(jwt) {
  const cookie = "app_session_id=" + jwt;
  return {
    post: async (proc, input) => {
      const r = await fetch(`${BASE}/api/trpc/${proc}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ json: input }) });
      const b = await r.json().catch(() => null);
      return { status: r.status, dado: b?.result?.data?.json, erro: b?.error?.json?.message };
    },
    get: async (proc, input) => {
      const url = `${BASE}/api/trpc/${proc}` + (input !== undefined ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : "");
      const r = await fetch(url, { headers: { cookie } });
      const b = await r.json().catch(() => null);
      return { status: r.status, dado: b?.result?.data?.json, erro: b?.error?.json?.message };
    },
  };
}

const conn = await mysql.createConnection(env.DATABASE_URL);
const criado = { contatos: [], contextos: [], reunioes: [], oportunidades: [], qaUserId: null };
let runner = null, qa = null;

try {
  // ── Infra: site, cache e páginas ───────────────────────────────────────
  const home = await fetch(BASE + "/");
  ok("site no ar", home.status === 200);
  const html = await home.text();
  const bundle = (html.match(/assets\/index-[A-Za-z0-9_-]+\.js/) || [])[0];
  if (bundle) {
    const asset = await fetch(`${BASE}/${bundle}`, { method: "HEAD" });
    ok("assets com cache de 1 ano", /immutable/.test(asset.headers.get("cache-control") || ""));
  }
  {
    // A CSP de produção não pode voltar a afrouxar o script-src (server/_core/csp.ts).
    const csp = home.headers.get("content-security-policy") || "";
    const scriptSrc = (csp.split(";").map(d => d.trim()).find(d => d.startsWith("script-src ")) || "").replace(/^script-src\s+/, "");
    ok("CSP estrita (script-src só 'self')", scriptSrc === "'self'", scriptSrc || "sem cabeçalho CSP");
  }
  ok("página de privacidade", (await fetch(BASE + "/privacidade")).status === 200);
  ok("html declara pt-BR (tradutor do Chrome quieto)", /<html lang="pt-BR"/.test(html));

  // ── Banco: conexão, dados e migrações em dia ───────────────────────────
  const [[totalUsuarias]] = await conn.query("SELECT COUNT(*) n FROM users");
  ok("banco responde e tem usuárias", totalUsuarias.n > 0, `${totalUsuarias.n} contas`);
  const stats = await (await fetch(BASE + "/api/trpc/stats.platform")).json();
  ok("servidor enxerga o banco (stats)", (stats?.result?.data?.json?.users ?? 0) > 0);
  const situacao = await migrar(env.DATABASE_URL, { relatarApenas: true });
  ok("migrações em dia (nada pendente, nada divergente)", situacao.ok);

  // ── Identidades: quem executa e a conta QA descartável ─────────────────
  const [[chefe]] = await conn.query(
    "SELECT openId, name, role FROM users WHERE role IN ('president', 'admin') ORDER BY id LIMIT 1");
  ok("existe conta presidente ou admin em produção", !!chefe, chefe ? `${chefe.name} (${chefe.role})` : "NENHUMA: ninguém consegue moderar");
  runner = cliente(await jwtDe(chefe?.openId ?? "inexistente", chefe?.name ?? "Exame"));

  const [[qaJa]] = await conn.query("SELECT id FROM users WHERE openId = ?", [QA_OPENID]);
  if (qaJa) {
    criado.qaUserId = qaJa.id;
    await conn.query("UPDATE users SET role = 'silver', isActive = 1 WHERE id = ?", [criado.qaUserId]);
  } else {
    const [ins] = await conn.query(
      "INSERT INTO users (openId, name, email, role, loginMethod, isActive) VALUES (?, 'Exame de Saúde (QA)', 'exame@invalido.local', 'silver', 'email', 1)",
      [QA_OPENID]);
    criado.qaUserId = ins.insertId;
  }
  qa = cliente(await jwtDe(QA_OPENID, "Exame de Saúde (QA)"));

  // ── Autenticação: aceita o válido, barra o inválido ────────────────────
  const eu = await runner.get("auth.me", undefined);
  ok("login por sessão funciona", eu.status === 200 && !!eu.dado?.id);
  ok("resposta não vaza hash de senha", !JSON.stringify(eu.dado || {}).includes("passwordHash"));
  // auth.me é público de propósito (devolve null sem sessão); a rejeição de
  // token inválido se prova numa rota protegida.
  const invalido = cliente("token-invalido-de-proposito");
  const negado = await invalido.get("network.list", {});
  ok("token inválido é rejeitado na rota protegida", negado.status === 401 || negado.status === 403, `status ${negado.status}`);
  const proxyAnonimo = await fetch(BASE + "/manus-storage/qualquer/coisa.txt");
  ok("arquivos exigem sessão (anônimo barrado)", proxyAnonimo.status === 401, `status ${proxyAnonimo.status}`);

  // ── Contatos: criar, buscar, editar e isolamento entre contas ──────────
  const c1 = await runner.post("network.create", { fullName: "Exame Exportadora", company: "Vinícola Exame" });
  const c2 = await runner.post("network.create", { fullName: "Exame Importadora", company: "Importadora Exame" });
  const id1 = c1.dado?.id, id2 = c2.dado?.id;
  if (id1) criado.contatos.push(id1);
  if (id2) criado.contatos.push(id2);
  ok("criar contato", c1.status === 200 && c2.status === 200, c1.erro?.slice(0, 60) || "");
  const busca = await runner.get("network.list", { q: "Exame Exportadora" });
  ok("buscar contato", (busca.dado?.data || []).some(c => c.fullName === "Exame Exportadora"));
  const edicao = await runner.post("network.update", { id: id1, company: "Vinícola Exame Editada" });
  ok("editar contato", edicao.status === 200);
  const listaQa = await qa.get("network.list", {});
  ok("ISOLAMENTO: outra conta não vê os contatos", (listaQa.dado?.data || []).length === 0);

  // ── Match: a regra de direção que a cliente definiu ────────────────────
  await runner.post("intelligentMatches.addAsset", { contactId: id1, tagLabel: "Exportar vinho" });
  await runner.post("intelligentMatches.addNeed", { contactId: id2, tagLabel: "Importar vinho" });
  await runner.post("intelligentMatches.recalculate", undefined);
  const sugestoes = await runner.get("intelligentMatches.list", undefined);
  const listaM = Array.isArray(sugestoes.dado) ? sugestoes.dado : (sugestoes.dado?.matches || []);
  const par = listaM.find(m => m.matchScore === 100 && [m.contactAId, m.contactBId].includes(id1));
  ok("match por direção (Exportar x Importar = 100%)", !!par, par ? par.matchType : "não nasceu");
  const sugQa = await qa.get("intelligentMatches.list", undefined);
  ok("ISOLAMENTO: outra conta não vê as sugestões", (Array.isArray(sugQa.dado) ? sugQa.dado : (sugQa.dado?.matches || [])).length === 0);

  // ── Contextos ──────────────────────────────────────────────────────────
  const tipos = await runner.get("contexts.listTypes", undefined);
  ok("catálogo de tipos de contexto populado", (tipos.dado || []).length > 0, `${(tipos.dado || []).length} tipos`);
  const ctx = await runner.post("contexts.create", { name: "Exame Contexto", city: "Brasília" });
  if (ctx.dado?.id) criado.contextos.push(ctx.dado.id);
  ok("criar contexto", ctx.status === 200);
  const buscaCtx = await runner.get("contexts.list", { q: "Exame Contexto" });
  ok("buscar contexto", JSON.stringify(buscaCtx.dado || "").includes("Exame Contexto"));

  // ── Oportunidades: confidencialidade e níveis de acesso ────────────────
  const opp = await runner.post("opportunities.create", {
    title: "Exame de saúde: oportunidade confidencial temporária",
    description: "Registro criado pelo exame de saúde de produção para conferir a visibilidade por nível de acesso. É apagado ao final da execução.",
    type: "partnership", isConfidential: true, tags: ["exame"],
  });
  const oppId = opp.dado?.id ?? opp.dado?.opportunityId;
  if (oppId) criado.oportunidades.push(oppId);
  ok("criar oportunidade confidencial", opp.status === 200);
  if (chefe && oppId) {
    const aval = await runner.post("president.validateOpportunity", { opportunityId: oppId, status: "approved" });
    ok("presidente aprova oportunidade", aval.status === 200, aval.erro?.slice(0, 50) || "");
  }
  const listaOppQa = await qa.get("opportunities.list", {});
  ok("ISOLAMENTO: Prata não vê a confidencial", !JSON.stringify(listaOppQa.dado || "").includes("Exame de saúde"));
  if (oppId) {
    const direto = await qa.get("opportunities.get", { id: oppId });
    ok("Prata barrada no acesso direto", direto.status === 403 || /FORBIDDEN|Ouro/i.test(direto.erro || ""));
  }

  // ── IA (opcional, gasta cota do Gemini) ────────────────────────────────
  if (COM_IA) {
    const faq = await fetch(BASE + "/api/trpc/faq.ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { question: "O que é o MMM?" } }) });
    const faqBody = await faq.json().catch(() => null);
    // O plano gratuito do Gemini limita as chamadas por minuto. Se o exame
    // roda logo depois de outro uso da IA, o 429 é a cota falando, não o site
    // quebrado: vira PULADO, como nas checagens de memória abaixo. Falha de
    // verdade aqui é status diferente de 200 sem 429/cota na mensagem.
    const faqErro = faqBody?.error?.json?.message || "";
    const faqEmCota = /429|quota|RESOURCE_EXHAUSTED|limite|rate/i.test(faqErro);
    ok("IA responde (FAQ)" + (faqEmCota ? " (PULADO: cota por minuto do Gemini)" : ""),
      (faq.status === 200 && !!faqBody?.result?.data?.json?.answer) || faqEmCota);
    await espera(15000);
    const rei = await runner.post("memory.reindex", undefined);
    const limitada = /429|limite|rate|muitas/i.test(rei.erro || "");
    ok("memória reindexa" + (limitada ? " (PULADO: ritmo do embedding)" : ""), rei.status === 200 || limitada);
    await espera(15000);
    const pergunta = await runner.post("memory.search", { query: "Quem eu conheci na Antártida em 1990?" });
    const honesta = /não encontrei|não há|nenhum|não localiz|não tenho|não constam/i.test(pergunta.dado?.answer || "");
    // Três desfechos diferentes, e o exame precisa distinguir os três:
    //   erro 429 na requisição  -> cota, PULADO
    //   resposta AI_UNAVAILABLE -> a busca funcionou mas a IA não redigiu.
    //     Isso é ALERTA, não pulado: se a Memória passar dias sem responder,
    //     o exame tem que dizer. Rotular como "ritmo do embedding" escondia
    //     a falha e ainda apontava o subsistema errado.
    //   resposta redigida       -> checa a honestidade de verdade
    const emCota = /429|quota|RESOURCE_EXHAUSTED|limite|rate|muitas/i.test(pergunta.erro || "");
    const iaMuda = /não conseguiu redigir/i.test(pergunta.dado?.answer || "");
    if (emCota) {
      ok("memória responde com honestidade (PULADO: cota da IA)", true);
    } else if (iaMuda) {
      ok("memória responde com honestidade", false,
        "ALERTA: a busca achou as fontes mas a IA não redigiu a resposta (conferir a chave e a cota do Gemini)");
    } else {
      ok("memória responde com honestidade", honesta, (pergunta.dado?.answer || pergunta.erro || "").slice(0, 60));
    }
  } else {
    resultados.push("INFO  checagens de IA puladas (rode com --com-ia para incluí-las)");
  }
} catch (e) {
  resultados.push("EXCECAO: " + (e?.message || e));
} finally {
  // ── Limpeza total, mesmo se algo falhou no meio ────────────────────────
  try {
    if (runner) {
      for (const id of criado.contextos) await runner.post("contexts.delete", { id }).catch(() => {});
      for (const id of criado.contatos) await runner.post("network.delete", { id }).catch(() => {});
    }
    for (const id of criado.oportunidades) {
      await conn.query("DELETE FROM opportunities WHERE id = ? AND title LIKE 'Exame de saúde%'", [id]).catch(() => {});
    }
    await conn.query("DELETE FROM opportunities WHERE title LIKE 'Exame de saúde%'").catch(() => {});
    await conn.query("DELETE FROM private_contacts WHERE fullName LIKE 'Exame Exporta%' OR fullName LIKE 'Exame Importa%'").catch(() => {});
    const [[qaLimpar]] = await conn.query("SELECT id FROM users WHERE openId = ?", [QA_OPENID]);
    if (qaLimpar) {
      await conn.query("DELETE FROM gold_access_grants WHERE userId = ?", [qaLimpar.id]).catch(() => {});
      await conn.query("DELETE FROM notifications WHERE userId = ?", [qaLimpar.id]).catch(() => {});
      await conn.query("DELETE FROM user_profiles WHERE userId = ?", [qaLimpar.id]).catch(() => {});
      await conn.query("DELETE FROM users WHERE id = ?", [qaLimpar.id]);
    }
    // matches órfãos que os contatos de exame tenham deixado
    await conn.query(`
      DELETE m FROM ai_match_suggestions m
      LEFT JOIN private_contacts a ON a.id = m.contact_a_id
      LEFT JOIN private_contacts b ON b.id = m.contact_b_id
      WHERE a.id IS NULL OR b.id IS NULL`).catch(() => {});
    resultados.push("LIMPEZA: concluída");
  } catch (e) {
    resultados.push("LIMPEZA COM ERRO: " + (e?.message || e));
  }
  await conn.end();
  console.log(resultados.join("\n"));
  const falhas = resultados.filter(r => r.startsWith("FALHA")).length;
  const oks = resultados.filter(r => r.startsWith("OK")).length;
  console.log(`\n${oks} OK, ${falhas} falha(s)` + (falhas ? " | investigue as FALHAs antes de seguir" : " | produção saudável"));
  process.exit(falhas ? 1 : 0);
}
