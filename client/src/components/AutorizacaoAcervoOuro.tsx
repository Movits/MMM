import { useState } from "react";
import { ShieldCheck, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";

/**
 * Etapa 10: autorização da DONA para que membras Ouro leiam os contatos que ela
 * marcar como compartilhados.
 *
 * Aparece dentro do formulário do contato, e só quando ela escolhe o nível
 * "Autorizadas (Ouro)". O motivo de morar aqui, e não numa tela própria, é que
 * este é o único instante em que a decisão importa: marcar um contato como
 * compartilhado sem a autorização no lugar faz o contato simplesmente não
 * aparecer no acervo — o servidor reavalia o termo a cada leitura
 * (usersComConsentimento em server/db.ts) — e ela não teria como descobrir por quê.
 *
 * Sem versão publicada do termo o componente não desenha nada: nesse estado o
 * servidor libera a leitura por omissão e não há o que consentir. Quando o
 * documento é publicado, este bloco passa a aparecer sozinho.
 */
export function AutorizacaoAcervoOuro() {
  const { t } = useTranslation();
  const [aberto, setAberto] = useState(false);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.consent.status.useQuery({ type: "termo_acesso_ouro" });

  const autorizar = trpc.consent.accept.useMutation({
    onSuccess: () => {
      toast.success(t("network.ouroAutorizadoToast"));
      utils.consent.status.invalidate();
    },
    onError: erro => toast.error(erro.message || t("network.ouroFalhaToast")),
  });

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
        <Loader2 className="animate-spin" size={13} /> {t("network.ouroCarregando")}
      </div>
    );
  }

  // Sem termo publicado não há trava: o acervo lê por omissão e pedir aceite
  // aqui seria pedir concordância com um documento que não existe.
  const texto = data?.document?.text ?? "";
  if (!texto) return null;

  if (data?.accepted) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 shrink-0 text-emerald-300" size={15} />
        <p className="text-xs text-emerald-200/80">{t("network.ouroJaAutorizado")}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/5 px-3 py-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 shrink-0 text-amber-300" size={15} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-200">{t("network.ouroPrecisaAutorizar")}</p>
          <p className="mt-1 text-xs text-white/55">{t("network.ouroPrecisaAutorizarDetalhe")}</p>

          <button
            type="button"
            onClick={() => setAberto(a => !a)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-300/90 hover:text-amber-200"
          >
            {aberto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {aberto ? t("network.ouroEsconderTermo") : t("network.ouroLerTermo")}
          </button>

          {aberto && (
            <div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-white/60">
              {texto}
            </div>
          )}

          <button
            type="button"
            onClick={() => autorizar.mutate({ type: "termo_acesso_ouro" })}
            disabled={autorizar.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-[#060e1a] transition-colors hover:bg-amber-400 disabled:opacity-60"
          >
            {autorizar.isPending && <Loader2 className="animate-spin" size={13} />}
            {t("network.ouroAutorizarBotao")}
          </button>
        </div>
      </div>
    </div>
  );
}
