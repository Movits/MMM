import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw, ScrollText } from "lucide-react";

// Carregado só quando a última etapa aparece: o Streamdown traz KaTeX, Shiki e
// Mermaid, peso que as outras oito etapas do cadastro não precisam baixar.
const Streamdown = lazy(() => import("streamdown").then(modulo => ({ default: modulo.Streamdown })));

/**
 * Última etapa do cadastro: o Termo Geral de Uso, Proteção de Dados e
 * Intermediação Digital (Dr. Ronei, 14/09/2026).
 *
 * O texto vem do documento PUBLICADO (consent.status, tipo termo_geral_de_uso),
 * nunca do código: a versão que a tela mostra é a que o aceite registra
 * (Onboarding manda o `documentVersionId` e o servidor recusa se a vigente
 * mudou). Sem versão publicada não há o que aceitar, e a etapa diz isso em vez
 * de deixar concluir.
 *
 * Este componente só exibe; o estado (consulta, caixa marcada, envio) é do
 * Onboarding.
 */

export type DocumentoDoTermo = {
  id: string;
  version: number;
  text: string;
  publishedAt: Date | string;
};

/**
 * O .docx termina com a linha "☐ LI E ACEITO integralmente…", que no documento
 * é o lugar da marcação. Na tela quem cumpre esse papel é a caixa de verdade,
 * logo abaixo e com as mesmas palavras; repetir a linha dentro do texto
 * mostraria duas caixas, uma delas impossível de marcar. O documento publicado
 * (e o hash gravado no aceite) continua com a linha.
 */
export function textoDoTermoParaExibir(texto: string): string {
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  if (linhas.length && /^\s*☐/.test(linhas[linhas.length - 1])) linhas.pop();
  return linhas.join("\n").trimEnd();
}

// Tailwind 4 não gera as classes internas do Streamdown (node_modules não é
// escaneado) e o preflight zera títulos e parágrafos: sem isto o termo sairia
// num bloco só, ilegível no celular.
const TIPOGRAFIA_DO_TERMO =
  "text-[15px] leading-relaxed text-white/80 break-words " +
  "[&_h1]:mb-4 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:leading-snug [&_h1]:text-white " +
  "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white " +
  "[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-white " +
  "[&_p]:mb-3 [&_strong]:font-semibold [&_strong]:text-white " +
  "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1";

export function EtapaTermoGeralDeUso({ carregando, erro, documento, aceito, onAceitoChange, onTentarDeNovo }: {
  carregando: boolean;
  erro: boolean;
  documento: DocumentoDoTermo | null;
  aceito: boolean;
  onAceitoChange: (aceito: boolean) => void;
  onTentarDeNovo: () => void;
}) {
  const { t, i18n } = useTranslation();

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/50" role="status">
        <Loader2 size={18} className="animate-spin" aria-hidden /> {t("termoGeral.carregando")}
      </div>
    );
  }

  if (erro || !documento) {
    return (
      <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-500/[0.06] px-5 py-8 text-center">
        <p className="font-semibold text-white">
          {erro ? t("termoGeral.erroCarregar") : t("termoGeral.naoPublicado")}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
          {erro ? t("termoGeral.erroCarregarDica") : t("termoGeral.naoPublicadoDica")}
        </p>
        <button type="button" onClick={onTentarDeNovo}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-sm text-white/80 hover:border-white/40 hover:text-white">
          <RotateCcw size={14} aria-hidden /> {t("termoGeral.tentarDeNovo")}
        </button>
      </div>
    );
  }

  const publicadoEm = new Date(documento.publishedAt);
  const data = Number.isNaN(publicadoEm.getTime()) ? "" : publicadoEm.toLocaleDateString(i18n.language);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c98f70]/30 bg-[#c98f70]/10">
          <ScrollText size={19} className="text-[#c98f70]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold leading-snug text-white">{t("termoGeral.titulo")}</h2>
          <p className="mt-0.5 text-xs text-white/45">{t("termoGeral.versao", { versao: documento.version, data })}</p>
        </div>
      </div>

      {!i18n.language?.toLowerCase().startsWith("pt") && (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs text-white/60">
          {t("termoGeral.avisoIdioma")}
        </p>
      )}

      <div role="region" aria-label={t("termoGeral.textoIntegral")} tabIndex={0} lang="pt-BR"
        data-testid="texto-do-termo-geral"
        className={`max-h-[60vh] overflow-y-auto overscroll-contain rounded-2xl border border-[#c98f70]/25 bg-[#211e1b]/70 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c98f70]/60 sm:max-h-[28rem] sm:p-6 ${TIPOGRAFIA_DO_TERMO}`}>
        {/* Enquanto o leitor de Markdown baixa, o texto já aparece cru: nunca uma caixa vazia. */}
        <Suspense fallback={<div className="whitespace-pre-wrap">{textoDoTermoParaExibir(documento.text)}</div>}>
          <Streamdown>{textoDoTermoParaExibir(documento.text)}</Streamdown>
        </Suspense>
      </div>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all duration-200"
          style={{
            borderColor: aceito ? "#c98f70" : "rgba(255,255,255,0.1)",
            backgroundColor: aceito ? "rgba(201,143,112,0.1)" : "rgba(255,255,255,0.02)",
          }}>
          <input type="checkbox" checked={aceito} onChange={evento => onAceitoChange(evento.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[#c98f70]" />
          <span className="text-sm font-medium text-white">{t("termoGeral.aceite")}</span>
        </label>
        {!aceito && <p className="text-center text-xs text-red-400/70">{t("termoGeral.obrigatorio")}</p>}
      </div>
    </div>
  );
}
