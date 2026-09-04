import { describe, expect, it } from "vitest";
import i18next from "i18next";
import ptBR from "./locales/pt-BR.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

/**
 * Aviso de sessão expirando (InactivityGuard) em russo e árabe — auditoria de
 * 04/09. O aviso sai com count=5 (aos 25 min, logout aos 30). Russo põe 5 na
 * forma "many" e árabe na forma "few"; os arquivos só tinham _one/_other, e o
 * i18next NÃO cai de _many/_few para _other — cai para o idioma de fallback.
 * Toda usuária em ru/ar recebia o aviso de segurança em português.
 *
 * Instância própria, com os JSONs reais e o MESMO fallbackLng do app: o que
 * se prova é a resolução de plural, não o componente.
 */

async function instancia() {
  const i18n = i18next.createInstance();
  await i18n.init({
    resources: {
      "pt-BR": { translation: ptBR },
      ru: { translation: ru },
      ar: { translation: ar },
      en: { translation: en },
    },
    fallbackLng: "pt-BR",
    interpolation: { escapeValue: false },
  });
  return i18n;
}

describe("aviso de sessão — plural em russo e árabe não cai no português", () => {
  it("russo: 5 minutos (forma many) sai em russo, e 1/2/21 nas formas certas", async () => {
    const i18n = await instancia();
    const t = i18n.getFixedT("ru");
    expect(t("inactivityGuard.warningTitle", { count: 5 })).toBe("⏰ Сессия истекает через 5 минут");
    expect(t("inactivityGuard.warningTitle", { count: 2 })).toBe("⏰ Сессия истекает через 2 минуты");
    expect(t("inactivityGuard.warningTitle", { count: 1 })).toBe("⏰ Сессия истекает через 1 минуту");
    expect(t("inactivityGuard.warningTitle", { count: 21 })).toBe("⏰ Сессия истекает через 21 минуту");
    expect(t("inactivityGuard.warningTitle", { count: 5 })).not.toContain("Sessão");
  });

  it("árabe: 5 minutos (forma few) sai em árabe, e 2 usa o dual", async () => {
    const i18n = await instancia();
    const t = i18n.getFixedT("ar");
    expect(t("inactivityGuard.warningTitle", { count: 5 })).toBe("⏰ ستنتهي الجلسة خلال 5 دقائق");
    expect(t("inactivityGuard.warningTitle", { count: 2 })).toBe("⏰ ستنتهي الجلسة خلال دقيقتين");
    expect(t("inactivityGuard.warningTitle", { count: 1 })).toBe("⏰ ستنتهي الجلسة خلال 1 دقيقة");
    expect(t("inactivityGuard.warningTitle", { count: 5 })).not.toContain("Sessão");
  });

  it("português e inglês continuam iguais (as formas extras nunca são escolhidas)", async () => {
    const i18n = await instancia();
    expect(i18n.getFixedT("pt-BR")("inactivityGuard.warningTitle", { count: 5 })).toBe("⏰ Sessão expirando em 5 minutos");
    expect(i18n.getFixedT("pt-BR")("inactivityGuard.warningTitle", { count: 1 })).toBe("⏰ Sessão expirando em 1 minuto");
    expect(i18n.getFixedT("en")("inactivityGuard.warningTitle", { count: 5 })).toBe("⏰ Session expiring in 5 minutes");
  });
});
