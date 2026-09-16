/**
 * A duração de um arquivo de áudio como o NAVEGADOR a lê, antes do envio.
 *
 * Não assume valor nenhum: sem leitura, devolve null e a tela recusa. Antes
 * caía em 60 s, e um .webm de 25 minutos passava pela conferência do limite
 * de 10 minutos e seguia para o servidor com "60" (revisão adversarial de
 * 15/09).
 *
 * O .webm gravado por MediaRecorder não traz a duração no cabeçalho, e o Chrome
 * responde `Infinity`: pedir a posição do fim obriga o navegador a percorrer o
 * arquivo, e o `durationchange` que vem em seguida traz a duração real.
 *
 * É só a conferência antes do envio. Para o limite e para o contador de minutos
 * vale a duração que o servidor mede nos bytes.
 */

/** Sem resposta do navegador neste prazo, a leitura desiste (null). */
export const PRAZO_DA_LEITURA_DA_DURACAO_MS = 15_000;

export function lerDuracaoNoNavegador(
  arquivo: Blob,
  criarAudio: () => HTMLAudioElement = () => document.createElement("audio"),
): Promise<number | null> {
  return new Promise(resolve => {
    const audio = criarAudio();
    const url = URL.createObjectURL(arquivo);
    let terminou = false;
    const legivel = () => Number.isFinite(audio.duration) && audio.duration > 0;
    const terminar = (segundos: number | null) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      resolve(segundos === null ? null : Math.ceil(segundos));
    };
    const prazo = setTimeout(() => terminar(null), PRAZO_DA_LEITURA_DA_DURACAO_MS);
    audio.preload = "metadata";
    audio.onerror = () => terminar(null);
    audio.onloadedmetadata = () => {
      if (legivel()) return terminar(audio.duration);
      audio.ondurationchange = () => { if (legivel()) terminar(audio.duration); };
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    };
    audio.src = url;
  });
}
