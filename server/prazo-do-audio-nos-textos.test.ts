import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * O áudio de reunião passou a ser apagado 24 horas depois da transcrição (ou
 * da falha dela), por decisão da Dra. Glenda; antes a tela prometia 30 dias.
 *
 * O `conferir-locales.mjs` só compara o CONJUNTO de chaves: um idioma que
 * continuasse dizendo "30 dias" passaria na CI em silêncio — e a frase da
 * caixinha de consentimento é justamente o que a dona confirma antes de gravar.
 * Por isso este teste lê o TEXTO, nos 10 idiomas.
 *
 * Só o algarismo não bastava: "24 days" ou "24天" na caixinha passavam. E a
 * regra tem dois começos, a transcrição ou a falha; um merge de locales (como
 * nas #100 e #109) que perdesse "(ou da falha dela)" num idioma deixaria a dona
 * com metade da regra, e o teste de tela só renderiza pt-BR.
 */

const LOCALES_DIR = join(process.cwd(), "client", "src", "i18n", "locales");
const arquivos = readdirSync(LOCALES_DIR).filter(nome => nome.endsWith(".json")).sort();
const meetingsDe = (arquivo: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(LOCALES_DIR, arquivo), "utf8")).meetings;

const FRASES_DO_PRAZO = [
  "consentCheckboxLabel",
  "consentNotice",
  "privacyNotice",
  "recordingExpiredNotice",
  "recordingExpiredNoTranscript",
  "reprocessHint",
  "audioDeadlinePending",
];

// As que a dona lê antes de gravar (caixinha e aviso da lista), o aviso que
// acompanha toda gravação e a frase da reunião que falhou sem transcrição: todas
// valem também para a reunião com falha, então todas dizem que o prazo conta dela.
// A linha do prazo em 'processing' (audioDeadlinePending) entra pelo mesmo
// motivo: um reprocesso também passa por 'processing', e se ele falhar de novo
// o áudio sai 24 horas depois da falha ANTERIOR, não de uma transcrição.
const FRASES_COM_A_FALHA = [
  "consentCheckboxLabel",
  "consentNotice",
  "privacyNotice",
  "recordingExpiredNoTranscript",
  "audioDeadlinePending",
];

// Por idioma: a unidade de HORA colada ao 24, e os radicais de "falha" e de
// "transcrição" do jeito que cada tradução os escreve (conferidos nos textos).
const IDIOMAS: Record<string, { horas: RegExp; falha: RegExp; transcricao: RegExp }> = {
  "ar.json": { horas: /24\s*ساعة/, falha: /فشل/, transcricao: /التفريغ/ },
  "de.json": { horas: /24\s*Stunden/, falha: /Fehlschlag/, transcricao: /Transkription/ },
  "en.json": { horas: /24\s*hours/, falha: /fail/, transcricao: /transcription/ },
  "es.json": { horas: /24\s*horas/, falha: /fallo/, transcricao: /transcripción/ },
  "fr.json": { horas: /24\s*heures/, falha: /échec/, transcricao: /transcription/ },
  "hi.json": { horas: /24\s*घंटे/, falha: /विफल/, transcricao: /ट्रांसक्रिप्शन/ },
  "ja.json": { horas: /24\s*時間/, falha: /失敗/, transcricao: /文字起こし/ },
  "pt-BR.json": { horas: /24\s*horas/, falha: /falha/, transcricao: /transcrição/ },
  "ru.json": { horas: /24\s*час/, falha: /сбо/, transcricao: /транскрипц/ },
  "zh.json": { horas: /24\s*小时/, falha: /失败/, transcricao: /转录/ },
};

describe("prazo do áudio de reunião nos textos da tela", () => {
  it("confere os 10 idiomas, e cada um tem a sua unidade e os seus radicais", () => {
    expect(arquivos).toHaveLength(10);
    expect(Object.keys(IDIOMAS).sort()).toEqual(arquivos);
  });

  it.each(arquivos)("%s: as frases do prazo dizem 24 horas, na unidade do idioma, e nenhuma diz 30", arquivo => {
    const meetings = meetingsDe(arquivo);
    for (const chave of FRASES_DO_PRAZO) {
      const texto = meetings[chave];
      expect(texto, `${arquivo}: meetings.${chave}`).toBeTypeOf("string");
      expect(texto, `${arquivo}: meetings.${chave}`).toMatch(IDIOMAS[arquivo].horas);
      expect(texto, `${arquivo}: meetings.${chave}`).not.toMatch(/\b30\b/);
    }
  });

  it.each(arquivos)("%s: a caixinha, os avisos, a frase da reunião sem transcrição e a linha do prazo em processamento dizem que o prazo também conta da falha", arquivo => {
    const meetings = meetingsDe(arquivo);
    for (const chave of FRASES_COM_A_FALHA) {
      expect(meetings[chave], `${arquivo}: meetings.${chave}`).toMatch(IDIOMAS[arquivo].falha);
    }
  });

  // A caixinha é o consentimento registrado: se passasse a contar "depois da
  // gravação", a dona confirmaria um prazo que não é o que o servidor cumpre.
  it.each(arquivos)("%s: a caixinha conta o prazo da transcrição", arquivo => {
    const meetings = meetingsDe(arquivo);
    expect(meetings.consentCheckboxLabel, `${arquivo}: meetings.consentCheckboxLabel`).toMatch(IDIOMAS[arquivo].transcricao);
  });

  // Com 24 horas, a hora do fim do prazo importa: uma tradução que perdesse o
  // {{date}} deixaria a dona sem saber até quando dá para ouvir ou reprocessar.
  it.each(arquivos)("%s: 'disponível até' e a dica de reprocessar mantêm o {{date}}", arquivo => {
    const meetings = meetingsDe(arquivo);
    expect(meetings.availableUntilAt, `${arquivo}: meetings.availableUntilAt`).toContain("{{date}}");
    expect(meetings.reprocessHint, `${arquivo}: meetings.reprocessHint`).toContain("{{date}}");
  });

  // O availableUntilAt não diz "24 horas" (só traz a data), por isso fica fora
  // de FRASES_DO_PRAZO; entra no snapshot porque é a frase com o fim do prazo.
  const FRASES_NO_SNAPSHOT = [...FRASES_DO_PRAZO, "availableUntilAt"].sort();

  // Os testes acima procuram palavras, e uma tradução pode mudar o SENTIDO sem
  // perder nenhuma delas: a caixinha prometendo apagar também a transcrição, o
  // prazo contando "depois da gravação" com "falha" ainda na frase, o aviso
  // dizendo que a transcrição sumiu. Por isso o texto inteiro dessas frases, nos
  // 10 idiomas, fica versionado em __snapshots__/prazo-do-audio-nos-textos.test.ts.snap,
  // e qualquer mudança nelas aparece no diff da PR.
  //
  // Mudar uma dessas frases exige revisar o .snap no diff, idioma por idioma,
  // antes do commit: é ali que se confere que a caixinha de consentimento
  // continua dizendo o que o servidor cumpre. Nunca rode -u às cegas para deixar
  // a suíte verde, porque aceitar o snapshot sem ler é aprovar uma promessa de
  // privacidade sem revisão. Na CI o vitest não grava snapshot, então o .snap
  // vai no mesmo commit que a frase.
  it("o texto inteiro das frases do prazo, nos 10 idiomas, bate com o snapshot versionado", () => {
    const frases: Record<string, Record<string, unknown>> = {};
    for (const arquivo of arquivos) {
      const meetings = meetingsDe(arquivo);
      const doIdioma: Record<string, unknown> = {};
      for (const chave of FRASES_NO_SNAPSHOT) {
        expect(meetings[chave], `${arquivo}: meetings.${chave}`).toBeTypeOf("string");
        doIdioma[chave] = meetings[chave];
      }
      frases[arquivo.replace(/\.json$/, "")] = doIdioma;
    }
    expect(frases).toMatchSnapshot();
  });
});
