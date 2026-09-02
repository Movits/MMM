/**
 * Diretivas da Content-Security-Policy que o helmet envia em toda resposta.
 *
 * Só o script-src depende do ambiente; o resto é igual nos dois.
 *
 * Desenvolvimento (Vite em middleware, ver setupVite): o @vitejs/plugin-react
 * injeta no HTML um <script> inline com o preâmbulo do React Refresh
 * (window.$RefreshReg$ etc.) e o cliente de HMR. Sem 'unsafe-inline' a página
 * não sobe. O 'unsafe-eval' fica como sempre esteve: não custa nada em dev e
 * evita quebrar ferramenta de depuração.
 *
 * Produção (build estático de dist/public): a política é estrita, script-src
 * só 'self'. Prova, feita sobre o build de 02/09/2026 (417 chunks):
 * - dist/public/index.html tem um único <script type="module" src="/assets/
 *   index-*.js">, nenhum script inline (o Vite emite tudo em arquivo);
 * - nenhum chunk contém eval( nem new Function(. Os "Function(" que o grep
 *   acha são padrões de regex das gramáticas do shiki e o
 *   Function("return this")() do lodash embutido em mermaid e cytoscape, que
 *   nunca executa no browser porque `self` satisfaz o || antes dele;
 * - o único WebAssembly do bundle é o motor oniguruma do shiki, e o Streamdown
 *   passa engine: createJavaScriptRegexEngine(), logo esse chunk nunca é
 *   importado; por isso nem 'wasm-unsafe-eval' entra.
 * Se um dia o build ganhar script inline, o caminho é hash (sha256) ou nonce,
 * nunca voltar 'unsafe-inline'. O teste em server/csp.test.ts trava isto.
 *
 * style-src mantém 'unsafe-inline' nos dois ambientes: Tailwind 4 e Radix
 * injetam <style> e atributos style em tempo de execução.
 */
export function montarDiretivasCsp(
  emDesenvolvimento: boolean
): Record<string, string[]> {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: emDesenvolvimento
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:", "blob:"],
    connectSrc: ["'self'", "wss:", "https:"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"], // Proteção adicional contra clickjacking
    objectSrc: ["'none'"],
    baseUri: ["'self'"], // Proteção contra base tag injection
    formAction: ["'self'"], // Formulários só podem enviar para o próprio domínio
    upgradeInsecureRequests: [],
  };
}
