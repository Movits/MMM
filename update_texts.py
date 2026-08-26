#!/usr/bin/env python3
"""
Atualiza dois textos da landing page nos 10 idiomas:
1. hero.badge / auth.platformTagline: "Plataforma Exclusiva para Mulheres Líderes" → "Ecossistema Mundial de Oportunidades"
2. hero.subtitle: texto longo sobre IA → novo texto mais elaborado
"""

import json
import os

LOCALES_DIR = "client/src/i18n/locales"

# Novos textos por idioma
# Chave: código do idioma
# Valor: (novo_badge, novo_tagline, novo_subtitle)

translations = {
    "pt-BR": (
        "Ecossistema Mundial de Oportunidades",
        "Ecossistema mundial de oportunidades",
        "Diga-nos quem você é, o que busca e o que tem a oferecer. Nossa inteligência artificial analisa o seu perfil de forma profunda para conectar você a líderes e oportunidades de alta compatibilidade real — indo muito além de simples palavras-chave."
    ),
    "en": (
        "Global Ecosystem of Opportunities",
        "Global ecosystem of opportunities",
        "Tell us who you are, what you seek and what you have to offer. Our artificial intelligence deeply analyzes your profile to connect you with leaders and opportunities of high real compatibility — going far beyond simple keywords."
    ),
    "es": (
        "Ecosistema Mundial de Oportunidades",
        "Ecosistema mundial de oportunidades",
        "Díganos quién es usted, qué busca y qué tiene para ofrecer. Nuestra inteligencia artificial analiza su perfil en profundidad para conectarla con líderes y oportunidades de alta compatibilidad real — yendo mucho más allá de simples palabras clave."
    ),
    "fr": (
        "Écosystème Mondial d'Opportunités",
        "Écosystème mondial d'opportunités",
        "Dites-nous qui vous êtes, ce que vous recherchez et ce que vous avez à offrir. Notre intelligence artificielle analyse votre profil en profondeur pour vous connecter avec des leaders et des opportunités à haute compatibilité réelle — bien au-delà des simples mots-clés."
    ),
    "ar": (
        "النظام البيئي العالمي للفرص",
        "النظام البيئي العالمي للفرص",
        "أخبرينا من أنتِ، وما الذي تبحثين عنه، وما الذي تقدمينه. يحلل ذكاؤنا الاصطناعي ملفك الشخصي بعمق ليربطك بالقيادات والفرص ذات التوافق الحقيقي العالي — متجاوزًا الكلمات المفتاحية البسيطة بكثير."
    ),
    "zh": (
        "全球机遇生态系统",
        "全球机遇生态系统",
        "告诉我们您是谁、您在寻找什么以及您能提供什么。我们的人工智能深度分析您的档案，将您与高度真实兼容性的领导者和机遇相连接——远远超越简单的关键词匹配。"
    ),
    "hi": (
        "अवसरों का वैश्विक पारिस्थितिकी तंत्र",
        "अवसरों का वैश्विक पारिस्थितिकी तंत्र",
        "हमें बताएं कि आप कौन हैं, आप क्या चाहती हैं और आपके पास क्या देने को है। हमारी कृत्रिम बुद्धिमत्ता आपकी प्रोफ़ाइल का गहराई से विश्लेषण करती है और आपको उच्च वास्तविक संगतता वाले नेताओं और अवसरों से जोड़ती है — केवल कीवर्ड से कहीं आगे जाकर।"
    ),
    "de": (
        "Globales Ökosystem der Möglichkeiten",
        "Globales Ökosystem der Möglichkeiten",
        "Sagen Sie uns, wer Sie sind, was Sie suchen und was Sie anzubieten haben. Unsere künstliche Intelligenz analysiert Ihr Profil tiefgehend, um Sie mit Führungspersönlichkeiten und Möglichkeiten mit hoher echter Kompatibilität zu verbinden — weit über einfache Schlüsselwörter hinaus."
    ),
    "ja": (
        "グローバルな機会のエコシステム",
        "グローバルな機会のエコシステム",
        "あなたが誰であるか、何を求めているか、何を提供できるかをお聞かせください。私たちの人工知能があなたのプロフィールを深く分析し、単純なキーワードをはるかに超えた高い実際の適合性を持つリーダーや機会とあなたをつなぎます。"
    ),
    "ru": (
        "Глобальная экосистема возможностей",
        "Глобальная экосистема возможностей",
        "Расскажите нам, кто вы, что ищете и что можете предложить. Наш искусственный интеллект глубоко анализирует ваш профиль, чтобы связать вас с лидерами и возможностями высокой реальной совместимости — выходя далеко за рамки простых ключевых слов."
    ),
}

def set_nested(obj, keys, value):
    """Set a nested key in a dict."""
    for key in keys[:-1]:
        if key not in obj:
            obj[key] = {}
        obj = obj[key]
    obj[keys[-1]] = value

def get_nested(obj, keys):
    """Get a nested key from a dict, return None if not found."""
    for key in keys:
        if not isinstance(obj, dict) or key not in obj:
            return None
        obj = obj[key]
    return obj

updated_files = []

for lang, (new_badge, new_tagline, new_subtitle) in translations.items():
    filepath = os.path.join(LOCALES_DIR, f"{lang}.json")
    if not os.path.exists(filepath):
        print(f"SKIP: {filepath} not found")
        continue

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False

    # 1. hero.badge
    old_badge = get_nested(data, ["hero", "badge"])
    if old_badge is not None:
        set_nested(data, ["hero", "badge"], new_badge)
        print(f"[{lang}] hero.badge: '{old_badge}' → '{new_badge}'")
        changed = True

    # 2. auth.platformTagline
    old_tagline = get_nested(data, ["auth", "platformTagline"])
    if old_tagline is not None:
        set_nested(data, ["auth", "platformTagline"], new_tagline)
        print(f"[{lang}] auth.platformTagline: '{old_tagline}' → '{new_tagline}'")
        changed = True

    # 3. hero.subtitle
    old_subtitle = get_nested(data, ["hero", "subtitle"])
    if old_subtitle is not None:
        set_nested(data, ["hero", "subtitle"], new_subtitle)
        print(f"[{lang}] hero.subtitle updated")
        changed = True

    if changed:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        updated_files.append(lang)
        print()

print(f"\nDone! Updated {len(updated_files)} files: {updated_files}")
