export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Código (não frase) que a varredura de reuniões presas grava em
 * `meetings.processing_error`. Mora em shared/ porque os dois lados o leem:
 * o servidor escreve sem saber o idioma da dona, e a tela de Reuniões traduz
 * (`meetings.processingInterrupted`) — um texto fixo em português apareceria
 * cru nas outras nove línguas. As demais mensagens de processing_error são
 * frases já pensadas para a tela e passam inteiras.
 */
export const CODIGO_ERRO_INTERROMPIDO = "ERRO_INTERROMPIDO";

/**
 * Quanto tempo uma reunião pode ficar em "processing" antes de a varredura
 * dá-la como interrompida. Mora em shared/ porque os dois lados o usam: o
 * servidor na varredura e para recusar reprocessar um áudio prestes a vencer
 * (a retenção o apagaria no meio), e a tela para nem oferecer o botão nesse caso.
 */
export const LIMITE_PROCESSAMENTO_MS = 15 * 60 * 1000;

/**
 * Frase (e não código) que o reprocessamento grava em `processing_error`
 * quando o áudio não está mais no bucket. Frase, porque o app Expo mostra
 * processing_error como veio; compartilhada, porque a tela do site a reconhece
 * para traduzi-la e para não oferecer de novo um reprocessamento sem áudio.
 */
export const MENSAGEM_AUDIO_GUARDADO_AUSENTE = "O áudio guardado desta reunião não foi encontrado.";
