import type { ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowRight, CircleAlert, Clock3, Mic, Search, Sparkles, Users, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { AppHeader } from "@/components/AppHeader";
import { ErroDeConsulta } from "@/components/ErroDeConsulta";
import { rotuloDoCampo } from "@/components/CompletudeDoContato";

/**
 * Meu Network Inteligente — o painel da rede particular (pedido do Nicolas,
 * 13/09/2026, item 19), montado só com o que já existe e é contado no banco
 * (networkInteligente.resumo):
 *
 * - reuniões, contatos e contatos com informação faltando;
 * - matches internos, só com o termo do Smart Match aceito;
 * - a duração das reuniões guardadas e o limite gratuito por reunião, que é o
 *   mesmo número que o servidor aplica ao receber a gravação;
 * - a chamada "Precisa de mais tempo?" sem botão, link nem preço: não existe
 *   plano nem cobrança, e o texto diz isso.
 *
 * Ficam FORA até existirem de verdade: contatos disponibilizados, matches com a
 * rede global, intermediações, negócios, comissionamentos e minutos consumidos
 * no mês. Um cartão com zero nesses lugares simularia um recurso que não há.
 */

// 20 s de reunião não são "0 min".
function emMinutos(segundos: number) {
  return segundos > 0 ? Math.max(1, Math.round(segundos / 60)) : 0;
}

const CARTAO = "rounded-2xl border border-white/[0.08] bg-[#211e1b]/90";

function Indicador({ rotulo, valor, detalhe, href, icone: Icone }: {
  rotulo: string; valor: ReactNode; detalhe: string; href?: string; icone: LucideIcon;
}) {
  const corpo = (
    <div className={`${CARTAO} h-full p-5 transition-colors duration-200 ${href ? "hover:border-[#c98f70]/35" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{rotulo}</p>
        <Icone className="h-4 w-4 shrink-0 text-[#c98f70]" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-black tabular-nums text-white">{valor}</p>
      <p className="mt-1 text-xs text-white/45">{detalhe}</p>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{corpo}</Link> : corpo;
}

function Atalho({ href, icone: Icone, titulo, descricao, children }: {
  href: string; icone: LucideIcon; titulo: string; descricao: string; children?: ReactNode;
}) {
  return (
    <Link href={href} className={`${CARTAO} group flex h-full flex-col p-5 transition-colors duration-200 hover:border-[#c98f70]/35`}>
      <span className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#c98f70]/25 bg-[#c98f70]/10">
          <Icone className="h-5 w-5 text-[#c98f70]" aria-hidden="true" />
        </span>
        <span className="font-bold text-white">{titulo}</span>
      </span>
      <span className="mt-3 block text-sm leading-relaxed text-white/55">{descricao}</span>
      {children}
    </Link>
  );
}

export default function MeuNetworkInteligente() {
  const { t } = useTranslation();
  const resumo = trpc.networkInteligente.resumo.useQuery();
  const dados = resumo.data;
  const limite = dados ? emMinutos(dados.minutos.limitePorReuniaoSegundos) : 0;

  return (
    <>
      <AppHeader title={t("networkPanel.title")} backTo="/dashboard" />
      <main className="min-h-screen bg-transparent px-4 py-8 text-white md:px-8">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8">
            <p className="text-xs font-bold tracking-[.18em] text-[#c98f70]">{t("networkPanel.eyebrow")}</p>
            <h1 className="mt-2 text-3xl font-bold text-balance md:text-4xl">{t("networkPanel.title")}</h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-white/60">{t("networkPanel.subtitle")}</p>
          </header>

          {resumo.isError ? (
            <ErroDeConsulta erro={resumo.error} aoTentarDeNovo={() => void resumo.refetch()} />
          ) : !dados ? (
            <div role="status" className="flex items-center justify-center gap-3 py-20 text-sm text-white/50">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#c98f70]/30 border-t-[#c98f70]" aria-hidden="true" />
              {t("networkPanel.loading")}
            </div>
          ) : (
            <>
              <section aria-label={t("networkPanel.title")} className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
                <Indicador rotulo={t("networkPanel.meetings")} valor={dados.reunioes.total} icone={Mic} href="/meetings"
                  detalhe={t("networkPanel.meetingsDetail", { transcritas: dados.reunioes.transcritas })} />
                <Indicador rotulo={t("networkPanel.contacts")} valor={dados.contatos.total} icone={Users} href="/network"
                  detalhe={t("networkPanel.contactsDetail")} />
                <Indicador rotulo={t("networkPanel.incomplete")} valor={dados.contatos.incompletos} icone={CircleAlert}
                  detalhe={t("networkPanel.incompleteDetail")} />
                {dados.matchesInternos.termoAceito ? (
                  <Indicador rotulo={t("networkPanel.internalMatches")} valor={dados.matchesInternos.total} icone={Sparkles} href="/intelligent-matches"
                    detalhe={t("networkPanel.internalMatchesDetail", { novos: dados.matchesInternos.novos })} />
                ) : (
                  // Sem o termo não há número: o traço diz que ele não é mostrado,
                  // e o cartão leva à tela onde o termo é aceito.
                  <Indicador rotulo={t("networkPanel.internalMatches")} valor="—" icone={Sparkles} href="/intelligent-matches"
                    detalhe={t("networkPanel.internalMatchesNoConsent")} />
                )}
              </section>

              <section aria-labelledby="nwi-minutos" className={`${CARTAO} mt-4 p-5 md:p-6`}>
                <h2 id="nwi-minutos" className="flex items-center gap-2 text-lg font-bold">
                  <Clock3 className="h-4 w-4 text-[#c98f70]" aria-hidden="true" />
                  {t("networkPanel.minutesTitle")}
                </h2>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t("networkPanel.minutesUsed")}</p>
                    <p className="mt-1 text-2xl font-black tabular-nums">{t("networkPanel.minutesValue", { minutos: emMinutos(dados.minutos.segundosEmReunioesGuardadas) })}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{t("networkPanel.minutesUsedHelp")}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t("networkPanel.minutesLimit")}</p>
                    <p className="mt-1 text-2xl font-black tabular-nums">{t("networkPanel.minutesValue", { minutos: limite })}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/45">{t("networkPanel.minutesLimitHelp")}</p>
                  </div>
                </div>
                <div className="mt-5 rounded-xl border border-[#c98f70]/25 bg-[#c98f70]/[0.06] p-4">
                  <p className="font-semibold text-[#efcba8]">{t("networkPanel.moreTime")}</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/55">{t("networkPanel.moreTimeUnavailable", { minutos: limite })}</p>
                </div>
              </section>

              <section aria-labelledby="nwi-atalhos" className="mt-8">
                <h2 id="nwi-atalhos" className="mb-3 text-lg font-bold">{t("networkPanel.actionsTitle")}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Atalho href="/meetings" icone={Mic} titulo={t("networkPanel.actionRecord")}
                    descricao={t("networkPanel.actionRecordDesc", { minutos: limite })}>
                    <span className="mt-3 block rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/50">
                      {t("networkPanel.consentNotice")}
                    </span>
                  </Atalho>
                  <Atalho href="/network" icone={Users} titulo={t("networkPanel.actionContacts")} descricao={t("networkPanel.actionContactsDesc")} />
                  <Atalho href="/memory" icone={Search} titulo={t("networkPanel.actionSearch")} descricao={t("networkPanel.actionSearchDesc")} />
                  <Atalho href="/intelligent-matches" icone={Sparkles} titulo={t("networkPanel.actionMatches")} descricao={t("networkPanel.actionMatchesDesc")} />
                </div>
              </section>

              <section aria-labelledby="nwi-incompletos" className="mt-8">
                <h2 id="nwi-incompletos" className="text-lg font-bold">{t("networkPanel.incompleteTitle")}</h2>
                {dados.contatos.total === 0 ? (
                  <p className="mt-3 text-sm text-white/50">{t("networkPanel.noContacts")}</p>
                ) : dados.contatos.incompletos === 0 ? (
                  <p className="mt-3 text-sm text-white/50">{t("networkPanel.incompleteEmpty")}</p>
                ) : (
                  <>
                    <p role="note" className="mt-3 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-100">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                      {t("networkPanel.alert")}
                    </p>
                    <ul className="mt-3 space-y-2">
                      {dados.contatos.amostraIncompletos.map(contato => (
                        <li key={contato.id} className={`${CARTAO} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-white">{contato.fullName}</p>
                            <p className="mt-1 text-xs text-white/50">
                              {t("networkPanel.missing")} {contato.faltando.map(campo => rotuloDoCampo(t, campo)).join(", ")}
                            </p>
                          </div>
                          <Link href={`/network?contato=${contato.id}`}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#c98f70]/35 px-4 py-2 text-sm font-semibold text-[#c98f70] transition-colors hover:bg-[#c98f70]/10">
                            {t("networkPanel.complete")}
                            <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {dados.contatos.incompletos > dados.contatos.amostraIncompletos.length && (
                      <p className="mt-3 text-xs text-white/45">
                        {t("networkPanel.incompleteMore", { mostrados: dados.contatos.amostraIncompletos.length, total: dados.contatos.incompletos })}{" "}
                        <Link href="/network" className="font-semibold text-[#c98f70] underline-offset-2 hover:underline">{t("networkPanel.seeAllContacts")}</Link>
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}
