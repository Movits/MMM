#!/usr/bin/env node
// Carimbo de conferência do MMM.
//
// Regra do time (CLAUDE.md, "Fluxo de trabalho"): antes de iniciar uma tarefa e
// antes de commit/push, conferir GitHub, o quadro do Notion e o grupo do time,
// e provar que o código faz o que o commit diz. Este script transforma a regra
// em trava: sem um carimbo recente, o Claude Code recusa `git commit`,
// `git push`, `git merge` e `gh pr merge`.
//
// O carimbo fica em .claude/carimbo.local.json (ignorado pelo git, um por
// clone). Ele vence em 6 horas e também quando origin/main muda: se alguém
// mergeou algo depois da sua conferência, você precisa olhar de novo.
//
// Modos:
//   --carimbar --github "..." --notion "..." --whatsapp "..."   registra
//   --status                                                    mostra o estado
//   --testar                                                    autoteste
//   --pre-tool   (hook PreToolUse, JSON no stdin)
//   --prompt     (hook UserPromptSubmit)
//
// O hook não prova que o Notion e o grupo foram lidos de verdade: prova que a
// pergunta foi feita e a resposta ficou registrada antes do commit. É
// disciplina, não segurança. O botão "Merge" no site do GitHub passa ao largo;
// por isso a regra é mergear só por `gh pr merge`.
//
// Sem dependências: roda com o mesmo Node 20+ que o projeto exige.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ =
  process.env.CLAUDE_PROJECT_DIR ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARQUIVO = path.join(RAIZ, ".claude", "carimbo.local.json");
const VALIDADE_MS = 6 * 60 * 60 * 1000;
const TAMANHO_MINIMO = 20;
const COMANDO_CARIMBAR =
  'node .claude/hooks/carimbo.mjs --carimbar --github "..." --notion "..." --whatsapp "..."';

// ---------------------------------------------------------------- git -----

function git(args, timeout = 15000) {
  try {
    return execFileSync("git", args, {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout,
    }).trim();
  } catch {
    return null;
  }
}

const urlDoRemote = () => git(["remote", "get-url", "origin"]) || "";
const shaCurto = ref => git(["rev-parse", "--short", ref]);
const shaLongo = ref => git(["rev-parse", ref]);
const branchAtual = () => git(["rev-parse", "--abbrev-ref", "HEAD"]) || "?";

// ------------------------------------------------------------ carimbo -----

function lerCarimbo() {
  try {
    return JSON.parse(readFileSync(ARQUIVO, "utf8"));
  } catch {
    return null;
  }
}

function hora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return d.toLocaleString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

// Devolve { ok: true, carimbo } ou { ok: false, motivo }.
function validarCarimbo() {
  const c = lerCarimbo();
  if (!c) return { ok: false, motivo: "nenhum carimbo em .claude/carimbo.local.json" };
  if (c.repo !== urlDoRemote()) return { ok: false, motivo: "o carimbo é de outro repositório" };
  const idade = Date.now() - new Date(c.quando).getTime();
  if (!(idade >= 0) || idade > VALIDADE_MS) {
    return { ok: false, motivo: `o carimbo de ${hora(c.quando)} venceu (validade de 6 h)` };
  }
  const agora = shaCurto("origin/main");
  if (agora && c.shaOriginMain !== agora) {
    return {
      ok: false,
      motivo: `origin/main mudou desde o carimbo (era ${c.shaOriginMain}, agora ${agora}); veja o que entrou`,
    };
  }
  return { ok: true, carimbo: c };
}

function textoDeBloqueio(motivo) {
  return (
    `Conferência do MMM pendente: ${motivo}. ` +
    "Antes de commitar ou empurrar, confira o GitHub (git fetch, commits e PRs novos, diff " +
    "provando que o código faz o que diz), o quadro do Notion e o grupo do time, mostre o " +
    `resumo a quem está pedindo e registre com: ${COMANDO_CARIMBAR}`
  );
}

// --------------------------------------------------------- detecção -----

const RUNNERS = new Set([
  "sh", "bash", "zsh", "pwsh", "powershell", "powershell.exe", "cmd", "cmd.exe",
  "eval", "exec", "xargs", "env", "npx", "pnpm", "npm", "yarn", "node",
]);
const REGEX_GIT = /\bgit\s+(?:-[^\s]+\s+)*(commit|push|merge)\b/;
const REGEX_GH = /\bgh\s+(?:pr\s+merge|repo\s+sync|api\b[^\n]*merge)/;

function tokens(segmento) {
  const saida = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segmento))) saida.push(m[1] ?? m[2] ?? m[3]);
  return saida;
}

// Devolve "commit" | "push" | "merge" | null para um segmento de comando.
function classificarSegmento(segmento) {
  const s = segmento.trim();
  if (!s) return null;
  const t = tokens(s);
  let i = 0;
  while (i < t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) || t[i] === "sudo")) i++;
  const exe = (t[i] || "").replace(/^.*[\\/]/, "").toLowerCase();

  if (exe === "git") {
    let j = i + 1;
    while (j < t.length && t[j].startsWith("-")) {
      if ((t[j] === "-C" || t[j] === "-c") && !t[j].includes("=")) j += 2;
      else j += 1;
    }
    const sub = t[j];
    if (sub === "commit" || sub === "push" || sub === "merge") {
      if (t.includes("--dry-run")) return null;
      if (sub === "push" && t.includes("-n")) return null;
      return sub;
    }
    return null;
  }
  if (exe === "gh") {
    const resto = t.slice(i + 1).join(" ");
    if (/^pr\s+merge\b/.test(resto)) return "merge";
    if (/^repo\s+sync\b/.test(resto)) return "push";
    if (/^api\b/.test(resto) && /merge/.test(resto)) return "merge";
    return null;
  }
  if (RUNNERS.has(exe)) {
    const g = REGEX_GIT.exec(s);
    if (g) return g[1];
    if (REGEX_GH.test(s)) return "merge";
  }
  return null;
}

// Divide o comando em segmentos por &&, ||, ;, | e quebra de linha, sem cortar
// dentro de aspas: `echo "a && git commit"` é um segmento só (e não um commit).
function segmentar(comando) {
  const segmentos = [];
  let atual = "";
  let aspas = null;
  for (let i = 0; i < comando.length; i++) {
    const ch = comando[i];
    if (aspas) {
      atual += ch;
      if (ch === aspas) aspas = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      aspas = ch;
      atual += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < comando.length) {
      atual += ch + comando[i + 1];
      i++;
      continue;
    }
    const dois = comando.slice(i, i + 2);
    if (dois === "&&" || dois === "||") {
      segmentos.push(atual);
      atual = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      segmentos.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  segmentos.push(atual);
  return segmentos;
}

// Devolve a ação mais grave encontrada no comando inteiro, ou null.
export function detectar(comando) {
  if (typeof comando !== "string") return null;
  const peso = { commit: 1, push: 2, merge: 3 };
  let pior = null;
  for (const seg of segmentar(comando)) {
    const acao = classificarSegmento(seg);
    if (acao && (!pior || peso[acao] > peso[pior])) pior = acao;
  }
  return pior;
}

// ------------------------------------------------------------ modos -----

function lerStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function modoPreTool() {
  const entrada = lerStdin();
  if (!entrada) return;
  const ferramentas = new Set(["Bash", "PowerShell", "mcp__Desktop_Commander__start_process"]);
  if (!ferramentas.has(entrada.tool_name)) return;
  const comando = entrada.tool_input && entrada.tool_input.command;
  const acao = detectar(comando);
  if (!acao) return;

  let veredito;
  try {
    veredito = validarCarimbo();
    if (veredito.ok && (acao === "push" || acao === "merge")) {
      // A main remota pode ter andado depois do último fetch. Falha de rede
      // libera: trabalhar offline não pode travar o commit local.
      const remoto = git(["ls-remote", "--heads", "origin", "main"], 5000);
      const local = shaLongo("origin/main");
      if (remoto && local && !remoto.startsWith(local)) {
        veredito = {
          ok: false,
          motivo: "a main no GitHub recebeu commits que você ainda não viu (rode git fetch e confira)",
        };
      }
    }
  } catch (erro) {
    veredito = { ok: false, motivo: `o carimbo não pôde ser validado (${erro.message})` };
  }
  if (veredito.ok) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: textoDeBloqueio(veredito.motivo),
      },
    })
  );
}

function modoPrompt() {
  const v = validarCarimbo();
  if (v.ok) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext:
          `[carimbo do MMM] ${v.motivo}. Se a mensagem inicia uma tarefa nova, antes de ` +
          "tocar em código: confira o GitHub (fetch, commits/PRs novos, diff), o quadro do " +
          `Notion e o grupo do time, e registre com: ${COMANDO_CARIMBAR}`,
      },
    })
  );
}

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] || "" : "";
}

function modoCarimbar() {
  const github = argumento("--github").trim();
  const notion = argumento("--notion").trim();
  const whatsapp = argumento("--whatsapp").trim();
  const faltando = [
    ["--github", github],
    ["--notion", notion],
    ["--whatsapp", whatsapp],
  ].filter(([, v]) => v.length < TAMANHO_MINIMO);
  if (faltando.length) {
    console.error(
      `Falta descrever a conferência (mínimo ${TAMANHO_MINIMO} caracteres): ` +
        faltando.map(([n]) => n).join(", ")
    );
    console.error(`Uso: ${COMANDO_CARIMBAR}`);
    process.exit(1);
  }

  if (git(["fetch", "--prune", "origin"], 30000) === null) {
    console.error("Aviso: git fetch falhou (sem rede?); usando o origin/main já conhecido.");
  }
  const sha = shaCurto("origin/main");
  if (!sha) {
    console.error("Não achei origin/main. Este é o clone do MMM, com o remote origin?");
    process.exit(1);
  }
  if (!github.includes(sha)) {
    console.error(
      `O texto de --github precisa citar o commit atual de origin/main (${sha}), ` +
        "prova de que o log foi lido e não presumido."
    );
    process.exit(1);
  }
  const atras = git(["rev-list", "--count", "HEAD..origin/main"]);
  if (atras && Number(atras) > 0) {
    console.error(
      `Sua branch (${branchAtual()}) está ${atras} commit(s) atrás de origin/main. ` +
        "Traga a main para ela (git merge origin/main ou rebase), leia o que entrou e carimbe de novo."
    );
    process.exit(1);
  }

  const carimbo = {
    repo: urlDoRemote(),
    quando: new Date().toISOString(),
    shaOriginMain: sha,
    branch: branchAtual(),
    github,
    notion,
    whatsapp,
  };
  mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(carimbo, null, 2) + "\n");
  console.log(
    `Carimbo gravado (${hora(carimbo.quando)}, origin/main ${sha}, branch ${carimbo.branch}).`
  );
  console.log(`  GitHub:   ${github}`);
  console.log(`  Notion:   ${notion}`);
  console.log(`  WhatsApp: ${whatsapp}`);
  console.log("Vale por 6 h ou até origin/main mudar.");
}

function modoStatus() {
  const v = validarCarimbo();
  if (v.ok) {
    const c = v.carimbo;
    console.log(
      `Carimbo VÁLIDO: ${hora(c.quando)}, origin/main ${c.shaOriginMain}, branch ${c.branch}.`
    );
    console.log(`  GitHub:   ${c.github}\n  Notion:   ${c.notion}\n  WhatsApp: ${c.whatsapp}`);
  } else {
    console.log(`Carimbo INVÁLIDO: ${v.motivo}.`);
    console.log(`Registre com: ${COMANDO_CARIMBAR}`);
    process.exitCode = 1;
  }
}

function modoTestar() {
  const casos = [
    ["git status", null],
    ["git log --oneline -5 origin/main", null],
    ["git log --grep=commit", null],
    ["git config user.name", null],
    ["git commit -m 'x'", "commit"],
    ["git -C /tmp/x commit -m 'x'", "commit"],
    ["git add -A && git commit -m 'x'", "commit"],
    ["cd sub; git push -u origin feat", "push"],
    ["git push --dry-run", null],
    ["GIT_TRACE=1 git push", "push"],
    ["git merge origin/main", "merge"],
    ["gh pr merge 12 --squash", "merge"],
    ["gh pr view 12", null],
    ["gh pr create --fill", null],
    ["gh repo sync", "push"],
    ['sh -c "git push origin main"', "push"],
    ['grep -n "git push" docs/x.md', null],
    ['echo "git commit"', null],
    ['echo \'{"command":"git add -A && git commit -m x"}\' | node hook.mjs', null],
    ["pnpm test", null],
  ];
  let falhas = 0;
  for (const [cmd, esperado] of casos) {
    const obtido = detectar(cmd);
    const ok = obtido === esperado;
    if (!ok) falhas++;
    console.log(`${ok ? "ok  " : "ERRO"} ${JSON.stringify(cmd)} -> ${obtido} (esperado ${esperado})`);
  }
  if (existsSync(ARQUIVO)) {
    const c = lerCarimbo();
    console.log(c ? "ok   carimbo.local.json é JSON válido" : "ERRO carimbo.local.json não é JSON");
    if (!c) falhas++;
  }
  console.log(falhas ? `${falhas} falha(s).` : "Autoteste verde.");
  process.exit(falhas ? 1 : 0);
}

const modo = process.argv[2];
try {
  if (modo === "--pre-tool") modoPreTool();
  else if (modo === "--prompt") modoPrompt();
  else if (modo === "--carimbar") modoCarimbar();
  else if (modo === "--status") modoStatus();
  else if (modo === "--testar") modoTestar();
  else {
    console.log(
      'Modos: --carimbar --github "..." --notion "..." --whatsapp "..." | --status | --testar | --pre-tool | --prompt'
    );
  }
} catch (erro) {
  // Um hook que quebra vira erro não bloqueante e some em silêncio; deixar o
  // rastro no stderr para o autoteste e o --status denunciarem.
  console.error(`carimbo.mjs: ${erro.message}`);
}
