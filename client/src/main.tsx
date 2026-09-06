import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import "./i18n"; // must be imported before App
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

// Depois de um deploy, uma aba aberta antes dele ainda pede os chunks antigos
// (nomes com hash) e o servidor responde 404 de propósito (fallthrough:false
// em server/_core/vite.ts); o Vite avisa por este evento antes de a tela cair
// no ErrorBoundary. Recarregar uma vez traz o index.html novo (que sai com
// no-cache). A marca no sessionStorage evita laço se a causa for outra.
window.addEventListener("vite:preloadError", event => {
  const marca = "mmm:recarregado-por-chunk-antigo";
  try {
    if (sessionStorage.getItem(marca) === window.location.href) return;
    sessionStorage.setItem(marca, window.location.href);
  } catch {
    // sessionStorage bloqueado: recarrega assim mesmo, uma vez por aba nova.
  }
  event.preventDefault();
  window.location.reload();
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  // Não redirecionar se já está em páginas públicas (evita loop de login duplo)
  const publicPaths = ["/login", "/register", "/forgot-password", "/reset-password", "/"];
  const currentPath = window.location.pathname;
  const isPublicPage = publicPaths.some(p => currentPath === p || currentPath.startsWith(p + "?"));
  if (isPublicPage) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
