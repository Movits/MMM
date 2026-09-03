// Roda antes de cada arquivo de teste do projeto "server" (ver vitest.config.ts).
//
// O .env de trabalho pode apontar para o banco de PRODUÇÃO (foi assim que
// `pnpm test` chegou a promover uma usuária real a presidente e a semear contas
// fictícias no Aiven). A regra passa a ser: teste nunca lê DATABASE_URL. Quem
// precisa de banco real declara DATABASE_URL_TESTES (no CI é o MariaDB do
// serviço; na máquina de cada pessoa, um banco local descartável) e se pula
// quando ela não existe. Sem a variável, getDb() devolve null e todo helper
// lança BancoIndisponivel, o que é o comportamento certo para um teste que
// esqueceu de mockar o banco.
if (process.env.DATABASE_URL_TESTES) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TESTES;
} else {
  // Apagar, não esvaziar: contextos.test.ts (e quem seguir o padrão) define uma
  // URL fictícia com `??=` para o drizzle inicializar sobre um cliente falso.
  delete process.env.DATABASE_URL;
}
