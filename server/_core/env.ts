export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // LLM: qualquer endpoint compatível com a API da OpenAI; a chave do Google
  // Gemini cobre as chamadas quando LLM_API_KEY não está definida. O storage
  // (STORAGE_*) nunca divide variável com o LLM, de propósito: era assim que
  // configurar o storage errado contaminava o endpoint da IA.
  llmApiUrl: process.env.LLM_API_URL || "",
  llmApiKey: process.env.LLM_API_KEY || process.env.GOOGLE_API_KEY || "",
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
