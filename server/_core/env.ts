export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  // Fora do Manus, a chave do Google Gemini cobre as chamadas de LLM.
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY || process.env.GOOGLE_API_KEY || "",
};

// Segredos não têm valor padrão: sem a variável definida, a inicialização falha.
export function requireSecret(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${nome} não definida. Ela é obrigatória e não possui valor padrão: defina um segredo forte no ambiente antes de iniciar o servidor.`
    );
  }
  return valor;
}
