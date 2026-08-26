import i18n from "i18next";
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

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
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
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    load: "currentOnly",
  });

// Update document direction for RTL languages
i18n.on("languageChanged", (lng) => {
  const lang = LANGUAGES.find((l) => l.code === lng);
  document.documentElement.dir = lang?.dir ?? "ltr";
  document.documentElement.lang = lng;
});

export default i18n;
