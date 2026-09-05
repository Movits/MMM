import i18n, { type InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ptBR from "./locales/pt-BR.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ar from "./locales/ar.json";
import zh from "./locales/zh.json";
import hi from "./locales/hi.json";
import de from "./locales/de.json";
import ja from "./locales/ja.json";
import ru from "./locales/ru.json";

export const LANGUAGES = [
  { code: "pt-BR", label: "Português", flag: "🇧🇷", dir: "ltr" },
  { code: "en",    label: "English",   flag: "🇺🇸", dir: "ltr" },
  { code: "es",    label: "Español",   flag: "🇪🇸", dir: "ltr" },
  { code: "fr",    label: "Français",  flag: "🇫🇷", dir: "ltr" },
  { code: "ar",    label: "العربية",   flag: "🇸🇦", dir: "rtl" },
  { code: "zh",    label: "中文",       flag: "🇨🇳", dir: "ltr" },
  { code: "hi",    label: "हिन्दी",    flag: "🇮🇳", dir: "ltr" },
  { code: "de",    label: "Deutsch",   flag: "🇩🇪", dir: "ltr" },
  { code: "ja",    label: "日本語",     flag: "🇯🇵", dir: "ltr" },
  { code: "ru",    label: "Русский",   flag: "🇷🇺", dir: "ltr" },
];

// Os códigos que têm JSON. É esta lista que casa o que o navegador informa
// com o que existe de fato.
export const CODIGOS = LANGUAGES.map(l => l.code);

/**
 * O navegador quase sempre informa código regional ("en-US", "es-MX",
 * "zh-CN"), e os recursos existem só no código base ("en", "es", "zh"). Com
 * `load: "currentOnly"`, o i18next não desce de "en-US" para "en" sozinho: a
 * cadeia ficava ["en-US", "pt-BR"], toda usuária estrangeira recebia
 * português, e o "en-US" ainda ia parar no localStorage, repetindo o erro a
 * cada visita. O detector passa por aqui antes de entregar o código ao
 * i18next: exato fica (pt-BR); regional cuja base existe vira a base; o resto
 * segue como veio, para o casamento por prefixo do próprio i18next
 * (pt-PT → pt-BR) ou o fallback decidirem.
 */
export function converterIdiomaDetectado(lng: string): string {
  if (CODIGOS.includes(lng)) return lng;
  const base = lng.split("-")[0];
  return CODIGOS.includes(base) ? base : lng;
}

/**
 * As opções da instância, numa função para o teste de detecção
 * (deteccao-de-idioma.test.ts) montar uma instância própria com EXATAMENTE a
 * configuração do app: o que se prova é a resolução de idioma, não a tela.
 */
export function opcoesBase(): InitOptions {
  return {
    resources: {
      "pt-BR": { translation: ptBR },
      en:      { translation: en },
      es:      { translation: es },
      fr:      { translation: fr },
      ar:      { translation: ar },
      zh:      { translation: zh },
      hi:      { translation: hi },
      de:      { translation: de },
      ja:      { translation: ja },
      ru:      { translation: ru },
    },
    fallbackLng: "pt-BR",
    // Sem supportedLngs, "en-US" é aceito como idioma e, com currentOnly,
    // "en" nunca entra na cadeia. Com a lista, getBestMatchFromCodes cai para
    // a parte de idioma ("en-US" → "en") ou para o código de mesmo prefixo
    // ("pt-PT" → "pt-BR") — também em changeLanguage, fora do detector.
    // NÃO ligar nonExplicitSupportedLngs: com currentOnly ele aceita "en-US"
    // na cadeia sem acrescentar "en" e ainda rejeita o próprio fallback
    // "pt-BR" (a base "pt" não está na lista) — provado com os 10 JSONs.
    supportedLngs: [...CODIGOS, "cimode"],
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      convertDetectedLanguage: converterIdiomaDetectado,
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    load: "currentOnly",
  };
}

/**
 * Direção e idioma do documento (o árabe é RTL; `lang` orienta leitor de tela,
 * hifenização e fonte). Recebe o idioma RESOLVIDO, não o pedido: o pedido pode
 * ser um código regional, e o que está na tela é o que tem recursos.
 */
export function aplicarDirecao(lng: string) {
  const lang = LANGUAGES.find((l) => l.code === lng);
  document.documentElement.dir = lang?.dir ?? "ltr";
  document.documentElement.lang = lng;
}

// O handler entra ANTES do init de propósito. Com os recursos embutidos, o
// i18next resolve o idioma e emite `languageChanged` DENTRO do init, de forma
// síncrona; registrado depois, o handler perdia esse primeiro evento e um
// navegador em ar-SA carregava o árabe em LTR com <html lang="pt-BR">, só
// acertando na troca manual de idioma.
i18n.on("languageChanged", () => {
  aplicarDirecao(i18n.resolvedLanguage ?? i18n.language);
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init(opcoesBase());

export default i18n;
