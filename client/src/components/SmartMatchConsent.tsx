import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { trpc } from "@/lib/trpc";

/**
 * Etapa 11: tela de autorização do Cruzamento Inteligente.
 *
 * Enquanto a usuária não aceita o termo vigente, é isto que ocupa a página no
 * lugar dos matches. Recusar não tem botão porque não precisa: basta sair da
 * página — o resto da plataforma não depende desta autorização.
 */
export function SmartMatchConsent({ onAccepted }: { onAccepted: () => void }) {
  const [reading, setReading] = useState(false);
  const { data, isLoading } = trpc.consent.status.useQuery({ type: "termo_smart_match" });
  const accept = trpc.consent.accept.useMutation({
    onSuccess: () => { toast.success("Autorização registrada."); onAccepted(); },
    onError: error => toast.error(error.message || "Não foi possível registrar a autorização."),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-white/45">
      <Loader2 className="mr-2 animate-spin" size={18}/> Carregando o termo…
    </div>;
  }

  const texto = data?.document?.text ?? "";

  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-amber-300/25 bg-amber-300/[0.04] p-7 md:p-9">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/10">
          <ShieldCheck className="text-amber-300" size={21}/>
        </div>
        <div>
          <h2 className="text-lg font-bold">Autorização necessária</h2>
          <p className="text-sm text-white/45">
            Versão {data?.document?.version} do termo do Cruzamento Inteligente
          </p>
        </div>
      </div>

      <div className={`prose prose-invert prose-sm max-w-none overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1725]/60 p-5 transition-all ${reading ? "max-h-none" : "max-h-64"}`}>
        <Streamdown>{texto}</Streamdown>
      </div>

      {!reading && (
        <button onClick={() => setReading(true)} className="mt-3 text-sm text-amber-300 hover:text-amber-200">
          Ler o termo inteiro
        </button>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          disabled={accept.isPending}
          onClick={() => accept.mutate({ type: "termo_smart_match" })}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f5a623] px-6 py-3 font-bold text-[#08121f] transition-colors hover:bg-[#e09520] disabled:opacity-50"
        >
          {accept.isPending ? <Loader2 className="animate-spin" size={17}/> : <ShieldCheck size={17}/>}
          Autorizar o cruzamento
        </button>
        <p className="text-xs text-white/40">
          Você pode revogar quando quiser, e o restante da plataforma continua funcionando.
        </p>
      </div>
    </div>
  );
}
