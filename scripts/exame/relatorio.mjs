// Relatório e ritmo do exame de produção (scripts/checar-producao.mjs).
//
// Módulo PURO: sem mysql2, dotenv ou node:fs, sem process.env, sem efeito de topo,
// para o teste (server/exame-de-producao.test.ts) provar as regras sem I/O:
// - exceção no meio, limpeza com erro, ALERTA e LIMITE (429 persistente) REPROVAM;
//   o exame antigo imprimia "produção saudável" com código 0 depois de uma exceção;
// - PULADO é prefixo próprio, contado à parte e repetido no resumo como bloco NÃO
//   PROVADO, para "passou" nunca ser confundido com "não foi testado";
// - o relatório nunca imprime valor vindo do servidor (nome, e-mail, texto de
//   usuária): só contagens, status HTTP, nomes de chaves e literais do exame. A
//   saída é colada em PR pública.

export const PREFIXO = {
  ok: "OK    ",
  falha: "FALHA ",
  pulado: "PULADO",
  alerta: "ALERTA",
  limite: "LIMITE",
  info: "INFO  ",
  excecao: "EXCECAO",
  limpeza: "LIMPEZA COM ERRO",
};

const REPROVAM = new Set(["falha", "alerta", "limite", "excecao", "limpeza"]);

export class Relatorio {
  constructor() {
    this.linhas = [];
    this.pulados = [];
    this.houveExcecao = false;
    this.houveLimite = false;
    this.houveErroDeLimpeza = false;
  }

  #linha(tipo, nome, extra = "") {
    const texto = `${PREFIXO[tipo]} ${nome}${extra ? " | " + extra : ""}`;
    this.linhas.push({ tipo, nome, extra, texto });
    return texto;
  }

  /** Checagem comum: OK quando `condicao` é verdadeira, FALHA quando não. Devolve a condição. */
  ok(nome, condicao, extra = "") {
    if (condicao) this.#linha("ok", nome, extra);
    else this.#linha("falha", nome, extra);
    return Boolean(condicao);
  }

  falha(nome, extra = "") { this.#linha("falha", nome, extra); return false; }

  /** Não foi possível provar: conta à parte e aparece no resumo como NÃO PROVADO. */
  pulado(nome, motivo) { this.pulados.push(nome); this.#linha("pulado", nome, motivo); return false; }

  /** Funcionou pela metade e alguém precisa olhar: reprova. */
  alerta(nome, extra) { this.#linha("alerta", nome, extra); return false; }

  /** 429 que persistiu: o exame fica incompleto e reprova. */
  limite(nome, extra = "") { this.houveLimite = true; this.#linha("limite", nome, extra); return false; }

  info(texto) { this.#linha("info", texto); }

  excecao(erro) {
    this.houveExcecao = true;
    this.#linha("excecao", String(erro && erro.message ? erro.message : erro).slice(0, 200));
  }

  limpezaComErro(texto) { this.houveErroDeLimpeza = true; this.#linha("limpeza", texto); }

  /** Checagens que não puderam rodar porque algo anterior faltou (ex.: sem sessão). */
  naoExecutada(nome, motivo) { this.#linha("falha", nome, `NÃO EXECUTADA (${motivo})`); return false; }

  contagens() {
    const c = { ok: 0, falhas: 0, pulados: 0 };
    for (const l of this.linhas) {
      if (l.tipo === "ok") c.ok++;
      else if (l.tipo === "pulado") c.pulados++;
      else if (REPROVAM.has(l.tipo)) c.falhas++;
    }
    return c;
  }

  codigoDeSaida() {
    const { falhas } = this.contagens();
    return falhas > 0 || this.houveExcecao || this.houveLimite || this.houveErroDeLimpeza ? 1 : 0;
  }

  /** A última linha do exame; "produção saudável" só sem nada reprovando. */
  resumo() {
    const { ok, falhas, pulados } = this.contagens();
    let veredito;
    if (this.houveExcecao) veredito = "exame interrompido por exceção: investigue antes de seguir";
    else if (this.houveLimite) veredito = "exame incompleto por limite de requisições: repita em um minuto";
    else if (this.houveErroDeLimpeza) veredito = "limpeza incompleta: há dado do exame sobrando em produção";
    else if (falhas > 0) veredito = "investigue as FALHAs antes de seguir";
    else veredito = "produção saudável";
    const naoProvado = pulados > 0 ? ` | NÃO PROVADO (${pulados}): ${this.pulados.join("; ")}` : "";
    return `${ok} OK, ${falhas} falha(s), ${pulados} pulado(s) | ${veredito}${naoProvado}`;
  }

  texto() {
    return this.linhas.map(l => l.texto).join("\n") + "\n\n" + this.resumo();
  }
}

/**
 * Julga uma resposta do cliente tRPC do exame ({ status, dado, erro, codigo }).
 * Exige status 200 ANTES de olhar o conteúdo: o exame antigo aceitava "lista vazia"
 * vinda de um 401/403/429, e isolamento passava com o servidor quebrado.
 *
 * Devolve { ok, motivo, detalhe }:
 *   motivo "limite"    -> 429 (o chamador decide retentar ou marcar LIMITE)
 *   motivo "status"    -> outro status que não 200
 *   motivo "zod"       -> 400: o EXAME chamou errado, não a produção
 *   motivo "predicado" -> 200 mas o conteúdo não satisfez
 *   motivo ""          -> ok
 * `detalhe` traz só status, código do tRPC e no máximo 40 caracteres da mensagem
 * de erro do servidor (mensagens são texto do código, não dado de usuária).
 */
export function avaliar(resposta, predicado = () => true) {
  const status = resposta && resposta.status;
  if (status === 429) return { ok: false, motivo: "limite", detalhe: "status 429" };
  if (status === 400) return { ok: false, motivo: "zod", detalhe: `input do exame inválido: ${resumirErro(resposta)}` };
  if (status !== 200) return { ok: false, motivo: "status", detalhe: `status ${status}${resumirErro(resposta, " ")}` };
  if (resposta.erro) return { ok: false, motivo: "status", detalhe: `200 com erro no envelope: ${resumirErro(resposta)}` };
  try {
    const resultado = predicado(resposta.dado);
    return resultado ? { ok: true, motivo: "", detalhe: "" } : { ok: false, motivo: "predicado", detalhe: "" };
  } catch (erro) {
    return { ok: false, motivo: "predicado", detalhe: `predicado lançou: ${String(erro && erro.message || erro).slice(0, 40)}` };
  }
}

/** Uma resposta de erro "esperada" (403, 401, 500 NOT_FOUND...) casa com o que o exame pediu? */
export function avaliarNegativa(resposta, aceitas) {
  const status = resposta && resposta.status;
  if (status === 429) return { ok: false, motivo: "limite", detalhe: "status 429" };
  const casou = aceitas.some(regra => regra(status, (resposta && resposta.erro) || "", (resposta && resposta.codigo) || ""));
  if (casou) return { ok: true, motivo: "", detalhe: `status ${status}` };
  return { ok: false, motivo: "status", detalhe: `barrado por motivo errado: status ${status}${resumirErro(resposta, " ")}` };
}

export function resumirErro(resposta, separador = "") {
  const codigo = resposta && resposta.codigo ? String(resposta.codigo) : "";
  const mensagem = resposta && resposta.erro ? String(resposta.erro).slice(0, 40) : "";
  const partes = [codigo, mensagem].filter(Boolean);
  return partes.length ? separador + partes.join(" ") : "";
}

/** Cabeçalho combinado RateLimit (draft-7): "limit=100, remaining=87, reset=42". */
export function analisarRateLimit(valor) {
  if (!valor || typeof valor !== "string") return null;
  const saida = {};
  for (const parte of valor.split(",")) {
    const [chave, numero] = parte.split("=").map(s => s.trim());
    if (chave && numero !== undefined && /^\d+$/.test(numero)) saida[chave] = Number(numero);
  }
  return "remaining" in saida ? saida : null;
}

/**
 * Ritmo das requisições: janela deslizante local (rede de segurança) mais o
 * orçamento que o SERVIDOR informa no cabeçalho RateLimit. O apiLimiter da
 * produção é 100 req/min por IP; o exame faz ~70 chamadas em /api/trpc, e duas
 * execuções seguidas estourariam. Relógio e sono injetáveis para o teste.
 */
export class Ritmo {
  constructor({ limite = 85, janelaMs = 60_000, folgaServidor = 10, agora = () => Date.now(), dormir = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    this.limite = limite;
    this.janelaMs = janelaMs;
    this.folgaServidor = folgaServidor;
    this.agora = agora;
    this.dormir = dormir;
    this.carimbos = [];
    this.servidor = null; // { remaining, resetEm }
    this.esperasMs = 0;
  }

  /** Quanto esperar agora, em ms, antes da próxima requisição (puro). */
  esperaNecessaria() {
    const t = this.agora();
    this.carimbos = this.carimbos.filter(c => t - c < this.janelaMs);
    let espera = 0;
    if (this.carimbos.length >= this.limite) espera = Math.max(espera, this.carimbos[0] + this.janelaMs - t);
    if (this.servidor && this.servidor.remaining < this.folgaServidor && this.servidor.resetEm > t) {
      espera = Math.max(espera, this.servidor.resetEm - t);
    }
    return espera;
  }

  async antes() {
    const espera = this.esperaNecessaria();
    if (espera > 0) {
      this.esperasMs += espera;
      await this.dormir(espera);
    }
    this.carimbos.push(this.agora());
  }

  /** Lê o orçamento devolvido pelo servidor (cabeçalhos RateLimit e Retry-After). */
  depois(headers) {
    if (!headers || typeof headers.get !== "function") return;
    const combinado = analisarRateLimit(headers.get("ratelimit"));
    if (combinado) {
      this.servidor = { remaining: combinado.remaining, resetEm: this.agora() + (combinado.reset ?? 60) * 1000 };
    }
    const retry = headers.get("retry-after");
    if (retry && /^\d+$/.test(retry)) {
      this.servidor = { remaining: 0, resetEm: this.agora() + Number(retry) * 1000 };
    }
  }

  /** Depois de um 429: quanto esperar antes da única retentativa. */
  esperaAposLimite() {
    const t = this.agora();
    if (this.servidor && this.servidor.resetEm > t) return this.servidor.resetEm - t;
    return this.janelaMs;
  }
}
