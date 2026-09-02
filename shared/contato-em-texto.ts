/**
 * A13 — detecção de e-mail e telefone em texto livre.
 *
 * Decisão D3 (Glenda, 31/08): os contatos das partes aparecem somente para o
 * consultor de negócios, jamais entre as partes. Este módulo é a barreira
 * extra nos canais de texto livre — e é PRECISÃO em primeiro lugar: conversa
 * de negócio é cheia de números legítimos (preços, faixas, safras "2025-2026",
 * CNPJ, CPF, CEP, boletos), e bloquear uma proposta por causa deles seria
 * pior que deixar um telefone passar. O bloqueio técnico não substitui a
 * cláusula contratual da etapa 13; ele torna o caminho oficial mais fácil e
 * gera o registro que a sustenta (nota do cartão A13).
 *
 * O que casa:
 *  - e-mail literal (com @);
 *  - telefone com DDI (+55 11 99999-8888 e variações com espaço/ponto);
 *  - DDD entre parênteses ((11) 98888-7777, (11)3456 7890);
 *  - DDD colado ao número por espaço/ponto (11 99999 8888 · 11.99999.8888 ·
 *    11 9 9999 8888 · 11 3456-7890) — a forma mais comum de digitar no Brasil;
 *  - celular hifenizado mesmo sem DDD (99999-8888 — o 9 na frente denuncia);
 *  - sequência crua de 10-11 dígitos COM CARA de telefone: DDD válido (sem
 *    zero) seguido de 9+8 dígitos (celular) ou [2-5]+7 (fixo). "12345678901"
 *    (CPF sem pontos) e "84670000001" (linha de boleto) não têm essa forma.
 *
 * O que NÃO casa, de propósito: intervalos de anos e faixas ("2025-2026",
 * "1000-5000"), CNPJ/CPF (pontuados ou crus), CEP (5-3), valores, datas — e
 * o fixo hifenizado SEM DDD ("3456-7890"), que é indistinguível de faixa
 * numérica; sem DDD ele tampouco serve como contato entre cidades. Quem
 * quiser burlar consegue ("nove nove nove..." por extenso) — o objetivo é o
 * caminho honesto e o registro, não uma fortaleza.
 */

const PADROES: Array<{ tipo: "email" | "telefone"; regex: RegExp }> = [
  { tipo: "email", regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  // +DDI com grupos: +55 11 99999-8888 · +55 (11) 99999 8888 · +351 912 345 678
  { tipo: "telefone", regex: /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,5}){2,4}/g },
  // DDD entre parênteses: (11) 99999-8888 · (11)3456-7890 · (11) 9 9999 8888
  { tipo: "telefone", regex: /\(\d{2,3}\)\s?9?[\s.]?\d{4}[\s.-]?\d{4}\b/g },
  // DDD + separador: 11 99999 8888 · 11.99999.8888 · 11 9 9999 8888 · 11 3456-7890
  { tipo: "telefone", regex: /\b[1-9][1-9][\s.]9?[\s.]?\d{4}[\s.-]\d{4}\b/g },
  // Celular hifenizado sem DDD: o 9 obrigatório na frente separa "99999-8888"
  // de faixas e anos; o fixo 4-4 sem DDD fica de fora (ver o cabeçalho).
  { tipo: "telefone", regex: /\b9\d{4}-\d{4}\b/g },
  // Sequência crua com forma de telefone: DDD sem zero + celular (9........)
  // ou fixo ([2-5].......). CPF de 11 dígitos raramente sobrevive às duas
  // exigências; valores redondos (10 dígitos começando em 10...) nunca.
  { tipo: "telefone", regex: /\b[1-9][1-9](?:9\d{8}|[2-5]\d{7})\b/g },
];

export type ContatoEncontrado = { tipo: "email" | "telefone"; trecho: string };

export function encontrarContatosEmTexto(texto: string): ContatoEncontrado[] {
  const achados: ContatoEncontrado[] = [];
  const vistos = new Set<string>();
  for (const { tipo, regex } of PADROES) {
    for (const casamento of Array.from(texto.matchAll(regex))) {
      const trecho = casamento[0];
      // Um telefone dentro de um e-mail já reportado (ou o mesmo trecho por
      // dois padrões) não vira um segundo achado.
      if (vistos.has(trecho) || achados.some(a => a.trecho.includes(trecho))) continue;
      vistos.add(trecho);
      achados.push({ tipo, trecho });
    }
  }
  return achados;
}

/**
 * Versão mascarada de um trecho, para o REGISTRO da tentativa: o log precisa
 * provar que houve contato no texto sem se tornar, ele mesmo, um repositório
 * do dado que o bloqueio existe para não espalhar.
 */
export function mascararTrecho(trecho: string): string {
  if (trecho.length <= 4) return "*".repeat(trecho.length);
  return trecho.slice(0, 2) + "*".repeat(Math.min(trecho.length - 4, 12)) + trecho.slice(-2);
}

/**
 * Texto com os contatos substituídos pela máscara — para campos que JÁ estão
 * gravados e precisam circular para outras usuárias (ex.: a bio do perfil no
 * payload dos matches). A dona continua vendo o próprio texto inteiro; a
 * contraparte recebe a versão sem o contato.
 */
export function mascararContatosEmTexto(texto: string): string {
  let resultado = texto;
  for (const { trecho } of encontrarContatosEmTexto(texto)) {
    resultado = resultado.split(trecho).join(mascararTrecho(trecho));
  }
  return resultado;
}
