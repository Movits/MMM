import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

// Páginas de Privacidade e Termos. O conteúdo definitivo vem dos textos
// jurídicos da cliente (previstos para 03/09); até lá, as rotas existem para o
// footer não apontar para o nada, e deixam claro que o documento está em
// elaboração. Trocar o conteúdo aqui quando os textos chegarem.

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060b14] text-white antialiased">
      <nav className="border-b border-white/[0.05] px-6 py-4">
        <Link href="/">
          <span className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors cursor-pointer text-sm">
            <ArrowLeft size={16} /> Voltar
          </span>
        </Link>
      </nav>
      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-extrabold mb-6">{title}</h1>
        <div className="space-y-4 text-white/60 text-sm leading-relaxed">{children}</div>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Política de Privacidade">
      <p>
        A versão completa desta política está em elaboração com a assessoria
        jurídica da plataforma e será publicada nesta página.
      </p>
      <p>
        Enquanto isso, valem os princípios que orientam o produto desde o
        desenho: a sua base de contatos é privada e nunca é exposta a outras
        usuárias; dados sensíveis ficam guardados de forma cifrada; e nenhuma
        informação sua é vendida ou compartilhada com terceiros.
      </p>
      <p>
        Dúvidas sobre os seus dados podem ser tratadas diretamente com a equipe
        da plataforma enquanto o canal oficial de contato não é publicado.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Termos de Uso">
      <p>
        Os termos completos estão em elaboração com a assessoria jurídica da
        plataforma e serão publicados nesta página antes da abertura ao público.
      </p>
      <p>
        Em resumo do que já vale hoje: a plataforma destina-se a conexões de
        negócio entre mulheres empreendedoras; oportunidades publicadas passam
        por análise e validação; e acordos fechados a partir das conexões devem
        respeitar as regras de intermediação da comunidade.
      </p>
    </LegalShell>
  );
}
