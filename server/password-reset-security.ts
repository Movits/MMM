import crypto from "crypto";

export const PASSWORD_RESET_GENERIC_MESSAGE = "Se o e-mail existir em nossa base, você receberá instruções em breve.";
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_RATE_LIMIT = 3;
export const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

export function hashPasswordResetToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function getRequestIp(forwardedFor: string | string[] | undefined, fallbackIp?: string) {
  const rawValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return (rawValue?.split(",")[0]?.trim() || fallbackIp || "unknown").slice(0, 64);
}
