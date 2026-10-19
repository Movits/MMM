# client/

<!-- Carregado quando o Claude lê ou edita um arquivo de client/. As regras que valem
em toda sessão estão no CLAUDE.md da raiz. -->

Não escreva neste arquivo nomes de classes utilitárias do Tailwind: o Tailwind 4 varre os
arquivos de `client/`, inclusive este, e geraria CSS novo em produção.

React 19 + Vite, consumindo o servidor tipado via tRPC (`client/src/lib/trpc.ts` + React
Query). Front e API na mesma origem: não há proxy de dev.

## Estrutura

- **Autenticação:** não há AuthContext. `useAuth` (`client/src/_core/hooks/useAuth.ts`) é
  `trpc.auth.me` no cache do React Query. Com o banco fora do ar, `auth.me` lança e o
  `ProtectedRoute` mostra "tentar de novo" em vez de mandar ao login.
- **Rotas:** páginas em `client/src/pages/`, roteadas com wouter em `App.tsx`.
  `ProtectedRoute` aplica `requireAdmin`, `requireGold` e `requireOpportunities`, e manda
  para /onboarding quem não concluiu o cadastro (só a rota do cadastro liga
  `permitirCadastroIncompleto`; a regra de servidor está em `server/CLAUDE.md`).
- **Nível de acesso:** esconder na tela não basta, a privacidade é regra de consulta no
  servidor. As checagens "Ouro ou acima" do client (`ProtectedRoute`, `AppHeader`,
  `Connections`) repetem as do servidor; mudou uma, confira a outra.
- **UI:** shadcn/ui em `components/ui/`; Tailwind 4 configurado no próprio CSS
  (`client/src/index.css`, não há `tailwind.config`); o tema escuro está desligado.
- **i18n:** 10 JSONs em `client/src/i18n/locales/` com o mesmo conjunto de chaves
  (`node scripts/conferir-locales.mjs` garante; o CI também roda). Os arquivos são grandes:
  edite chave a chave, sem reescrever o arquivo inteiro (`/texto-de-tela`). `AdminPanel`,
  `PresidentPanel` e `LegalPage` continuam em pt-BR fixo (na `LegalPage`, porque o
  documento jurídico só existe em português), e a maioria dos componentes compartilhados
  não traduz.
- **Match na tela:** `pages/IntelligentMatches.tsx` usa funções de `shared/tipo-da-oferta.ts`;
  as regras dos motores estão em `server/CLAUDE.md`.
- **Código morto conhecido** (não construa sobre ele): `ComponentShowcase` e `AIChatBox`
  (importado só por ele). Não confunda com o `streamdown`, que está em uso
  (`TermoGeralDeUso.tsx`, `SmartMatchConsent.tsx`).

## Testes de front

- `vitest.workspace.ts` divide a suíte em dois projetos, `server` (Node) e `client`
  (jsdom com Testing Library), e `pnpm test` roda os dois.
- Teste de front fica em `client/src/**/*.test.tsx`, ao lado do componente. Padrão:
  `client/src/components/ProtectedRoute.test.tsx`, que mocka `useAuth` com `vi.mock` e
  troca `window.location` por um dublê para ler o redirecionamento sem navegar.
- `client/src/test/setup.ts` carrega o jest-dom, limpa o DOM entre testes e fixa o i18n em
  pt-BR.
- O `tsconfig` exclui `*.test.tsx` como exclui `*.test.ts`: ninguém checa os tipos dos
  testes. Escreva o dublê a partir do tipo real.
- Função pura do client pode ser testada em `server/*.test.ts` (padrão:
  `server/transcricao-destacada.test.ts`) ou, sem JSX, em `client/src/**/*.test.ts`, que o
  projeto `client` também colhe.

## O que "testado" significa no front

Teste automatizado não dispensa o smoke manual. "Testado" no front é: `pnpm check` e
`pnpm build` verdes; `conferir-locales` se tocou em texto; abrir cada tela afetada com
`pnpm dev`, logada com o nível certo (bronze, prata, ouro, admin) quando a tela depende de
nível, exercitar a mudança e conferir o console sem erro; e uma seção "Como verifiquei" na
PR listando as telas. Na nuvem não há MySQL: diga na PR que as telas não foram abertas.
