import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, SpellCheck, X } from "lucide-react";
import { toast } from "sonner";
import { diferencasDaRevisao } from "@/lib/diferencas-da-revisao";
import { trpc } from "@/lib/trpc";

/**
 * "Revisar texto" (decisão do Roberto, 14/09: Gemini em vez do LanguageTool).
 *
 * Manda o texto a assistenteTexto.revisar, que corrige só ortografia, gramática
 * e pontuação, e mostra a SUGESTÃO. O campo só muda se a pessoa clicar em
 * "Usar texto revisado". Se ela editar o campo enquanto a sugestão está aberta,
 * a sugestão some: ela valia para o texto anterior.
 *
 * Rende o botão e, logo depois, o painel da sugestão com `basis-full`, para
 * ocupar uma linha própria quando estiver numa fileira flex-wrap (ver
 * AssistenteDeTexto).
 */
export function BotaoRevisarTexto({ texto, onAceitar, desabilitado = false }: {
  texto: string;
  onAceitar: (revisado: string) => void;
  desabilitado?: boolean;
}) {
  const { t } = useTranslation();
  const [sugestao, setSugestao] = useState<{ original: string; revisado: string } | null>(null);
  const revisar = trpc.assistenteTexto.revisar.useMutation();

  // A sugestão é do texto que foi enviado; se o campo mudou, ela não vale mais.
  const sugestaoValida = sugestao && sugestao.original === texto ? sugestao : null;
  // O que muda fica à vista: palavra tirada riscada, palavra nova destacada.
  const trechos = useMemo(
    () => (sugestao ? diferencasDaRevisao(sugestao.original, sugestao.revisado) : []),
    [sugestao],
  );

  async function pedirRevisao() {
    if (texto.trim().length < 2) {
      toast.error(t("assistenteTexto.textoCurto"));
      return;
    }
    const enviado = texto;
    try {
      const resposta = await revisar.mutateAsync({ texto: enviado });
      if (!resposta.mudou) {
        setSugestao(null);
        toast.success(t("assistenteTexto.semCorrecoes"));
        return;
      }
      setSugestao({ original: enviado, revisado: resposta.revisado });
    } catch (erro) {
      const codigo = (erro as { data?: { code?: string } } | null)?.data?.code;
      const chave = codigo === "TOO_MANY_REQUESTS" ? "assistenteTexto.muitosPedidos"
        : codigo === "UNPROCESSABLE_CONTENT" ? "assistenteTexto.revisaoRecusada"
        : "assistenteTexto.erroRevisar";
      toast.error(t(chave));
    }
  }

  return (
    <>
      <button type="button" onClick={pedirRevisao} disabled={desabilitado || revisar.isPending}
        title={t("assistenteTexto.revisarDica")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-[#c98f70]/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
        {revisar.isPending
          ? <><Loader2 size={13} className="animate-spin" aria-hidden /> {t("assistenteTexto.revisando")}</>
          : <><SpellCheck size={13} aria-hidden /> {t("assistenteTexto.revisar")}</>}
      </button>

      {sugestaoValida && (
        <div role="region" aria-label={t("assistenteTexto.sugestaoTitulo")}
          className="basis-full w-full rounded-xl border border-[#c98f70]/30 bg-[#c98f70]/[0.06] p-3">
          <p className="text-xs font-semibold text-[#c98f70]">{t("assistenteTexto.sugestaoTitulo")}</p>
          <p className="mt-0.5 text-[11px] text-white/40">{t("assistenteTexto.sugestaoDica")}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white/85">
            {trechos.map((trecho, i) => {
              if (trecho.tipo === "igual") return <span key={i}>{trecho.texto}</span>;
              const [, antes = "", corpo = "", depois = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(trecho.texto) ?? [];
              return (
                <span key={i}>
                  {antes}
                  {trecho.tipo === "removido"
                    ? <del className="text-white/40 decoration-white/40">{corpo}</del>
                    : <ins className="rounded-sm bg-[#c98f70]/25 px-0.5 text-white no-underline">{corpo}</ins>}
                  {depois}
                </span>
              );
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button"
              onClick={() => { onAceitar(sugestaoValida.revisado); setSugestao(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#c98f70] px-3 py-1.5 text-xs font-bold text-[#151312] hover:bg-[#b07a5c]">
              <Check size={13} aria-hidden /> {t("assistenteTexto.usar")}
            </button>
            <button type="button" onClick={() => setSugestao(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/60 hover:text-white">
              <X size={13} aria-hidden /> {t("assistenteTexto.descartar")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
