import { useTranslation } from "react-i18next";
import { BotaoDitarTexto, juntarTextoDitado } from "@/components/BotaoDitarTexto";
import { BotaoRevisarTexto } from "@/components/BotaoRevisarTexto";

/**
 * Fileira "Gravar áudio" + "Revisar texto" para pôr embaixo de um campo livre.
 * O ditado entra depois do que já está escrito; a revisão, se aceita, troca o
 * texto inteiro. Os dois só mexem no valor do campo — quem salva é o formulário.
 *
 * O AVISO embaixo dos botões existe porque estes dois botões aparecem DENTRO do
 * cadastro, antes da etapa do Termo Geral de Uso: quem grava a apresentação na
 * segunda etapa manda a própria voz para um serviço de IA antes de ter aceitado
 * termo nenhum. Ninguém some com o aviso para "limpar" a tela — ele é a única
 * coisa que diz à usuária para onde o texto dela vai, e é o que fecha a janela D
 * da revisão do Nicolas na #135. O texto é curto de propósito: aviso comprido
 * ninguém lê.
 */
export function AssistenteDeTexto({ valor, onChange, desabilitado = false }: {
  valor: string;
  onChange: (novo: string) => void;
  desabilitado?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <BotaoDitarTexto desabilitado={desabilitado} onTexto={ditado => onChange(juntarTextoDitado(valor, ditado))} />
        <BotaoRevisarTexto desabilitado={desabilitado} texto={valor} onAceitar={onChange} />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-white/45">{t("assistenteTexto.avisoIA")}</p>
    </div>
  );
}
