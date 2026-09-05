/**
 * O que a tela mostra quando uma consulta falha.
 *
 * Nem todo erro que chega ao React Query passou pelo servidor tRPC. O
 * `errorFormatter` (server/_core/trpc.ts) escreve mensagens em português e já
 * mascarou o SQL, mas ele só fala quando a resposta tem o envelope do tRPC.
 * Um 429 do apiLimiter (texto puro), um 502/503 em HTML do Render ou a rede
 * fora chegam como TRPCClientError montado no cliente, com texto técnico em
 * inglês: "Unable to transform response from server", "Failed to fetch". Isso
 * não é para a usuária ler.
 *
 * O sinal é `data.code`: só um erro devolvido pelo servidor tem o `data` do
 * shape (TRPCClientError.from monta `data` a partir de `result.error.data`,
 * que não existe fora do envelope). Com ele, a mensagem é a do servidor; sem
 * ele, o texto genérico — e não o do ErrorBoundary, que afirma "nossa equipe
 * foi notificada", coisa que aqui ninguém foi.
 */
export function mensagemDeErroParaTela(erro: unknown, t: (chave: string) => string): string {
  if (erro && typeof erro === "object") {
    const { message, data } = erro as { message?: unknown; data?: unknown };
    const codigo = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
    if (typeof codigo === "string" && typeof message === "string" && message.trim()) return message;
  }
  return t("errorBoundary.serverUnavailable");
}
