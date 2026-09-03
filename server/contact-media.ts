// Foto e cartão de visita de um contato privado (etapa 1) — mesmas regras da
// mídia de contexto (etapa 5): chega em base64 numa requisição só, é validado
// aqui e vai para o storage S3 (server/storage.ts) sob uma chave com a dona
// no caminho, que é o que o storageProxy usa para decidir quem pode baixar.
//
// Só imagem (o requisito da Glenda diz "Cartão de visita (imagem)"), sem PDF
// — diferente da mídia de contexto, que aceita documento.

export const MAX_CONTACT_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_CONTACT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function extensionForContactImage(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export function decodeContactImage(base64: string, mimeType: string): Buffer {
  if (!(ALLOWED_CONTACT_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Formato não suportado: envie JPG, PNG ou WebP.");
  }
  // FileReader entrega "data:image/png;base64,..." — o cabeçalho cai fora.
  const normalized = base64.trim().replace(/^data:[^,]+;base64,/i, "").replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("Arquivo inválido.");
  }
  const dados = Buffer.from(normalized, "base64");
  if (!dados.length || dados.length > MAX_CONTACT_IMAGE_BYTES) {
    throw new Error("O arquivo deve ter no máximo 10 MB.");
  }
  return dados;
}
