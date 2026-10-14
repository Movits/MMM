import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  avisosDoBanco,
  classificarHost,
  descreverGit,
  descreverIdade,
  lerEnv,
  montarAviso,
  precisaInstalar,
} from "../.claude/hooks/inicio-de-sessao.mjs";

/**
 * O hook de início de sessão (.claude/hooks/inicio-de-sessao.mjs) avisa,
 * antes do primeiro comando, quando o .env de trabalho aponta para um banco
 * remoto — o .env já apontou para a produção e `pnpm test` chegou a promover
 * uma usuária real. Ele vive em .claude/hooks (Node puro, roda antes de existir
 * node_modules), mas as funções são puras: testadas aqui porque o projeto
 * "server" do vitest colhe server/** (mesmo padrão de transcricao-destacada).
 */

// Pedaços de um .env "real" que nunca podem aparecer na saída.
const SEGREDOS = [
  "avnadmin",
  "SENHA-SECRETA",
  "exemplo-falso",
  "12345",
  "defaultdb",
  "outra-senha",
  "banco.exemplo.com.br",
];
const URL_AIVEN =
  "mysql://avnadmin:SENHA-SECRETA@exemplo-falso.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED";
const URL_REMOTA = "mysql://root:outra-senha@banco.exemplo.com.br:3306/testes";
const URL_LOCAL = "mysql://root:root@127.0.0.1:3306/banco_local";

const semSegredo = (texto: string) => SEGREDOS.filter(s => texto.includes(s));

describe("classificarHost: só a classe do banco, nunca o endereço", () => {
  it("sem valor é 'ausente'", () => {
    expect(classificarHost(undefined)).toBe("ausente");
    expect(classificarHost("")).toBe("ausente");
    expect(classificarHost("   ")).toBe("ausente");
  });

  it("a própria máquina é 'local'", () => {
    expect(classificarHost("mysql://root:root@localhost:3306/db")).toBe(
      "local"
    );
    expect(classificarHost("mysql://root:root@127.0.0.1:3306/db")).toBe(
      "local"
    );
    expect(classificarHost("mysql://root:root@127.0.1.1/db")).toBe("local");
    expect(classificarHost("mysql://root:root@[::1]:3306/db")).toBe("local");
    expect(classificarHost("mysql://root@0.0.0.0/db")).toBe("local");
    expect(classificarHost("mysql://root:root@app.localhost/db")).toBe("local");
  });

  it("host.docker.internal e nome de serviço sem ponto (Docker) são 'local'", () => {
    expect(
      classificarHost("mysql://root:root@host.docker.internal:3306/db")
    ).toBe("local");
    expect(classificarHost("mysql://root:root@mysql:3306/db")).toBe("local");
  });

  it("*.aivencloud.com é 'aiven', em qualquer caixa", () => {
    expect(classificarHost(URL_AIVEN)).toBe("aiven");
    expect(classificarHost("mysql://u:p@MMM-X.AIVENCLOUD.COM:1/db")).toBe(
      "aiven"
    );
  });

  it("qualquer outro host é 'remoto' (inclusive IP da rede)", () => {
    expect(classificarHost(URL_REMOTA)).toBe("remoto");
    expect(classificarHost("mysql://u:p@10.0.0.5/db")).toBe("remoto");
    expect(classificarHost("mysql://u:p@203.0.113.7:3306/db")).toBe("remoto");
  });

  it("senha com @, # ou / sem codificar não faz banco remoto parecer local", () => {
    // Com new URL, "u:123#x@..." viraria host "u" (sem ponto, logo local).
    expect(classificarHost("mysql://u:123#x@banco.exemplo.com.br/db")).toBe(
      "remoto"
    );
    expect(classificarHost("mysql://u:a/b@c@banco.exemplo.com.br/db")).toBe(
      "remoto"
    );
    expect(
      classificarHost("mysql://avnadmin:abc#def@x.aivencloud.com:1/defaultdb")
    ).toBe("aiven");
    expect(classificarHost("mysql://root:p#1@localhost/db")).toBe("local");
  });

  it("o que não é URL de banco é 'invalido'", () => {
    expect(classificarHost("não é url")).toBe("invalido");
    expect(classificarHost("localhost:3306")).toBe("invalido");
    expect(classificarHost("mysql:///db")).toBe("invalido");
    expect(classificarHost("mysql://")).toBe("invalido");
  });
});

describe("lerEnv: o mínimo do dotenv", () => {
  it("lê aspas, comentários, linha vazia e export", () => {
    const env = lerEnv(
      [
        "# comentário",
        "",
        'A="com espaço # e cerquilha"',
        "B='simples'",
        "C=`crase`",
        "D=sem aspas # comentário no fim",
        "export E=exportada",
        "F=",
        "  G = com espaços  ",
      ].join("\n")
    );
    expect(env).toEqual({
      A: "com espaço # e cerquilha",
      B: "simples",
      C: "crase",
      D: "sem aspas",
      E: "exportada",
      F: "",
      G: "com espaços",
    });
  });

  it("aceita CRLF e BOM, e a última ocorrência vence", () => {
    expect(lerEnv("\uFEFFX=1\r\nY=2\r\nX=3\r\n")).toEqual({ X: "3", Y: "2" });
  });

  it("ignora linha sem '=' e entrada que não é texto", () => {
    expect(lerEnv("só texto\n=sem chave")).toEqual({});
    expect(lerEnv(undefined)).toEqual({});
  });
});

describe("avisosDoBanco", () => {
  it("tudo local: uma linha de resumo, sem ATENÇÃO", () => {
    const linhas = avisosDoBanco({
      DATABASE_URL: URL_LOCAL,
      DATABASE_URL_TESTES: URL_LOCAL,
    });
    expect(linhas).toEqual([
      "Banco: DATABASE_URL local · DATABASE_URL_TESTES local.",
    ]);
  });

  it("sem DATABASE_URL_TESTES diz que o teste de integração se pula", () => {
    const [linha] = avisosDoBanco({ DATABASE_URL: URL_LOCAL });
    expect(linha).toContain(
      "DATABASE_URL_TESTES ausente (o teste de integração se pula)"
    );
  });

  it("banco remoto no .env vira ATENÇÃO, com o efeito de cada variável", () => {
    const [linha] = avisosDoBanco({
      DATABASE_URL: URL_AIVEN,
      DATABASE_URL_TESTES: URL_REMOTA,
    });
    expect(linha.startsWith("ATENÇÃO:")).toBe(true);
    expect(linha).toContain(
      "DATABASE_URL (do .env) aponta para banco REMOTO (Aiven)"
    );
    expect(linha).toContain(
      "DATABASE_URL_TESTES (do .env) aponta para banco REMOTO (fora desta máquina)"
    );
    expect(linha).toContain(
      "pnpm dev usaria esse banco e pnpm test gravaria nele"
    );
  });

  it("a variável do terminal vence a do .env (o dotenv não sobrescreve)", () => {
    const [linha] = avisosDoBanco(
      { DATABASE_URL: URL_LOCAL },
      { DATABASE_URL: URL_AIVEN }
    );
    expect(linha).toContain(
      "DATABASE_URL (do terminal) aponta para banco REMOTO (Aiven)"
    );
    expect(linha).toContain("os scripts de banco");
    expect(
      avisosDoBanco({ DATABASE_URL: URL_AIVEN }, { DATABASE_URL: URL_LOCAL })[0]
    ).not.toContain("ATENÇÃO");
  });

  it("sem .env e sem variável no terminal, manda copiar o .env.example", () => {
    expect(avisosDoBanco({}, {}, false)).toEqual([
      "Banco: não há .env. Peça à pessoa para copiar o .env.example para .env e preencher (o Claude não lê nem escreve o .env; veja o README).",
    ]);
  });

  it("RUN_LIVE_CREDENTIAL_TESTS=true acrescenta uma ATENÇÃO; outro valor não", () => {
    const ligado = avisosDoBanco({
      DATABASE_URL: URL_LOCAL,
      RUN_LIVE_CREDENTIAL_TESTS: "true",
    });
    expect(ligado).toHaveLength(2);
    expect(ligado[1]).toMatch(/^ATENÇÃO: RUN_LIVE_CREDENTIAL_TESTS=true/);
    expect(
      avisosDoBanco({
        DATABASE_URL: URL_LOCAL,
        RUN_LIVE_CREDENTIAL_TESTS: "false",
      })
    ).toHaveLength(1);
  });

  it("nunca imprime valor de variável, em nenhum caso", () => {
    const casos = [
      avisosDoBanco({
        DATABASE_URL: URL_AIVEN,
        DATABASE_URL_TESTES: URL_REMOTA,
      }),
      avisosDoBanco(
        {},
        { DATABASE_URL: URL_AIVEN, DATABASE_URL_TESTES: URL_REMOTA }
      ),
      avisosDoBanco({ DATABASE_URL: "mysql://avnadmin:SENHA-SECRETA@" }),
      avisosDoBanco({
        DATABASE_URL: URL_REMOTA,
        RUN_LIVE_CREDENTIAL_TESTS: "true",
      }),
    ];
    for (const linhas of casos)
      expect(semSegredo(linhas.join("\n"))).toEqual([]);
  });
});

describe("descreverGit, descreverIdade e precisaInstalar", () => {
  const base = {
    branch: "feat/x",
    atras: 2,
    afrente: 1,
    sha: "8123111",
    suja: false,
    fetchOk: true,
  };

  it("no local avisa que o atraso é desde o último fetch", () => {
    const linha = descreverGit({
      ...base,
      nuvem: false,
      idadeDoFetch: "há 3 dias",
    });
    expect(linha).toBe(
      "Sessão local · branch feat/x · 2 atrás / 1 à frente de origin/main (8123111), desde o último fetch (há 3 dias) · árvore limpa."
    );
  });

  it("na nuvem, com fetch falho, diz que os números são do último fetch", () => {
    expect(descreverGit({ ...base, nuvem: true, fetchOk: false })).toContain(
      "o fetch falhou"
    );
    expect(descreverGit({ ...base, nuvem: true })).not.toContain("fetch");
  });

  it("sem origin/main ou sem git, diz o que falta", () => {
    expect(descreverGit({ ...base, nuvem: false, sha: null })).toContain(
      "origin/main não encontrado"
    );
    expect(descreverGit({ nuvem: false })).toBe(
      "Sessão local · não consegui ler o git."
    );
  });

  it("idade em minutos, horas e dias", () => {
    expect(descreverIdade(5 * 60_000)).toBe("há 5 min");
    expect(descreverIdade(3 * 3_600_000)).toBe("há 3 h");
    expect(descreverIdade(3 * 86_400_000)).toBe("há 3 dias");
  });

  it("instala quando falta node_modules ou o lock é mais novo", () => {
    expect(precisaInstalar({ mtimeModulos: null, mtimeLock: 1 })).toBe(true);
    expect(precisaInstalar({ mtimeModulos: 1, mtimeLock: 2 })).toBe(true);
    expect(precisaInstalar({ mtimeModulos: 2, mtimeLock: 1 })).toBe(false);
  });
});

describe("montarAviso", () => {
  const git = {
    branch: "feat/x",
    atras: 0,
    afrente: 0,
    sha: "8123111",
    suja: false,
    idadeDoFetch: "há 1 h",
  };

  it("na main pede uma branch antes de mudar arquivo", () => {
    const linhas = montarAviso({
      nuvem: false,
      git: { ...git, branch: "main" },
    });
    expect(linhas.some(l => l.startsWith("ATENÇÃO: você está na main"))).toBe(
      true
    );
    expect(
      montarAviso({ nuvem: false, git }).some(l => l.includes("está na main"))
    ).toBe(false);
  });

  it("na nuvem traz a linha do 403 e do MySQL e não fala do .env", () => {
    const linhas = montarAviso({
      nuvem: true,
      git,
      banco: ["Banco: x"],
      carimbo: "Carimbo VÁLIDO: y.",
    });
    expect(linhas).toContain(
      "Na nuvem: gh pr/gh issue dão 403 (use as ferramentas mcp__github__*); não há MySQL (o banco do zero fica com o CI)."
    );
    expect(linhas).not.toContain("Banco: x");
  });

  it("aponta as skills só quando elas existem", () => {
    expect(montarAviso({ nuvem: false, git, skillsProntas: true }).at(-1)).toBe(
      "Para começar: /comecar-tarefa. Antes da PR: /abrir-pr. O Claude só mescla ou toca produção a pedido da pessoa, com permissão."
    );
    expect(
      montarAviso({ nuvem: false, git, skillsProntas: false }).at(-1)
    ).toContain("Fluxo de trabalho");
  });

  it("no pior caso fica em até 8 linhas e sem segredo", () => {
    const linhas = montarAviso({
      nuvem: false,
      git: { ...git, branch: "main" },
      dependencias: "Dependências: não há node_modules; rode pnpm install.",
      banco: avisosDoBanco({
        DATABASE_URL: URL_AIVEN,
        DATABASE_URL_TESTES: URL_REMOTA,
        RUN_LIVE_CREDENTIAL_TESTS: "true",
      }),
      carimbo: "Carimbo INVÁLIDO: nenhum carimbo.",
      skillsProntas: true,
    });
    expect(linhas.length).toBeLessThanOrEqual(8);
    expect(semSegredo(linhas.join("\n"))).toEqual([]);
  });
});

describe("o hook rodado de verdade (modo local, sem rede)", () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "inicio-de-sessao-"));
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  it("sai com 0, devolve o JSON do SessionStart e não vaza o .env", () => {
    writeFileSync(
      path.join(pasta, ".env"),
      `DATABASE_URL="${URL_AIVEN}"\nDATABASE_URL_TESTES=${URL_REMOTA}\nJWT_SECRET=SENHA-SECRETA\n`
    );
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const hook = path.resolve(
      aqui,
      "..",
      ".claude",
      "hooks",
      "inicio-de-sessao.mjs"
    );
    const r = spawnSync(process.execPath, [hook], {
      encoding: "utf8",
      timeout: 20_000,
      // Ambiente mínimo e explícito: sem CLAUDE_CODE_REMOTE (modo local, sem
      // rede) e sem o DATABASE_URL que o setup da suíte deixa no processo.
      env: {
        PATH: process.env.PATH,
        ...(process.env.SYSTEMROOT
          ? { SYSTEMROOT: process.env.SYSTEMROOT }
          : {}),
        CLAUDE_PROJECT_DIR: pasta,
      },
    });

    expect(r.status).toBe(0);
    const saida = JSON.parse(r.stdout);
    expect(saida.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(saida.hookSpecificOutput.additionalContext).toContain(
      "REMOTO (Aiven)"
    );
    expect(saida.systemMessage).toMatch(/^ATENÇÃO: DATABASE_URL \(do \.env\)/);
    expect(semSegredo(r.stdout + r.stderr)).toEqual([]);
  });
});
