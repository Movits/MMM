import { useTranslation } from "react-i18next";
import { CheckCircle, Circle } from "lucide-react";
import {
  avaliarQualificacaoDoPerfil,
  MINIMO_DE_PALAVRAS_NA_APRESENTACAO,
  type PerfilParaQualificar,
} from "@shared/qualificacao-do-perfil";

/**
 * Governança (14/09/2026): o cadastro nasce Bronze, "perfil em qualificação",
 * e passa a Prata sozinho quando o perfil atende à régua de
 * shared/qualificacao-do-perfil.ts — a mesma que o servidor aplica ao salvar.
 * Este cartão diz à membra Bronze o que falta, item a item, em vez de deixar o
 * nível como um rótulo sem caminho. Para Prata, Ouro e staff não aparece: nada
 * a completar, e Ouro não é degrau desta régua.
 */
export function QualificacaoDoPerfil({ role, perfil, onCompletar }: {
  role?: string | null;
  perfil: PerfilParaQualificar | null | undefined;
  /** Abre a edição do perfil. Ausente (já editando) = sem botão. */
  onCompletar?: () => void;
}) {
  const { t } = useTranslation();
  if (role !== "bronze") return null;

  const { qualificado, pendencias } = avaliarQualificacaoDoPerfil(perfil);

  return (
    <section
      aria-labelledby="qualificacao-do-perfil-titulo"
      className="rounded-2xl border border-[#c98f70]/30 bg-[#c98f70]/[0.06] p-5"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">🥉</span>
        <div className="min-w-0 flex-1">
          <h2 id="qualificacao-do-perfil-titulo" className="font-bold text-white">
            {t("governanca.perfil.titulo")}
          </h2>
          {qualificado ? (
            <p className="mt-1 flex items-start gap-2 text-sm text-white/70">
              <CheckCircle size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
              {t("governanca.perfil.prontoParaPrata")}
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-white/60">{t("governanca.perfil.texto")}</p>
              <ul className="mt-3 space-y-1.5">
                {pendencias.map(pendencia => (
                  <li key={pendencia} className="flex items-start gap-2 text-sm text-white/75">
                    <Circle size={13} className="mt-1 shrink-0 text-[#c98f70]" aria-hidden="true" />
                    {t(`governanca.pendencias.${pendencia}`, { minimo: MINIMO_DE_PALAVRAS_NA_APRESENTACAO })}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-white/40">{t("governanca.perfil.semMensalidade")}</p>
          {onCompletar && (
            <button
              type="button"
              onClick={onCompletar}
              className="mt-3 rounded-lg border border-[#c98f70]/40 px-3.5 py-1.5 text-sm font-semibold text-[#c98f70] transition-colors hover:bg-[#c98f70]/10"
            >
              {t("governanca.perfil.completar")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
