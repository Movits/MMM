#!/usr/bin/env python3
import json
import os

# Chaves de errors para cada idioma
errors_translations = {
    "pt-BR": {
        "notFoundTitle": "Página não encontrada",
        "notFoundDesc": "Parece que você saiu do mapa. A página que você está procurando não existe ou foi movida.",
        "backHome": "Voltar para o início",
        "goToDashboard": "Ir para o Dashboard",
        "staleLink": "Se você chegou aqui por um link, pode ser que ele esteja desatualizado.",
        "notFound": "Página não encontrada",
        "notFoundDescShort": "A página que você está procurando não existe.",
        "goHome": "Voltar ao início"
    },
    "en": {
        "notFoundTitle": "Page not found",
        "notFoundDesc": "Looks like you've gone off the map. The page you're looking for doesn't exist or has been moved.",
        "backHome": "Back to home",
        "goToDashboard": "Go to Dashboard",
        "staleLink": "If you arrived here via a link, it may be outdated.",
        "notFound": "Page not found",
        "notFoundDescShort": "The page you're looking for doesn't exist.",
        "goHome": "Back to home"
    },
    "es": {
        "notFoundTitle": "Página no encontrada",
        "notFoundDesc": "Parece que te has salido del mapa. La página que buscas no existe o fue movida.",
        "backHome": "Volver al inicio",
        "goToDashboard": "Ir al Panel",
        "staleLink": "Si llegaste aquí a través de un enlace, puede estar desactualizado.",
        "notFound": "Página no encontrada",
        "notFoundDescShort": "La página que buscas no existe.",
        "goHome": "Volver al inicio"
    },
    "fr": {
        "notFoundTitle": "Page introuvable",
        "notFoundDesc": "On dirait que vous avez quitté la carte. La page que vous cherchez n'existe pas ou a été déplacée.",
        "backHome": "Retour à l'accueil",
        "goToDashboard": "Aller au tableau de bord",
        "staleLink": "Si vous êtes arrivée ici via un lien, il est peut-être obsolète.",
        "notFound": "Page introuvable",
        "notFoundDescShort": "La page que vous cherchez n'existe pas.",
        "goHome": "Retour à l'accueil"
    },
    "ar": {
        "notFoundTitle": "الصفحة غير موجودة",
        "notFoundDesc": "يبدو أنك خرجت عن المسار. الصفحة التي تبحثين عنها غير موجودة أو تم نقلها.",
        "backHome": "العودة إلى الرئيسية",
        "goToDashboard": "الذهاب إلى لوحة التحكم",
        "staleLink": "إذا وصلت إلى هنا عبر رابط، فقد يكون قديماً.",
        "notFound": "الصفحة غير موجودة",
        "notFoundDescShort": "الصفحة التي تبحثين عنها غير موجودة.",
        "goHome": "العودة إلى الرئيسية"
    },
    "zh": {
        "notFoundTitle": "页面未找到",
        "notFoundDesc": "看起来您已经偏离了地图。您正在寻找的页面不存在或已被移动。",
        "backHome": "返回首页",
        "goToDashboard": "前往控制台",
        "staleLink": "如果您通过链接到达这里，该链接可能已过时。",
        "notFound": "页面未找到",
        "notFoundDescShort": "您正在寻找的页面不存在。",
        "goHome": "返回首页"
    },
    "hi": {
        "notFoundTitle": "पृष्ठ नहीं मिला",
        "notFoundDesc": "लगता है आप नक्शे से बाहर चली गई हैं। आप जो पृष्ठ ढूंढ रही हैं वह मौजूद नहीं है या स्थानांतरित कर दिया गया है।",
        "backHome": "होम पर वापस जाएं",
        "goToDashboard": "डैशबोर्ड पर जाएं",
        "staleLink": "यदि आप किसी लिंक के माध्यम से यहां पहुंची हैं, तो वह पुराना हो सकता है।",
        "notFound": "पृष्ठ नहीं मिला",
        "notFoundDescShort": "आप जो पृष्ठ ढूंढ रही हैं वह मौजूद नहीं है।",
        "goHome": "होम पर वापस जाएं"
    },
    "de": {
        "notFoundTitle": "Seite nicht gefunden",
        "notFoundDesc": "Es sieht aus, als hätten Sie die Karte verlassen. Die gesuchte Seite existiert nicht oder wurde verschoben.",
        "backHome": "Zurück zur Startseite",
        "goToDashboard": "Zum Dashboard",
        "staleLink": "Wenn Sie über einen Link hierher gelangt sind, könnte er veraltet sein.",
        "notFound": "Seite nicht gefunden",
        "notFoundDescShort": "Die gesuchte Seite existiert nicht.",
        "goHome": "Zurück zur Startseite"
    },
    "ja": {
        "notFoundTitle": "ページが見つかりません",
        "notFoundDesc": "マップから外れてしまったようです。お探しのページは存在しないか、移動されました。",
        "backHome": "ホームに戻る",
        "goToDashboard": "ダッシュボードへ",
        "staleLink": "リンクからここに来た場合、そのリンクが古くなっている可能性があります。",
        "notFound": "ページが見つかりません",
        "notFoundDescShort": "お探しのページは存在しません。",
        "goHome": "ホームに戻る"
    },
    "ru": {
        "notFoundTitle": "Страница не найдена",
        "notFoundDesc": "Похоже, вы сошли с карты. Страница, которую вы ищете, не существует или была перемещена.",
        "backHome": "Вернуться на главную",
        "goToDashboard": "Перейти в панель управления",
        "staleLink": "Если вы попали сюда по ссылке, она может быть устаревшей.",
        "notFound": "Страница не найдена",
        "notFoundDescShort": "Страница, которую вы ищете, не существует.",
        "goHome": "Вернуться на главную"
    }
}

locales_dir = "client/src/i18n/locales"

for lang, new_errors in errors_translations.items():
    filepath = os.path.join(locales_dir, f"{lang}.json")
    if not os.path.exists(filepath):
        print(f"SKIP: {filepath} not found")
        continue
    
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Merge errors
    existing_errors = data.get("errors", {})
    existing_errors.update(new_errors)
    data["errors"] = existing_errors
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"Updated: {filepath}")

print("Done!")
