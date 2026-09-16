import { DeleteObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect, type MySqlColumn, type MySqlTable } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O áudio de reunião é apagado 24 h depois da transcrição ou da falha
 * (decisão da Dra. Glenda; antes eram 30 dias contados do envio). A
 * transcrição fica.
 *
 * Aqui o banco é um fake que EXECUTA o SQL que o drizzle renderiza: o LEFT
 * JOIN da gravação com a reunião, `<=`, `>`, `<>`, `in`, `is null`, `or` — e
 * aplica UPDATE e DELETE nas linhas que casam. A regra só se prova assim: um
 * fake que devolvesse sempre as mesmas linhas não diria se a gravação antiga
 * sai, se a nova fica ou se a de uma reunião em 'processing' é poupada. O
 * relógio é falso (só Date), para a fronteira das 24 h ser exata. E toda
 * leitura cede uma volta do event loop (setImmediate), como um banco de
 * verdade: uma paginação que não avança falha pelo prazo do teste em vez de
 * travar o vitest.
 *
 * O que se trava:
 * - a primeira passada depois do deploy tira o áudio das reuniões transcritas
 *   há mais de 24 h, das falhas de 01/09 e das gravações sem reunião; encurta
 *   o das transcritas há pouco; não toca 'processing' nem 'deleted'; e pagina;
 * - o que a poda põe no passado sai pela CHAVE quando a instância velha apaga a
 *   linha no meio — também se a poda de dentro cair depois —, e só então: com
 *   a linha lá, um reprocesso tomado no meio da poda fica com o áudio;
 * - a linha legada com a chave em "/manus-storage/..." sai com as versões da
 *   chave REAL, pela varredura, pela leitura e pela exclusão;
 * - a poda ajusta o 'ready' nos dois sentidos e só encurta o 'failed', sem
 *   desfazer a renovação de um reprocesso que deu certo no meio dela;
 * - o reprocesso que deu certo e não conseguiu gravar a renovação fica com o
 *   áudio até a nova transcrição + 24 h, mesmo depois do prazo velho;
 * - o apagamento pula 'processing' e a renovação pendente, vai em lotes e para
 *   quando o bucket falha;
 * - a exclusão com o bucket falhando deixa a linha da gravação para a
 *   varredura, que a tira quando o bucket volta;
 * - de ponta a ponta, pelo envio: em transcrição + 24 h − 1 ms o áudio fica,
 *   em + 24 h sai, e a transcrição continua.
 */

type Linha = Record<string, unknown>;
const dialeto = new MySqlDialect();
const schema = await import("../drizzle/schema");

// ---------------------------------------------------------------- o banco ---
const banco = new Map<unknown, Linha[]>();
const linhasDe = (tabela: unknown): Linha[] => {
  if (!banco.has(tabela)) banco.set(tabela, []);
  return banco.get(tabela)!;
};
type Escrita = { tipo: "update" | "insert" | "delete"; tabela: unknown; sql: string; params: unknown[]; valores?: Linha };
const escritas: Escrita[] = [];
const leituras: Array<{ tabela: unknown; sql: string }> = [];
// Chamado depois de cada SELECT calcular as linhas e antes de devolvê-las: é
// o "enquanto isso" de uma corrida.
let aoLer: ((tabela: unknown) => void) | null = null;
// Chamado depois de cada UPDATE aplicado: o "enquanto isso" de outra instância.
let aoAtualizar: ((tabela: unknown) => void) | null = null;
// Aguardado ANTES de cada UPDATE: o "enquanto isso" entre o SELECT e o UPDATE
// de quem escreve — um reprocesso tomado no meio da poda, por exemplo.
let antesDeAtualizar: ((tabela: unknown) => Promise<void>) | null = null;
// Quantas vezes o UPDATE do prazo do 'ready' (SET simples por meeting_id e
// owner_id, sem `>`) lança antes de passar.
let falhasDoPrazoDoReady = 0;

const renderizar = (condicao?: SQL) => (condicao ? dialeto.sqlToQuery(condicao) : { sql: "", params: [] as unknown[] });

/** A linha vista pelo nome das colunas no banco (`tabela`.`coluna`), como o SQL a cita. */
function registro(partes: Array<[MySqlTable, Linha | null]>): Linha {
  const valores: Linha = {};
  for (const [tabela, linha] of partes) {
    const nome = getTableName(tabela);
    for (const [chave, coluna] of Object.entries(getTableColumns(tabela))) {
      valores[`${nome}.${coluna.name}`] = linha ? (linha[chave] ?? null) : null;
    }
  }
  return valores;
}

const normal = (valor: unknown) => (typeof valor === "boolean" ? Number(valor) : valor);
function comparar(a: unknown, operador: string, b: unknown): boolean {
  // NULL do LEFT JOIN não casa com nada, nem com `<>`: é o que obriga o `is null`.
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const [x, y] = [normal(a), normal(b)] as [number | string, number | string];
  switch (operador) {
    case "=": return x === y;
    case "<>": return x !== y;
    case "<": return x < y;
    case "<=": return x <= y;
    case ">": return x > y;
    case ">=": return x >= y;
    default: throw new Error(`operador desconhecido: ${operador}`);
  }
}

type Token =
  | { tipo: "(" | ")" | "and" | "or" }
  | { tipo: "nulo"; ref: string }
  | { tipo: "in"; ref: string; quantos: number }
  | { tipo: "comparacao"; ref: string; operador: string; direita: string | null };
const TOKEN = /\s*(?:(\()|(\))|(and)\b|(or)\b|`(\w+)`\.`(\w+)` is null|`(\w+)`\.`(\w+)` in \(((?:\?, )*\?)\)|`(\w+)`\.`(\w+)` (<>|<=|>=|=|<|>) (?:(\?)|`(\w+)`\.`(\w+)`))/y;

/** Compila um WHERE renderizado numa função da linha. O que o fake não entende LANÇA. */
function avaliador(condicao: SQL | undefined): (valores: Linha) => boolean {
  if (!condicao) return () => true;
  const { sql, params } = dialeto.sqlToQuery(condicao);
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < sql.length) {
    const m = TOKEN.exec(sql);
    if (!m) throw new Error(`o fake não sabe avaliar: ${sql}`);
    if (m[1]) tokens.push({ tipo: "(" });
    else if (m[2]) tokens.push({ tipo: ")" });
    else if (m[3]) tokens.push({ tipo: "and" });
    else if (m[4]) tokens.push({ tipo: "or" });
    else if (m[5]) tokens.push({ tipo: "nulo", ref: `${m[5]}.${m[6]}` });
    else if (m[7]) tokens.push({ tipo: "in", ref: `${m[7]}.${m[8]}`, quantos: m[9].split(",").length });
    else tokens.push({ tipo: "comparacao", ref: `${m[10]}.${m[11]}`, operador: m[12], direita: m[13] ? null : `${m[14]}.${m[15]}` });
  }
  let i = 0;
  let parametro = 0;
  type Teste = (valores: Linha) => boolean;
  const primario = (): Teste => {
    const token = tokens[i++];
    if (token?.tipo === "(") {
      const dentro = ou();
      if (tokens[i++]?.tipo !== ")") throw new Error(`parêntese sem par: ${sql}`);
      return dentro;
    }
    if (token?.tipo === "nulo") return valores => valores[token.ref] === null || valores[token.ref] === undefined;
    if (token?.tipo === "in") {
      const lista = params.slice(parametro, parametro + token.quantos);
      parametro += token.quantos;
      return valores => lista.some(valor => comparar(valores[token.ref], "=", valor));
    }
    if (token?.tipo === "comparacao") {
      if (token.direita) return valores => comparar(valores[token.ref], token.operador, valores[token.direita!]);
      const valor = params[parametro++];
      return valores => comparar(valores[token.ref], token.operador, valor);
    }
    throw new Error(`o fake não sabe avaliar: ${sql}`);
  };
  const e = (): Teste => {
    let teste = primario();
    while (tokens[i]?.tipo === "and") { i++; const anterior = teste; const proximo = primario(); teste = v => anterior(v) && proximo(v); }
    return teste;
  };
  const ou = (): Teste => {
    let teste = e();
    while (tokens[i]?.tipo === "or") { i++; const anterior = teste; const proximo = e(); teste = v => anterior(v) || proximo(v); }
    return teste;
  };
  const teste = ou();
  if (i !== tokens.length || parametro !== params.length) throw new Error(`o fake não sabe avaliar: ${sql}`);
  return teste;
}

function selecionar(campos?: Record<string, MySqlColumn>) {
  return {
    from: (tabela: MySqlTable) => {
      let juncao: { tabela: MySqlTable; on: SQL } | null = null;
      let condicao: SQL | undefined;
      let ordens: SQL[] = [];
      let limite = Number.POSITIVE_INFINITY;
      const executar = () => {
        const casaJuncao = juncao ? avaliador(juncao.on) : null;
        const casa = avaliador(condicao);
        let registros = linhasDe(tabela).map(linha => {
          const partes: Array<[MySqlTable, Linha | null]> = [[tabela, linha]];
          if (juncao && casaJuncao) {
            const par = linhasDe(juncao.tabela).find(outra => casaJuncao(registro([[tabela, linha], [juncao!.tabela, outra]]))) ?? null;
            partes.push([juncao.tabela, par]);
          }
          return { linha, valores: registro(partes) };
        }).filter(({ valores }) => casa(valores));
        for (const ordem of [...ordens].reverse()) {
          const m = /^`(\w+)`\.`(\w+)` (asc|desc)$/.exec(dialeto.sqlToQuery(ordem).sql);
          if (!m) throw new Error("ordenação que o fake não entende");
          const ref = `${m[1]}.${m[2]}`;
          const sentido = m[3] === "desc" ? -1 : 1;
          registros = [...registros].sort((a, b) => {
            const [x, y] = [a.valores[ref], b.valores[ref]] as [number | string, number | string];
            return (x < y ? -1 : x > y ? 1 : 0) * sentido;
          });
        }
        leituras.push({ tabela, sql: renderizar(condicao).sql });
        const linhas = registros.slice(0, limite).map(({ linha, valores }) => (campos
          ? Object.fromEntries(Object.entries(campos).map(([chave, coluna]) => [chave, valores[`${getTableName(coluna.table)}.${coluna.name}`] ?? null]))
          : { ...linha }));
        aoLer?.(tabela);
        return linhas;
      };
      const consulta = {
        leftJoin: (outra: MySqlTable, on: SQL) => { juncao = { tabela: outra, on }; return consulta; },
        where: (c?: SQL) => { condicao = c; return consulta; },
        orderBy: (...o: SQL[]) => { ordens = o; return consulta; },
        limit: (n: number) => { limite = n; return consulta; },
        // Uma volta do event loop por leitura (macrotarefa): só com microtarefas,
        // um laço de paginação que não avança nunca deixaria o prazo do teste disparar.
        then: (resolver: (linhas: Linha[]) => unknown, rejeitar?: (erro: unknown) => unknown) =>
          new Promise(pronto => setImmediate(pronto)).then(executar).then(resolver, rejeitar),
      };
      return consulta;
    },
  };
}

const fakeDb = {
  select: (campos?: Record<string, MySqlColumn>) => selecionar(campos),
  update: (tabela: MySqlTable) => ({ set: (valores: Linha) => ({ where: async (condicao?: SQL) => {
    if (antesDeAtualizar) await antesDeAtualizar(tabela);
    const renderizado = renderizar(condicao);
    escritas.push({ tipo: "update", tabela, valores, ...renderizado });
    const prazoDoReady = tabela === schema.meetingRecordings && renderizado.sql.includes("`meeting_id`") && !renderizado.sql.includes(">");
    if (prazoDoReady && falhasDoPrazoDoReady > 0) {
      falhasDoPrazoDoReady -= 1;
      throw new Error("Lock wait timeout exceeded; try restarting transaction");
    }
    const casa = avaliador(condicao);
    const alvos = linhasDe(tabela).filter(linha => casa(registro([[tabela, linha]])));
    for (const linha of alvos) Object.assign(linha, valores);
    aoAtualizar?.(tabela);
    return [{ affectedRows: alvos.length }];
  } }) }),
  insert: (tabela: MySqlTable) => ({ values: async (valores: Linha | Linha[]) => {
    for (const linha of [valores].flat()) {
      escritas.push({ tipo: "insert", tabela, sql: "", params: [], valores: linha });
      linhasDe(tabela).push({ ...linha });
    }
  } }),
  delete: (tabela: MySqlTable) => ({ where: async (condicao?: SQL) => {
    escritas.push({ tipo: "delete", tabela, ...renderizar(condicao) });
    const casa = avaliador(condicao);
    const antes = linhasDe(tabela).length;
    banco.set(tabela, linhasDe(tabela).filter(linha => !casa(registro([[tabela, linha]]))));
    return [{ affectedRows: antes - linhasDe(tabela).length }];
  } }),
};
vi.mock("./db", () => ({ exigirDb: async () => fakeDb as never, getDb: async () => fakeDb as never }));

// ---------------------------------------------------- bucket, IA e relógio ---
const noBucket = new Set<string>();
const apagadasDoBucket: string[] = [];
let bucketFora = false;
// Ligado, o expurgo é o de VERDADE (storage.ts), sobre um bucket com versões
// simulado no `send` do S3Client: é como se prova que a chave de uma linha
// legada chega normalizada ao HEAD, ao DELETE e à listagem.
let expurgoDeVerdade = false;
vi.mock("./storage", async importOriginal => {
  const real = await importOriginal<typeof import("./storage")>();
  return {
    ...real,
    storagePut: async (chave: string) => {
      const key = chave.replace(/(\.\w+)$/, "_abc12345$1");
      noBucket.add(key);
      return { key, url: `/manus-storage/${key}` };
    },
    storageApagarTodasAsVersoes: async (chave: string) => {
      if (expurgoDeVerdade) return real.storageApagarTodasAsVersoes(chave);
      if (bucketFora) throw new Error("bucket fora do ar");
      apagadasDoBucket.push(chave);
      noBucket.delete(chave);
    },
    storageDelete: async () => { throw new Error("áudio de reunião não sai por storageDelete: só esconderia a versão"); },
    // Lê do bucket falso: um reprocesso cujo áudio já saiu falha como na vida
    // real, em vez de receber bytes de um objeto que não existe.
    storageGetBytes: async (chave: string) => {
      if (!noBucket.has(chave)) throw new real.ObjetoAusenteNoStorageError(chave);
      return Buffer.from("áudio guardado da reunião");
    },
  };
});
let falhaDaTranscricao: Error | null = null;
// O "enquanto isso" da IA: é aqui que o relógio anda entre a tomada e o fim.
let aoTranscrever: (() => void) | null = null;
vi.mock("./gemini", async importOriginal => ({
  ...await importOriginal<typeof import("./gemini")>(),
  transcribeWithGemini: async () => {
    aoTranscrever?.();
    if (falhaDaTranscricao) throw falhaDaTranscricao;
    return { text: "Transcrição da reunião.", segments: [], language: "pt" };
  },
  embedWithGemini: async () => [],
  embedManyWithGemini: async () => [],
}));
vi.mock("./_core/llm", () => ({
  invokeLLM: async () => ({ choices: [{ message: { content: JSON.stringify({ entities: [], contacts: [] }) } }] }),
}));

const servico = await import("./meeting-service");
const PRAZO = servico.PRAZO_DO_AUDIO_MS;

const AGORA = Date.parse("2026-09-14T12:00:00Z");
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const DONA = "dona-1";

const reuniao = (id: string, extra: Linha = {}): Linha => ({
  id, ownerId: DONA, title: "Reunião", contactId: null, contextId: null, status: "ready", consentGranted: true,
  consentAt: AGORA - 3 * DIA, language: "pt", processingError: null, createdAt: AGORA - 3 * DIA, updatedAt: AGORA - 3 * DIA, ...extra,
});
const chaveDe = (meetingId: string, id: string) => `meetings/${DONA}/${meetingId}/recording_${id}.webm`;
const gravacao = (id: string, meetingId: string, extra: Linha = {}): Linha => ({
  id, meetingId, ownerId: DONA, storageKey: chaveDe(meetingId, id), storageUrl: `/manus-storage/${chaveDe(meetingId, id)}`,
  mimeType: "audio/webm", sizeBytes: 100, durationSeconds: 60, expiresAt: AGORA + 27 * DIA, createdAt: AGORA - 3 * DIA, ...extra,
});
const gravacaoAtual = (id: string) => linhasDe(schema.meetingRecordings).find(linha => linha.id === id);
const apagadasDo = (tabela: unknown) => escritas.filter(escrita => escrita.tipo === "delete" && escrita.tabela === tabela);
const leiturasDoApagamento = () => leituras.filter(leitura => leitura.tabela === schema.meetingRecordings && leitura.sql.includes("<="));
const leiturasDaPoda = () => leituras.filter(leitura => leitura.tabela === schema.meetingRecordings && leitura.sql.includes("`meeting_recordings`.`expires_at` >"));
const avisos = () => JSON.stringify(vi.mocked(console.warn).mock.calls);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  banco.clear();
  escritas.length = 0;
  leituras.length = 0;
  aoLer = null;
  aoAtualizar = null;
  antesDeAtualizar = null;
  falhasDoPrazoDoReady = 0;
  noBucket.clear();
  apagadasDoBucket.length = 0;
  bucketFora = false;
  expurgoDeVerdade = false;
  falhaDaTranscricao = null;
  aoTranscrever = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a primeira passada depois do deploy — as gravações de antes da regra", () => {
  it("'ready' transcrita há 3 dias, com o prazo velho (envio + 30 dias), sai na PRIMEIRA chamada: o objeto e a linha — e a transcrição, as entidades, as sugestões e as traduções ficam", async () => {
    banco.set(schema.meetings, [reuniao("r-antiga")]);
    banco.set(schema.meetingRecordings, [gravacao("g-antiga", "r-antiga")]);
    banco.set(schema.meetingTranscripts, [{ id: "t-1", meetingId: "r-antiga", ownerId: DONA, transcript: "O que foi dito.", createdAt: AGORA - 3 * DIA }]);
    banco.set(schema.meetingEntities, [{ id: "e-1", meetingId: "r-antiga", ownerId: DONA, createdAt: AGORA - 3 * DIA }]);
    banco.set(schema.meetingContactSuggestions, [{ id: "s-1", meetingId: "r-antiga", ownerId: DONA, createdAt: AGORA - 3 * DIA }]);
    banco.set(schema.meetingTranscriptTranslations, [{ id: "tr-1", meetingId: "r-antiga", ownerId: DONA }]);

    const resultado = await servico.limparGravacoesVencidas();

    expect(resultado).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 1 });
    // uma ida ao bucket só: a chave que a poda pôs no passado sai pela chave, e a linha não a manda de novo
    expect(apagadasDoBucket).toEqual([chaveDe("r-antiga", "g-antiga")]);
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(escritas.filter(escrita => escrita.tipo === "delete").map(escrita => escrita.tabela)).toEqual([schema.meetingRecordings]);
    expect(linhasDe(schema.meetingTranscriptTranslations)).toHaveLength(1);

    const dados = await servico.getPrivateMeeting(DONA, "r-antiga");
    expect(dados?.transcript?.transcript).toBe("O que foi dito.");
    expect(dados?.entities).toHaveLength(1);
    expect(dados?.suggestions).toHaveLength(1);
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(true);
  });

  it("'failed' de 01/09 (reunião de teste): o áudio sai na primeira passada; a reunião, não — o código só apaga o áudio", async () => {
    const falhou = Date.parse("2026-09-01T15:00:00Z");
    banco.set(schema.meetings, [reuniao("r-teste", { status: "failed", processingError: "Não foi possível transcrever o áudio.", createdAt: falhou - HORA, updatedAt: falhou })]);
    banco.set(schema.meetingRecordings, [gravacao("g-teste", "r-teste", { createdAt: falhou - HORA, expiresAt: falhou - HORA + 30 * DIA })]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 1 });
    expect(apagadasDoBucket).toEqual([chaveDe("r-teste", "g-teste")]);
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(linhasDe(schema.meetings)).toHaveLength(1);
  });

  it("'ready' transcrita há 2 h: o prazo é ENCURTADO para a transcrição + 24 h, e o áudio fica até lá", async () => {
    banco.set(schema.meetings, [reuniao("r-recente", { updatedAt: AGORA - 2 * HORA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-recente", "r-recente", { createdAt: AGORA - 2 * HORA - MINUTO, expiresAt: AGORA - 2 * HORA - MINUTO + 30 * DIA })]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 1 });
    expect(gravacaoAtual("g-recente")?.expiresAt).toBe(AGORA - 2 * HORA + PRAZO);
    expect(apagadasDoBucket).toEqual([]);
    const dados = await servico.getPrivateMeeting(DONA, "r-recente");
    expect(dados?.recording?.expiresAt).toBe(AGORA + 22 * HORA);
  });

  it("'processing' e 'deleted' ficam intactas (a execução ou a exclusão em curso decide); gravação sem reunião — ou com uma reunião de mesmo id de OUTRA dona — vence já e sai", async () => {
    banco.set(schema.meetings, [
      reuniao("r-processando", { status: "processing", updatedAt: AGORA - 5 * MINUTO }),
      reuniao("r-excluida", { status: "deleted", updatedAt: AGORA - 2 * DIA }),
      // Em 'processing', ela pouparia a gravação se o JOIN não exigisse a mesma dona.
      reuniao("r-alheia", { ownerId: "outra-dona", status: "processing", updatedAt: AGORA - 5 * MINUTO }),
    ]);
    banco.set(schema.meetingRecordings, [
      gravacao("g-alheia", "r-alheia", { expiresAt: AGORA + 5 * DIA }),
      gravacao("g-excluida", "r-excluida", { expiresAt: AGORA + 20 * DIA }),
      gravacao("g-orfa", "r-sumiu", { expiresAt: AGORA + 10 * DIA }),
      gravacao("g-processando", "r-processando", { expiresAt: AGORA + 30 * DIA }),
    ]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 2, apagadas: 2, prazosAjustados: 2 });
    expect(linhasDe(schema.meetingRecordings).map(linha => [linha.id, linha.expiresAt])).toEqual([
      ["g-excluida", AGORA + 20 * DIA],
      ["g-processando", AGORA + 30 * DIA],
    ]);
    expect(apagadasDoBucket.sort()).toEqual([chaveDe("r-alheia", "g-alheia"), chaveDe("r-sumiu", "g-orfa")]);
  });

  it("a poda pagina: com lotes de 2, as 5 gravações de reunião pronta são ajustadas, em 3 leituras", async () => {
    banco.set(schema.meetings, [reuniao("r-pagina", { updatedAt: AGORA - HORA })]);
    banco.set(schema.meetingRecordings, Array.from({ length: 5 }, (_, i) => gravacao(`g-${i}`, "r-pagina", { expiresAt: AGORA + 29 * DIA })));

    expect(await servico.ajustarPrazosDasGravacoes(2)).toEqual({ prazosAjustados: 5, vencidasNaPoda: [] });
    expect(linhasDe(schema.meetingRecordings).map(linha => linha.expiresAt)).toEqual(Array(5).fill(AGORA - HORA + PRAZO));
    expect(leiturasDaPoda()).toHaveLength(3);
  });

  it("201 gravações antigas (mais de um lote da poda) saem todas na primeira chamada, cada chave uma vez no bucket", async () => {
    banco.set(schema.meetings, [reuniao("r-muitas")]);
    banco.set(schema.meetingRecordings, Array.from({ length: 201 }, (_, i) => gravacao(`g-${String(i).padStart(3, "0")}`, "r-muitas")));

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 201, apagadas: 201, prazosAjustados: 201 });
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(apagadasDoBucket).toHaveLength(201);
    expect(new Set(apagadasDoBucket).size).toBe(201);
  });
});

describe("o deploy com a instância velha ainda no ar", () => {
  it("a velha abre a reunião logo depois de a poda pôr o prazo no passado — só esconde o áudio e apaga a linha —, e a passada do boot tira a voz pela CHAVE", async () => {
    banco.set(schema.meetings, [reuniao("r-antiga")]);
    banco.set(schema.meetingRecordings, [gravacao("g-antiga", "r-antiga")]);
    noBucket.add(chaveDe("r-antiga", "g-antiga"));
    // A instância velha (sem as versões): DELETE simples, que deixa a versão no
    // bucket, e a linha fora. Sem a chave vinda da poda, a passada não acharia
    // linha nenhuma e a voz ficaria no bucket para sempre.
    aoAtualizar = tabela => {
      if (tabela !== schema.meetingRecordings) return;
      aoAtualizar = null;
      banco.set(schema.meetingRecordings, []);
    };

    // O boot: a poda com await, e a passada com as chaves que ela devolveu.
    const poda = await servico.ajustarPrazosDasGravacoes();
    expect(poda).toEqual({ prazosAjustados: 1, vencidasNaPoda: [chaveDe("r-antiga", "g-antiga")] });
    const passada = await servico.limparGravacoesVencidas(poda.vencidasNaPoda);

    // a voz conta como encontrada e apagada: a auditoria não subconta
    expect(passada).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 0 });
    expect(apagadasDoBucket).toEqual([chaveDe("r-antiga", "g-antiga")]);
    expect(noBucket.size).toBe(0);
  });

  it("sem as chaves do boot (a passada de 5 min): a velha apaga a linha logo depois do UPDATE da poda de dentro, e a voz sai pela CHAVE no fim da passada", async () => {
    banco.set(schema.meetings, [reuniao("r-antiga")]);
    banco.set(schema.meetingRecordings, [gravacao("g-antiga", "r-antiga")]);
    noBucket.add(chaveDe("r-antiga", "g-antiga"));
    aoAtualizar = tabela => {
      if (tabela !== schema.meetingRecordings) return;
      aoAtualizar = null;
      banco.set(schema.meetingRecordings, []);
    };

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 1 });
    expect(apagadasDoBucket).toEqual([chaveDe("r-antiga", "g-antiga")]);
    expect(noBucket.size).toBe(0);
  });

  it("a poda de dentro cai (queda passageira do banco): a chave do boot cuja linha a velha apagou já saiu do bucket ANTES, e não se perde com o erro", async () => {
    banco.set(schema.meetings, [reuniao("r-antiga")]);
    noBucket.add(chaveDe("r-antiga", "g-antiga"));
    // A primeira leitura da poda de dentro lança, como uma conexão que caiu.
    aoLer = () => {
      if (!leiturasDaPoda().length) return;
      aoLer = null;
      throw new Error("Connection lost: The server closed the connection.");
    };

    await expect(servico.limparGravacoesVencidas([chaveDe("r-antiga", "g-antiga")])).rejects.toThrow("Connection lost");

    expect(apagadasDoBucket).toEqual([chaveDe("r-antiga", "g-antiga")]);
    expect(noBucket.size).toBe(0);
  });
});

describe("a poda: 'ready' nos dois sentidos, 'failed' só encurta", () => {
  it("'failed' com o prazo já MENOR que o alvo fica como está: a falha de um reprocesso não estende o prazo contado da primeira falha — nem pela varredura", async () => {
    // Primeira falha às 10:00 de ontem (prazo: hoje 10:00 + ... = daqui a 2 h);
    // o reprocesso falhou de novo há 1 h e gravou updated_at novo.
    banco.set(schema.meetings, [reuniao("r-refalhou", { status: "failed", updatedAt: AGORA - HORA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-refalhou", "r-refalhou", { expiresAt: AGORA + 2 * HORA })]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
    expect(gravacaoAtual("g-refalhou")?.expiresAt).toBe(AGORA + 2 * HORA);
    expect(escritas.filter(escrita => escrita.tipo === "update")).toEqual([]);
  });

  it("'ready' com o prazo MENOR que a transcrição + 24 h (renovação que não foi gravada) é ESTENDIDO — inclusive com o prazo velho já vencido", async () => {
    banco.set(schema.meetings, [
      reuniao("r-curta", { updatedAt: AGORA - 2 * HORA }),
      reuniao("r-vencida", { updatedAt: AGORA - 3 * HORA }),
    ]);
    banco.set(schema.meetingRecordings, [
      gravacao("g-curta", "r-curta", { expiresAt: AGORA + HORA }),
      gravacao("g-vencida", "r-vencida", { expiresAt: AGORA - MINUTO }),
    ]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 2 });
    expect(gravacaoAtual("g-curta")?.expiresAt).toBe(AGORA - 2 * HORA + PRAZO);
    expect(gravacaoAtual("g-vencida")?.expiresAt).toBe(AGORA - 3 * HORA + PRAZO);
    expect(apagadasDoBucket).toEqual([]);
  });

  it("o UPDATE da poda é compare-and-set no prazo LIDO: um reprocesso que dá certo entre a leitura e o UPDATE mantém a renovação", async () => {
    banco.set(schema.meetings, [reuniao("r-corrida", { status: "failed", updatedAt: AGORA - 2 * HORA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-corrida", "r-corrida", { expiresAt: AGORA + 10 * DIA })]);
    // Enquanto a poda tem o 'failed' na mão, o reprocesso termina: 'ready' e
    // prazo renovado para a nova transcrição + 24 h.
    aoLer = tabela => {
      if (tabela !== schema.meetingRecordings) return;
      aoLer = null;
      Object.assign(linhasDe(schema.meetings)[0], { status: "ready", updatedAt: AGORA });
      Object.assign(gravacaoAtual("g-corrida")!, { expiresAt: AGORA + PRAZO });
    };

    expect(await servico.ajustarPrazosDasGravacoes()).toEqual({ prazosAjustados: 0, vencidasNaPoda: [] });

    expect(gravacaoAtual("g-corrida")?.expiresAt).toBe(AGORA + PRAZO);
    const [poda] = escritas.filter(escrita => escrita.tipo === "update");
    expect(poda.valores).toEqual({ expiresAt: AGORA - 2 * HORA + PRAZO });
    expect({ sql: poda.sql, params: poda.params }).toEqual({
      sql: "(`meeting_recordings`.`id` = ? and `meeting_recordings`.`expires_at` = ?)",
      params: ["g-corrida", AGORA + 10 * DIA],
    });
    // e a passada seguinte, com o 'ready' lido, não tem o que ajustar
    expect(await servico.ajustarPrazosDasGravacoes()).toEqual({ prazosAjustados: 0, vencidasNaPoda: [] });
  });
});

describe("o reprocesso que deu certo renova o prazo — mesmo com a escrita do prazo falhando", () => {
  // Primeira falha há 22 h: o prazo gravado vence daqui a 2 h. O reprocesso dá
  // certo agora, e a regra passa a ser a nova transcrição (AGORA) + 24 h.
  const PRIMEIRA_FALHA = AGORA - 22 * HORA;
  const PRAZO_VELHO = PRIMEIRA_FALHA + PRAZO;
  async function reprocessarComFalhaAntiga() {
    banco.set(schema.meetings, [reuniao("r-refeita", { status: "failed", processingError: "Não foi possível transcrever o áudio.", createdAt: PRIMEIRA_FALHA - 5 * MINUTO, updatedAt: PRIMEIRA_FALHA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-refeita", "r-refeita", { createdAt: PRIMEIRA_FALHA - 3 * MINUTO, expiresAt: PRAZO_VELHO })]);
    noBucket.add(chaveDe("r-refeita", "g-refeita"));
    const { trabalho } = await servico.iniciarReprocessamento(DONA, "r-refeita");
    await trabalho;
    expect(linhasDe(schema.meetings)[0]).toMatchObject({ status: "ready", updatedAt: AGORA });
  }

  it("a escrita falha UMA vez: a tentativa seguinte grava a renovação, sem aviso", async () => {
    falhasDoPrazoDoReady = 1;
    await reprocessarComFalhaAntiga();
    expect(gravacaoAtual("g-refeita")?.expiresAt).toBe(AGORA + PRAZO);
    expect(avisos()).not.toContain("o prazo do áudio não foi gravado");
  });

  it("todas as tentativas falham: a poda da passada seguinte renova, e o áudio e a linha ficam até a nova transcrição + 24 h — não até o prazo velho", async () => {
    falhasDoPrazoDoReady = 99;
    await reprocessarComFalhaAntiga();
    expect(gravacaoAtual("g-refeita")?.expiresAt).toBe(PRAZO_VELHO);
    expect(avisos()).toContain("o prazo do áudio não foi gravado");
    falhasDoPrazoDoReady = 0;

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 1 });
    expect(gravacaoAtual("g-refeita")?.expiresAt).toBe(AGORA + PRAZO);

    for (const instante of [AGORA + HORA, PRAZO_VELHO, AGORA + PRAZO - 1]) {
      vi.setSystemTime(instante);
      expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
      expect(gravacaoAtual("g-refeita")).toBeDefined();
    }
    expect(apagadasDoBucket).toEqual([]);

    vi.setSystemTime(AGORA + PRAZO);
    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 0 });
    expect(gravacaoAtual("g-refeita")).toBeUndefined();
    expect((await servico.getPrivateMeeting(DONA, "r-refeita"))?.transcript?.transcript).toBe("Transcrição da reunião.");
  });

  it("todas falham e nenhuma passada roda até o prazo VELHO passar: a leitura serve o áudio pela regra, sem apagar, e a passada seguinte ainda renova", async () => {
    falhasDoPrazoDoReady = 99;
    await reprocessarComFalhaAntiga();
    falhasDoPrazoDoReady = 0;

    vi.setSystemTime(PRAZO_VELHO + HORA);
    const dados = await servico.getPrivateMeeting(DONA, "r-refeita");
    expect(dados?.recordingExpired).toBe(false);
    expect(dados?.recording?.expiresAt).toBe(AGORA + PRAZO);
    expect(gravacaoAtual("g-refeita")).toBeDefined();
    expect(apagadasDoBucket).toEqual([]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 1 });
    expect(gravacaoAtual("g-refeita")?.expiresAt).toBe(AGORA + PRAZO);
  });

  it("nem a poda consegue gravar (o prazo mudou entre a leitura e o UPDATE): o apagamento pula a reunião pronta há menos de 24 h", async () => {
    banco.set(schema.meetings, [reuniao("r-pendente", { updatedAt: AGORA - HORA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-pendente", "r-pendente", { expiresAt: AGORA - MINUTO })]);
    aoLer = tabela => {
      if (tabela !== schema.meetingRecordings) return;
      aoLer = null;
      Object.assign(gravacaoAtual("g-pendente")!, { expiresAt: AGORA - 2 * MINUTO });
    };

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
    expect(gravacaoAtual("g-pendente")).toBeDefined();
    expect(apagadasDoBucket).toEqual([]);
  });
});

describe("o apagamento", () => {
  it("pula a reunião em 'processing' — na varredura e na leitura: vencida, não é servida, mas também não sai", async () => {
    banco.set(schema.meetings, [reuniao("r-processando", { status: "processing", updatedAt: AGORA - MINUTO })]);
    banco.set(schema.meetingRecordings, [gravacao("g-processando", "r-processando", { expiresAt: AGORA - 1 })]);

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
    const dados = await servico.getPrivateMeeting(DONA, "r-processando");
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(true);
    expect(gravacaoAtual("g-processando")).toBeDefined();
    expect(apagadasDoBucket).toEqual([]);
  });

  it("contrato com a tela: em 'processing', meetings.get devolve a gravação com o prazo PROVISÓRIO (a tela troca a data por 'apagado 24 h depois da transcrição')", async () => {
    const ficha = AGORA - 2 * MINUTO;
    banco.set(schema.meetings, [reuniao("r-processando", { status: "processing", updatedAt: ficha })]);
    banco.set(schema.meetingRecordings, [gravacao("g-processando", "r-processando", { createdAt: ficha, expiresAt: ficha + PRAZO + servico.LIMITE_PROCESSAMENTO_MS })]);

    const dados = await servico.getPrivateMeeting(DONA, "r-processando");

    expect(dados?.recording?.expiresAt).toBe(ficha + PRAZO + servico.LIMITE_PROCESSAMENTO_MS);
    expect(dados?.recordingExpired).toBe(false);
  });

  it("201 vencidas saem numa chamada só: o laço segue de lote em lote enquanto o lote vem cheio e apaga", async () => {
    banco.set(schema.meetings, [reuniao("r-lote")]);
    banco.set(schema.meetingRecordings, Array.from({ length: 201 }, (_, i) => gravacao(`g-${String(i).padStart(3, "0")}`, "r-lote", { expiresAt: AGORA - 1 })));

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 201, apagadas: 201, prazosAjustados: 0 });
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(apagadasDoBucket).toHaveLength(201);
    expect(leiturasDoApagamento()).toHaveLength(2);
  });

  it("lote cheio sem nenhuma apagada (bucket fora) encerra a passada: uma leitura só, e as linhas ficam para a próxima", async () => {
    bucketFora = true;
    banco.set(schema.meetings, [reuniao("r-lote")]);
    banco.set(schema.meetingRecordings, Array.from({ length: 250 }, (_, i) => gravacao(`g-${String(i).padStart(3, "0")}`, "r-lote", { expiresAt: AGORA - 1 })));

    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 200, apagadas: 0, prazosAjustados: 0 });
    expect(linhasDe(schema.meetingRecordings)).toHaveLength(250);
    expect(leiturasDoApagamento()).toHaveLength(1);
    expect(apagadasDo(schema.meetingRecordings)).toEqual([]);
  });
});

describe("a exclusão da reunião com o bucket falhando", () => {
  const semear = () => {
    banco.set(schema.meetings, [reuniao("r-excluir", { updatedAt: AGORA - HORA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-excluir", "r-excluir", { expiresAt: AGORA - HORA + PRAZO })]);
    banco.set(schema.meetingTranscripts, [{ id: "t-excluir", meetingId: "r-excluir", ownerId: DONA, transcript: "O que foi dito." }]);
    noBucket.add(chaveDe("r-excluir", "g-excluir"));
  };

  it("a reunião sai, mas a LINHA da gravação fica, sem reunião; a passada seguinte, com o bucket de volta, tira o áudio e a linha", async () => {
    semear();
    bucketFora = true;

    expect(await servico.deletePrivateMeeting(DONA, "r-excluir")).toBe(true);
    expect(linhasDe(schema.meetings)).toEqual([]);
    expect(linhasDe(schema.meetingTranscripts)).toEqual([]);
    expect(linhasDe(schema.meetingRecordings).map(linha => linha.id)).toEqual(["g-excluir"]);

    bucketFora = false;
    vi.setSystemTime(AGORA + 5 * MINUTO);
    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 1 });
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(noBucket.size).toBe(0);
  });

  it("com o bucket respondendo, a gravação sai junto com a reunião, pelo id", async () => {
    semear();
    expect(await servico.deletePrivateMeeting(DONA, "r-excluir")).toBe(true);
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(apagadasDoBucket).toEqual([chaveDe("r-excluir", "g-excluir")]);
  });
});

describe("de ponta a ponta, pelo envio", () => {
  const envio = { meetingId: "r-nova", ownerId: DONA, audioBase64: Buffer.from("áudio da reunião").toString("base64"), mimeType: "audio/webm", durationSeconds: 30, language: "pt" };
  const esperandoAudio = () => banco.set(schema.meetings, [reuniao("r-nova", { status: "recording", createdAt: AGORA - MINUTO, updatedAt: AGORA - MINUTO })]);
  // A IA leva 10 min: a tomada é em AGORA, a transcrição (ou a falha) em AGORA + 10 min.
  const DURACAO_DA_IA = 10 * MINUTO;
  const FIM_DA_IA = AGORA + DURACAO_DA_IA;
  const iaLevaDezMinutos = () => { aoTranscrever = () => vi.setSystemTime(Date.now() + DURACAO_DA_IA); };

  it("transcrita: o prazo conta da TRANSCRIÇÃO, não da tomada; em transcrição + 24 h − 1 ms o áudio fica e é servido; em + 24 h sai do bucket e do banco, e a transcrição continua", async () => {
    esperandoAudio();
    iaLevaDezMinutos();
    await servico.processMeetingRecording(envio);
    const [linha] = linhasDe(schema.meetingRecordings);
    expect(linhasDe(schema.meetings)[0]).toMatchObject({ status: "ready", updatedAt: FIM_DA_IA });
    expect(linha.expiresAt).toBe(Number(linhasDe(schema.meetings)[0].updatedAt) + PRAZO);
    expect(Number(linha.expiresAt) - AGORA).toBe(DURACAO_DA_IA + PRAZO);

    vi.setSystemTime(FIM_DA_IA + PRAZO - 1);
    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 0 });
    expect((await servico.getPrivateMeeting(DONA, "r-nova"))?.recording).not.toBeNull();

    vi.setSystemTime(FIM_DA_IA + PRAZO);
    expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 0 });
    expect(apagadasDoBucket).toEqual([linha.storageKey]);
    expect(noBucket.size).toBe(0);
    const dados = await servico.getPrivateMeeting(DONA, "r-nova");
    expect(dados?.transcript?.transcript).toBe("Transcrição da reunião.");
    expect(dados?.recording).toBeNull();
    expect(dados?.recordingExpired).toBe(true);
  });

  it("a transcrição falhou: o prazo é a hora da FALHA + 24 h (não a tomada, nem o provisório do upload), e o áudio sai então", async () => {
    esperandoAudio();
    iaLevaDezMinutos();
    falhaDaTranscricao = new Error("qualquer");
    await expect(servico.processMeetingRecording(envio)).rejects.toThrow();
    expect(linhasDe(schema.meetings)[0]).toMatchObject({ status: "failed", updatedAt: FIM_DA_IA });
    expect(linhasDe(schema.meetingRecordings)[0].expiresAt).toBe(FIM_DA_IA + PRAZO);

    vi.setSystemTime(FIM_DA_IA + PRAZO - 1);
    expect((await servico.limparGravacoesVencidas()).apagadas).toBe(0);
    vi.setSystemTime(FIM_DA_IA + PRAZO);
    expect((await servico.limparGravacoesVencidas()).apagadas).toBe(1);
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
  });
});

describe("o reprocesso tomado no meio da poda — o expurgo pela chave não passa por cima da linha que existe", () => {
  // Falha de 3 dias atrás, com o prazo velho (envio + 30 dias): a poda a põe no
  // passado. A tomada do reprocesso só muda meetings, então o compare-and-set da
  // poda em expires_at não a percebe, e a chave volta em vencidasNaPoda.
  const CHAVE = chaveDe("r-x", "g-x");
  const semear = () => {
    banco.set(schema.meetings, [reuniao("r-x", { status: "failed", processingError: "Não foi possível transcrever o áudio.", updatedAt: AGORA - 3 * DIA })]);
    banco.set(schema.meetingRecordings, [gravacao("g-x", "r-x", { expiresAt: AGORA + 27 * DIA })]);
    noBucket.add(CHAVE);
  };
  /** O reprocesso de VERDADE toma a reunião entre o SELECT e o UPDATE da poda. */
  const tomarNoMeioDaPoda = () => {
    const execucao: { trabalho: Promise<void> | null } = { trabalho: null };
    antesDeAtualizar = async tabela => {
      if (tabela !== schema.meetingRecordings) return;
      antesDeAtualizar = null;
      execucao.trabalho = (await servico.iniciarReprocessamento(DONA, "r-x")).trabalho;
    };
    return execucao;
  };
  const oAudioFicouEValePor24h = async () => {
    expect(apagadasDoBucket).toEqual([]);
    expect(noBucket.has(CHAVE)).toBe(true);
    expect(linhasDe(schema.meetings)[0]).toMatchObject({ status: "ready", processingError: null, updatedAt: AGORA });
    expect(gravacaoAtual("g-x")?.expiresAt).toBe(AGORA + PRAZO);
    // a tela promete as 24 h de um objeto que existe
    const dados = await servico.getPrivateMeeting(DONA, "r-x");
    expect(dados?.recordingExpired).toBe(false);
    expect(dados?.recording?.expiresAt).toBe(AGORA + PRAZO);
  };

  it("na passada de 5 min: a chave da poda de dentro tem linha, então fica com o apagamento, que pula 'processing' — o objeto fica, e a reunião termina 'ready' com o áudio", async () => {
    semear();
    const execucao = tomarNoMeioDaPoda();

    const passada = await servico.limparGravacoesVencidas();
    expect(execucao.trabalho).not.toBeNull();
    await execucao.trabalho;

    expect(passada).toEqual({ encontradas: 0, apagadas: 0, prazosAjustados: 1 });
    await oAudioFicouEValePor24h();
  });

  it("no boot: a chave que a poda do boot devolveu tem linha, e a primeira passada também não a expurga", async () => {
    semear();
    const execucao = tomarNoMeioDaPoda();

    const poda = await servico.ajustarPrazosDasGravacoes();
    expect(poda).toEqual({ prazosAjustados: 1, vencidasNaPoda: [CHAVE] });
    const passada = await servico.limparGravacoesVencidas(poda.vencidasNaPoda);
    await execucao.trabalho;

    // prazosAjustados depende de a execução já ter gravado o 'ready' quando a
    // poda de dentro lê: o que se trava é que nada saiu
    expect(passada).toMatchObject({ encontradas: 0, apagadas: 0 });
    await oAudioFicouEValePor24h();
  });
});

describe("linha legada com a chave em '/manus-storage/...' — o expurgo age sobre a chave REAL", () => {
  // Aqui o expurgo é o de storage.ts, sobre um bucket com versões simulado no
  // `send` do S3Client (semântica do S3: HEAD 404 com marcador por cima, DELETE
  // sem VersionId empilha marcador). Sem a normalização, o HEAD, o DELETE e a
  // listagem iriam para "manus-storage/meetings/...": tudo "daria certo", a
  // linha sairia e as versões da voz ficariam.
  const CHAVE_REAL = chaveDe("r-legada", "g-legada");
  const legada = (extra: Linha = {}) => gravacao("g-legada", "r-legada", { storageKey: `/manus-storage/${CHAVE_REAL}`, ...extra });
  const VARIAVEIS = ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY", "STORAGE_ENDPOINT", "STORAGE_REGION"] as const;
  const guardadas: Partial<Record<(typeof VARIAVEIS)[number], string | undefined>> = {};
  type Versao = { Key: string; VersionId: string; marcador: boolean };
  let versoes: Versao[] = [];
  const chavesPedidas: string[] = [];

  beforeEach(() => {
    for (const nome of VARIAVEIS) guardadas[nome] = process.env[nome];
    process.env.STORAGE_BUCKET = "bucket-de-teste";
    process.env.STORAGE_ACCESS_KEY_ID = "id-de-teste";
    process.env.STORAGE_SECRET_ACCESS_KEY = "segredo-de-teste";
    process.env.STORAGE_ENDPOINT = "https://s3.exemplo.invalid";
    delete process.env.STORAGE_REGION;
    expurgoDeVerdade = true;
    versoes = [
      { Key: CHAVE_REAL, VersionId: "v-1", marcador: false },
      { Key: CHAVE_REAL, VersionId: "v-2", marcador: false },
    ];
    chavesPedidas.length = 0;
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (comando: { input: Record<string, unknown> }) => {
      const Key = comando.input.Key as string | undefined;
      const VersionId = comando.input.VersionId as string | undefined;
      chavesPedidas.push(String(Key ?? comando.input.Prefix));
      if (comando instanceof HeadObjectCommand) {
        const atual = versoes.filter(versao => versao.Key === Key).at(-1);
        if (!atual || atual.marcador) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return {};
      }
      if (comando instanceof ListObjectVersionsCommand) {
        const casam = versoes.filter(versao => versao.Key.startsWith(String(comando.input.Prefix)));
        const item = ({ Key: chave, VersionId: id }: Versao) => ({ Key: chave, VersionId: id });
        return { IsTruncated: false, Versions: casam.filter(v => !v.marcador).map(item), DeleteMarkers: casam.filter(v => v.marcador).map(item) };
      }
      if (comando instanceof DeleteObjectCommand) {
        if (!VersionId) versoes.push({ Key: String(Key), VersionId: `m-${versoes.length}`, marcador: true });
        else versoes = versoes.filter(versao => !(versao.Key === Key && versao.VersionId === VersionId));
        return {};
      }
      throw new Error(`comando que o bucket simulado não conhece: ${comando.constructor.name}`);
    }) as never);
  });
  afterEach(() => {
    expurgoDeVerdade = false;
    for (const nome of VARIAVEIS) {
      if (guardadas[nome] === undefined) delete process.env[nome];
      else process.env[nome] = guardadas[nome];
    }
  });

  it.each([
    ["a varredura, sobre a linha que a exclusão da conta deixou sem reunião", async () => {
      banco.set(schema.meetingRecordings, [legada()]);
      expect(await servico.limparGravacoesVencidas()).toEqual({ encontradas: 1, apagadas: 1, prazosAjustados: 1 });
    }],
    ["a leitura da gravação vencida", async () => {
      banco.set(schema.meetings, [reuniao("r-legada", { status: "failed", updatedAt: AGORA - 2 * DIA })]);
      banco.set(schema.meetingRecordings, [legada({ expiresAt: AGORA - DIA })]);
      expect((await servico.getPrivateMeeting(DONA, "r-legada"))?.recordingExpired).toBe(true);
    }],
    ["a exclusão da reunião", async () => {
      banco.set(schema.meetings, [reuniao("r-legada")]);
      banco.set(schema.meetingRecordings, [legada()]);
      expect(await servico.deletePrivateMeeting(DONA, "r-legada")).toBe(true);
    }],
  ] as Array<[string, () => Promise<void>]>)("%s: a linha sai com as versões da chave real, e o bucket fica vazio", async (_rotulo, rodar) => {
    await rodar();

    expect(versoes).toEqual([]);
    expect(linhasDe(schema.meetingRecordings)).toEqual([]);
    expect(new Set(chavesPedidas)).toEqual(new Set([CHAVE_REAL]));
  });
});
