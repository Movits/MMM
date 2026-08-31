export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // LLM: qualquer endpoint compatível com a API da OpenAI. Fora do Manus, a
  // chave do Google Gemini cobre as chamadas. SEM fallback para
  // BUILT_IN_FORGE_API_URL de propósito: era assim que configurar o storage
  // errado contaminava o endpoint da IA — as duas coisas nunca mais dividem
  // variável.
  llmApiUrl: process.env.LLM_API_URL || "",
  llmApiKey: process.env.LLM_API_KEY || process.env.BUILT_IN_FORGE_API_KEY || process.env.GOOGLE_API_KEY || "",
  // Storage, data API e heartbeat continuam falando o protocolo do Forge, que
  // saiu do ar junto com o Manus. Sem substituto configurado eles falham com
  // mensagem própria, em vez de herdar o endpoint do LLM e errar de forma obscura.
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL_STORAGE ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
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
