import crypto from "crypto";

export const PASSWORD_RESET_GENERIC_MESSAGE = "Se o e-mail existir em nossa base, você receberá instruções em breve.";
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
// Por IP real (ip-da-cliente.ts) a cada 15 min, contando até e-mail que não
// existe, repetição e erro de digitação. Era 3, e as participantes importadas
// só entram por este fluxo: no lançamento de 16/09, a sala inteira no mesmo
// wi-fi dividia os 3 pedidos. Não é ele que protege a caixa de uma pessoa (é o
// limite por conta) nem a cota diária da Resend (que um IP gasta com qualquer
// valor acima de ~35).
export const PASSWORD_RESET_RATE_LIMIT = 300;
// Por e-mail e por conta a cada 15 min: o que impede encher a caixa de uma pessoa.
export const PASSWORD_RESET_ACCOUNT_LIMIT = 3;
export const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

export function hashPasswordResetToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

// Primeiro item do X-Forwarded-For: FORJÁVEL (a Cloudflare acrescenta ao que o
// cliente mandou). Fica só para os registros de auditoria que ainda o usam;
// para limitar, use ipDaCliente (ip-da-cliente.ts).
export function getRequestIp(forwardedFor: string | string[] | undefined, fallbackIp?: string) {
  const rawValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return (rawValue?.split(",")[0]?.trim() || fallbackIp || "unknown").slice(0, 64);
}
