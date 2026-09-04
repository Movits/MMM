// Documento enviado em base64 numa requisição só — Deal Room (documento
// confidencial da sala) e SIVC (documento de verificação com OCR). Mesma regra
// dos outros uploads do app (gravação de reunião, mídia de contexto, foto e
// cartão do contato): 10 MB por arquivo, validado AQUI antes de tocar o
// storage. O corpo da requisição tem o cabo em 15 MB (server/_core/index.ts);
// este módulo é o que vira mensagem para a usuária.
//
// Antes (quadro Notion, prazo 08/09): fileBase64 era z.string() sem limite e o
// corpo caía no parser global de 5 MB — qualquer arquivo acima de ~3,7 MB
// voltava como 413 cru, antes de o tRPC sequer rodar.

import { TRPCError } from "@trpc/server";

export const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;

// 10 MB em base64 dão ~13,98 milhões de caracteres; a folga cobre o cabeçalho
// "data:...;base64," e quebras de linha que o FileReader pode incluir. É o
// cabo do schema Zod — a mensagem amigável sai da função abaixo.
export const MAX_DOCUMENTO_BASE64_CHARS = 14 * 1024 * 1024;

function mensagemDeLimite(maxBytes: number): string {
  return `O arquivo deve ter no máximo ${Math.round(maxBytes / 1024 / 1024)} MB.`;
}

export function decodeDocumentoBase64(base64: string, maxBytes = MAX_DOCUMENTO_BYTES): Buffer {
  // FileReader entrega "data:application/pdf;base64,..." — o cabeçalho cai fora.
  const normalizado = base64.trim().replace(/^data:[^,]+;base64,/i, "").replace(/\s/g, "");
  if (!normalizado || !/^[A-Za-z0-9+/=]+$/.test(normalizado)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo inválido." });
  }
  // Tamanho estimado ANTES de decodificar (4 caracteres = 3 bytes): um corpo
  // enorme é recusado sem alocar um Buffer de dezenas de MB só para isso.
  const estimado = Math.floor((normalizado.length * 3) / 4);
  if (estimado > maxBytes + 3) {
    throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDeLimite(maxBytes) });
  }
  const dados = Buffer.from(normalizado, "base64");
  if (!dados.length || dados.length > maxBytes) {
    throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDeLimite(maxBytes) });
  }
  return dados;
}

/** Nome de arquivo seguro para compor a chave no storage: sem caminho, sem espaço. */
export function nomeSeguroParaChave(original: string): string {
  const soONome = original.split(/[\\/]/).pop() ?? "";
  const limpo = soONome.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  return limpo || "documento";
}
