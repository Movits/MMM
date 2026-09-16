import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET ??= "jwt-secret-somente-para-testes";

/**
 * O assistente da FAQ da Home (`faq.ask`, público) responde pelo que o prompt
 * diz. Na entrega de 16/09 o prompt ainda mandava a IA dizer que o
 * compartilhamento de contatos com a rede e a comissão "ainda não existem",
 * enquanto a mesma Home anuncia "Disponibilize contatos de forma anonimizada
 * para oportunidades da rede" e o Meu Network Inteligente já tem o SIM/NÃO por
 * contato (`networkInteligente.definirDisponibilidade`) e o registro de
 * conexões com status de comissão. Este teste lê o prompt que chega ao modelo.
 */

const llm = vi.hoisted(() => ({
  invokeLLM: vi.fn(async (_params: { messages: Array<{ role: string; content: string }> }) => ({
    choices: [{ message: { content: "resposta" } }],
  })),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: llm.invokeLLM }));

import { faqRouter } from "./routers/faq";

let ipSeq = 0;
function contexto() {
  ipSeq += 1;
  return {
    req: { headers: {}, socket: { remoteAddress: `10.0.0.${ipSeq}` } },
    res: {},
    user: null,
  } as never;
}

async function promptEnviado(pergunta: string) {
  const resposta = await faqRouter.createCaller(contexto()).ask({ question: pergunta });
  expect(resposta.answer).toBe("resposta");
  const chamada = llm.invokeLLM.mock.calls.at(-1)?.[0];
  const sistema = chamada?.messages.find(m => m.role === "system")?.content ?? "";
  const usuaria = chamada?.messages.find(m => m.role === "user")?.content;
  expect(usuaria).toBe(pergunta);
  return sistema;
}

describe("faq.ask: o prompt não nega o que a plataforma já oferece", () => {
  beforeEach(() => llm.invokeLLM.mockClear());

  it("apresenta a plataforma como WRW — Women Rocking the World (marca de 15/09/2026)", async () => {
    const prompt = await promptEnviado("O que é a WRW?");
    expect(prompt).toMatch(/^Você é a assistente virtual da plataforma WRW — Women Rocking the World —/);
    // A sigla antiga só aparece na linha que ensina a responder a quem ainda a usa;
    // o nome antigo por extenso não vai ao prompt, para a IA não repeti-lo ao visitante.
    const comNomeAntigo = prompt.split("\n").filter(l => /\bMMM\b|Mulheres que Movem/.test(l));
    expect(comNomeAntigo).toHaveLength(1);
    expect(comNomeAntigo[0]).toMatch(/use sempre WRW/);
    expect(prompt).not.toMatch(/Mulheres que Movem|Women Moving/i);
  });

  it("não manda dizer que disponibilizar contatos à rede ou a comissão não existem", async () => {
    const prompt = await promptEnviado("Posso disponibilizar meus contatos para oportunidades da rede?");
    expect(prompt).toContain("Meu Network Inteligente");
    expect(prompt).not.toMatch(/compartilhamento de contatos com a rede[^.\n]*ainda não exist/i);
    expect(prompt).not.toMatch(/comissão[^.\n]*ainda não exist/i);
  });

  it("descreve a disponibilização anonimizada: padrão NÃO, só ID anônimo e o que tem e precisa", async () => {
    const prompt = await promptEnviado("Meus contatos são compartilhados com a rede?");
    const linha = prompt.split("\n").find(l => l.includes("Meu Network Inteligente")) ?? "";
    expect(linha).toMatch(/privados por padrão/);
    expect(linha).toMatch(/disponibilizar cada contato para oportunidades da rede/);
    expect(linha).toMatch(/começa em NÃO/);
    expect(linha).toMatch(/ID anônimo/);
    expect(linha).toMatch(/nunca nome, telefone, e-mail, áudio, transcrição ou notas/);
  });

  it("registro com status de comissão, sem percentual; planos pagos e minutos extras continuam inexistentes", async () => {
    const linha = (await promptEnviado("Tem comissão?")).split("\n").find(l => l.includes("Meu Network Inteligente")) ?? "";
    expect(linha).toMatch(/status da comissão/);
    expect(linha).toMatch(/não informe percentual/);
    expect(linha).toMatch(/Não prometa planos pagos nem minutos extras: ainda não existem/);
    expect(linha).not.toMatch(/\d+\s*%/);
  });
});
