#!/usr/bin/env node
// Carimbo de conferência da WRW (nome técnico MMM).
//
// Regra do time (CLAUDE.md, "Fluxo de trabalho"): antes de iniciar uma tarefa e
// antes de commit/push, conferir GitHub, o quadro do Notion e o grupo do time,
// e provar que o código faz o que o commit diz. Este script transforma a regra
// em trava: sem um carimbo recente, o Claude Code recusa `git commit`,
// `git push`, `git merge` e `gh pr merge`. Exceções que não publicam nem
// mesclam nada na main: `gh api` só de leitura, e o `git merge origin/main`
// que só traz a main para uma branch de trabalho (ver soTrazAMain).
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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
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
    `Conferência da WRW pendente: ${motivo}. ` +
    "Antes de commitar ou empurrar, confira o GitHub (git fetch, commits e PRs novos, diff " +
    "provando que o código faz o que diz), o quadro do Notion e o grupo do time, mostre o " +
    `resumo a quem está pedindo e registre com: ${COMANDO_CARIMBAR}`
  );
}

// --------------------------------------------------------- detecção -----

// --------------------------------------------------- leitura do comando -----
//
// O hook recebe o texto que vai para o Bash (Git Bash) ou para a ferramenta
// PowerShell e decide se ele grava commit, empurra ou mescla. Para isso lê o
// texto como o shell leria (lerShell): palavras, aspas e escapes de cada shell,
// comentários, continuação de linha, redirecionamentos, $( ) e crase
// (inclusive dentro de aspas duplas), heredoc e here-string. Cada comando
// simples sai como uma lista de palavras; o que o shell executa por dentro
// (substituições, corpo de heredoc entregue a um shell, string de `sh -c`,
// script de `bash x.sh`, alias definido na linha) é lido de novo.
// Revisões independentes de 19/10: a versão que olhava só a primeira palavra
// deixava passar `if ($?) { git commit }`, `timeout 60 git push`, `git.exe`,
// `$x = git commit`, `saida="$(git push)"`, comentário com apóstrofo e
// here-string; a que procurava em qualquer posição sem ler aspas, comentários
// e redirecionamentos travava `git merge origin/main 2>&1` e um `# git merge`
// num comentário. Os casos estão no autoteste (--testar).

// Shells que leem comandos de uma string, da entrada padrão ou de um arquivo.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "pwsh", "powershell", "cmd", "wsl"]);
const SHELLS_POWERSHELL = new Set(["pwsh", "powershell", "iex", "invoke-expression"]);
// Quem executa outro comando: string (sh -c "...", iex '...'), arquivo
// (bash x.sh, source x.sh) ou entrada padrão (echo "git push" | bash).
const RUNNERS = new Set([...SHELLS, "eval", "source", ".", "iex", "invoke-expression", "watch", "parallel", "env"]);
const LEEM_ENTRADA = new Set([...SHELLS, "iex", "invoke-expression"]);
// Palavras que vêm antes do comando de verdade e executam o que vem depois.
const EMBRULHOS = new Set([
  "sudo", "doas", "time", "nice", "ionice", "nohup", "command", "builtin", "noglob", "stdbuf",
  "timeout", "exec", "env", "xargs", "watch", "parallel", "taskset", "chrt", "winpty",
]);
// Opções de embrulho que tomam valor (`sudo -u roberto`, `timeout -s KILL 60`).
const VALOR_DE_EMBRULHO = new Set([
  "-u", "-g", "-h", "-p", "-C", "-D", "-U", "-s", "-k", "-n", "--user", "--group", "--signal",
  "--kill-after", "-I", "-L", "-P",
]);
// Comandos que só escrevem texto: o que vem nos argumentos não é comando (as
// substituições $( ) deles são lidas à parte).
const ECOS = new Set([
  "echo", "printf", "write-host", "write-output", "write-error", "write-warning", "write-verbose",
  "write-information", "out-host",
]);
// Interpretadores com código em string (-e, -c): o código pode chamar o git.
const INTERPRETADORES = new Set(["node", "deno", "bun", "python", "python3", "py", "perl", "ruby", "php"]);
// Palavras que abrem um bloco antes do comando (`if ($?) { git push }`, `then git commit`).
const ABERTURAS = new Set(["!", "then", "do", "else", "elif", "elseif", "if", "while", "until", "try", "finally", "foreach"]);
// Quem grava arquivo com o texto que recebe (para o script gravado e rodado na mesma chamada).
const GRAVADORES = new Set(["set-content", "add-content", "out-file", "tee", "tee-object"]);

// Rede de segurança só para código de outra linguagem (node -e, python -c).
const REGEX_GIT = /\bgit(?:\.exe)?["']?\s*[\s,]\s*(?:-[^\s'",]+\s+)*["']?(commit|push|merge|pull|revert|cherry-pick)(?![\w-])/i;
const REGEX_GH = /\bgh(?:\.exe)?["']?\s*[\s,]\s*["']?(?:pr["']?\s*[\s,]\s*["']?(?:merge|update-branch)|repo["']?\s*[\s,]\s*["']?sync)(?![\w-])/i;
const PROFUNDIDADE_MAXIMA = 4;
const MAX_PALAVRAS_DO_RESTO = 300;
const MAX_SCRIPTS = 32;
const MAX_RUNNERS_POR_COMANDO = 16;
const MAX_TEXTO = 1_000_000;

const PESO = { commit: 1, push: 2, merge: 3 };
const pior = (a, b) => (!a ? b : !b ? a : PESO[b] > PESO[a] ? b : a);
const acaoDaPalavra = s =>
  s === "commit" || s === "push" || s === "merge" ? s : s === "pull" ? "merge" : s === "revert" || s === "cherry-pick" ? "commit" : null;

// Lê de `texto[ini]` até o `)` que fecha um `$(`, `@(`, `<(` já aberto,
// respeitando aspas, escapes, comentários e corpo de heredoc lá dentro.
// Devolve [conteúdo, índice depois do `)`].
function lerAteFechar(texto, ini, ps) {
  let prof = 1;
  let j = ini;
  let aspas = null;
  const pendentes = [];
  const n = texto.length;
  while (j < n) {
    const c = texto[j];
    if (aspas === "'") {
      if (c === "'") aspas = null;
      j++;
      continue;
    }
    if (aspas === "$'") {
      if (c === "\\") j += 2;
      else {
        if (c === "'") aspas = null;
        j++;
      }
      continue;
    }
    if (aspas === '"') {
      if ((!ps && c === "\\") || (ps && c === "`")) j += 2;
      else {
        if (c === '"') aspas = null;
        j++;
      }
      continue;
    }
    if (c === "\n" && pendentes.length) {
      j = pularCorposDeHeredoc(texto, j + 1, pendentes);
      pendentes.length = 0;
      continue;
    }
    if (!ps && c === "$" && texto[j + 1] === "'") {
      aspas = "$'";
      j += 2;
      continue;
    }
    if (c === "'" || c === '"') aspas = c;
    else if ((!ps && c === "\\") || (ps && c === "`")) j++;
    else if (c === "#" && (j === ini || /[\s;&|(]/.test(texto[j - 1]))) {
      while (j < n && texto[j] !== "\n") j++;
      continue;
    } else if (!ps && c === "<" && texto[j + 1] === "<" && texto[j + 2] !== "<") {
      const m = /^<<(-?)[ \t]*\\?(['"]?)([^\s'"<>|&;()]+)\2/.exec(texto.slice(j, j + 300));
      if (m) {
        pendentes.push({ delim: m[3], tiraTab: m[1] === "-" });
        j += m[0].length;
        continue;
      }
    } else if (c === "(") prof++;
    else if (c === ")") {
      prof--;
      if (prof === 0) return [texto.slice(ini, j), j + 1];
    }
    j++;
  }
  return [texto.slice(ini), n];
}

// Pula os corpos de heredoc a partir do começo de uma linha. Sem a linha do
// delimitador, o corpo vai até o fim (é o que o bash faz). Devolve o índice
// depois do último delimitador; se `corpos` vier, guarda o texto de cada corpo.
function pularCorposDeHeredoc(texto, pos, pendentes, corpos) {
  const n = texto.length;
  for (const h of pendentes) {
    const linhas = [];
    let achou = false;
    while (pos < n) {
      let fim = texto.indexOf("\n", pos);
      if (fim < 0) fim = n;
      let linha = texto.slice(pos, fim).replace(/\r$/, "");
      pos = fim + 1;
      if (h.tiraTab) linha = linha.replace(/^\t+/, "");
      if (linha === h.delim) {
        achou = true;
        break;
      }
      linhas.push(linha);
    }
    if (corpos) corpos.push({ ...h, corpo: linhas.join("\n") });
    if (!achou) return n;
  }
  return Math.min(pos, n);
}

// As substituições $( ) e crase de um texto que o shell expande (corpo de
// heredoc sem aspas no delimitador, here-string @"...", ${X:-$(...)}).
function substituicoesEm(texto, ps) {
  const saida = [];
  for (let j = 0; j < texto.length; j++) {
    const c = texto[j];
    if ((!ps && c === "\\") || (ps && c === "`" && texto[j + 1] !== "(")) {
      j++;
      continue;
    }
    if ((c === "$" || (ps && c === "@")) && texto[j + 1] === "(") {
      const [conteudo, depois] = lerAteFechar(texto, j + 2, ps);
      saida.push(conteudo);
      j = depois - 1;
    } else if (!ps && c === "`") {
      const f = texto.indexOf("`", j + 1);
      saida.push(texto.slice(j + 1, f < 0 ? texto.length : f));
      j = f < 0 ? texto.length : f;
    }
  }
  return saida;
}

// Marca de substituição dentro de uma palavra: "$(…#3)" aponta para subs[3].
const marca = (prefixo, k) => `${prefixo}(…#${k})`;
const MARCA = /\(…#(\d+)\)/;

// Lê o texto como o shell. Devolve { comandos, subs }: comandos é a lista de
// comandos simples, cada um { palavras, sep, heredocs, redirecoes } (sep é o
// separador que veio antes: "|", ";", "&&", "\n", "&", "(", "{"...); subs são
// os textos que o shell executa por dentro ($( ), crase, <( )) e precisam ser
// lidos de novo.
export function lerShell(texto, shell = "bash") {
  const ps = shell === "powershell";
  const n = texto.length;
  const comandos = [];
  const subs = [];
  let palavras = [];
  let palavra = null;
  let profundidade = 0;
  let atual = { palavras, sep: "", heredocs: [], redirecoes: [] };
  let pendentes = [];
  let alvoDe = null;
  let i = 0;

  const add = c => {
    palavra = (palavra ?? "") + c;
  };
  const sub = (prefixo, conteudo) => {
    subs.push(conteudo);
    add(marca(prefixo, subs.length - 1));
  };
  const fechaPalavra = () => {
    if (palavra !== null) {
      if (alvoDe) atual.redirecoes.push({ op: alvoDe, alvo: palavra });
      else palavras.push(palavra);
      alvoDe = null;
    }
    palavra = null;
    profundidade = 0;
  };
  const fechaComando = sep => {
    fechaPalavra();
    alvoDe = null;
    if (palavras.length || atual.heredocs.length || atual.redirecoes.length) comandos.push(atual);
    palavras = [];
    atual = { palavras, sep, heredocs: [], redirecoes: [] };
  };

  while (i < n) {
    const ch = texto[i];
    const prox = texto[i + 1];

    // Continuação de linha: `\` + quebra no Bash, crase + quebra no PowerShell.
    if (((!ps && ch === "\\") || (ps && ch === "`")) && (prox === "\n" || (prox === "\r" && texto[i + 2] === "\n"))) {
      i += prox === "\r" ? 3 : 2;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      fechaComando("\n");
      i++;
      if (pendentes.length) {
        const corpos = [];
        i = pularCorposDeHeredoc(texto, i, pendentes, corpos);
        for (const c of corpos) c.dono.heredocs.push(c);
        pendentes = [];
      }
      continue;
    }
    if (ch === " " || ch === "\t") {
      fechaPalavra();
      i++;
      continue;
    }
    // Comentário: `#` no começo de palavra vai até o fim da linha; no
    // PowerShell, também o bloco <# ... #>.
    if (ch === "#" && palavra === null) {
      while (i < n && texto[i] !== "\n") i++;
      continue;
    }
    if (ps && ch === "<" && prox === "#" && palavra === null) {
      const f = texto.indexOf("#>", i + 2);
      i = f < 0 ? n : f + 2;
      continue;
    }
    // Here-string do PowerShell: @' ou @" no fim da linha, até a linha que
    // começa com '@ ou "@. A de aspas simples é literal; a de duplas expande $( ).
    if (ps && ch === "@" && (prox === "'" || prox === '"') && /^[ \t]*\r?\n/.test(texto.slice(i + 2, i + 40))) {
      const q = prox;
      const ini = texto.indexOf("\n", i) + 1;
      const fecho = new RegExp(`(^|\\n)${q}@`, "g");
      fecho.lastIndex = ini - 1;
      const m = fecho.exec(texto);
      const fim = m ? m.index + m[1].length : n;
      const conteudo = texto.slice(ini, fim);
      if (q === '"') for (const s of substituicoesEm(conteudo, true)) subs.push(s);
      add(conteudo);
      i = m ? fim + 2 : n;
      continue;
    }
    // `--%` do PowerShell: o resto da linha vai literal para o programa.
    if (ps && palavra === null && texto.startsWith("--%", i) && /[\s|]|$/.test(texto[i + 3] ?? "")) {
      let f = i + 3;
      while (f < n && texto[f] !== "\n" && texto[f] !== "|") f++;
      add(texto.slice(i, f));
      i = f;
      continue;
    }
    // Escape fora de aspas: `\` no Bash, crase no PowerShell.
    if ((!ps && ch === "\\") || (ps && ch === "`")) {
      add(prox ?? "");
      i += 2;
      continue;
    }
    // $'...' do Bash: a barra escapa qualquer caractere, inclusive a aspa.
    if (!ps && ch === "$" && prox === "'") {
      if (palavra === null) palavra = "";
      i += 2;
      while (i < n && texto[i] !== "'") {
        if (texto[i] === "\\" && i + 1 < n) {
          add(texto[i + 1]);
          i += 2;
          continue;
        }
        add(texto[i]);
        i++;
      }
      i++;
      continue;
    }
    // Aspas simples: literais (no PowerShell, '' é uma aspa).
    if (ch === "'") {
      if (palavra === null) palavra = "";
      i++;
      while (i < n) {
        if (texto[i] === "'") {
          if (ps && texto[i + 1] === "'") {
            add("'");
            i += 2;
            continue;
          }
          i++;
          break;
        }
        add(texto[i]);
        i++;
      }
      continue;
    }
    // Aspas duplas: no Bash `\` escapa " \ $ e crase; no PowerShell a crase
    // escapa e "" é uma aspa. $( ) e crase (Bash) lá dentro são executados.
    if (ch === '"') {
      if (palavra === null) palavra = "";
      i++;
      while (i < n) {
        const c = texto[i];
        if (c === '"') {
          if (ps && texto[i + 1] === '"') {
            add('"');
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (!ps && c === "\\" && i + 1 < n && '"\\$`\n'.includes(texto[i + 1])) {
          if (texto[i + 1] !== "\n") add(texto[i + 1]);
          i += 2;
          continue;
        }
        if (ps && c === "`" && i + 1 < n) {
          add(texto[i + 1]);
          i += 2;
          continue;
        }
        if (c === "$" && texto[i + 1] === "(") {
          const [conteudo, depois] = lerAteFechar(texto, i + 2, ps);
          sub("$", conteudo);
          i = depois;
          continue;
        }
        if (!ps && c === "`") {
          const f = texto.indexOf("`", i + 1);
          sub("`", texto.slice(i + 1, f < 0 ? n : f));
          i = f < 0 ? n : f + 1;
          continue;
        }
        add(c);
        i++;
      }
      continue;
    }
    // Substituição fora de aspas: $( ), @( ) do PowerShell, <( ) e >( ) do Bash.
    if ((ch === "$" || (ps && ch === "@") || (!ps && (ch === "<" || ch === ">"))) && prox === "(") {
      const [conteudo, depois] = lerAteFechar(texto, i + 2, ps);
      sub(ch, conteudo);
      i = depois;
      continue;
    }
    if (!ps && ch === "`") {
      const f = texto.indexOf("`", i + 1);
      sub("`", texto.slice(i + 1, f < 0 ? n : f));
      i = f < 0 ? n : f + 1;
      continue;
    }
    // ${...} é variável, inteira na palavra; ${X:-$(cmd)} executa o cmd.
    if (ch === "$" && prox === "{") {
      let prof = 0;
      let f = i + 1;
      for (; f < n; f++) {
        if (texto[f] === "{") prof++;
        else if (texto[f] === "}" && --prof === 0) break;
      }
      const conteudo = texto.slice(i, Math.min(f + 1, n));
      for (const s of substituicoesEm(conteudo.slice(2, -1), ps)) subs.push(s);
      add(conteudo);
      i = f + 1;
      continue;
    }
    // Separadores de comando.
    if ((ch === "&" && prox === "&") || (ch === "|" && prox === "|")) {
      fechaComando(ch + prox);
      i += 2;
      continue;
    }
    if (ch === "|" || ch === ";") {
      fechaComando(ch);
      i++;
      continue;
    }
    if (ch === "&" && prox !== ">") {
      fechaComando("&");
      i++;
      continue;
    }
    // Heredoc do Bash: << ou <<- fora de aspas (<<< é here-string, não conta).
    if (!ps && ch === "<" && prox === "<" && texto[i + 2] !== "<") {
      const m = /^<<(-?)[ \t]*(\\?)(['"]?)([^\s'"<>|&;()]+)\3/.exec(texto.slice(i, i + 300));
      if (m) {
        fechaPalavra();
        pendentes.push({ delim: m[4], tiraTab: m[1] === "-", expande: !m[2] && !m[3], dono: atual });
        i += m[0].length;
        continue;
      }
    }
    // Redirecionamento: > >> >& >| < <& <> e os descritores na frente (2>&1,
    // *>&1, &>). Ele não é argumento do programa: o alvo vai para redirecoes.
    if (ch === ">" || ch === "<") {
      if (palavra !== null && /^(\d+|&|\*)$/.test(palavra)) palavra = null;
      else fechaPalavra();
      let op = ch;
      i++;
      while (i < n && op.length < 3 && /[>&|<]/.test(texto[i])) op += texto[i++];
      alvoDe = op;
      continue;
    }
    // Grupos: ( { no começo de palavra abrem comando novo; ) } sem par na
    // palavra fecham. Dentro da palavra (repos/{owner}, HEAD@{1}, if($?))
    // fazem parte dela. No Bash, `{` só abre bloco seguido de espaço: `{}` e
    // `{a,b}` são palavra.
    const chaveDePalavra = ch === "{" && !ps && prox !== undefined && !/\s/.test(prox);
    if ((ch === "(" || ch === "{") && palavra === null && !chaveDePalavra) {
      fechaComando(ch);
      i++;
      continue;
    }
    if (ch === "(" || ch === "{") {
      profundidade++;
      add(ch);
      i++;
      continue;
    }
    if ((ch === ")" || ch === "}") && profundidade > 0) {
      profundidade--;
      add(ch);
      i++;
      continue;
    }
    if (ch === ")" || ch === "}") {
      fechaComando(ch);
      i++;
      continue;
    }
    add(ch);
    i++;
  }
  fechaComando("");
  return { comandos, subs };
}

// Nome do executável de uma palavra: sem atribuição na frente, sem caminho,
// sem `.exe`, em minúsculas (`C:\Program Files\Git\bin\git.exe` e `GIT.EXE`
// são `git`). Vale o que vem depois do último `(` ou `{` colado, como em
// `if($?){git` do PowerShell.
function nomeDoExecutavel(palavra) {
  return (palavra || "")
    .split(/[({]/)
    .pop()
    .replace(/^[A-Za-z_][A-Za-z0-9_]*=/, "")
    .replace(/[)}]+$/, "")
    .replace(/^.*[\\/]/, "")
    .toLowerCase()
    .replace(/\.exe$/, "");
}

// Índice da palavra que é o comando: pula atribuições (`X=1`, `$x =` do
// PowerShell) e as aberturas de bloco (`if`, `then`, `!`, `($?)`).
function indiceDoComando(t) {
  let i = 0;
  while (i < t.length) {
    const p = t[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(p) || ABERTURAS.has(p.toLowerCase()) || /^\(.*\)$/.test(p)) {
      i++;
      continue;
    }
    if (/^\$[\w:{}]+$/.test(p) && /^[-+*/]?=$/.test(t[i + 1] || "")) {
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

// ------------------------------------------------------------ git e gh -----

// `gh api` escreve quando recebe método (-X, --method) ou corpo (-f, -F,
// --field, --raw-field, --input; com corpo e sem método, o gh manda POST). A
// leitura simples, sem nenhuma dessas flags, passa: `--jq '.merged_at'`,
// `.allow_auto_merge`, GET em /pulls/N/merge, `-i`, `-H`, `-q`, `--paginate`.
// Qualquer uma delas trava, mesmo com GET: o gh aceita flag curta agrupada e
// valor colado (`-iX PUT`, `-iXPUT`, `-X=PUT`, `-iF base=main`), e a versão que
// tentava separar flag de valor token a token deixava esses passarem como
// leitura (revisão de 19/10 da #161). Por isso a regra é por presença: token
// de flag curta que tenha X, f ou F em qualquer posição, ou --method, --field,
// --raw-field e --input (com = ou separados). Na dúvida, trava. GET já é o
// padrão do gh, e uma busca com campos cabe na URL (`'search/issues?q=...'`).
export function ghApiEscreve(args) {
  return args.some(a =>
    a.startsWith("--")
      ? /^--(?:method|field|raw-field|input)(?:=|$)/.test(a)
      : /^-./.test(a) && /[XfF]/.test(a)
  );
}

// O `git merge` (ou `git pull`) que só traz a main para uma branch de trabalho
// não mescla nada NA main e é o que o fluxo manda fazer antes da PR. Sem esta
// exceção havia um impasse: o --carimbar recusa branch atrás de origin/main, e
// o hook recusava o merge que a põe em dia. Só vale na forma simples, com a
// branch do diretório do comando conhecida e diferente de main, no comando de
// primeiro nível (dentro de `bash -c` não vale) e sem troca de diretório ou de
// repositório em nenhum comando (cd, pushd, Push-Location, Pop-Location, -C,
// GIT_DIR, --git-dir, --work-tree): aí o merge volta a pedir carimbo.
const ALVOS_DA_MAIN = new Set(["origin/main", "main", "refs/remotes/origin/main", "refs/heads/main"]);
// Opções que não mudam o que entra: só a forma de mostrar, de editar a
// mensagem e o avanço rápido. -s/-X/--strategy ficam de fora.
const OPCOES_DO_MERGE_SIMPLES = new Set([
  "--no-edit", "--ff-only", "--ff", "--no-ff", "--no-rebase", "-q", "--quiet", "--stat", "-n",
  "--no-stat", "--log", "--no-log", "--no-verify", "--verify", "--progress", "--no-progress",
]);
const OPCOES_DO_MERGE_COM_VALOR = new Set(["-m", "--message", "-F", "--file"]);
const TROCAS_DE_LUGAR = new Set(["cd", "chdir", "pushd", "popd", "set-location", "push-location", "pop-location", "sl"]);

function trocaDeLugar(comandos) {
  return comandos.some(c =>
    c.palavras.some(p => {
      const s = p.toLowerCase();
      return (
        TROCAS_DE_LUGAR.has(nomeDoExecutavel(p)) ||
        p === "-C" ||
        s.startsWith("--git-dir") ||
        s.startsWith("--work-tree") ||
        /(^|[^a-z_])git_(dir|work_tree)=/.test(s) ||
        s.includes("env:git_dir")
      );
    })
  );
}

// Os alvos e as opções de um merge/pull, com o valor de -m/-F fora da conta.
function alvosEOpcoes(args) {
  const alvos = [];
  const opcoes = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (OPCOES_DO_MERGE_COM_VALOR.has(a)) {
      k++;
      continue;
    }
    if (/^(--message|--file)=/.test(a) || /^-m./.test(a)) continue;
    (a.startsWith("-") ? opcoes : alvos).push(a);
  }
  return { alvos, opcoes };
}

export function soTrazAMain(argsDoMerge, ctx) {
  if (!ctx.primeiroNivel || ctx.trocaDeLugar) return false;
  let { alvos, opcoes } = alvosEOpcoes(argsDoMerge);
  if (alvos.length === 2 && alvos[0] === "origin") alvos = [`origin/${alvos[1]}`];
  if (alvos.length !== 1 || !ALVOS_DA_MAIN.has(alvos[0])) return false;
  if (!opcoes.every(o => OPCOES_DO_MERGE_SIMPLES.has(o))) return false;
  // A branch fica por último: descobri-la custa um `git rev-parse`.
  const b = typeof ctx.branch === "function" ? ctx.branch() : ctx.branch;
  return Boolean(b) && b !== "main" && b !== "HEAD" && b !== "?";
}

// `git merge -h`, `--help`, `--abort` e `--quit` não mesclam nada, mas só
// quando são o ÚNICO argumento depois de `merge`. Em qualquer outra posição o
// token pode ser valor de outra opção: em `git merge -m --abort feat/outra` o
// git toma "--abort" como a mensagem do -m e mescla feat/outra (revisão de
// 19/10 da #161, conferido com `git rev-parse --parseopt`). Pela mesma razão
// o `--dry-run` não libera o merge: o git merge nem tem essa opção.
const MERGE_QUE_NAO_MESCLA = new Set(["-h", "--help", "--abort", "--quit"]);

// Opções globais do git que tomam o valor no token seguinte. Sem pular o
// valor, `git --git-dir .git push` lia ".git" como subcomando e liberava.
const GLOBAIS_COM_VALOR = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix",
  "--attr-source",
]);

// `git commit --dry-run` e `git push --dry-run`/`-n` não gravam nada, mas só
// quando a flag é uma opção de verdade. Como valor de outra opção ela não vale:
// `git commit -m --dry-run` grava um commit com a mensagem "--dry-run", e
// `git push -o -n origin main` empurra de verdade. Depois de `--` tudo é caminho.
const OPCOES_COM_VALOR = {
  commit: new Set([
    "-m", "-F", "-C", "-c", "-t", "--message", "--file", "--reuse-message", "--reedit-message",
    "--template", "--author", "--date", "--cleanup", "--fixup", "--squash", "--trailer",
    "--pathspec-from-file",
  ]),
  push: new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]),
};
const CURTAS_COM_VALOR = { commit: "mFCct", push: "o" };

function tomaValor(sub, opcao) {
  if (!opcao || opcao.includes("=")) return false;
  if (OPCOES_COM_VALOR[sub].has(opcao)) return true;
  return /^-[A-Za-z]+$/.test(opcao) && CURTAS_COM_VALOR[sub].includes(opcao.at(-1));
}

function ehEnsaio(sub, args) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") return false;
    const marcaDeEnsaio = a === "--dry-run" || (sub === "push" && a === "-n");
    if (marcaDeEnsaio && !tomaValor(sub, args[k - 1])) return true;
  }
  return false;
}

// Subcomando opaco (variável, splat, substituição): na dúvida, trava.
const opaco = s => /^[$@`]/.test(s) || MARCA.test(s);
const SUBS_DO_GIT = ["commit", "push", "merge", "pull", "revert", "cherry-pick", "am", "rebase", "submodule", "bisect"];

function classificarGit(t, i, ctx, profundidade) {
  let j = i + 1;
  while (j < t.length && t[j].startsWith("-")) {
    const op = t[j];
    const valor = op.includes("=") ? op.slice(op.indexOf("=") + 1) : t[j + 1] || "";
    // Com --config-env o corpo do alias vem de uma variável: não dá para ler.
    if (op.startsWith("--config-env") && /^alias\./i.test(valor)) return "merge";
    // Alias definido na linha que grava, empurra, mescla ou chama o shell.
    if (op === "-c" && /^alias\./i.test(valor)) {
      const corpo = valor.slice(valor.indexOf("=") + 1);
      if (/^!|\b(commit|push|merge|pull|revert|cherry-pick|am|rebase)(?![\w-])/i.test(corpo)) return "merge";
    }
    j += GLOBAIS_COM_VALOR.has(op) ? 2 : 1;
  }
  const bruto = t[j] || "";
  if (bruto && opaco(bruto)) return "merge";
  const sub = bruto.toLowerCase();
  if (!SUBS_DO_GIT.includes(sub)) return null;
  const resto = t.slice(j + 1, j + 1 + MAX_PALAVRAS_DO_RESTO);
  // Só a ajuda: `git push -h`, `git commit --help`.
  if (resto.length === 1 && (resto[0] === "-h" || resto[0] === "--help")) return null;
  const filho = { ...ctx, primeiroNivel: false };
  if (sub === "merge" || sub === "pull") {
    if (sub === "merge" && resto.length === 1 && MERGE_QUE_NAO_MESCLA.has(resto[0])) return null;
    const { alvos, opcoes } = alvosEOpcoes(resto);
    // --ff-only só avança a branch, sem commit de merge: na main, é o pull
    // --ff-only que o fluxo manda; noutra branch com a main, soTrazAMain.
    if (sub === "pull" && opcoes.includes("--ff-only")) return null;
    if (sub === "merge" && opcoes.includes("--ff-only") && alvos.length === 1 && ALVOS_DA_MAIN.has(alvos[0])) return null;
    if (soTrazAMain(resto, ctx)) return null;
    return "merge";
  }
  if (sub === "revert" || sub === "cherry-pick" || sub === "am" || sub === "rebase") {
    const naoGrava = ["-n", "--no-commit", "--abort", "--quit", "--skip", "-h", "--help", "--show-current-patch", "--edit-todo"];
    let acao = resto.some(a => naoGrava.includes(a)) ? null : "commit";
    // rebase -x/--exec roda um comando a cada commit.
    for (let k = 0; k < resto.length; k++) {
      const a = resto[k];
      const cmd = a === "-x" || a === "--exec" ? resto[k + 1] : a.startsWith("--exec=") ? a.slice(7) : null;
      if (cmd) acao = pior(acao, detectarEm(cmd, filho, profundidade + 1));
    }
    return acao;
  }
  // `git submodule foreach 'git push'` e `git bisect run ...` executam o resto.
  if (sub === "submodule" || sub === "bisect") {
    const k = resto.findIndex(a => a === "foreach" || a === "run");
    if (k < 0) return null;
    const cmd = resto.slice(k + 1).filter(a => !/^--?(recursive|quiet|q)$/.test(a));
    if (!cmd.length) return null;
    // O foreach entrega o texto ao shell; o bisect run executa os argumentos.
    const linha = sub === "submodule" ? cmd.join(" ") : cmd.map(cotar).join(" ");
    return detectarEm(linha, filho, profundidade + 1);
  }
  return ehEnsaio(sub, resto) ? null : sub;
}

// Junta palavras de volta numa linha sem perder o que tinha espaço.
const cotar = p => (/[\s"'`$;&|<>(){}]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p);

// Flags do gh antes do grupo que tomam valor (`gh -R dono/repo pr merge`).
const GH_GLOBAIS_COM_VALOR = new Set(["-R", "--repo", "--hostname"]);
// Valores do gh api que não falam do que a chamada faz: o filtro do jq, o
// modelo, cabeçalhos.
const GH_API_SO_FORMATO = new Set(["--jq", "-q", "--template", "-t", "-H", "--header", "--cache", "-p", "--preview", "--hostname"]);

function classificarGh(t, i) {
  const args = t.slice(i + 1, i + 1 + MAX_PALAVRAS_DO_RESTO);
  let k = 0;
  while (k < args.length && args[k].startsWith("-")) k += GH_GLOBAIS_COM_VALOR.has(args[k]) ? 2 : 1;
  const grupo = (args[k] || "").toLowerCase();
  if (opaco(args[k] || "")) return "merge";
  if (grupo === "pr" || grupo === "repo") {
    // `gh pr -R dono/repo merge 12`: pula as flags e o valor do -R/--repo.
    let m = k + 1;
    while (m < args.length && args[m].startsWith("-")) m += GH_GLOBAIS_COM_VALOR.has(args[m]) ? 2 : 1;
    const sub = (args[m] || "").toLowerCase();
    const resto = args.slice(m + 1);
    if (resto.length === 1 && (resto[0] === "-h" || resto[0] === "--help")) return null;
    if (grupo === "pr" && sub === "merge") return "merge";
    if (grupo === "pr" && sub === "update-branch") return "push";
    if (grupo === "repo" && sub === "sync") return "push";
    return null;
  }
  if (grupo !== "api") return null;
  const resto = [...args.slice(0, k), ...args.slice(k + 1)];
  if (!ghApiEscreve(resto)) return null;
  // O que diz o que a chamada faz: o caminho e os campos (-f/-F). O filtro do
  // --jq e os cabeçalhos ficam de fora (`--jq '.mergeable'` não mescla nada).
  const relevantes = [];
  let caminho = null;
  for (let m = 0; m < resto.length; m++) {
    const a = resto[m];
    if (GH_API_SO_FORMATO.has(a)) {
      m++;
      continue;
    }
    if (/^--(jq|template|header|cache|preview|hostname)=/.test(a)) continue;
    // O valor do método e o arquivo do --input não são o caminho.
    if (/^-[A-Za-z]*X$/.test(a) || a === "--method" || a === "--input") {
      m++;
      continue;
    }
    if (a.startsWith("-")) {
      const colado = /^-[A-Za-z]*[fF](.+)$/.exec(a) || /^--(?:field|raw-field)=(.+)$/.exec(a);
      const campo = colado ? colado[1] : /^(-[A-Za-z]*[fF]|--field|--raw-field)$/.test(a) && resto[m + 1] ? resto[++m] : null;
      // Texto livre (corpo de comentário, título, evento de review) não diz o
      // que a chamada faz: "pronto para merge" num comentário não mescla nada.
      if (campo && !/^(body|title|event|description|name|label|labels|message)=/i.test(campo)) relevantes.push(campo);
      continue;
    }
    if (caminho === null) caminho = a;
    relevantes.push(a);
  }
  const texto = relevantes.join(" ").toLowerCase().replace(/["'\\`]/g, "");
  if ((caminho || "").toLowerCase() === "graphql") {
    // GraphQL: as mutations que mesclam ou gravam na main, ou a consulta vinda
    // de arquivo (que não dá para ler aqui). Resolver conversa, comentar e
    // aprovar não passam pelo carimbo.
    const perigosa = /\b(merge\w*|enablepullrequestautomerge|updatepullrequestbranch|createcommitonbranch|updaterefs?|createref|deleteref)\b/;
    if (/\bmutation\b/.test(texto) && perigosa.test(texto)) return "merge";
    if (/query=@/.test(texto) || resto.some(a => a.startsWith("--input"))) return "merge";
    return null;
  }
  if (/merge/.test(texto)) return "merge";
  // Escrita que grava na main sem a palavra merge: mover ref, gravar arquivo
  // pela API de contents, atualizar a branch da PR; caminho em variável.
  if (/git\/(refs|commits|trees|tags)|\/contents\/|update-branch/.test(texto)) return "push";
  if (/^\$/.test(caminho || "") || opaco(caminho || "")) return "merge";
  return null;
}

// ---------------------------------------------------------- runners -----

// Caminho de script como o Git Bash e o PowerShell escrevem: /c/Users/...,
// ~/x, $HOME/x, $env:USERPROFILE\x, /tmp/x.
function resolverCaminho(caminho, base) {
  let c = caminho
    .replace(/^~(?=[\\/]|$)/, homedir())
    .replace(/^\$\{?HOME\}?(?=[\\/]|$)/i, homedir())
    .replace(/^\$env:USERPROFILE(?=[\\/]|$)/i, homedir())
    .replace(/^%USERPROFILE%(?=[\\/]|$)/i, homedir());
  let b = typeof base === "string" && base ? base : process.cwd();
  if (process.platform === "win32") {
    c = c.replace(/^\/tmp(?=\/|$)/, tmpdir()).replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
    b = b.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
  }
  return path.resolve(b, c);
}

// Lê o script que um runner vai executar e procura nele o que trava. Cada
// arquivo é lido uma vez por comando (cache, que também corta ciclos), com teto
// de arquivos e de tamanho; passou do teto, trava (na dúvida). Arquivo que não
// existe: se o próprio texto grava arquivo (heredoc com >, echo > x,
// Set-Content), o que ele grava é lido como o script; se o texto troca de
// diretório, tenta a partir de cada `cd`; se o caminho tem variável, trava.
function lerScript(caminho, ctx, profundidade) {
  const bases = [ctx.cwd, ...ctx.alvosDeCd.map(d => resolverCaminho(d, ctx.cwd))];
  let arquivo = null;
  for (const b of bases) {
    try {
      const a = resolverCaminho(caminho, b);
      if (existsSync(a) && statSync(a).isFile()) {
        arquivo = a;
        break;
      }
    } catch {
      // caminho inválido nesta base
    }
  }
  if (!arquivo) {
    let acao = null;
    for (const g of ctx.gravados) acao = pior(acao, detectarEm(g.texto, { ...ctx, shell: g.shell, primeiroNivel: false }, profundidade + 1));
    if (!acao && /\$/.test(caminho)) acao = "merge";
    return acao;
  }
  const lidos = ctx.scripts;
  if (lidos.has(arquivo)) return lidos.get(arquivo);
  if (lidos.size >= MAX_SCRIPTS || profundidade >= PROFUNDIDADE_MAXIMA) return "merge";
  lidos.set(arquivo, null);
  let acao;
  try {
    const conteudo = statSync(arquivo).size > 256 * 1024 ? null : readFileSync(arquivo);
    if (!conteudo) acao = "merge";
    // Binário (byte zero no começo) não é script: nada a dizer.
    else if (conteudo.subarray(0, 4096).includes(0)) acao = null;
    else {
      const shell = /\.ps1$/i.test(arquivo) ? "powershell" : "bash";
      acao = detectarEm(conteudo.toString("utf8"), { ...ctx, shell, primeiroNivel: false }, profundidade + 1);
    }
  } catch {
    acao = "merge";
  }
  lidos.set(arquivo, acao);
  return acao;
}

// Script de texto na posição de comando: ./x.sh, .\x.ps1, scripts/x.sh, ./build
// (sem extensão). Executável (.exe, .com) não é lido.
const pareceScript = p =>
  /\.(sh|bash|ps1|cmd|bat)$/i.test(p) || (/^\.{1,2}[\\/]/.test(p) && !/\.[A-Za-z0-9]{1,4}$/.test(p));

// Opções dos shells que tomam valor (o valor não é o script).
const BASH_COM_VALOR = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);
const PWSH_COM_VALOR = new Set([
  "-executionpolicy", "-ep", "-ex", "-windowstyle", "-w", "-workingdirectory", "-wd", "-configurationname",
  "-version", "-v", "-inputformat", "-if", "-outputformat", "-of", "-psconsolefile", "-custompipename",
  "-settingsfile", "-settings",
]);

// O comando em string que o runner executa, se houver: o argumento de -c no
// bash, tudo depois de -Command no PowerShell, de /c no cmd, o texto do eval,
// do iex, do watch e o do parallel antes de :::.
function comandoEmString(exe, args) {
  const baixo = args.map(a => a.toLowerCase());
  if (["sh", "bash", "zsh", "dash", "ksh"].includes(exe)) {
    const k = baixo.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a) && !a.startsWith("--"));
    return k >= 0 ? args[k + 1] ?? null : null;
  }
  if (exe === "pwsh" || exe === "powershell") {
    const k = baixo.findIndex(a => a === "-c" || a === "-command" || a === "-com" || a === "-encodedcommand" || a === "-e" || a === "-ec");
    if (k < 0) return null;
    if (/^-(e|ec|encodedcommand)$/.test(baixo[k])) return "\u0000opaco";
    return args.slice(k + 1).join(" ");
  }
  if (exe === "cmd") {
    const k = baixo.findIndex(a => a === "/c" || a === "/k");
    if (k < 0) return null;
    // `cmd /c "git push"`: a linha inteira entre aspas é o comando; com várias
    // palavras, as aspas de cada uma ficam (`findstr "git push" *.md`).
    const resto = args.slice(k + 1);
    return resto.length === 1 ? resto[0] : resto.map(cotar).join(" ");
  }
  if (exe === "eval" || exe === "iex" || exe === "invoke-expression") return args.length ? args.join(" ") : null;
  // O watch junta os argumentos com espaço e entrega ao sh -c.
  if (exe === "watch") {
    const resto = [];
    for (let k = 0; k < args.length; k++) {
      if (/^(-n|--interval|-d|--differences|-g|-t|-b|-e|-p|-c|-x)$/.test(args[k]) && resto.length === 0) {
        if (/^(-n|--interval)$/.test(args[k])) k++;
        continue;
      }
      resto.push(args[k]);
    }
    return resto.length ? resto.join(" ") : null;
  }
  // O parallel roda o comando que vem antes de ::: (depois das opções dele).
  if (exe === "parallel") {
    const f = args.indexOf(":::");
    const antes = args.slice(0, f < 0 ? args.length : f);
    let k = 0;
    while (k < antes.length && antes[k].startsWith("-")) k += /^-[jJ]$/.test(antes[k]) ? 2 : 1;
    return antes.length > k ? antes.slice(k).map(cotar).join(" ") : null;
  }
  if (exe === "env") {
    const k = baixo.findIndex(a => a === "-s" || a === "--split-string" || a.startsWith("--split-string="));
    if (k < 0) return null;
    return baixo[k].includes("=") ? args[k].slice(args[k].indexOf("=") + 1) : args[k + 1] ?? null;
  }
  return null;
}

// O script que o runner lê, se houver: o primeiro argumento que não é opção
// (pulando valores de opção) nos shells; o de -File no PowerShell; o de /c no
// cmd; o de source e `.`.
function scriptDoRunner(exe, args) {
  const baixo = args.map(a => a.toLowerCase());
  if (exe === "pwsh" || exe === "powershell") {
    const f = baixo.findIndex(a => a === "-file" || a === "-f");
    if (f >= 0) return args[f + 1] ?? null;
    for (let k = 0; k < args.length; k++) {
      if (PWSH_COM_VALOR.has(baixo[k])) k++;
      else if (!args[k].startsWith("-")) return args[k];
    }
    return null;
  }
  if (exe === "cmd") {
    const k = baixo.findIndex(a => a === "/c" || a === "/k");
    return k >= 0 && args[k + 1] && pareceScript(args[k + 1]) ? args[k + 1] : null;
  }
  if (exe === "source" || exe === ".") return args.find(a => !a.startsWith("-")) ?? null;
  if (["sh", "bash", "zsh", "dash", "ksh"].includes(exe)) {
    // `bash -n x.sh` só confere a sintaxe: não executa nada.
    if (args.some(a => /^-[a-z]*n[a-z]*$/.test(a))) return null;
    for (let k = 0; k < args.length; k++) {
      if (BASH_COM_VALOR.has(args[k])) k++;
      else if (args[k] === "--") return args[k + 1] ?? null;
      else if (!args[k].startsWith("-") && !args[k].startsWith("+")) return args[k];
    }
  }
  return null;
}

// Quem executa outro comando: o que vem numa string, num arquivo ou na
// entrada padrão também é lido, com o shell de quem executa.
function classificarRunner(t, i, comandos, idx, ctx, profundidade) {
  const exe = nomeDoExecutavel(t[i]);
  const args = t.slice(i + 1, i + 1 + MAX_PALAVRAS_DO_RESTO);
  const shellDoFilho = SHELLS_POWERSHELL.has(exe) ? "powershell" : exe === "eval" || ["sh", "bash", "zsh", "dash", "ksh", "wsl"].includes(exe) ? "bash" : ctx.shell;
  const filho = { ...ctx, shell: shellDoFilho, primeiroNivel: false };
  let acao = null;
  const cmd = comandoEmString(exe, args);
  if (cmd === "\u0000opaco") return "merge";
  if (cmd !== null) {
    if (profundidade + 1 >= PROFUNDIDADE_MAXIMA) return "merge";
    // A string pode ser uma substituição: `bash -c "$(cat x.sh)"` lê o x.sh;
    // outra substituição ou uma variável pura: na dúvida, trava.
    const m = MARCA.exec(cmd);
    if (m && cmd.replace(MARCA, "").replace(/^[$@`]|`$/g, "").trim() === "") {
      const texto = ctx.subs[Number(m[1])] || "";
      const lido = lerShell(texto, ctx.shell).comandos[0]?.palavras || [];
      const ex = nomeDoExecutavel(lido[0] || "");
      if (["cat", "type", "get-content", "gc"].includes(ex)) {
        for (const a of lido.slice(1)) if (!a.startsWith("-")) acao = pior(acao, lerScript(a, ctx, profundidade));
      } else acao = pior(acao, "merge");
    } else if (/^\$[\w:{}[\]@]+$/.test(cmd.trim())) acao = pior(acao, "merge");
    else acao = pior(acao, detectarEm(cmd, filho, profundidade + 1));
  }
  // Arquivo de comandos (bash -o pipefail x.sh, pwsh -File x.ps1, source x.sh)
  // e o redirecionamento `bash < x.sh`.
  if (cmd === null) {
    const script = scriptDoRunner(exe, args);
    if (script) acao = pior(acao, lerScript(script, ctx, profundidade));
  }
  for (const r of comandos[idx].redirecoes) {
    if (!LEEM_ENTRADA.has(exe)) break;
    if (r.op === "<") acao = pior(acao, lerScript(r.alvo, ctx, profundidade));
    // Here-string do Bash: `bash <<< "git push"`.
    if (r.op === "<<<") acao = pior(acao, detectarEm(r.alvo, filho, profundidade + 1));
  }
  // Entrada padrão: `echo "git push" | bash`, `cat x.sh | bash`.
  if (LEEM_ENTRADA.has(exe) && cmd === null && !scriptDoRunner(exe, args) && idx > 0 && comandos[idx].sep === "|") {
    const anterior = comandos[idx - 1].palavras;
    const ia = indiceDoComando(anterior);
    const ex = nomeDoExecutavel(anterior[ia] || "");
    if (ECOS.has(ex)) acao = pior(acao, detectarEm(anterior.slice(ia + 1).join("\n"), filho, profundidade + 1));
    if (["cat", "type", "get-content", "gc"].includes(ex)) {
      for (const a of anterior.slice(ia + 1)) if (!a.startsWith("-")) acao = pior(acao, lerScript(a, ctx, profundidade));
    }
    // Se o anterior grava os heredocs dele no pipe (`cat <<EOF | bash`), o
    // corpo é lido em classificarComando.
  }
  return acao;
}

// Start-Process, Start-Job e Invoke-Command do PowerShell: o executável vem
// em -FilePath ou na primeira posição, e os argumentos em -ArgumentList.
function argumentosDoStartProcess(t, ic) {
  const args = t.slice(ic + 1);
  let exe = null;
  let lista = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k].toLowerCase();
    if (a === "-filepath" || a === "-file") exe = args[++k];
    else if (a === "-argumentlist" || a === "-args") {
      // A lista pode ter aspas por dentro ('-Command "git push"') e vírgulas
      // ('pr','merge'): é lida com o léxico do PowerShell.
      lista = lerShell(args[++k] || "", "powershell")
        .comandos.flatMap(c => c.palavras)
        .flatMap(p => p.split(","))
        .filter(Boolean);
    } else if (a.startsWith("-")) {
      if (["-workingdirectory", "-wd", "-verb", "-windowstyle", "-redirectstandardoutput", "-redirectstandarderror", "-redirectstandardinput", "-credential", "-name"].includes(a)) k++;
    } else if (!exe) exe = args[k];
  }
  return exe ? [exe, ...lista] : null;
}

// --------------------------------------------------------- classificar -----

function classificarComando(comandos, idx, ctx, profundidade) {
  const comando = comandos[idx];
  const t = comando.palavras;
  let acao = null;
  // Corpo de heredoc: comando se vai para um shell (`bash <<EOF`, `cat <<EOF | bash`);
  // se o delimitador não tem aspas, as substituições $( ) do corpo também rodam.
  for (const h of comando.heredocs) {
    const vaiParaShell = [idx, ...seguintesNoPipe(comandos, idx)].some(k => leAEntrada(comandos[k].palavras));
    if (vaiParaShell) acao = pior(acao, detectarEm(h.corpo, { ...ctx, primeiroNivel: false }, profundidade + 1));
    else if (h.expande) {
      for (const s of substituicoesEm(h.corpo, ctx.shell === "powershell")) {
        acao = pior(acao, detectarEm(s, { ...ctx, primeiroNivel: false }, profundidade + 1));
      }
    }
  }
  if (!t.length) return acao;
  const ic = indiceDoComando(t);
  const exeDoComando = nomeDoExecutavel(t[ic] || "");
  // echo e afins só escrevem texto.
  if (ECOS.has(exeDoComando)) return acao;
  // Alias definido antes no mesmo texto (`alias gp='git push'; gp`).
  const alias = ctx.aliases.get(exeDoComando);
  if (alias) acao = pior(acao, alias === "git" || alias === "gh" ? (alias === "git" ? classificarGit : classificarGh)(t, ic, ctx, profundidade) : alias);
  // Executável em variável seguido de commit/push/merge: `$GIT push` no Bash,
  // `& $git push` no PowerShell (sem o &, `$x` no começo é expressão).
  if (/^\$/.test(t[ic] || "") && (ctx.shell !== "powershell" || comando.sep === "&")) {
    for (const p of t.slice(ic + 1, ic + 4)) acao = pior(acao, acaoDaPalavra(p.toLowerCase()));
  }
  // Script na posição de comando: ./x.sh, .\x.ps1, & .\x.ps1.
  if (pareceScript(t[ic] || "") && !["git", "gh"].includes(exeDoComando) && !RUNNERS.has(exeDoComando)) {
    acao = pior(acao, lerScript(t[ic], ctx, profundidade));
  }
  // Start-Process / Start-Job / Invoke-Command com -ArgumentList.
  if (["start-process", "saps", "start", "start-job", "invoke-command"].includes(exeDoComando)) {
    const sintetico = argumentosDoStartProcess(t, ic);
    if (sintetico) acao = pior(acao, classificarComando([{ palavras: sintetico, sep: "", heredocs: [], redirecoes: [] }], 0, ctx, profundidade));
  }
  // node -e, python -c e afins: o código pode chamar o git.
  // Só quando o código executa outro programa (execSync, spawn, subprocess,
  // system): `m.detectar('git push')` num teste do hook não empurra nada.
  if (INTERPRETADORES.has(exeDoComando)) {
    for (let k = ic + 1; k < t.length - 1; k++) {
      if (/^(-e|--eval|-p|--print|-c|-r)$/.test(t[k]) && /\b(exec\w*|spawn\w*|system|popen|subprocess|check_output|check_call|shell_exec|passthru|Popen)\b/.test(t[k + 1])) {
        const codigo = t[k + 1];
        const g = REGEX_GIT.exec(codigo);
        if (g) acao = pior(acao, acaoDaPalavra(g[1].toLowerCase()) || "commit");
        if (REGEX_GH.test(codigo)) acao = pior(acao, "merge");
      }
    }
  }

  let naCadeia = true;
  let runners = 0;
  for (let i = 0; i < t.length; i++) {
    const exe = nomeDoExecutavel(t[i]);
    const ehDaCadeia = naCadeia && i >= ic;
    if (exe === "git") acao = pior(acao, classificarGit(t, i, ctx, profundidade));
    else if (exe === "gh") acao = pior(acao, classificarGh(t, i));
    else if (RUNNERS.has(exe) && runners < MAX_RUNNERS_POR_COMANDO) {
      // Fora da cadeia, só o shell com -c/-Command e a string (npx -y bash -c '...').
      const comString = SHELLS.has(exe) && comandoEmString(exe, t.slice(i + 1)) !== null;
      if (ehDaCadeia || comString) {
        runners++;
        acao = pior(acao, classificarRunner(t, i, comandos, idx, ctx, profundidade));
      }
    }
    // find -exec, -execdir, -ok: o que vem depois é outro comando.
    if (/^-(exec|execdir|ok|okdir)$/.test(t[i])) {
      const fim = t.findIndex((p, k) => k > i && (p === ";" || p === "+"));
      const sub = t.slice(i + 1, fim < 0 ? t.length : fim);
      acao = pior(acao, classificarComando([{ palavras: sub, sep: "", heredocs: [], redirecoes: [] }], 0, ctx, profundidade));
    }
    if (ehDaCadeia) {
      const continua =
        EMBRULHOS.has(exe) ||
        RUNNERS.has(exe) ||
        (i > ic &&
          (t[i].startsWith("-") ||
            /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i]) ||
            /^\d+[smhd]?$/.test(t[i]) ||
            VALOR_DE_EMBRULHO.has(t[i - 1])));
      if (!continua) naCadeia = false;
    }
  }
  return acao;
}

function seguintesNoPipe(comandos, idx) {
  const saida = [];
  for (let k = idx + 1; k < comandos.length && comandos[k].sep === "|"; k++) saida.push(k);
  return saida;
}

// O comando lê a entrada padrão como comandos? (bash, sh -s, pwsh -, iex;
// não com -c, -Command ou script: aí a entrada é dado.)
function leAEntrada(t) {
  const ic = indiceDoComando(t);
  for (let i = ic; i < t.length; i++) {
    const exe = nomeDoExecutavel(t[i]);
    if (LEEM_ENTRADA.has(exe)) {
      const args = t.slice(i + 1);
      return comandoEmString(exe, args) === null && !scriptDoRunner(exe, args);
    }
    const continua = EMBRULHOS.has(exe) || (i > ic && (t[i].startsWith("-") || /^\d+[smhd]?$/.test(t[i])));
    if (!continua) return false;
  }
  return false;
}

// O que o texto grava em arquivo (para o script gravado e rodado na mesma
// chamada): corpo de heredoc com > ou tee, echo/printf com >, Set-Content e
// afins com -Value ou pelo pipe.
function arquivosGravados(comandos, shell) {
  const saida = [];
  for (let k = 0; k < comandos.length; k++) {
    const c = comandos[k];
    const t = c.palavras;
    const ic = indiceDoComando(t);
    const exe = nomeDoExecutavel(t[ic] || "");
    const grava = c.redirecoes.some(r => r.op.startsWith(">")) || GRAVADORES.has(exe) || seguintesNoPipe(comandos, k).some(m => GRAVADORES.has(nomeDoExecutavel(comandos[m].palavras[indiceDoComando(comandos[m].palavras)] || "")));
    if (!grava) continue;
    for (const h of c.heredocs) saida.push({ texto: h.corpo, shell });
    if (ECOS.has(exe)) saida.push({ texto: t.slice(ic + 1).join("\n"), shell });
    if (GRAVADORES.has(exe)) {
      const v = t.findIndex(p => /^-value$/i.test(p));
      if (v >= 0 && t[v + 1]) saida.push({ texto: t[v + 1], shell: "powershell" });
    }
  }
  return saida;
}

// Diretórios para onde o texto vai (`cd sub && bash x.sh`).
function alvosDeCd(comandos) {
  const saida = [];
  for (const c of comandos) {
    const t = c.palavras;
    const ic = indiceDoComando(t);
    if (TROCAS_DE_LUGAR.has(nomeDoExecutavel(t[ic] || ""))) {
      const alvo = t.slice(ic + 1).find(p => !p.startsWith("-"));
      if (alvo) saida.push(alvo);
    }
  }
  return saida;
}

// Aliases do texto: `alias gp='git push'`, `alias g=git`, `Set-Alias g git`.
function aliasesDoTexto(comandos, ctx, profundidade) {
  const mapa = new Map(ctx.aliases);
  for (const c of comandos) {
    const t = c.palavras;
    const ic = indiceDoComando(t);
    const exe = nomeDoExecutavel(t[ic] || "");
    if (exe === "alias") {
      for (const p of t.slice(ic + 1)) {
        const m = /^([^=\s]+)=(.*)$/s.exec(p);
        if (!m) continue;
        const alvo = nomeDoExecutavel(m[2].trim().split(/\s+/)[0] || "");
        if ((alvo === "git" || alvo === "gh") && m[2].trim().split(/\s+/).length === 1) mapa.set(m[1].toLowerCase(), alvo);
        else {
          const a = detectarEm(m[2], { ...ctx, aliases: mapa, primeiroNivel: false }, profundidade + 1);
          if (a) mapa.set(m[1].toLowerCase(), a);
        }
      }
    }
    if (exe === "set-alias" || exe === "new-alias" || exe === "sal" || exe === "nal") {
      const pos = t.slice(ic + 1).filter(p => !p.startsWith("-"));
      const kn = t.findIndex(p => /^-name$/i.test(p));
      const kv = t.findIndex(p => /^-value$/i.test(p));
      const nome = kn >= 0 ? t[kn + 1] : pos[0];
      const valor = kv >= 0 ? t[kv + 1] : kn >= 0 ? pos.find(p => p !== t[kn + 1]) : pos[1];
      const alvo = nomeDoExecutavel(valor || "");
      if (nome && (alvo === "git" || alvo === "gh")) mapa.set(nome.toLowerCase(), alvo);
    }
  }
  return mapa;
}

function detectarEm(texto, ctx, profundidade) {
  if (profundidade > PROFUNDIDADE_MAXIMA) return "merge";
  const { comandos, subs } = lerShell(texto, ctx.shell);
  const aqui = { ...ctx, subs };
  if (profundidade === 0) {
    aqui.trocaDeLugar = trocaDeLugar(comandos);
    aqui.alvosDeCd = alvosDeCd(comandos);
    aqui.gravados = arquivosGravados(comandos, ctx.shell);
  }
  aqui.aliases = aliasesDoTexto(comandos, aqui, profundidade);
  let acao = null;
  for (let k = 0; k < comandos.length; k++) acao = pior(acao, classificarComando(comandos, k, aqui, profundidade));
  for (const s of subs) acao = pior(acao, detectarEm(s, { ...aqui, primeiroNivel: false }, profundidade + 1));
  return acao;
}

// Devolve a ação mais grave encontrada no comando inteiro, ou null.
// ctx: { shell: "bash" | "powershell", cwd, branch } — branch é a do diretório
// do comando (para soTrazAMain), como valor ou como função, chamada só quando
// o comando é um merge da main; cwd é esse diretório (para ler `bash x.sh`).
export function detectar(comando, ctx = {}) {
  if (typeof comando !== "string") return null;
  if (comando.length > MAX_TEXTO) return /\b(git|gh)(\.exe)?\b/i.test(comando) ? "merge" : null;
  const base = {
    shell: ctx.shell === "powershell" ? "powershell" : "bash",
    cwd: ctx.cwd,
    branch: ctx.branch,
    primeiroNivel: true,
    scripts: new Map(),
    aliases: new Map(),
    alvosDeCd: [],
    gravados: [],
    subs: [],
  };
  return detectarEm(comando, base, 0);
}

// ------------------------------------------------------------ modos -----

function lerStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function branchDoDiretorio(dir) {
  if (typeof dir !== "string" || !dir) return null;
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
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
  // A branch é a do diretório onde o comando roda (campo cwd da entrada do
  // hook), não a da raiz do projeto: o diretório do Bash persiste entre
  // chamadas. Sem cwd, a branch fica desconhecida e não há exceção. Ela só é
  // descoberta quando o comando é um merge da main: o `git rev-parse` em todo
  // comando somava latência no Windows. O cwd também serve para achar o
  // script de um `bash x.sh`. O shell decide as aspas e os escapes: na
  // ferramenta PowerShell a crase escapa e a barra é parte do caminho.
  let branch;
  const ctx = {
    shell: entrada.tool_name === "PowerShell" ? "powershell" : "bash",
    cwd: entrada.cwd,
    branch: () => (branch === undefined ? (branch = branchDoDiretorio(entrada.cwd)) : branch),
  };
  // Erro na análise não pode virar liberação silenciosa: se o comando cita git
  // ou gh e a leitura quebrou, trava (na dúvida, trava).
  let acao;
  try {
    acao = detectar(comando, ctx);
  } catch {
    acao = typeof comando === "string" && /\b(git|gh)(\.exe)?\b/i.test(comando) ? "merge" : null;
  }
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
          `[carimbo da WRW] ${v.motivo}. Se a mensagem inicia uma tarefa nova, antes de ` +
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
    console.error("Não achei origin/main. Este é o clone da WRW, com o remote origin?");
    process.exit(1);
  }
  if (!github.includes(sha)) {
    console.error(
      `O texto de --github precisa citar o commit atual de origin/main (${sha}), ` +
        "prova de que o log foi lido e não presumido."
    );
    process.exit(1);
  }
  // Com um merge da main em andamento (conflito a resolver), o que está no
  // MERGE_HEAD já foi trazido: o commit que conclui o merge precisa do carimbo.
  const mergeEmAndamento = git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  const atras = mergeEmAndamento
    ? git(["rev-list", "--count", "HEAD..origin/main", `^${mergeEmAndamento}`])
    : git(["rev-list", "--count", "HEAD..origin/main"]);
  if (atras && Number(atras) > 0) {
    console.error(
      `Sua branch (${branchAtual()}) está ${atras} commit(s) atrás de origin/main. ` +
        "Traga a main para ela com git merge origin/main (numa branch de trabalho isso não pede " +
        "carimbo; na main, use git pull --ff-only), leia o que entrou e carimbe de novo."
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
  // [comando, esperado, branch do diretório (opcional; padrão: desconhecida),
  //  shell (opcional; padrão: bash)]
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
    ["git merge origin/main", null, "fix/x"],
    ["git merge --no-edit origin/main", null, "fix/x"],
    ["git fetch --prune && git merge origin/main", null, "fix/x"],
    ["git merge origin/main", "merge", "main"],
    ["git merge feat/outra", "merge", "fix/x"],
    ["git merge origin/main feat/outra", "merge", "fix/x"],
    ["git merge -s ours origin/main", "merge", "fix/x"],
    ["git merge", "merge", "fix/x"],
    ["git merge --continue", "merge", "fix/x"],
    ["cd /outro && git merge origin/main", "merge", "fix/x"],
    ["{ cd /outro; git merge origin/main; }", "merge", "fix/x"],
    ["builtin cd /outro && git merge origin/main", "merge", "fix/x"],
    ["export GIT_DIR=/outro/.git; git merge origin/main", "merge", "fix/x"],
    ["git -C /outro merge origin/main", "merge", "fix/x"],
    ["git --git-dir=/outro/.git merge origin/main", "merge", "fix/x"],
    ['bash -c "git merge origin/main"', "merge", "fix/x"],
    // Revisão de 19/10: troca de diretório que o regex não pegava.
    ["Push-Location C:\\outro; git merge origin/main", "merge", "fix/x"],
    ["pushd /outro && git merge origin/main", "merge", "fix/x"],
    ['"cd" /outro && git merge origin/main', "merge", "fix/x"],
    ["\\cd /outro && git merge origin/main", "merge", "fix/x"],
    ["git merge --abort", null],
    ["git merge --quit", null],
    ["git merge -h", null],
    ["git merge --help", null],
    ["git -C /outro merge --abort", null],
    // Revisão de 19/10: -h, --help, --abort e --quit só liberam como argumento
    // único; noutra posição podem ser valor do -m e o merge acontece.
    ["git merge -m --abort feat/outra", "merge", "fix/x"],
    ["git merge -m --quit feat/outra", "merge", "fix/x"],
    ["git merge -m -h feat/outra", "merge", "fix/x"],
    ["git merge --abort origin/x", "merge", "fix/x"],
    ["git merge feat/outra --abort", "merge", "fix/x"],
    // O 2>&1 é redirecionamento do shell, não argumento do git (revisão de 19/10).
    ["git merge --abort 2>&1", null],
    ["git merge -m --dry-run feat/outra", "merge", "fix/x"],
    ["git merge --dry-run feat/outra", "merge", "fix/x"],
    ["git commit --dry-run", null],
    ["gh api repos/o/r --jq '.allow_auto_merge'", null],
    ["gh api repos/o/r/pulls/94 --jq '{merged_at: .merged_at}'", null],
    ["gh api repos/o/r/pulls/1/merge", null],
    ["gh api repos/o/r/pulls/1 --jq '.merged'", null],
    ["gh api repos/o/r/pulls/1 -q .mergeable_state", null],
    ["gh api 'repos/o/r/pulls?state=closed' --jq '.[].merged_at'", null],
    ["gh api --paginate repos/o/r/pulls --jq '.[] | select(.merged_at)'", null],
    ["gh api -i repos/o/r/pulls/1/merge", null],
    ["gh api -H 'Accept: application/vnd.github+json' repos/o/r/pulls/1/merge", null],
    ["gh api 'search/issues?q=is:merged+repo:o/r'", null],
    ["gh api -X PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api --method=PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api -XPUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api repos/o/r/merges -f base=main -f head=x", "merge"],
    ["gh api -X PATCH repos/o/r -F allow_auto_merge=true", "merge"],
    ["gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'", "merge"],
    ["gh api graphql -F query=@merge.graphql", "merge"],
    ["gh api https://api.github.com/graphql -f query='mutation { mergePullRequest }'", "merge"],
    // Revisão de 19/10: flag curta agrupada ou com valor colado, e as longas
    // com = ou separadas. Qualquer método conta, até GET (na dúvida, trava).
    ["gh api -iX PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api -iXPUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api -X=PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api repos/o/r/merges -iF base=main -iF head=x", "merge"],
    ["gh api repos/o/r/merges -if base=main -if head=x", "merge"],
    ["gh api repos/o/r/merges -Fbase=main", "merge"],
    ["gh api --method PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api --method=put repos/o/r/pulls/1/merge", "merge"],
    ["gh api repos/o/r/merges --field base=main --field head=x", "merge"],
    ["gh api repos/o/r/merges --field=base=main", "merge"],
    ["gh api repos/o/r/merges --raw-field base=main", "merge"],
    ["gh api repos/o/r/merges --raw-field=head=x", "merge"],
    ["gh api repos/o/r/merges --input corpo.json", "merge"],
    ["gh api repos/o/r/merges --input=corpo.json", "merge"],
    ["gh api -X PATCH repos/o/r/merges", "merge"],
    ["gh api -X PUT 'repos/o/r/pulls/1/merge'", "merge"],
    ['gh api -X PUT repos/o/r/pulls/1/mer""ge', "merge"],
    ["gh api -X GET repos/o/r/pulls/1/merge", "merge"],
    ["gh api --method GET repos/o/r/pulls/1/merge", "merge"],
    ["gh api -X GET search/issues -f q='is:merged'", "merge"],
    ["gh pr merge 12 --squash", "merge"],
    ["gh pr view 12", null],
    ["gh pr create --fill", null],
    ["gh repo sync", "push"],
    ['sh -c "git push origin main"', "push"],
    ['grep -n "git push" docs/x.md', null],
    ['echo "git commit"', null],
    ['echo \'{"command":"git add -A && git commit -m x"}\' | node hook.mjs', null],
    ['node .claude/hooks/carimbo.mjs --carimbar --github "PRs mergeadas por gh pr merge" --notion "x" --whatsapp "y"', null],
    ["pnpm exec tsx scripts/x.ts --nota 'git push feito'", null],
    ['bash -c "git push origin main"', "push"],
    ["pnpm test", null],
    // Revisão independente de 19/10: git e gh em qualquer posição do segmento.
    ["git status; if ($?) { git commit -m x }", "commit"],
    ["git add -A; if ($?) { git push -u origin feat/x }", "push"],
    ["if($?){git commit -m x}", "commit"],
    ["( git commit -m x )", "commit"],
    ["(git commit -m x)", "commit"],
    ["{ git push; }", "push"],
    ["if true; then git commit -m x; fi", "commit"],
    ["for i in 1; do git push; done", "push"],
    ["git status & git commit -m x", "commit"],
    ["! git commit -m x", "commit"],
    ["timeout 60 git push", "push"],
    ["time git commit -m x", "commit"],
    ["nice -n 10 git push", "push"],
    ["nohup git push &", "push"],
    ["command git commit -m x", "commit"],
    ["noglob git push", "push"],
    ["stdbuf -oL git push", "push"],
    ["git.exe commit -m x", "commit"],
    ["GIT.EXE push", "push"],
    ["& git.exe push origin feat/x", "push"],
    ["& 'C:\\Program Files\\Git\\bin\\git.exe' commit -m x", "commit"],
    ["gh.exe pr merge 12", "merge"],
    ["gh.exe api -X PUT repos/o/r/pulls/1/merge", "merge"],
    ["$saida = git commit -m x", "commit"],
    ["echo $(git push)", "push"],
    ["x=$(git commit -m y)", "commit"],
    ["echo `git push`", "push"],
    // --dry-run e -n só liberam como opção, não como valor de outra opção.
    ["git commit -m --dry-run", "commit"],
    ["git commit -am --dry-run", "commit"],
    ["git commit --message --dry-run", "commit"],
    ["git commit -m x -- --dry-run", "commit"],
    ["git push -o -n origin main", "push"],
    ["git push --push-option -n origin main", "push"],
    ["git commit -m x --dry-run", null],
    ["git push --dry-run origin feat/x", null],
    ["git push -n origin feat/x", null],
    ["git push -o ci.skip --dry-run origin x", null],
    // Opção global com valor separado e alias na linha.
    ["git --git-dir .git push", "push"],
    ["git --work-tree . commit -m x", "commit"],
    ["git --namespace x push", "push"],
    ["git -c alias.p=push p origin main", "merge"],
    ["git --config-env alias.p=VAR p", "merge"],
    ["git --config-env=alias.p=VAR p", "merge"],
    ["git -c core.quotepath=off status", null],
    ["git -c user.name=x log", null],
    // Quem executa outro comando: string, entrada padrão, heredoc e arquivo.
    ["Start-Process git -ArgumentList 'push origin main'", "push"],
    ["iex 'git push origin main'", "push"],
    ['Invoke-Expression "git commit -m x"', "commit"],
    ["cmd.exe /c git push", "push"],
    ["wsl git push", "push"],
    ['echo "git push" | bash', "push"],
    ["timeout 60 bash -c 'git push'", "push"],
    ["env -i bash -c 'git push'", "push"],
    ["bash <<EOF\ngit push\nEOF", "push"],
    ["bash mescla.sh", "merge"],
    ["sh -e mescla.sh", "merge"],
    ["source mescla.sh", "merge"],
    [". mescla.sh", "merge"],
    ["bash leitura.sh", null],
    ["bash nao-existe.sh", null],
    // Aspas coladas na flag e caminho com {owner}.
    ["gh api '-'X PUT repos/o/r/pulls/1/merge", "merge"],
    ['gh api --"method"=PUT repos/o/r/pulls/1/merge', "merge"],
    ["gh api --method\\=PUT repos/o/r/pulls/1/merge", "merge"],
    ["gh api repos/{owner}/{repo}/pulls/1/merge -X PUT", "merge"],
    // A troca de diretório colada em ; também tira a exceção do merge da main.
    ["Pop-Location; git merge origin/main", "merge", "fix/x"],
    ["popd; git merge origin/main", "merge", "fix/x"],
    ["git fetch; if ($?) { git merge origin/main }", null, "fix/x"],
    ["if ($?) { git merge --abort }", null],
    // Corpo de heredoc é dado; `<<` entre aspas não abre heredoc.
    ['echo "<<EOF"\ngit push\nEOF', "push"],
    ["git commit -F - <<'EOF'\nfix: x\n\ngit push --prune agora pergunta\nEOF", "commit"],
    ["cat > notas.md <<'EOF'\nRode git push -u origin feat/x\nEOF", null],
    // O que tem de continuar liberado.
    ["git status; if ($?) { git log --oneline -1 }", null],
    ["timeout 60 pnpm test", null],
    ["which git", null],
    ["git --version", null],
    ["echo git", null],
    ["grep -n bash LEIAME.md", null],
    ["find . -name LEIAME.md", null],
    ["git add .", null],
    ["gh pr create --title x --body-file corpo.md", null],
    ["gh api 'repos/o/r/pulls?state=closed&per_page=100' --jq '.[].merged_at'", null],
    ["git log --format='%h (%an)' -3", null],
    ["corepack pnpm vitest run server/carimbo.test.ts", null],
    // Revisão adversarial de 19/10 (segunda rodada): comentário, aspas
    // escapadas, heredoc dentro de "$( )", here-string, delimitador com hífen.
    ["git fetch --prune\n# traz a main (git merge origin/main) antes da PR\ngit merge --no-edit origin/main", null, "fix/x"],
    ["# 1. o que entrou (nada de gh pr merge sem carimbo)\ngit log --oneline -15 origin/main", null],
    ['node .claude/hooks/carimbo.mjs --carimbar --github "diff: \\"timeout 60 git push origin main\\" agora trava" --notion "x" --whatsapp "y"', null],
    ['gh pr create --title x --body "$(cat <<\'EOF\'\n- Antes, "timeout 60 git push" passava.\n- O parser trata a aspa (") solta.\nEOF\n)"', null],
    ["gh pr create --title x --body @'\n- Lê o que vem d'outro comando.\n- Trava git push escondido.\n'@", null, null, "powershell"],
    ["cat > corpo.md <<'FIM-DO-CORPO'\nO hook trava o git push escondido.\nFIM-DO-CORPO", null],
    ["cat > x.md <<\\EOF\ngit push\nEOF", null],
    ["cd . && cat > x.md <<'EOF'\ngit push\nEOF", null],
    ["cat > notas.md <<EOF\n\tEOF\ngit push citado na nota\nEOF", null],
    ["git add . && git commit -F - <<'EOF'\nfix: x\n\nDepois rode gh pr merge 12\nEOF", "commit"],
    ["bash rodar.sh", null],
    ["echo Rode git push depois do exame", null],
    ["Write-Host 'git push feito'", null, null, "powershell"],
    ['git -c alias.lg="log --oneline --graph" lg -10', null],
    ['grep -n "\\"" server/x.ts', null],
    ["git pull --ff-only", null],
    ["git pull origin main", null, "fix/x"],
    ["./binario.exe", null],
    ["bash eu.sh", null],
    // $( ) e crase dentro de aspas e em heredoc sem aspas no delimitador.
    ['saida="$(git push -u origin feat/x 2>&1)"\necho "$saida"', "push"],
    ['echo "push: $(git push -u origin feat/x 2>&1)"', "push"],
    ['$saida = "$(git push -u origin feat/x 2>&1)"; $saida', "push", null, "powershell"],
    ['$r = "$(gh pr merge 161 --squash 2>&1)"', "merge", null, "powershell"],
    ["cat > rel.md <<EOF\nResultado: $(git push -u origin feat/x 2>&1)\nEOF", "push"],
    // Comentário com apóstrofo ou aspa ímpar não esconde a linha seguinte.
    ["# Nicolas's review ok\ngit push -u origin feat/x", "push"],
    ["# it's green\ngh pr merge 161 --squash", "merge"],
    ["git add -A # it's fine\ngit commit -m x", "commit"],
    ['# tela de 5" ainda quebra\ngit push -u origin feat/x', "push"],
    // Here-string e "$(cat <<'EOF')" com aspa ímpar não escondem o comando seguinte.
    ["gh pr create --title x --body @'\nIt's ready\n'@\ngh pr merge --auto --squash", "merge", null, "powershell"],
    ["git tag -a v1 -m @'\nRoberto's release\n'@\ngit push origin feat/x --follow-tags", "push", null, "powershell"],
    ['gh pr create --title x --body "$(cat <<\'EOF\'\n- a aspa (") solta.\nEOF\n)" && gh pr merge --auto --squash', "merge"],
    // Aspas escapadas no Bash.
    ['grep -n "\\"" server/x.ts && git push origin feat/x', "push"],
    ['git status && echo "a \\" b" && gh pr merge 12 --squash', "merge"],
    ['git commit -m "x \\" --dry-run \\" y"', "commit"],
    // Scripts: -File, opções com valor, ./x, < x, cat x | bash.
    ["powershell -ExecutionPolicy Bypass -File publica.ps1", "push", null, "powershell"],
    ["pwsh -NoProfile -ExecutionPolicy Bypass -File .\\publica.ps1", "push", null, "powershell"],
    ["& .\\publica.ps1", "push", null, "powershell"],
    [".\\publica.ps1", "push", null, "powershell"],
    ["Get-Content publica.ps1 -Raw | Invoke-Expression", "push", null, "powershell"],
    ["./publica.sh", "push"],
    ["bash -o pipefail publica.sh", "push"],
    ["bash < publica.sh", "push"],
    ["cat publica.sh | bash", "push"],
    // Outros que gravam commit, mesclam ou empurram.
    ["git revert --no-edit HEAD", "commit"],
    ["git cherry-pick abc1234", "commit"],
    ["git am < patch.mbox", "commit"],
    ["git pull --no-rebase origin feat/outra", "merge", "fix/x"],
    ["gh pr update-branch 161", "push"],
    ["gh pr -R Movits/MMM merge 161 --squash", "merge"],
    ["Start-Process gh -ArgumentList 'pr merge 161 --squash' -Wait", "merge", null, "powershell"],
    ["Start-Process gh -ArgumentList 'pr','merge','161','--squash' -Wait", "merge", null, "powershell"],
    ["$p = Start-Process git -ArgumentList 'push -u origin feat/x' -PassThru", "push", null, "powershell"],
    ["gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc", "push"],
    ["gh api -X PUT repos/o/r/contents/README.md -f message=x -f branch=main", "push"],
    ["gh api graphql -F query=@consulta.graphql", "merge"],
    // Continuação de linha, if/else sem ;, variáveis e outros embrulhos.
    ["git -c user.name=Claude \\\n  push -u origin feat/x", "push"],
    ["git -c user.name=Claude `\n  push -u origin feat/x", "push", null, "powershell"],
    ["if ($?) { git push -u origin feat/x } else { Write-Host 'falhou' -n }", "push", null, "powershell"],
    ["$git = 'git'; & $git push -u origin feat/x", "push", null, "powershell"],
    ["$a = @('push','-u','origin','feat/x'); git @a", "merge", null, "powershell"],
    ["$cmd = 'git push -u origin feat/x'; Invoke-Expression $cmd", "merge", null, "powershell"],
    ["find . -maxdepth 0 -exec bash -c 'git push -u origin feat/x' \\;", "push"],
    ["parallel bash -c 'git -C {} push' ::: a b", "push"],
    ["watch -n 60 'git push'", "push"],
    ["sudo -u roberto bash -c 'git push'", "push"],
    // Revisão adversarial de 19/10 (terceira rodada): redirecionamento não é
    // argumento; a string de um runner é lida com o shell dele, sem regex cega.
    ["git merge origin/main 2>&1", null, "fix/x"],
    ["git merge --no-edit origin/main 2>&1 | tail -5", null, "fix/x"],
    ["git merge origin/main > /tmp/m.log", null, "fix/x"],
    ["git pull origin main 2>&1", null, "fix/x"],
    ["git merge origin/main *>&1", null, "fix/x", "powershell"],
    ["git merge origin/main 2>&1 feat/outra", "merge", "fix/x"],
    ["git push>push.log 2>&1", "push"],
    ["bash -c 'git pull --ff-only'", null],
    ["bash -c 'git merge-base HEAD origin/main'", null],
    ["bash -c 'grep -rn \"git push\" docs'", null],
    ["bash -c 'gh api repos/o/r/pulls/161 --jq .merged_at'", null],
    ["watch -n 30 'gh api repos/o/r/pulls/161 --jq .mergeable_state'", null],
    ["& \"C:\\Program Files\\Git\\bin\\bash.exe\" -lc \"cd /c/x && git switch main && git pull --ff-only\"", null, null, "powershell"],
    ["bash -lc \"node .claude/hooks/carimbo.mjs --carimbar --github 'git push e gh pr merge travam' --notion 'x' --whatsapp 'y'\"", null],
    ["git ls-files '*.md' | xargs grep -l \"git push\"", null],
    ["git ls-files | xargs -I{} grep -l 'git commit' {}", null],
    ["cmd /c findstr /s /n \"git push\" *.md", null, null, "powershell"],
    ['cmd /c "git push"', "push", null, "powershell"],
    ["xargs -I{} sh -c 'git -C {} push'", "push"],
    ["git fetch && git merge --ff-only origin/main", null, "main"],
    ["git merge --ff-only feat/outra", "merge", "main"],
    ["git merge -q origin/main", null, "fix/x"],
    ["git merge --quiet --no-edit -m 'traz a main' origin/main", null, "fix/x"],
    ["git push -h", null],
    ["git commit --help", null],
    ["gh pr merge --help", null],
    ["gh api graphql -f query='query { repository(owner: \"o\", name: \"r\") { pullRequest(number: 161) { mergeable } } }'", null],
    ["gh api -X POST graphql -f query='query { viewer { login } }' --jq '.data.viewer.mergeable'", null],
    ["pwsh -NoProfile -c ls CLAUDE.md", null],
    ["bash -c 'wc -l \"$1\"' _ LEIAME.md", null],
    ["bash -c 'cat > notas.md' <<'EOF'\nRode git push depois.\nEOF", null],
    ["if ($modo -eq 'push') { Write-Host 'empurrar' }", null, null, "powershell"],
    ["wsl -l -v; echo 'depois: git push'", null, null, "powershell"],
    ["git -c alias.mb=merge-base mb HEAD origin/main", null],
    // Escapes da terceira rodada.
    ["cat > novo.sh <<'EOF'\nset -e\ngh pr merge 161 --merge --admin\nEOF\nbash novo.sh", "merge"],
    ["echo 'git push -u origin feat/x' > novo2.sh && bash novo2.sh", "push"],
    ["gh --repo Movits/MMM pr merge 161 --squash", "merge"],
    ["gh -R Movits/MMM pr update-branch 161", "push"],
    ["cd sub && bash so-no-sub.sh", "merge"],
    ["bash $SCRIPT", "merge"],
    ['bash -c "$(cat publica.sh)"', "push"],
    ["grep -n $'Nicolas\\'s' CLAUDE.md && git push -u origin feat/x", "push"],
    ["echo ${X:-$(gh pr merge 161 --squash)}", "merge"],
    ["Start-Process git -WorkingDirectory C:\\repo -ArgumentList 'push -u origin feat/x' -Wait", "push", null, "powershell"],
    ["alias gp='git push'\ngp -u origin feat/x", "push"],
    ["Set-Alias g git; g push -u origin feat/x", "push", null, "powershell"],
    ["git submodule foreach 'git push'", "push"],
    ["git rebase -x 'git push' origin/main", "push"],
    ["git rebase origin/main", "commit"],
    ["git rebase --abort", null],
    ["cmd /c publica.bat", "push", null, "powershell"],
    ["winpty bash -c 'git push'", "push"],
    ["npx -y bash -c 'git push'", "push"],
    ["git log --% --author=O'Brien -1\ngit push -u origin feat/x", "push", null, "powershell"],
    ["node -e \"require('child_process').execSync('git push -u origin feat/x')\"", "push"],
    ["python -c \"import subprocess; subprocess.run(['git', 'push'])\"", "push"],
    ["pwsh -NoProfile -Command 'Write-Host \"Pasta: C:\\repo\\\"; git -C C:\\repo push origin feat/x'", "push"],
    ['bash <<< "git push origin feat/x"', "push"],
    ["Start-Process pwsh -ArgumentList '-Command \"git push origin x\"'", "push", null, "powershell"],
    ["Start-Process pwsh -ArgumentList '-c','git push origin x'", "push", null, "powershell"],
    // O que tem de continuar liberado (corpus de 275 comandos da revisão).
    ["node -e \"import('./.claude/hooks/carimbo.mjs').then(m => console.log(m.detectar('git push origin main')))\"", null],
    ["gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: \"x\"}) { thread { isResolved } } }'", null],
    ["gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'", "merge"],
    ["gh api repos/o/r/issues/161/comments -f body='Revisado: pronto para merge quando o CI ficar verde.'", null],
    ["gh api repos/o/r/pulls/161/reviews -f event=COMMENT -f body='Pode mergear depois do CI.'", null],
    ["bash -n LEIAME.md", null],
  ];
  // Arquivos dos casos de runner: um script que mescla, um só de leitura e um
  // texto que cita git push (não é script e não pode travar o grep).
  const pasta = mkdtempSync(path.join(tmpdir(), "carimbo-testar-"));
  writeFileSync(path.join(pasta, "mescla.sh"), "set -e\ngh pr merge 160 --merge --admin\n");
  writeFileSync(path.join(pasta, "leitura.sh"), "git status\ngh pr view 12\n");
  writeFileSync(path.join(pasta, "LEIAME.md"), "Rode `git push -u origin feat/x`.\n");
  writeFileSync(path.join(pasta, "publica.sh"), "git push -u origin feat/x\n");
  writeFileSync(path.join(pasta, "publica.ps1"), "git push -u origin feat/x\n");
  writeFileSync(path.join(pasta, "rodar.sh"), "# antes rodava gh pr merge 12\npnpm test\n");
  writeFileSync(path.join(pasta, "eu.sh"), "bash eu.sh\n");
  writeFileSync(path.join(pasta, "binario.exe"), Buffer.from([0x4d, 0x5a, 0, 0, 0x67, 0x69, 0x74]));
  writeFileSync(path.join(pasta, "publica.bat"), "git push -u origin feat/x\r\n");
  mkdirSync(path.join(pasta, "sub"));
  writeFileSync(path.join(pasta, "sub", "so-no-sub.sh"), "gh pr merge 161 --squash\n");
  // O caminho do script como o Git Bash escreve (/c/Users/...) e entre aspas.
  const noGitBash = path.join(pasta, "mescla.sh").replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  casos.push([`bash ${noGitBash}`, "merge"], [`bash "${path.join(pasta, "mescla.sh")}"`, "merge"]);
  let falhas = 0;
  for (const [cmd, esperado, branch, shell] of casos) {
    const obtido = detectar(cmd, { branch: branch || null, cwd: pasta, shell: shell || "bash" });
    const ok = obtido === esperado;
    if (!ok) falhas++;
    const onde = (branch ? ` [branch ${branch}]` : "") + (shell === "powershell" ? " [PowerShell]" : "");
    console.log(`${ok ? "ok  " : "ERRO"} ${JSON.stringify(cmd)}${onde} -> ${obtido} (esperado ${esperado})`);
  }
  rmSync(pasta, { recursive: true, force: true });
  // Desempenho: o hook roda em todo comando e tem 15 s de teto; passou disso,
  // o Claude Code segue sem ele. Comandos de ~200 KB têm de sair em segundos.
  const grandes = [
    ["bash <<'EOF'\n" + "x\n".repeat(130000) + "git push origin main\nEOF", "push", "heredoc de 130 mil linhas para o bash"],
    ["x << y\n".repeat(30000) + "git push origin main", null, "30 mil heredocs sem fim"],
    ["git merge ".repeat(25000), "merge", "25 mil git merge numa linha"],
    ["bash ".repeat(20000) + "gh api -X PUT x/merge", "merge", "20 mil bash numa linha"],
    ['echo "' + "a".repeat(200000) + '"', null, "string de 200 KB"],
  ];
  for (const [cmd, esperado, nome] of grandes) {
    const t0 = Date.now();
    let obtido;
    try {
      obtido = detectar(cmd, { branch: "fix/x" });
    } catch (erro) {
      obtido = `exceção: ${erro.message}`;
    }
    const ms = Date.now() - t0;
    const ok = obtido === esperado && ms < 5000;
    if (!ok) falhas++;
    console.log(`${ok ? "ok  " : "ERRO"} desempenho: ${nome} -> ${obtido} em ${ms} ms (esperado ${esperado}, < 5000 ms)`);
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
