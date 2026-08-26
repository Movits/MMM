#!/usr/bin/env python3
"""
Script para corrigir todas as traduções incorretas no es.json
Substitui textos em português por traduções corretas em espanhol
"""
import json

with open('client/src/i18n/locales/es.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# ─── HERO ───────────────────────────────────────────────────────────────────
data['hero']['headline1'] = 'Conecta con mujeres'
data['hero']['headline2'] = 'extraordinarias'
data['hero']['headline3'] = 'y potencia tu red'
data['hero']['headline4'] = 'profesional'
data['hero']['subtitle'] = 'MMM OS es la plataforma de matchmaking inteligente que conecta mujeres líderes, emprendedoras y ejecutivas para colaborar, crecer e impactar.'
data['hero']['cta'] = 'Crear mi perfil gratis →'
data['hero']['ctaSecondary'] = 'Ver cómo funciona'

# ─── STATS ──────────────────────────────────────────────────────────────────
data['stats']['users'] = 'Mujeres activas'
data['stats']['opportunities'] = 'Oportunidades creadas'
data['stats']['satisfaction'] = 'Satisfacción garantizada'
data['stats']['connections'] = 'Conexiones exitosas'

# ─── STEPS ──────────────────────────────────────────────────────────────────
data['steps']['title'] = 'Tu camino hacia el éxito'
data['steps']['subtitle'] = 'Descubre lo fácil que es conectar y crecer con MMM OS.'
data['steps']['step1']['title'] = 'Crea tu perfil empoderador'
data['steps']['step1']['desc'] = 'Destaca tus habilidades, experiencias y aspiraciones para atraer las conexiones correctas.'
data['steps']['step2']['title'] = 'Descubre conexiones estratégicas'
data['steps']['step2']['desc'] = 'Nuestro algoritmo inteligente sugiere matches con mujeres que complementan tus objetivos.'
data['steps']['step3']['title'] = 'Colabora y conquista'
data['steps']['step3']['desc'] = 'Inicia conversaciones, explora alianzas y transforma tus ambiciones en realidad.'

# ─── OPPORTUNITIES ──────────────────────────────────────────────────────────
data['opportunities']['title'] = 'Un mundo de posibilidades para ti'
data['opportunities']['subtitle'] = 'Explora las diversas oportunidades que MMM OS ofrece para tu desarrollo.'
data['opportunities']['society']['label'] = 'Impacto social'
data['opportunities']['society']['desc'] = 'Conéctate para generar un impacto positivo en la sociedad.'
data['opportunities']['investment']['label'] = 'Inversión y finanzas'
data['opportunities']['investment']['desc'] = 'Encuentra inversoras u oportunidades de inversión.'
data['opportunities']['mentorship']['label'] = 'Mentoría y desarrollo'
data['opportunities']['mentorship']['desc'] = 'Recibe u ofrece mentoría para acelerar carreras.'
data['opportunities']['partnership']['label'] = 'Alianzas estratégicas'
data['opportunities']['partnership']['desc'] = 'Forma alianzas poderosas para proyectos y negocios.'
data['opportunities']['projects']['label'] = 'Proyectos colaborativos'
data['opportunities']['projects']['desc'] = 'Trabaja en proyectos innovadores con otras líderes.'
data['opportunities']['jobs']['label'] = 'Oportunidades de carrera'
data['opportunities']['jobs']['desc'] = 'Descubre y comparte vacantes de alto nivel.'

# ─── TESTIMONIALS ───────────────────────────────────────────────────────────
data['testimonials']['title'] = 'Lo que dicen nuestras líderes'
data['testimonials']['subtitle'] = 'Historias de éxito que inspiran.'
data['testimonials']['score'] = 'Puntuación media'

# ─── SECURITY ───────────────────────────────────────────────────────────────
data['security']['title'] = 'Tu seguridad es nuestra prioridad'
data['security']['subtitle'] = 'Garantizamos un entorno seguro y confiable para todas nuestras usuarias.'
data['security']['encryption']['title'] = 'Cifrado avanzado'
data['security']['encryption']['desc'] = 'Tus datos están protegidos con la más alta tecnología de cifrado.'
data['security']['verification']['title'] = 'Verificación rigurosa'
data['security']['verification']['desc'] = 'Todos los perfiles son verificados para garantizar la autenticidad y calidad de la comunidad.'
data['security']['control']['title'] = 'Control total'
data['security']['control']['desc'] = 'Tienes control total sobre tu información y con quién te conectas.'

# ─── CTA ────────────────────────────────────────────────────────────────────
data['cta']['title'] = '¿Lista para transformar tu futuro?'
data['cta']['subtitle'] = 'Únete a MMM OS y empieza a construir tu legado hoy.'
data['cta']['button'] = 'Crear cuenta'

# ─── FOOTER ─────────────────────────────────────────────────────────────────
data['footer']['tagline'] = 'Conectando mujeres. Impulsando el éxito.'
data['footer']['rights'] = '© 2026 MMM OS. Todos los derechos reservados.'

# ─── NAV ────────────────────────────────────────────────────────────────────
data['nav']['startFree'] = 'Crear cuenta'
data['nav']['myDashboard'] = 'Mi Panel →'

# ─── AUTH CTAs ──────────────────────────────────────────────────────────────
data['auth']['registerButton'] = 'Crear cuenta'
data['auth']['registerTitle'] = 'Crear cuenta'
data['auth']['createFree'] = 'Crear cuenta'

# ─── ONBOARDING (fix mixed Portuguese) ─────────────────────────────────────
data['onboarding']['next'] = 'Siguiente'
data['onboarding']['back'] = 'Atrás'
data['onboarding']['finish'] = 'Finalizar'
data['onboarding']['saving'] = 'Guardando...'
data['onboarding']['name'] = 'Tu nombre'
data['onboarding']['bio'] = 'Tu biografía'
data['onboarding']['specialty'] = 'Tu especialidad'
data['onboarding']['sector'] = 'Tu sector'
data['onboarding']['location'] = 'Tu ubicación'
data['onboarding']['experience'] = 'Tu experiencia'

# ─── DASHBOARD (fix mixed Portuguese) ───────────────────────────────────────
data['dashboard']['title'] = 'Hola'
data['dashboard']['matches'] = 'Tus Matches'
data['dashboard']['connections'] = 'Conexiones'
data['dashboard']['profile'] = 'Mi Perfil'
data['dashboard']['noMatches'] = '¿Lista para tu próxima gran conexión?'
data['dashboard']['noMatchesDesc'] = 'Nuestra IA analizará tu perfil en 5 dimensiones y encontrará las mujeres con mayor compatibilidad real contigo.'
data['dashboard']['compatibility'] = 'Puntuación Media'
data['dashboard']['connect'] = 'Expresar Interés'
data['dashboard']['loading'] = 'Cargando tu panel'
data['dashboard']['loadingDesc'] = 'Buscando tus oportunidades...'
data['dashboard']['restricted'] = 'Acceso restringido'

with open('client/src/i18n/locales/es.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("✅ es.json corrigido com sucesso!")
