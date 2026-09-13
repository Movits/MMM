import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";
import type { CampoDaCompletude } from "@shared/completude-do-contato";

/**
 * Meu Network Inteligente — o que falta num contato (pedido do Nicolas,
 * 13/09/2026, item 10). A regra mora em shared/completude-do-contato.ts; aqui
 * é só a tela: rótulos traduzidos e o alerta do detalhe do contato.
 */

type Traduzir = (chave: string, opcoes?: Record<string, unknown>) => string;

export function rotuloDoCampo(t: Traduzir, campo: CampoDaCompletude): string {
  return t(`networkPanel.fields.${campo}`);
}

// Rótulo e situação num texto só, como no exemplo do pedido:
// "Telefone — FALTANDO", "E-mail ✓".
function Linha({ rotulo, falta, destaque = false }: { rotulo: string; falta: boolean; destaque?: boolean }) {
  const { t } = useTranslation();
  const cor = falta ? "font-semibold text-amber-300" : "text-white/70";
  const forma = destaque ? "text-xs font-bold uppercase tracking-wider" : "";
  return (
    <li className={`py-1 ${cor} ${forma}`}>
      {falta ? `${rotulo} — ${t("networkPanel.statusMissing")}` : `${rotulo} ✓`}
    </li>
  );
}

/**
 * Alerta do detalhe do contato: o texto do pedido, o que está preenchido e o
 * que falta em Quem Sou / O Que Tenho / O Que Preciso, e o atalho para o
 * assistente do contato, que já completa por texto. Telefone e e-mail também
 * entram pelo "Editar" do próprio detalhe, e a dica diz isso. Não aparece com
 * o contato completo. Nada aqui grava nem sugere valor.
 */
export function AlertaDeCompletude({ faltando, aoCompletarPorTexto }: {
  faltando: CampoDaCompletude[];
  aoCompletarPorTexto: () => void;
}) {
  const { t } = useTranslation();
  const falta = (campo: CampoDaCompletude) => faltando.includes(campo);
  return (
    <div role="note" aria-label={t("networkPanel.alertLabel")} className="mx-6 mb-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-100">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        {t("networkPanel.alert")}
      </p>
      <div className="mt-3 grid gap-x-6 text-sm sm:grid-cols-2">
        <ul>
          <li className="pt-1 text-[11px] font-bold uppercase tracking-wider text-white/45">{t("networkPanel.whoAmI")}</li>
          <Linha rotulo={rotuloDoCampo(t, "nome")} falta={falta("nome")} />
          <Linha rotulo={rotuloDoCampo(t, "telefone")} falta={falta("telefone")} />
          <Linha rotulo={rotuloDoCampo(t, "email")} falta={falta("email")} />
        </ul>
        <ul className="sm:pt-5">
          <Linha rotulo={rotuloDoCampo(t, "tenho")} falta={falta("tenho")} destaque />
          <Linha rotulo={rotuloDoCampo(t, "preciso")} falta={falta("preciso")} destaque />
        </ul>
      </div>
      <button type="button" onClick={aoCompletarPorTexto}
        className="mt-3 rounded-lg bg-[#c98f70] px-3 py-1.5 text-xs font-bold text-[#151312] transition-colors hover:bg-[#b07a5c]">
        {t("networkPanel.completeByText")}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-white/45">{t("networkPanel.completeHint")}</p>
    </div>
  );
}
