import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, CircleAlert, Clock3, FileText, Loader2, Mic, Pause, Play, Plus, RefreshCw, Users, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { LANGUAGES } from "@/i18n";

const MAX_DURATION = 10 * 60;

function formatDuration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  return ({ draft: "Rascunho", recording: "Gravação pendente", processing: "Processando", ready: "Pronta", failed: "Falhou", deleted: "Excluída" } as Record<string, string>)[status] ?? status;
}

function statusClass(status: string) {
  return ({ ready: "bg-emerald-400/15 text-emerald-300 border-emerald-400/20", processing: "bg-amber-400/15 text-amber-300 border-amber-400/20", failed: "bg-red-400/15 text-red-300 border-red-400/20" } as Record<string, string>)[status] ?? "bg-white/5 text-white/55 border-white/10";
}

function microphoneErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "O microfone foi bloqueado pelo navegador. Permita o acesso nas configurações do site ou envie um arquivo de áudio.";
  if (name === "NotFoundError") return "Nenhum microfone foi encontrado. Conecte um dispositivo de áudio ou envie um arquivo.";
  if (name === "NotReadableError") return "O microfone está sendo usado por outro aplicativo. Feche-o e tente novamente, ou envie um arquivo.";
  return "Não foi possível acessar o microfone. Você pode liberar a permissão do navegador ou enviar um arquivo de áudio.";
}

function supportedAudioMime(file: File) {
  if (file.type === "audio/mpeg" || /\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (file.type === "audio/ogg" || /\.ogg$/i.test(file.name)) return "audio/ogg";
  if (file.type === "audio/wav" || /\.wav$/i.test(file.name)) return "audio/wav";
  if (file.type === "audio/mp4" || /\.mp4$/i.test(file.name)) return "audio/mp4";
  if (file.type === "audio/m4a" || file.type === "audio/x-m4a" || /\.m4a$/i.test(file.name)) return "audio/m4a";
  if (file.type === "audio/webm" || /\.webm$/i.test(file.name)) return "audio/webm";
  return null;
}

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo de áudio."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function inferAudioDuration(file: File) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const finish = (duration: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(duration) && duration > 0 ? Math.ceil(duration) : 60); };
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(60);
    audio.src = url;
  });
}

function recordedMimeType(value: string) {
  if (value.includes("ogg")) return "audio/ogg" as const;
  if (value.includes("wav")) return "audio/wav" as const;
  if (value.includes("mp4") || value.includes("m4a")) return "audio/mp4" as const;
  return "audio/webm" as const;
}

export default function Meetings() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: meetings, isLoading } = trpc.meetings.list.useQuery();
  const [screen, setScreen] = useState<"list" | "new" | "detail">("list");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [microphoneIssue, setMicrophoneIssue] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [capturedAudio, setCapturedAudio] = useState<{ blob: Blob; url: string; mimeType: "audio/webm" | "audio/ogg" | "audio/wav" | "audio/mp4"; durationSeconds: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const audioInput = useRef<HTMLInputElement | null>(null);

  const createMeeting = trpc.meetings.create.useMutation();
  const submitRecording = trpc.meetings.submitRecording.useMutation({
    onSuccess: async () => {
      await utils.meetings.list.invalidate();
      toast.success("Reunião processada. Revise a transcrição e as sugestões.");
      setScreen("detail");
    },
    onError: (error) => toast.error(error.message || "Não foi possível processar a reunião."),
  });

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.min(MAX_DURATION, Math.floor((Date.now() - startedAt.current) / 1000));
      setElapsed(seconds);
      if (seconds >= MAX_DURATION) stopRecording();
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => stream.current?.getTracks().forEach(track => track.stop()), []);

  async function startRecording() {
    if (!title.trim()) return toast.error("Dê um título para a reunião.");
    if (!consent) return toast.error("Registre o consentimento antes de iniciar a gravação.");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast.error("A gravação não é suportada neste navegador.");
    try {
      setStarting(true);
      setMicrophoneIssue(null);
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
        },
        video: false,
      });
      stream.current = media;
      const preferredMime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = preferredMime
        ? new MediaRecorder(media, { mimeType: preferredMime, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(media, { audioBitsPerSecond: 64_000 });
      chunks.current = [];
      mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        stream.current?.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        if (!blob.size) {
          setFinalizing(false);
          toast.error("A gravação não gerou áudio. Verifique o microfone e tente novamente.");
          return;
        }
        setCapturedAudio({
          blob,
          url: URL.createObjectURL(blob),
          mimeType: recordedMimeType(blob.type),
          durationSeconds: Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000)),
        });
        setElapsed(0);
        setFinalizing(false);
      };
      recorder.current = mediaRecorder;
      startedAt.current = Date.now();
      setElapsed(0);
      mediaRecorder.start(250);
      setRecording(true);
    } catch (error) {
      stream.current?.getTracks().forEach(track => track.stop());
      const issue = microphoneErrorMessage(error);
      setMicrophoneIssue(issue);
      toast.error(issue);
    } finally {
      setStarting(false);
    }
  }

  async function uploadAudio(file: File) {
    if (!title.trim()) return toast.error("Dê um título para a reunião.");
    if (!consent) return toast.error("Registre o consentimento antes de enviar o áudio.");
    const mimeType = supportedAudioMime(file);
    if (!mimeType) return toast.error("Envie um arquivo WebM, MP3, M4A, MP4, OGG ou WAV.");
    if (file.size > 10 * 1024 * 1024) return toast.error("O arquivo de áudio deve ter no máximo 10 MB.");
    try {
      const [audioBase64, durationSeconds] = await Promise.all([readAsDataUrl(file), inferAudioDuration(file)]);
      if (durationSeconds > MAX_DURATION) return toast.error("No modo atual, o áudio deve ter no máximo 10 minutos.");
      const created = await createMeeting.mutateAsync({ title: title.trim(), consentGranted: true, language: "pt" });
      setMeetingId(created.id);
      await submitRecording.mutateAsync({ meetingId: created.id, audioBase64, mimeType, durationSeconds, language: "pt" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o áudio.");
    }
  }

  async function processCapturedAudio() {
    if (!capturedAudio) return;
    try {
      setFinalizing(true);
      const [created, audioBase64] = await Promise.all([
        createMeeting.mutateAsync({ title: title.trim(), consentGranted: true, language: "pt" }),
        readAsDataUrl(capturedAudio.blob),
      ]);
      setMeetingId(created.id);
      await submitRecording.mutateAsync({
        meetingId: created.id,
        audioBase64,
        mimeType: capturedAudio.mimeType,
        durationSeconds: capturedAudio.durationSeconds,
        language: "pt",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a gravação.");
    } finally {
      setFinalizing(false);
    }
  }

  function discardCapturedAudio() {
    if (capturedAudio) URL.revokeObjectURL(capturedAudio.url);
    setCapturedAudio(null);
    setElapsed(0);
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") {
      setFinalizing(true);
      recorder.current.stop();
    }
    setRecording(false);
  }

  if (screen === "new") {
    return <MeetingRecorder
      title={title} setTitle={setTitle} consent={consent} setConsent={setConsent}
      recording={recording} elapsed={elapsed} processing={starting || finalizing || submitRecording.isPending}
      microphoneIssue={microphoneIssue} audioInput={audioInput} capturedAudio={capturedAudio}
      onProcessCaptured={processCapturedAudio} onDiscardCaptured={discardCapturedAudio}
      onStart={startRecording} onStop={stopRecording} onUpload={uploadAudio} onBack={() => { if (!recording) setScreen("list"); }}
    />;
  }
  if (screen === "detail" && meetingId) {
    return <MeetingDetail meetingId={meetingId} onBack={() => setScreen("list")} />;
  }

  return <main className="min-h-screen text-white px-4 py-8 md:px-8 bg-transparent">
    <div className="max-w-6xl mx-auto">
      <button onClick={() => navigate("/dashboard")} className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white mb-6"><ArrowLeft size={16}/> Dashboard</button>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div><p className="text-amber-300 text-sm font-semibold tracking-wide">PRIVADO E SEGURO</p><h1 className="text-3xl md:text-4xl font-bold mt-1">Assistente de Reuniões</h1><p className="text-white/55 mt-2 max-w-2xl">Grave reuniões curtas com consentimento, revise a transcrição e confirme os contatos sugeridos.</p></div>
        <button onClick={() => setScreen("new")} className="inline-flex justify-center items-center gap-2 rounded-xl bg-[#f5a623] text-[#08121f] font-bold px-5 py-3 hover:bg-[#ffc04d]"><Plus size={18}/> Nova reunião</button>
      </div>
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/80 mb-7"><CircleAlert size={17} className="inline mr-2"/>Somente grave com consentimento de todas as pessoas. O áudio é privado e programado para expirar após 30 dias.</div>
      {isLoading ? <div className="py-20 text-center text-white/45"><Loader2 className="animate-spin inline mr-2"/>Carregando reuniões…</div> : !meetings?.length ? <div className="rounded-3xl border border-dashed border-white/15 px-6 py-20 text-center"><Mic className="mx-auto text-amber-300 mb-4" size={34}/><h2 className="font-semibold text-xl">Nenhuma reunião registrada</h2><p className="text-white/45 mt-2">Inicie uma gravação para gerar transcrição e sugestões de contato.</p></div> : <div className="grid gap-3">{meetings.map(meeting => <button key={meeting.id} onClick={() => { setMeetingId(meeting.id); setScreen("detail"); }} className="text-left rounded-2xl border border-white/10 bg-white/[0.035] hover:bg-white/[0.07] p-5 transition-colors"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">{meeting.title}</h2><p className="text-xs text-white/45 mt-1">{new Date(meeting.createdAt).toLocaleString("pt-BR")}</p></div><span className={`border rounded-full px-3 py-1 text-xs font-semibold ${statusClass(meeting.status)}`}>{statusLabel(meeting.status)}</span></div></button>)}</div>}
    </div>
  </main>;
}

function MeetingRecorder(props: { title: string; setTitle: (value: string) => void; consent: boolean; setConsent: (value: boolean) => void; recording: boolean; elapsed: number; processing: boolean; microphoneIssue: string | null; audioInput: React.RefObject<HTMLInputElement | null>; capturedAudio: { url: string; durationSeconds: number } | null; onProcessCaptured: () => void; onDiscardCaptured: () => void; onStart: () => void; onStop: () => void; onUpload: (file: File) => void; onBack: () => void }) {
  const locked = props.recording || props.processing;
  return <main className="min-h-screen flex items-center justify-center p-4 bg-transparent text-white">
    <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0b1725]/90 p-6 md:p-8 shadow-2xl">
      <button disabled={locked} onClick={props.onBack} className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white disabled:opacity-40"><ArrowLeft size={16}/> Voltar</button>
      <p className="text-amber-300 text-xs font-semibold tracking-wide mt-6">NOVA REUNIÃO</p>
      <h1 className="text-2xl font-bold mt-1">Registre uma conversa estratégica</h1>
      <div className="mt-7 space-y-5">
        <div><label className="text-sm text-white/70">Título da reunião</label><input disabled={locked} value={props.title} onChange={e => props.setTitle(e.target.value)} placeholder="Ex.: Conversa com investidora" className="mt-2 w-full rounded-xl bg-white/5 border border-white/15 px-4 py-3 outline-none focus:border-amber-300"/></div>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 cursor-pointer"><input type="checkbox" checked={props.consent} disabled={locked} onChange={e => props.setConsent(e.target.checked)} className="mt-1 accent-amber-400"/><span className="text-sm text-white/70">Confirmo que todas as pessoas participantes autorizaram a gravação e o tratamento privado deste áudio para esta reunião.</span></label>
      </div>
      <div className="my-9 text-center"><div className={`mx-auto mb-4 h-28 w-28 rounded-full flex items-center justify-center border ${props.recording ? "border-red-400 bg-red-500/15 animate-pulse" : "border-amber-400/40 bg-amber-400/10"}`}>{props.processing ? <Loader2 className="animate-spin text-amber-300" size={36}/> : <Mic className={props.recording ? "text-red-300" : "text-amber-300"} size={36}/>}</div><p className="font-mono text-3xl tracking-widest">{formatDuration(props.elapsed)}</p><p className="text-xs text-white/40 mt-2">Limite no modo atual: 10 minutos e 10 MB</p></div>
      {props.microphoneIssue && <div className="mb-4 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100"><strong>Permissão de microfone:</strong> {props.microphoneIssue}</div>}
      <input ref={props.audioInput} type="file" accept="audio/webm,audio/mpeg,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/wav,.mp3,.m4a,.mp4,.ogg,.wav,.webm" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) props.onUpload(file); event.currentTarget.value = ""; }}/>
      {props.processing ? <div className="w-full rounded-xl bg-white/8 py-4 text-center text-white/70"><Loader2 className="inline animate-spin mr-2" size={17}/>Transcrevendo e analisando a reunião…</div> : props.recording ? <button onClick={props.onStop} className="w-full rounded-xl bg-red-500 text-white font-bold py-4 inline-flex justify-center gap-2"><Pause size={19}/> Encerrar gravação</button> : props.capturedAudio ? <div className="space-y-3 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-4"><p className="text-sm font-semibold text-amber-100">Ouça a gravação antes de transcrever</p><audio controls src={props.capturedAudio.url} className="w-full"/><p className="text-xs text-white/45">Duração: {formatDuration(props.capturedAudio.durationSeconds)}</p><button onClick={props.onProcessCaptured} className="w-full rounded-xl bg-[#f5a623] text-[#08121f] font-bold py-3 inline-flex justify-center gap-2"><FileText size={18}/> Transcrever áudio</button><button onClick={props.onDiscardCaptured} className="w-full rounded-xl border border-white/20 py-3 text-sm text-white/75">Descartar e gravar novamente</button></div> : <div className="space-y-3"><button onClick={props.onStart} className="w-full rounded-xl bg-[#f5a623] text-[#08121f] font-bold py-4 inline-flex justify-center gap-2"><Play size={19}/> Iniciar gravação</button><button onClick={() => props.audioInput.current?.click()} className="w-full rounded-xl border border-white/20 text-white/75 hover:bg-white/5 py-3 inline-flex justify-center gap-2 text-sm"><FileText size={17}/> Enviar arquivo de áudio</button></div>}
    </div>
  </main>;
}

function MeetingDetail({ meetingId, onBack }: { meetingId: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { i18n } = useTranslation();
  const { data, isLoading } = trpc.meetings.get.useQuery({ meetingId });
  const [tab, setTab] = useState<"summary" | "transcript" | "contacts">("summary");
  const initialLanguage = LANGUAGES.some(language => language.code === i18n.language) ? i18n.language : "pt-BR";
  const [translationLanguage, setTranslationLanguage] = useState(initialLanguage);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const decideEntity = trpc.meetings.decideEntity.useMutation({ onSuccess: () => utils.meetings.get.invalidate({ meetingId }) });
  const decideContact = trpc.meetings.decideContactSuggestion.useMutation({ onSuccess: () => utils.meetings.get.invalidate({ meetingId }) });
  const translateTranscript = trpc.meetings.translateTranscript.useMutation({
    onSuccess: result => setTranslatedText(result.text),
    onError: error => toast.error(error.message || "Não foi possível traduzir a transcrição."),
  });
  const deleteMeeting = trpc.meetings.delete.useMutation({
    onSuccess: async () => { await utils.meetings.list.invalidate(); toast.success("Reunião e dados derivados excluídos."); onBack(); },
    onError: error => toast.error(error.message || "Não foi possível excluir a reunião."),
  });

  useEffect(() => {
    if (!data?.transcript || translationLanguage === "pt-BR") { setTranslatedText(null); return; }
    translateTranscript.mutate({ meetingId, language: translationLanguage as "en" | "es" | "fr" | "de" | "ar" | "zh" | "hi" | "ja" | "ru" });
  }, [data?.transcript?.id, meetingId, translationLanguage]);

  if (isLoading || !data) return <main className="min-h-screen grid place-items-center text-white"><Loader2 className="animate-spin"/></main>;
  const { meeting, transcript, entities, suggestions } = data;
  const displayTranscript = translationLanguage === "pt-BR" ? transcript?.transcript : translatedText;
  return <main className="min-h-screen p-4 md:p-8 text-white bg-transparent"><div className="max-w-5xl mx-auto">
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white mb-6"><ArrowLeft size={16}/> Todas as reuniões</button>
    <div className="flex flex-col md:flex-row justify-between gap-4 mb-6"><div><p className="text-amber-300 text-xs font-semibold">REUNIÃO PRIVADA</p><h1 className="text-3xl font-bold mt-1">{meeting.title}</h1><p className="text-sm text-white/45 mt-2">{new Date(meeting.createdAt).toLocaleString(i18n.language)}</p></div><div className="flex items-start gap-2"><span className={`h-fit border rounded-full px-3 py-1 text-xs font-semibold ${statusClass(meeting.status)}`}>{statusLabel(meeting.status)}</span><button onClick={() => deleteMeeting.mutate({ meetingId })} disabled={deleteMeeting.isPending} className="rounded-full border border-red-400/25 px-3 py-1 text-xs text-red-200 hover:bg-red-400/10 disabled:opacity-50">Excluir</button></div></div>
    {meeting.status === "failed" && <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-200">{meeting.processingError || "O processamento não foi concluído. Tente novamente com uma gravação curta."}</div>}
    <div className="flex gap-2 border-b border-white/10 mb-6">{([ ["summary", "Resumo", FileText], ["transcript", "Transcrição", Clock3], ["contacts", `Contatos (${suggestions.length})`, Users] ] as const).map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 px-4 py-3 text-sm border-b-2 ${tab === id ? "border-amber-300 text-amber-300" : "border-transparent text-white/50"}`}><Icon size={16}/>{label}</button>)}</div>
    {tab === "summary" && <div className="grid md:grid-cols-2 gap-4"><section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="font-semibold">Entidades detectadas</h2><div className="flex flex-wrap gap-2 mt-4">{entities.length ? entities.map(entity => <span key={entity.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/75">{entity.value}</span>) : <p className="text-sm text-white/45">Nenhuma entidade pendente.</p>}</div></section><section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><h2 className="font-semibold">Proteção do áudio</h2><p className="text-sm text-white/50 mt-3">O áudio fica restrito à sua conta e expira automaticamente após 30 dias. A transcrição permanece privada na sua rede.</p></section></div>}
    {tab === "transcript" && <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <h2 className="font-semibold mb-4">Transcrição</h2>
      {transcript ? <>
        <div className="mb-5 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4">
          <p className="font-semibold text-amber-100">Traduzir o que foi dito nesta reunião</p>
          <p className="mt-1 text-sm text-amber-100/70">Escolha o idioma da pessoa estrangeira para gerar uma versão traduzida da transcrição.</p>
          <label className="mt-3 flex flex-col gap-2 text-sm text-white/75 sm:flex-row sm:items-center">Idioma de destino
            <select value={translationLanguage} onChange={event => setTranslationLanguage(event.target.value)} className="rounded-lg bg-[#0b1725] border border-white/15 px-3 py-2 text-white">
              {LANGUAGES.map(language => <option className="bg-white text-[#2D3E50]" key={language.code} value={language.code}>{language.flag} {language.label}</option>)}
            </select>
          </label>
        </div>
        {translateTranscript.isPending ? <div className="text-white/55"><Loader2 className="inline animate-spin mr-2" size={16}/>Traduzindo transcrição…</div> : <p className="whitespace-pre-wrap leading-7 text-white/75">{displayTranscript || transcript.transcript}</p>}
      </> : <p className="text-white/45">A transcrição ainda não está disponível.</p>}
    </section>}
    {tab === "contacts" && <div className="space-y-3">{suggestions.length ? suggestions.map(suggestion => <section key={suggestion.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="flex flex-col md:flex-row gap-4 justify-between"><div><h2 className="font-semibold">{suggestion.fullName}</h2><p className="text-sm text-white/55">{[suggestion.jobTitle, suggestion.company].filter(Boolean).join(" · ") || "Dados parciais detectados"}</p>{suggestion.email && <p className="text-xs text-white/40 mt-1">{suggestion.email}</p>}</div>{suggestion.status === "pending" ? <div className="flex flex-wrap gap-2"><button onClick={() => decideContact.mutate({ suggestionId: suggestion.id, action: "create" })} className="rounded-lg bg-amber-400 text-[#08121f] px-3 py-2 text-sm font-bold"><Check size={15} className="inline mr-1"/>Criar contato</button><button onClick={() => decideContact.mutate({ suggestionId: suggestion.id, action: "ignore" })} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/65"><X size={15} className="inline mr-1"/>Ignorar</button></div> : <span className="text-sm text-white/45">{suggestion.status === "created" ? "Contato criado" : "Ignorada"}</span>}</div></section>) : <div className="rounded-2xl border border-dashed border-white/15 py-14 text-center text-white/45">Nenhum contato sugerido nesta reunião.</div>}</div>}
  </div></main>;
}
