import { lazy, Suspense } from "react";
import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TIPOGRAFIA_DO_TERMO, textoDoTermoParaExibir } from "@/components/TermoGeralDeUso";

// Páginas públicas de Privacidade e Termos, para onde o rodapé aponta.
//
// Até 15/09 as duas diziam que os textos "estão em elaboração com a assessoria
// jurídica". Isso deixou de ser verdade para os TERMOS quando o Termo Geral de
// Uso, Proteção de Dados e Intermediação Digital (Dr. Ronei, 14/09) virou a
// última etapa do cadastro: quem clicava no rodapé lia o contrário do que o
// cadastro mostra, e quem ainda não tem conta não tinha como ler o que vai
// aceitar. Agora /termos mostra o documento PUBLICADO, o mesmo texto e a mesma
// versão que o aceite registra, por um procedimento público que não devolve
// dado de usuária nenhuma (consent.termoGeralPublico).
//
// A Política de Privacidade continua pendente de verdade — é a tarefa "Receber
// os textos jurídicos da Cris", em aberto no quadro do projeto —, então aquela
// página segue dizendo que o documento próprio virá, mas para de prometer o que
// não existe e aponta para as cláusulas de dados do Termo Geral, que estão em
// vigor hoje.
//
// As duas telas seguem em pt-BR fixo, como o resto desta página sempre esteve
// (ver CLAUDE.md): o documento jurídico só existe em português, e traduzir a
// moldura em volta de um texto que não se traduz confundiria mais que ajudaria.

// Mesmo carregamento tardio do cadastro: o Streamdown traz KaTeX, Shiki e
// Mermaid, peso que só faz sentido baixar em quem abre o termo.
const Streamdown = lazy(() => import("streamdown").then(modulo => ({ default: modulo.Streamdown })));

function LegalShell({ title, children, largo = false }: { title: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <div className="min-h-screen bg-[#151312] text-white antialiased">
      <nav className="border-b border-white/[0.05] px-6 py-4">
        <Link href="/">
          <span className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors cursor-pointer text-sm">
            <ArrowLeft size={16} /> Voltar
          </span>
        </Link>
      </nav>
      <main className={`${largo ? "max-w-3xl" : "max-w-2xl"} mx-auto px-6 py-16`}>
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
        A política de privacidade em documento próprio está sendo redigida pela
        assessoria jurídica da plataforma e será publicada nesta página.
      </p>
      <p>
        O que já vale hoje, e vale juridicamente, é o{" "}
        <Link href="/termos">
          <span className="text-[#c98f70] underline cursor-pointer">Termo Geral de Uso, Proteção de Dados e Intermediação Digital</span>
        </Link>
        , aceito por toda usuária no cadastro: ele trata do tratamento de dados
        pessoais, da base legal, do prazo de guarda e dos seus direitos.
      </p>
      <p>
        Na prática, e por desenho do produto: a sua base de contatos é privada e
        nunca é exposta a outras usuárias; o que você escolhe disponibilizar na
        rede global vai sem nome e sem contato; dados sensíveis ficam guardados
        de forma cifrada; e nenhuma informação sua é vendida.
      </p>
    </LegalShell>
  );
}

export function TermsPage() {
  const termo = trpc.consent.termoGeralPublico.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  return (
    <LegalShell title="Termos de Uso" largo>
      {termo.isLoading && (
        <p className="flex items-center gap-2 text-white/40">
          <Loader2 size={14} className="animate-spin" /> Carregando o termo vigente...
        </p>
      )}

      {/* Sem versão publicada (ou com o banco fora do ar) a página diz o que
          houve, em vez de mostrar um texto antigo escrito no código. */}
      {!termo.isLoading && !termo.data && (
        <>
          <p>
            O Termo Geral de Uso, Proteção de Dados e Intermediação Digital é o
            documento que rege a plataforma, e é aceito por toda usuária na
            última etapa do cadastro.
          </p>
          <p>
            A versão vigente ainda não está publicada nesta página. Se você
            precisa do texto agora, fale com a equipe da plataforma.
          </p>
        </>
      )}

      {termo.data && (
        <>
          <p className="text-white/40 text-xs">
            Versão {termo.data.version}, publicada em{" "}
            {new Date(termo.data.publishedAt).toLocaleDateString("pt-BR")}. É o
            mesmo texto que o cadastro apresenta para aceite.
          </p>
          <div lang="pt-BR" className={`pt-2 ${TIPOGRAFIA_DO_TERMO}`}>
            <Suspense fallback={<div className="whitespace-pre-wrap">{textoDoTermoParaExibir(termo.data.text)}</div>}>
              <Streamdown>{textoDoTermoParaExibir(termo.data.text)}</Streamdown>
            </Suspense>
          </div>
        </>
      )}
    </LegalShell>
  );
}
