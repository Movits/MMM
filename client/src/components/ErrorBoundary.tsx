import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorId: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorId: "" };
  }

  static getDerivedStateFromError(): State {
    const errorId = Math.random().toString(36).slice(2, 8).toUpperCase();
    return { hasError: true, errorId };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#060e1a] text-white flex items-center justify-center px-6">
          {/* Background glow */}
          <div className="fixed inset-0 overflow-hidden pointer-events-none">
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(245,166,35,0.05) 0%, transparent 70%)" }}
            />
          </div>

          <div className="relative max-w-md w-full text-center">
            {/* Logo */}
            <a href="/">
              <span className="inline-block text-2xl font-black tracking-tight mb-10 cursor-pointer">
                <span className="text-white">MMM</span>
                <span className="text-[#f5a623]">OS</span>
              </span>
            </a>

            {/* Icon */}
            <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(245,166,35,0.15) 0%, transparent 70%)" }}
              />
              <span className="relative text-4xl">⚡</span>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-black mb-3">
              Algo inesperado aconteceu
            </h1>

            {/* Description */}
            <p className="text-white/40 mb-3 leading-relaxed">
              Encontramos um problema técnico ao carregar esta página. Nossa equipe foi notificada automaticamente.
            </p>

            {/* Error ID */}
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-8">
              <span className="text-white/30 text-xs">Código de referência:</span>
              <code className="text-[#f5a623] text-xs font-bold">{this.state.errorId}</code>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="group relative bg-[#f5a623] hover:bg-[#e09520] text-[#060e1a] font-black px-7 py-3 rounded-xl text-sm transition-all duration-200 active:scale-95 shadow-xl shadow-[#f5a623]/20 overflow-hidden"
              >
                <span className="relative z-10">↻ Tentar novamente</span>
                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12" />
              </button>
              <a href="/">
                <button className="w-full border border-white/15 hover:border-[#f5a623]/40 text-white/60 hover:text-white px-7 py-3 rounded-xl text-sm transition-all duration-200">
                  ← Voltar ao início
                </button>
              </a>
            </div>

            {/* Tip */}
            <p className="text-white/20 text-xs mt-8">
              Se o problema persistir, tente limpar o cache do navegador (Ctrl+Shift+R).
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
