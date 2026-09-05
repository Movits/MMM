import { useTranslation } from "react-i18next";

// Identidade visual oficial (docs/identidade-visual, Glenda 03/09). Só existem
// artes em português e inglês, então a regra segue a da bandeira do seletor:
// pt-BR usa a arte PT e os outros nove idiomas usam a arte EN. A versão branca
// EN foi gerada por recolorização do mono preto oficial; a metálica só existe
// em EN — por isso o destaque em pt-BR usa a branca, não uma metálica inventada.
const ARTES = {
  monograma: "/brand/monograma-branco.png",
  lockup: { pt: "/brand/lockup-branco-pt.png", en: "/brand/lockup-branco-en.png" },
  destaque: { pt: "/brand/lockup-branco-pt.png", en: "/brand/lockup-metal-en.png" },
  selo: "/brand/selo.png",
} as const;

type Variante = keyof typeof ARTES;

export function BrandLogo({ variante, className }: {
  /** monograma: quadrado p/ headers; lockup: completo branco; destaque: peça de login/hero; selo: circular p/ avatares. */
  variante: Variante;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const idiomaAtual = i18n.resolvedLanguage ?? i18n.language;
  const idioma = idiomaAtual?.startsWith("pt") ? "pt" : "en";
  const arte = ARTES[variante];
  const src = typeof arte === "string" ? arte : arte[idioma];
  const alt = idioma === "pt" ? "MMM — Mulheres que Movem o Mundo" : "MMM — Women Moving the World";
  return <img src={src} alt={alt} className={className} />;
}

/** Marca compacta dos headers: monograma + wordmark "MMM" (sem o antigo "OS"). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 cursor-pointer ${className ?? ""}`}>
      <BrandLogo variante="monograma" className="h-[30px] w-[30px]" />
      <span className="text-xl font-black tracking-tight text-white">MMM</span>
    </span>
  );
}
