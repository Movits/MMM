import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/**
 * "Gravar áudio" como alternativa a digitar (Rosber, 14/09 19:10).
 *
 * Grava no navegador (MediaRecorder), manda ao servidor, que transcreve com o
 * Gemini (assistenteTexto.transcrever), e entrega o TEXTO a quem usa o botão,
 * que o põe no campo. A pessoa revisa e edita ali; nada é salvo até ela
 * confirmar o formulário. O áudio não fica guardado em lugar nenhum.
 *
 * Os limites espelham server/assistente-de-texto.ts: 2 minutos (a gravação para
 * sozinha) e 3 MB.
 */
export const LIMITE_GRAVACAO_SEGUNDOS = 120;
const LIMITE_AUDIO_BYTES = 3 * 1024 * 1024;

type Estado = "parado" | "pedindoMicrofone" | "gravando" | "transcrevendo";

/** Texto ditado entra DEPOIS do que já estava escrito, nunca por cima. */
export function juntarTextoDitado(atual: string, ditado: string): string {
  const novo = ditado.trim();
  if (!novo) return atual;
  const antes = atual.trimEnd();
  return antes ? `${antes} ${novo}` : novo;
}

function mimeDoAudio(tipo: string) {
  if (tipo.includes("ogg")) return "audio/ogg" as const;
  if (tipo.includes("wav")) return "audio/wav" as const;
  if (tipo.includes("mp4") || tipo.includes("m4a")) return "audio/mp4" as const;
  return "audio/webm" as const;
}

function lerComoDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(leitor.error);
    leitor.onload = () => resolve(String(leitor.result));
    leitor.readAsDataURL(blob);
  });
}

const minutos = (segundos: number) => `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

export function BotaoDitarTexto({ onTexto, desabilitado = false }: {
  onTexto: (texto: string) => void;
  desabilitado?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [estado, setEstado] = useState<Estado>("parado");
  const [segundos, setSegundos] = useState(0);
  const gravador = useRef<MediaRecorder | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const inicio = useRef(0);
  const montado = useRef(false);
  // Um pedido de microfone por vez. O estado da tela só muda na próxima
  // renderização; a ref barra já o segundo clique de um duplo clique, que abria
  // um segundo MediaRecorder e deixava o primeiro com o microfone aceso.
  const pedindoMicrofone = useRef(false);

  const transcrever = trpc.assistenteTexto.transcrever.useMutation();
  // A gravação termina alguns segundos depois de começar: o texto tem de ir para
  // o valor ATUAL do campo, não para o da hora em que ela clicou em gravar.
  const onTextoAtual = useRef(onTexto);
  onTextoAtual.current = onTexto;

  const soltarMicrofone = (midia: MediaStream | null = fluxo.current) => {
    midia?.getTracks().forEach(trilha => trilha.stop());
    if (fluxo.current === midia) fluxo.current = null;
  };

  // Saiu da tela GRAVANDO: para o microfone e não manda nada. O que já foi
  // enviado segue e é entregue ao campo (ver `enviar`): quem avança de etapa
  // durante o "Transcrevendo…" não perde o ditado. (O `true` na montagem cobre
  // o StrictMode, que monta, desmonta e monta de novo.)
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      const atual = gravador.current;
      if (atual?.state === "recording") {
        atual.onstop = null;
        atual.stop();
      }
      soltarMicrofone();
    };
  }, []);

  useEffect(() => {
    if (estado !== "gravando") return;
    const relogio = setInterval(() => {
      const decorridos = Math.floor((Date.now() - inicio.current) / 1000);
      setSegundos(decorridos);
      if (decorridos >= LIMITE_GRAVACAO_SEGUNDOS && gravador.current?.state === "recording") gravador.current.stop();
    }, 250);
    return () => clearInterval(relogio);
  }, [estado]);

  async function enviar(blob: Blob) {
    if (!blob.size) {
      setEstado("parado");
      toast.error(t("assistenteTexto.audioVazio"));
      return;
    }
    if (blob.size > LIMITE_AUDIO_BYTES) {
      setEstado("parado");
      toast.error(t("assistenteTexto.audioGrande"));
      return;
    }
    setEstado("transcrevendo");
    try {
      const audioBase64 = await lerComoDataUrl(blob);
      const { texto } = await transcrever.mutateAsync({ audioBase64, mimeType: mimeDoAudio(blob.type), idioma: i18n.language });
      // Entrega mesmo se o campo saiu da tela durante a transcrição (ex.: Continuar
      // no cadastro): a pessoa já parou a gravação e espera o texto no campo, e o
      // pedido já contou no limite. `onTextoAtual` é o da última renderização.
      onTextoAtual.current(texto);
      toast.success(t("assistenteTexto.transcricaoPronta"));
    } catch (erro) {
      const codigo = (erro as { data?: { code?: string } } | null)?.data?.code;
      toast.error(t(codigo === "TOO_MANY_REQUESTS" ? "assistenteTexto.muitosPedidos"
        // O servidor recusa o áudio grande e também a fala de mais de 2 minutos.
        : codigo === "PAYLOAD_TOO_LARGE" ? "assistenteTexto.audioGrande"
        : "assistenteTexto.erroTranscrever"));
    } finally {
      if (montado.current) setEstado("parado");
    }
  }

  async function comecar() {
    if (pedindoMicrofone.current || gravador.current?.state === "recording") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error(t("assistenteTexto.semSuporte"));
      return;
    }
    pedindoMicrofone.current = true;
    setEstado("pedindoMicrofone");
    let midia: MediaStream | null = null;
    try {
      const recebida = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true } },
        video: false,
      });
      midia = recebida;
      // Saiu da tela enquanto o navegador pedia o microfone: solta e não grava.
      if (!montado.current) {
        soltarMicrofone(recebida);
        return;
      }
      const preferido = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
        .find(tipo => MediaRecorder.isTypeSupported(tipo));
      const novo = preferido
        ? new MediaRecorder(recebida, { mimeType: preferido, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(recebida, { audioBitsPerSecond: 64_000 });
      // Os pedaços são DESTA gravação: nenhum gravador empurra para a lista de outro.
      const pedacos: Blob[] = [];
      novo.ondataavailable = evento => { if (evento.data.size) pedacos.push(evento.data); };
      novo.onstop = () => {
        soltarMicrofone(recebida);
        void enviar(new Blob(pedacos, { type: novo.mimeType || "audio/webm" }));
      };
      fluxo.current = recebida;
      gravador.current = novo;
      inicio.current = Date.now();
      setSegundos(0);
      novo.start(250);
      setEstado("gravando");
    } catch {
      soltarMicrofone(midia);
      if (montado.current) {
        setEstado("parado");
        toast.error(t("assistenteTexto.microfoneNegado"));
      }
    } finally {
      pedindoMicrofone.current = false;
    }
  }

  function parar() {
    if (gravador.current?.state === "recording") gravador.current.stop();
  }

  const base = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  if (estado === "gravando") {
    return (
      <button type="button" onClick={parar} aria-live="polite"
        className={`${base} border-red-400/50 bg-red-500/10 text-red-200 hover:bg-red-500/20`}>
        <Square size={12} className="fill-current" aria-hidden />
        <span>{t("assistenteTexto.parar")}</span>
        <span className="tabular-nums text-red-200/70">
          {t("assistenteTexto.gravando", { tempo: minutos(segundos), limite: minutos(LIMITE_GRAVACAO_SEGUNDOS) })}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={comecar} disabled={desabilitado || estado !== "parado"}
      title={t("assistenteTexto.gravarDica")} aria-live="polite" aria-busy={estado !== "parado" || undefined}
      className={`${base} border-white/15 bg-white/5 text-white/70 hover:border-[#c98f70]/50 hover:text-white`}>
      {estado === "transcrevendo"
        ? <><Loader2 size={13} className="animate-spin" aria-hidden /> {t("assistenteTexto.transcrevendo")}</>
        : estado === "pedindoMicrofone"
          ? <><Loader2 size={13} className="animate-spin" aria-hidden /> {t("assistenteTexto.gravar")}</>
          : <><Mic size={13} aria-hidden /> {t("assistenteTexto.gravar")}</>}
    </button>
  );
}
