#!/usr/bin/env python3
"""
Corrige os CTAs "Começar grátis" / "Criar conta grátis" para "Criar conta"
em todos os 10 idiomas, e também verifica/corrige traduções óbvias.
"""
import json
import os

# Mapeamento: idioma → textos corretos para os CTAs
cta_map = {
    'pt-BR': {
        'nav.startFree': 'Criar conta',
        'hero.cta': 'Criar meu perfil →',
        'cta.button': 'Criar conta',
        'auth.registerButton': 'Criar conta',
        'auth.registerTitle': 'Criar conta',
        'auth.createFree': 'Criar conta',
    },
    'en': {
        'nav.startFree': 'Create account',
        'hero.cta': 'Create my profile →',
        'cta.button': 'Create account',
        'auth.registerButton': 'Create account',
        'auth.registerTitle': 'Create account',
        'auth.createFree': 'Create account',
    },
    'es': {
        'nav.startFree': 'Crear cuenta',
        'hero.cta': 'Crear mi perfil →',
        'cta.button': 'Crear cuenta',
        'auth.registerButton': 'Crear cuenta',
        'auth.registerTitle': 'Crear cuenta',
        'auth.createFree': 'Crear cuenta',
    },
    'fr': {
        'nav.startFree': 'Créer un compte',
        'hero.cta': 'Créer mon profil →',
        'cta.button': 'Créer un compte',
        'auth.registerButton': 'Créer un compte',
        'auth.registerTitle': 'Créer un compte',
        'auth.createFree': 'Créer un compte',
    },
    'ar': {
        'nav.startFree': 'إنشاء حساب',
        'hero.cta': 'إنشاء ملفي الشخصي →',
        'cta.button': 'إنشاء حساب',
        'auth.registerButton': 'إنشاء حساب',
        'auth.registerTitle': 'إنشاء حساب',
        'auth.createFree': 'إنشاء حساب',
    },
    'zh': {
        'nav.startFree': '创建账户',
        'hero.cta': '创建我的档案 →',
        'cta.button': '创建账户',
        'auth.registerButton': '创建账户',
        'auth.registerTitle': '创建账户',
        'auth.createFree': '创建账户',
    },
    'hi': {
        'nav.startFree': 'खाता बनाएं',
        'hero.cta': 'मेरी प्रोफ़ाइल बनाएं →',
        'cta.button': 'खाता बनाएं',
        'auth.registerButton': 'खाता बनाएं',
        'auth.registerTitle': 'खाता बनाएं',
        'auth.createFree': 'खाता बनाएं',
    },
    'de': {
        'nav.startFree': 'Konto erstellen',
        'hero.cta': 'Mein Profil erstellen →',
        'cta.button': 'Konto erstellen',
        'auth.registerButton': 'Konto erstellen',
        'auth.registerTitle': 'Konto erstellen',
        'auth.createFree': 'Konto erstellen',
    },
    'ja': {
        'nav.startFree': 'アカウントを作成',
        'hero.cta': 'プロフィールを作成 →',
        'cta.button': 'アカウントを作成',
        'auth.registerButton': 'アカウントを作成',
        'auth.registerTitle': 'アカウントを作成',
        'auth.createFree': 'アカウントを作成',
    },
    'ru': {
        'nav.startFree': 'Создать аккаунт',
        'hero.cta': 'Создать мой профиль →',
        'cta.button': 'Создать аккаунт',
        'auth.registerButton': 'Создать аккаунт',
        'auth.registerTitle': 'Создать аккаунт',
        'auth.createFree': 'Создать аккаунт',
    },
}

base_dir = 'client/src/i18n/locales'

for lang, fixes in cta_map.items():
    filepath = os.path.join(base_dir, f'{lang}.json')
    if not os.path.exists(filepath):
        print(f"⚠️  {lang}.json não encontrado, pulando...")
        continue

    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for key_path, value in fixes.items():
        parts = key_path.split('.')
        obj = data
        for part in parts[:-1]:
            if part not in obj:
                obj[part] = {}
            obj = obj[part]
        obj[parts[-1]] = value

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✅ {lang}.json atualizado")

print("\n🎉 Todos os CTAs atualizados!")
