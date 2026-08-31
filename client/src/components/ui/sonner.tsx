import { Toaster as Sonner, type ToasterProps } from "sonner";

// Tema fixo: o app é single-theme light (ThemeContext próprio, switchable=false).
// A versão anterior lia useTheme() do next-themes, cujo provider nunca é montado —
// o sonner caía em "system" e, com o SO em dark, pintava a descrição do toast
// quase branca sobre o popover branco do tema light.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
