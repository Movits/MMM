// Fotos e documentos de um contexto (etapa 5) — mesmas regras da gravação de
// reunião: chega em base64 numa requisição só, é validado aqui e vai para o
// storage S3 (server/storage.ts) sob uma chave com dona no caminho, que é o que
// o storageProxy usa para decidir quem pode baixar.

export const MAX_CONTEXT_MEDIA_BYTES = 10 * 1024 * 1024;

// Fotos do encontro e documentos relacionados — o que o requisito da etapa 5
// pede. Tipo fora da lista é recusado antes de tocar o storage.
export const ALLOWED_CONTEXT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function extensionForContextMedia(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "pdf";
}

export function decodeContextMedia(base64: string, mimeType: string): Buffer {
  if (!(ALLOWED_CONTEXT_MEDIA_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Formato não suportado: envie JPG, PNG, WebP ou PDF.");
  }
  // FileReader entrega "data:image/png;base64,..." — o cabeçalho cai fora.
  const normalized = base64.trim().replace(/^data:[^,]+;base64,/i, "").replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("Arquivo inválido.");
  }
  const dados = Buffer.from(normalized, "base64");
  if (!dados.length || dados.length > MAX_CONTEXT_MEDIA_BYTES) {
    throw new Error("O arquivo deve ter no máximo 10 MB.");
  }
  return dados;
}

/** Nome de arquivo seguro para virar chave de storage: sem caminho, sem espaços. */
export function sanitizeMediaFileName(original: string): string {
  const soONome = original.split(/[\\/]/).pop() ?? "arquivo";
  const semExtensao = soONome.replace(/\.[^.]*$/, "");
  const limpo = semExtensao
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return limpo || "arquivo";
}
