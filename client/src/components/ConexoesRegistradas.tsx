import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Uma conexão registrada pela plataforma — Meu Network Inteligente, spec da
 * Glenda de 14/09, itens 15 a 18. A tela mostra o que o servidor devolve para
 * quem participa: a origem, os itens que se encontraram, a etapa e o status
 * da comissão. O lado alheio chega só com o ID anônimo (ou como "membra da
 * plataforma"), e o lado da própria dona leva ao perfil do contato dela.
 *
 * As etapas seguem a ordem (apresentação → negociação → fechamento); o botão
 * mostra só a próxima, e o servidor recusa pular. Comissão é STATUS: nenhum
 * percentual, valor ou cobrança aparece aqui, e o aviso diz isso.
 *
 * Descartar pede confirmação: o servidor não aceita etapa nenhuma depois do
 * descarte de quem pede (avancarConexao), e a sincronização não recria o par.
 */

type Lado = { lado: "a" | "b"; tipo: "contato" | "membro"; contactId: number | null; codigoAnonimo: string | null; meu: boolean; originador: boolean; statusComissaoOriginador: string | null };

export type ConexaoNaTela = {
  id: string;
  origem: string;
  /** A nota do cruzamento. Não é desenhada aqui: nesta tela não entra percentual. */
  pontuacao?: number;
  /** O outro lado retirou a autorização: sem itens, e a tela avisa (item 26). */
  outroLadoSemAutorizacao?: boolean;
  itens: Array<{ tem: string; precisa: string; deCodigo: string | null; paraCodigo: string | null }>;
  status: string;
  statusComissao: string;
  criadaEm: number;
  /** A dona já confirmou o fechamento; a conexão espera a confirmação do outro lado. */
  fechamentoConfirmadoPorMim?: boolean;
  lados: Lado[];
};

/**
 * A referência que identifica UMA conexão na tela. Sai do id da própria linha
 * (que o cliente já tem, e que não é dado de ninguém), e existe porque entre
 * duas membras não há mais nada para distinguir: os dois lados são "membra da
 * plataforma", os itens ficam vazios de propósito e duas conexões da mesma
 * rodada têm a mesma nota arredondada e o mesmo minuto de registro. Sem ela,
 * descartar — que não volta atrás — vira sorteio.
 */
export function referenciaDaConexao(id: string): string {
  return id.replace(/[^0-9a-zA-Z]/g, "").slice(-6).toUpperCase();
}
const PROXIMA: Record<string, "apresentacao" | "negociacao" | "fechada" | undefined> = {
  identificada: "apresentacao",
  apresentacao: "negociacao",
  negociacao: "fechada",
};

export function ConexaoRegistrada({ conexao }: { conexao: ConexaoNaTela }) {
  const { t, i18n } = useTranslation();
  const utils = trpc.useUtils();
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const avancar = trpc.networkInteligente.avancarConexao.useMutation({
    onSuccess: resultado => {
      setConfirmandoDescarte(false);
      toast.success(t(resultado?.aguardandoOutroLado ? "networkInteligente.connections.closingAwaiting" : "networkInteligente.connections.stepSaved"));
      void utils.networkInteligente.conexoes.invalidate();
      void utils.networkInteligente.contato.invalidate();
    },
    onError: () => toast.error(t("networkInteligente.connections.stepError")),
  });
  // Fechar exige a confirmação dos dois lados (o servidor guarda a de cada um);
  // quem já confirmou não vê o botão de novo, e sim o aviso de espera.
  const aguardandoOutroLado = conexao.status === "negociacao" && conexao.fechamentoConfirmadoPorMim === true;
  const proxima = aguardandoOutroLado ? undefined : PROXIMA[conexao.status];
  const podeDescartar = conexao.status !== "fechada" && conexao.status !== "descartada";
  const meuOriginador = conexao.lados.find(lado => lado.meu && lado.originador);
  const registradaEm = new Date(conexao.criadaEm).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
  const referencia = referenciaDaConexao(conexao.id);
  // O que identifica a conexão na tela, em qualquer idioma. Não é o `motivo`
  // do servidor (frase em português fixo, gravada na linha — ela serve ao
  // Painel Ouro, não a esta tela, que roda em 10 idiomas) nem a nota: aqui
  // não entra percentual nenhum, porque a comissão é status e o aviso ao pé
  // do cartão promete que nenhum percentual aparece.
  const identificacao = (
    <p className="mt-2 text-xs text-white/60">
      <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[#efcba8]">
        {t("networkInteligente.connections.reference", { codigo: referencia })}
      </span>
    </p>
  );

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[#efcba8]">{t(`networkInteligente.connections.origin.${conexao.origem}`)}</span>
        <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/70">{t(`networkInteligente.connections.status.${conexao.status}`)}</span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {conexao.lados.map(lado => (
          <li key={lado.lado}>
            {lado.meu && lado.contactId !== null ? (
              <Link href={`/meu-network-inteligente/contatos/${lado.contactId}`}
                className="rounded-md border border-[#c98f70]/30 bg-[#c98f70]/10 px-2 py-0.5 font-mono text-[#efcba8] hover:bg-[#c98f70]/20">
                {lado.codigoAnonimo ?? "—"}
              </Link>
            ) : (
              <span className={`rounded-md border px-2 py-0.5 ${lado.meu ? "border-[#c98f70]/30 bg-[#c98f70]/10 text-[#efcba8]" : "border-white/10 text-white/55"}`}>
                {lado.tipo === "contato"
                  ? t("networkInteligente.connections.contactSide", { codigo: lado.codigoAnonimo ?? "—" })
                  : t(lado.meu ? "networkInteligente.connections.mySide" : "networkInteligente.connections.memberSide")}
              </span>
            )}
          </li>
        ))}
      </ul>

      {identificacao}

      {conexao.outroLadoSemAutorizacao && (
        <p className="mt-2 text-sm text-white/60">{t("networkInteligente.connections.otherSideWithdrew")}</p>
      )}

      <ul className="mt-2 space-y-1">
        {conexao.itens.map((item, indice) => (
          <li key={indice} className="text-sm text-white/75">{t("networkInteligente.connections.itemLine", { tem: item.tem, precisa: item.precisa })}</li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-white/45">
        {t("networkInteligente.connections.registeredAt", { data: registradaEm })}
        {" · "}
        {t("networkInteligente.connections.platformCommission", { status: t(`networkInteligente.connections.commission.${conexao.statusComissao}`) })}
        {meuOriginador?.statusComissaoOriginador && (
          <>{" · "}{t("networkInteligente.connections.originatorCommission", { status: t(`networkInteligente.connections.commission.${meuOriginador.statusComissaoOriginador}`) })}</>
        )}
      </p>

      {aguardandoOutroLado && (
        <p className="mt-2 text-xs text-[#efcba8]">{t("networkInteligente.connections.closingAwaiting")}</p>
      )}

      {(proxima || podeDescartar) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {proxima && (
            <button type="button" disabled={avancar.isPending} onClick={() => avancar.mutate({ conexaoId: conexao.id, etapa: proxima })}
              className="rounded-lg bg-[#c98f70] px-3 py-1.5 text-xs font-bold text-[#151312] hover:bg-[#efcba8] disabled:opacity-50">
              {t(`networkInteligente.connections.next.${proxima}`)}
            </button>
          )}
          {podeDescartar && (
            <button type="button" disabled={avancar.isPending} onClick={() => setConfirmandoDescarte(true)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 disabled:opacity-50">
              {t("networkInteligente.connections.discard")}
            </button>
          )}
        </div>
      )}

      <Dialog open={confirmandoDescarte} onOpenChange={aberto => { if (!aberto && !avancar.isPending) setConfirmandoDescarte(false); }}>
        <DialogContent className="bg-[#211e1b] border-white/15 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">{t("networkInteligente.connections.discardConfirmTitle")}</DialogTitle>
            <DialogDescription className="text-sm text-white/60">{t("networkInteligente.connections.discardConfirmText")}</DialogDescription>
          </DialogHeader>
          {/* Qual conexão vai embora: a referência é o único campo que nunca
              empata entre dois cartões, e o descarte não volta atrás. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
            <p className="font-bold uppercase tracking-wider text-[#efcba8]">{t(`networkInteligente.connections.origin.${conexao.origem}`)}</p>
            <p className="mt-1 font-mono text-white/75">{t("networkInteligente.connections.reference", { codigo: referencia })}</p>
            <p className="mt-1 text-white/45">{t("networkInteligente.connections.registeredAt", { data: registradaEm })}</p>
          </div>
          {/* Entre membras o outro lado não tem nome nem código: a plataforma não o
              mostra, por desenho. Quem descarta precisa saber disso e agir sobre a
              referência, não sobre um cartão que parece igual ao de baixo. */}
          <p className="text-xs text-white/50">{t("networkInteligente.connections.otherSideAnonymous")}</p>
          <DialogFooter>
            <button type="button" disabled={avancar.isPending} onClick={() => setConfirmandoDescarte(false)}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm text-white/60 hover:bg-white/8 disabled:opacity-50">
              {t("networkInteligente.connections.discardConfirmCancel")}
            </button>
            <button type="button" disabled={avancar.isPending || !podeDescartar} onClick={() => avancar.mutate({ conexaoId: conexao.id, etapa: "descartada" })}
              className="rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-400 disabled:opacity-50">
              {t("networkInteligente.connections.discardConfirmButton", { codigo: referencia })}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
