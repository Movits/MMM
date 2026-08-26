import { useEffect, useState } from "react";
import { Link } from "wouter";

export default function OAuthError() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 50);
  }, []);

  return (
    <div className="min-h-screen bg-transparent text-white flex items-center justify-center px-6">
      {/* Animated background particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-[#f5a623]"
            style={{
              width: `${Math.random() * 3 + 1}px`,
              height: `${Math.random() * 3 + 1}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.3 + 0.05,
              animation: `float ${Math.random() * 8 + 5}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 5}s`,
            }}
          />
        ))}
      </div>

      <div
        className="relative max-w-lg w-full text-center"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.7s cubic-bezier(0.23,1,0.32,1)",
        }}
      >
        {/* Logo */}
        <Link href="/">
          <span className="inline-block text-2xl font-black tracking-tight mb-10 cursor-pointer">
            <span className="text-white">MMM</span>
            <span className="text-[#f5a623]">OS</span>
          </span>
        </Link>

        {/* Icon */}
        <div className="relative inline-flex items-center justify-center w-24 h-24 mb-8">
          <div className="absolute inset-0 bg-amber-500/10 rounded-full animate-ping" style={{ animationDuration: "2s" }} />
          <div className="absolute inset-0 bg-amber-500/5 rounded-full" />
          <span className="relative text-5xl">🔐</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-black mb-3">
          Acesso via link direto
        </h1>

        {/* Subtitle */}
        <p className="text-white/50 text-lg mb-8 leading-relaxed">
          Para acessar o MMM OS com segurança, você precisa usar o{" "}
          <strong className="text-white/80">endereço oficial da plataforma</strong>.
          O link de desenvolvimento não está autorizado para login.
        </p>

        {/* Info box */}
        <div className="bg-[#0d1530] border border-white/10 rounded-2xl p-6 mb-8 text-left space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-[#f5a623] text-lg mt-0.5">✓</span>
            <div>
              <div className="font-semibold text-white text-sm">O que aconteceu?</div>
              <div className="text-white/40 text-sm mt-1">
                O sistema de autenticação bloqueou o acesso porque o domínio de origem não está na lista de origens autorizadas. Isso é uma proteção de segurança normal.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-[#f5a623] text-lg mt-0.5">→</span>
            <div>
              <div className="font-semibold text-white text-sm">Como resolver?</div>
              <div className="text-white/40 text-sm mt-1">
                Acesse o MMM OS pelo endereço oficial publicado. Se você é o administrador, publique o site clicando em <strong className="text-white/60">Publish</strong> no painel de gerenciamento.
              </div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <Link href="/">
          <button className="w-full group relative bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-black px-8 py-4 rounded-xl text-base transition-all duration-200 active:scale-95 shadow-2xl shadow-[#f5a623]/20 overflow-hidden mb-4">
            <span className="relative z-10">← Voltar para a página inicial</span>
            <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12" />
          </button>
        </Link>

        <p className="text-white/20 text-xs">
          Código de erro: <code className="text-white/30">invalid_redirect_uri</code>
        </p>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}
