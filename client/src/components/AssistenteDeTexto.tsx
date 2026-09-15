import { BotaoDitarTexto, juntarTextoDitado } from "@/components/BotaoDitarTexto";
import { BotaoRevisarTexto } from "@/components/BotaoRevisarTexto";

/**
 * Fileira "Gravar áudio" + "Revisar texto" para pôr embaixo de um campo livre.
 * O ditado entra depois do que já está escrito; a revisão, se aceita, troca o
 * texto inteiro. Os dois só mexem no valor do campo — quem salva é o formulário.
 */
export function AssistenteDeTexto({ valor, onChange, desabilitado = false }: {
  valor: string;
  onChange: (novo: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <BotaoDitarTexto desabilitado={desabilitado} onTexto={ditado => onChange(juntarTextoDitado(valor, ditado))} />
      <BotaoRevisarTexto desabilitado={desabilitado} texto={valor} onAceitar={onChange} />
    </div>
  );
}
