import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Shield, Users, Star, CheckCircle, XCircle, Clock,
  AlertTriangle, BarChart3, Crown, UserCheck, Globe,
  FileText, ChevronRight, Search, Award, Lock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";

type Tab = "overview" | "gold" | "leaders" | "opportunities" | "compliance";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color = "amber" }: {
  icon: React.ElementType; label: string; value: number | string; color?: string;
}) {
  const colorMap: Record<string, string> = {
    amber: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    blue: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    green: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    red: "text-red-400 bg-red-400/10 border-red-400/20",
    purple: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    orange: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  };
  return (
    <div className={`rounded-2xl border p-5 ${colorMap[color] || colorMap.amber}`}>
      <div className="flex items-center gap-3 mb-3">
        <Icon size={18} />
        <span className="text-xs font-medium opacity-70">{label}</span>
      </div>
      <div className="text-3xl font-black">{value}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType; title: string; subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-4 mb-6">
      <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-amber-400" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {subtitle && <p className="text-sm text-white/40 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Módulo: Visão Geral ──────────────────────────────────────────────────────
function OverviewTab() {
  const { data: stats, isLoading } = trpc.president.getGovernanceStats.useQuery();

  if (isLoading) return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(7)].map((_, i) => (
        <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />
      ))}
    </div>
  );

  if (!stats) return <p className="text-white/40 text-sm">Sem dados disponíveis.</p>;

  return (
    <div className="space-y-6">
      <SectionHeader icon={BarChart3} title="Visão Geral da Plataforma" subtitle="Indicadores de governança em tempo real" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Total de Membras" value={stats.totalUsers} color="blue" />
        <StatCard icon={Shield} label="Membras Bronze" value={stats.bronzeUsers ?? 0} color="orange" />
        <StatCard icon={Shield} label="Membras Prata" value={stats.silverUsers} color="blue" />
        <StatCard icon={Star} label="Membras Ouro" value={stats.goldUsers} color="amber" />
        <StatCard icon={Clock} label="Oportunidades Pendentes" value={stats.pendingOpportunities} color="amber" />
        <StatCard icon={CheckCircle} label="Oportunidades Ativas" value={stats.activeOpportunities} color="green" />
        <StatCard icon={AlertTriangle} label="Alertas Vermelhos" value={stats.redFlagOpportunities} color="red" />
      </div>

      <div className="mt-8 p-5 rounded-2xl bg-amber-400/8 border border-amber-400/20">
        <div className="flex items-center gap-3 mb-3">
          <Crown size={16} className="text-amber-400" />
          <span className="text-sm font-bold text-amber-400">Responsabilidades do Painel Ouro</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-white/60">
          {[
            "Conceder e revogar o Selo Ouro de Exclusividade",
            "Nomear e gerenciar Líderes Nacionais",
            "Validar oportunidades estratégicas de alto valor",
            "Supervisionar o compliance geral da plataforma",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Módulo: Gestão de Ouro ───────────────────────────────────────────────────
function GoldTab() {
  const [search, setSearch] = useState("");
  const [grantDialog, setGrantDialog] = useState<{ userId: number; name: string } | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<{ userId: number; name: string } | null>(null);
  const [reason, setReason] = useState("");

  const { data: silverUsers, refetch: refetchSilver } = trpc.president.listAllUsers.useQuery({ role: "silver" });
  const { data: goldGrants, refetch: refetchGrants } = trpc.president.getGoldGrants.useQuery();

  const grantMutation = trpc.president.grantGold.useMutation({
    onSuccess: () => {
      toast.success("Selo Ouro concedido com sucesso!");
      setGrantDialog(null);
      setReason("");
      refetchSilver();
      refetchGrants();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.president.revokeGold.useMutation({
    onSuccess: () => {
      toast.success("✅ Selo Ouro revogado. A conta da membra continua ativa como Prata.");
      setRevokeDialog(null);
      setReason("");
      refetchGrants();
      refetchSilver(); // Atualizar lista Prata para mostrar a membra rebaixada imediatamente
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredSilver = (silverUsers?.users || []).filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <SectionHeader
        icon={Star}
        title="Gestão do Selo Ouro"
        subtitle="Conceda ou revogue o Selo de Exclusividade Institucional. Não pode ser comprado — apenas concedido manualmente."
      />

      {/* Membras Ouro Ativas */}
      <div>
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Membras com Selo Ouro Ativo</h3>
        {!goldGrants || goldGrants.length === 0 ? (
          <div className="p-6 rounded-xl bg-white/3 border border-white/8 text-center text-white/30 text-sm">
            Nenhuma membra com Selo Ouro ativo no momento.
          </div>
        ) : (
          <div className="space-y-2">
            {goldGrants.filter(g => !g.grant.revokedAt).map((g) => (
              <div key={g.grant.id} className="flex items-center justify-between p-4 rounded-xl bg-amber-400/8 border border-amber-400/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-amber-400/20 flex items-center justify-center">
                    <Star size={14} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{g.userName || "—"}</p>
                    <p className="text-xs text-white/40">{g.userEmail}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-400/30 hover:bg-red-400/10 bg-transparent text-xs"
                  onClick={() => { setRevokeDialog({ userId: g.grant.grantedTo, name: g.userName || "Membra" }); setReason(""); }}
                >
                  Revogar
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conceder Ouro */}
      <div>
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Conceder Selo Ouro — Membras Prata</h3>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            className="pl-9 bg-white/5 border-white/15 text-white placeholder-white/25 text-sm"
          />
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filteredSilver.length === 0 ? (
            <p className="text-center text-white/30 text-sm py-6">Nenhuma membra encontrada.</p>
          ) : filteredSilver.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3.5 rounded-xl bg-white/3 border border-white/8 hover:border-white/15 transition-colors">
              <div>
                <p className="text-sm font-medium text-white">{u.name || "Sem nome"}</p>
                <p className="text-xs text-white/40">{u.email} {u.country ? `· ${u.country}` : ""}</p>
              </div>
              <Button
                size="sm"
                className="bg-amber-400 hover:bg-amber-500 text-[#060e1a] text-xs font-bold"
                onClick={() => { setGrantDialog({ userId: u.id, name: u.name || "Membra" }); setReason(""); }}
              >
                <Star size={12} className="mr-1" /> Conceder Ouro
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Dialog: Conceder — ação direta, sem campo de justificativa */}
      <Dialog open={!!grantDialog} onOpenChange={() => setGrantDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-amber-400/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-amber-400 flex items-center gap-2">
              <Star size={16} /> Conceder Selo Ouro
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-white/70">
              Você está concedendo o <strong className="text-amber-400">Selo de Exclusividade Institucional</strong> para <strong className="text-white">{grantDialog?.name}</strong>.
            </p>
            {/* Mensagem automática que será enviada */}
            <div className="bg-amber-400/8 border border-amber-400/25 rounded-xl p-4">
              <p className="text-[11px] text-amber-400/70 uppercase tracking-wider font-semibold mb-2">Mensagem automática que será enviada:</p>
              <p className="text-sm text-white/80 leading-relaxed italic">
                "Parabéns, você agora é nível OURO! Uma membra Ouro do MMM reconheceu o seu potencial e concedeu a você o Selo de Exclusividade Institucional Ouro. Bem-vinda(o) ao grupo mais seleto da plataforma!"
              </p>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setGrantDialog(null)} className="bg-transparent border-white/20 text-white/60">Cancelar</Button>
            <Button
              className="bg-amber-400 hover:bg-amber-500 text-[#060e1a] font-bold"
              disabled={grantMutation.isPending}
              onClick={() => grantDialog && grantMutation.mutate({ userId: grantDialog.userId })}
            >
              {grantMutation.isPending ? "Concedendo..." : "⭐ Confirmar e Enviar Mensagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Revogar */}
      <Dialog open={!!revokeDialog} onOpenChange={() => setRevokeDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-red-400/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <XCircle size={16} /> Revogar Selo Ouro
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-white/60">
              Você está revogando o Selo Ouro de <strong className="text-white">{revokeDialog?.name}</strong>.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-400/8 border border-blue-400/20">
              <CheckCircle size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-blue-300">
                <strong>A conta não será excluída.</strong> A membra continuará ativa na plataforma com nível Prata e poderá receber o Selo Ouro novamente no futuro.
              </p>
            </div>
          </div>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Motivo da revogação (mínimo 10 caracteres)..."
            className="bg-white/5 border-white/15 text-white placeholder-white/30 text-sm resize-none"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeDialog(null)} className="bg-transparent border-white/20 text-white/60">Cancelar</Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white font-bold"
              disabled={reason.length < 10 || revokeMutation.isPending}
              onClick={() => revokeDialog && revokeMutation.mutate({ userId: revokeDialog.userId, reason })}
            >
              {revokeMutation.isPending ? "Revogando..." : "Confirmar Revogação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Módulo: Líderes Nacionais ────────────────────────────────────────────────
function LeadersTab() {
  const [nominateDialog, setNominateDialog] = useState<{ userId: number; name: string } | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<{ leaderId: number; name: string } | null>(null);
  const [oppDialog, setOppDialog] = useState<{ userId: number; name: string } | null>(null);
  const [region, setRegion] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [search, setSearch] = useState("");

  const { data: allUsers } = trpc.president.listAllUsers.useQuery({});
  const { data: leaders, refetch } = trpc.president.listLeaders.useQuery();
  const { data: leaderOpps } = trpc.president.getLeaderOpportunities.useQuery(
    { userId: oppDialog?.userId ?? 0 },
    { enabled: !!oppDialog }
  );

  const nominateMutation = trpc.president.nominateLeader.useMutation({
    onSuccess: () => {
      toast.success("Líder nacional nomeada com sucesso!");
      setNominateDialog(null);
      setRegion("");
      setSpecialty("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.president.revokeLeader.useMutation({
    onSuccess: () => {
      toast.success("Líder revogada com sucesso.");
      setRevokeDialog(null);
      setRevokeReason("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredUsers = (allUsers?.users || []).filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const leaderList = (leaders as Array<{ id: number; userId: number; name: string; email: string; region: string; specialty: string; country: string }> | undefined) ?? [];

  return (
    <div className="space-y-8">
      <SectionHeader
        icon={Globe}
        title="Líderes Nacionais"
        subtitle="Gerencie especialistas setoriais e líderes regionais. Múltiplas nomeações são permitidas."
      />

      {/* Líderes ativas com botão Revogar e Ver Oportunidades */}
      <div>
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
          Líderes Ativas ({leaderList.length})
        </h3>
        {leaderList.length === 0 ? (
          <div className="p-6 rounded-xl bg-white/3 border border-white/8 text-center text-white/30 text-sm">
            Nenhuma líder nacional nomeada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {leaderList.map((l) => (
              <div key={l.id} className="flex items-center gap-4 p-4 rounded-xl bg-purple-400/8 border border-purple-400/20">
                <div className="w-9 h-9 rounded-full bg-purple-400/20 flex items-center justify-center flex-shrink-0">
                  <UserCheck size={14} className="text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{l.name}</p>
                  <p className="text-xs text-white/40">{l.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Badge className="bg-purple-400/15 text-purple-300 border-purple-400/30 text-xs">{l.region}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-transparent border-blue-400/30 text-blue-300 hover:bg-blue-400/10 text-xs h-7 px-2"
                    onClick={() => setOppDialog({ userId: l.userId, name: l.name })}
                  >
                    <Search size={10} className="mr-1" /> Oportunidades
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-transparent border-red-400/30 text-red-300 hover:bg-red-400/10 text-xs h-7 px-2"
                    onClick={() => { setRevokeDialog({ leaderId: l.id, name: l.name }); setRevokeReason(""); }}
                  >
                    <XCircle size={10} className="mr-1" /> Revogar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nomear nova líder */}
      <div>
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">Nomear Nova Líder</h3>
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar membra por nome ou e-mail..."
            className="pl-9 bg-white/5 border-white/15 text-white placeholder-white/25 text-sm"
          />
        </div>
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {filteredUsers.map(u => (
            <div key={u.id} className="flex items-center justify-between p-3.5 rounded-xl bg-white/3 border border-white/8 hover:border-white/15 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{u.name || "Sem nome"}</p>
                <p className="text-xs text-white/40 truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-transparent border-blue-400/30 text-blue-300 hover:bg-blue-400/10 text-xs h-7 px-2"
                  onClick={() => setOppDialog({ userId: u.id, name: u.name || "Membra" })}
                  title="Ver oportunidades desta membra"
                >
                  <Search size={10} className="mr-1" /> Oportunidades
                </Button>
                <Button
                  size="sm"
                  className="bg-purple-500 hover:bg-purple-600 text-white text-xs font-bold"
                  onClick={() => { setNominateDialog({ userId: u.id, name: u.name || "Membra" }); setRegion(""); setSpecialty(""); }}
                >
                  <Award size={12} className="mr-1" /> Nomear
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dialog: Nomear Líder */}
      <Dialog open={!!nominateDialog} onOpenChange={() => setNominateDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-purple-400/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-purple-400 flex items-center gap-2">
              <Award size={16} /> Nomear Líder Nacional
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60">
            Nomeando <strong className="text-white">{nominateDialog?.name}</strong> como líder nacional.
          </p>
          <Input
            value={region}
            onChange={e => setRegion(e.target.value)}
            placeholder="Região / País (ex: Brasil, América Latina)"
            className="bg-white/5 border-white/15 text-white placeholder-white/30 text-sm"
          />
          <Input
            value={specialty}
            onChange={e => setSpecialty(e.target.value)}
            placeholder="Especialidade setorial (opcional)"
            className="bg-white/5 border-white/15 text-white placeholder-white/30 text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNominateDialog(null)} className="bg-transparent border-white/20 text-white/60">Cancelar</Button>
            <Button
              className="bg-purple-500 hover:bg-purple-600 text-white font-bold"
              disabled={region.length < 2 || nominateMutation.isPending}
              onClick={() => nominateDialog && nominateMutation.mutate({ userId: nominateDialog.userId, region, specialty: specialty || undefined })}
            >
              {nominateMutation.isPending ? "Nomeando..." : "Confirmar Nomeação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Revogar Líder */}
      <Dialog open={!!revokeDialog} onOpenChange={() => setRevokeDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-red-400/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <XCircle size={16} /> Revogar Líder
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60">
            Você está revogando a nomeação de <strong className="text-white">{revokeDialog?.name}</strong>. Esta ação é imediata.
          </p>
          <Input
            value={revokeReason}
            onChange={e => setRevokeReason(e.target.value)}
            placeholder="Motivo da revogação (opcional)"
            className="bg-white/5 border-white/15 text-white placeholder-white/30 text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeDialog(null)} className="bg-transparent border-white/20 text-white/60">Cancelar</Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white font-bold"
              disabled={revokeMutation.isPending}
              onClick={() => revokeDialog && revokeMutation.mutate({ leaderId: revokeDialog.leaderId, reason: revokeReason || undefined })}
            >
              {revokeMutation.isPending ? "Revogando..." : "Confirmar Revogação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Oportunidades do Líder */}
      <Dialog open={!!oppDialog} onOpenChange={() => setOppDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-blue-400/30 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-blue-400 flex items-center gap-2">
              <Search size={16} /> Oportunidades de {oppDialog?.name}
            </DialogTitle>
          </DialogHeader>
          {!leaderOpps || (leaderOpps as unknown[]).length === 0 ? (
            <p className="text-white/40 text-sm text-center py-6">Nenhuma oportunidade cadastrada por esta líder.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(leaderOpps as Array<{ id: number; title: string; type: string; status: string; complianceLevel: string; country: string; createdAt: string }>).map(o => (
                <div key={o.id} className="p-3.5 rounded-xl bg-white/3 border border-white/8">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{o.title}</p>
                      <p className="text-xs text-white/40 mt-0.5">{o.type} · {o.country}</p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Badge className={`text-xs ${
                        o.status === "active" ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30" :
                        o.status === "pending" ? "bg-amber-400/15 text-amber-300 border-amber-400/30" :
                        "bg-red-400/15 text-red-300 border-red-400/30"
                      }`}>{o.status}</Badge>
                      <Badge className={`text-xs ${
                        o.complianceLevel === "green" ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30" :
                        o.complianceLevel === "yellow" ? "bg-yellow-400/15 text-yellow-300 border-yellow-400/30" :
                        "bg-red-400/15 text-red-300 border-red-400/30"
                      }`}>{o.complianceLevel}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOppDialog(null)} className="bg-transparent border-white/20 text-white/60">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Módulo: Validação de Oportunidades ──────────────────────────────────────
function OpportunitiesTab() {
  // Modal apenas para Solicitar Info (precisa de input do que precisa)
  const [requestInfoDialog, setRequestInfoDialog] = useState<{
    id: number; title: string; publisherName: string;
  } | null>(null);
  const [infoNeeded, setInfoNeeded] = useState("");

  const { data: pending, refetch } = trpc.president.listPendingOpportunities.useQuery();

  const validateMutation = trpc.president.validateOpportunity.useMutation({
    onSuccess: (_, vars) => {
      const action = vars.status === "approved" ? "aprovada" : "rejeitada";
      toast.success(`Oportunidade ${action}! Mensagem automática enviada.`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const requestInfoMutation = trpc.president.requestInfo.useMutation({
    onSuccess: () => {
      toast.success("Solicitação enviada! Mensagem automática enviada para a publicadora.");
      setRequestInfoDialog(null);
      setInfoNeeded("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Mensagens automáticas que serão enviadas (para exibir no card)
  const autoMessages = {
    approved: (name: string) => `Olá, ${name.split(" ")[0]}. Analisamos a sua proposta e ela se encaixa muito bem no que buscamos.`,
    rejected: (name: string) => `Olá, ${name.split(" ")[0]}. Agradecemos o envio da proposta e o seu tempo. No momento, essa oportunidade não está alinhada com as nossas prioridades e foco estratégico atual.`,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={FileText}
        title="Validação de Oportunidades"
        subtitle="Homologue oportunidades estratégicas. Mensagens automáticas são enviadas ao clicar em Aprovar, Rejeitar ou Solicitar Info."
      />

      {!pending || pending.length === 0 ? (
        <div className="p-10 rounded-2xl bg-white/3 border border-white/8 text-center">
          <CheckCircle size={32} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-white font-semibold">Nenhuma oportunidade pendente</p>
          <p className="text-white/40 text-sm mt-1">Todas as oportunidades foram validadas.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((item) => (
            <div key={item.opp.id} className="p-5 rounded-2xl bg-white/3 border border-white/8 hover:border-white/15 transition-colors">
              {/* Info da oportunidade */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge className="bg-amber-400/15 text-amber-300 border-amber-400/30 text-xs">{item.opp.type}</Badge>
                  {item.opp.sector && <Badge className="bg-white/10 text-white/50 border-white/10 text-xs">{item.opp.sector}</Badge>}
                </div>
                <h4 className="text-sm font-semibold text-white">{item.opp.title}</h4>
                <p className="text-xs text-white/40 mt-0.5">Publicada por <strong className="text-white/60">{item.publisherName || item.publisherEmail}</strong></p>
                <p className="text-xs text-white/30 mt-2 line-clamp-2">{item.opp.description}</p>
              </div>

              {/* Botões de ação direta */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={validateMutation.isPending}
                  onClick={() => validateMutation.mutate({ opportunityId: item.opp.id, status: "approved" })}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold hover:bg-emerald-500/25 transition-all active:scale-95 disabled:opacity-50"
                >
                  <CheckCircle size={13} /> Aprovar
                </button>
                <button
                  disabled={validateMutation.isPending}
                  onClick={() => validateMutation.mutate({ opportunityId: item.opp.id, status: "rejected" })}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold hover:bg-red-500/25 transition-all active:scale-95 disabled:opacity-50"
                >
                  <XCircle size={13} /> Rejeitar
                </button>
                <button
                  onClick={() => { setRequestInfoDialog({ id: item.opp.id, title: item.opp.title, publisherName: item.publisherName || "" }); setInfoNeeded(""); }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-bold hover:bg-amber-500/25 transition-all active:scale-95"
                >
                  <Clock size={13} /> Solicitar Info
                </button>
              </div>

              {/* Preview das mensagens automáticas */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-emerald-400/60 font-semibold uppercase tracking-wider mb-1">Msg ao Aprovar:</p>
                  <p className="text-[11px] text-white/45 italic leading-relaxed line-clamp-2">{autoMessages.approved(item.publisherName || "Membra")}</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-red-400/60 font-semibold uppercase tracking-wider mb-1">Msg ao Rejeitar:</p>
                  <p className="text-[11px] text-white/45 italic leading-relaxed line-clamp-2">{autoMessages.rejected(item.publisherName || "Membra")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Solicitar Informações */}
      <Dialog open={!!requestInfoDialog} onOpenChange={() => setRequestInfoDialog(null)}>
        <DialogContent className="bg-[#0d1b2a] border-amber-400/30 text-white">
          <DialogHeader>
            <DialogTitle className="text-amber-400 flex items-center gap-2">
              <Clock size={16} /> Solicitar Informações Adicionais
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-white/60">
              Enviando solicitação para <strong className="text-white">{requestInfoDialog?.publisherName || "a publicadora"}</strong>.
            </p>
            <div>
              <label className="text-xs text-white/50 mb-1.5 block">O que você precisa que ela envie?</label>
              <Input
                value={infoNeeded}
                onChange={e => setInfoNeeded(e.target.value)}
                placeholder="ex: o detalhamento de custos / o cronograma / o portfólio"
                className="bg-white/5 border-white/15 text-white placeholder-white/30 text-sm"
              />
            </div>
            {infoNeeded.length >= 5 && (
              <div className="bg-amber-400/8 border border-amber-400/25 rounded-xl p-4">
                <p className="text-[11px] text-amber-400/70 uppercase tracking-wider font-semibold mb-2">Mensagem que será enviada:</p>
                <p className="text-sm text-white/80 leading-relaxed italic">
                  "Olá, {(requestInfoDialog?.publisherName || "Membra").split(" ")[0]}. Recebemos a sua proposta e temos interesse em avaliar melhor. Para seguirmos para a próxima etapa, você poderia nos enviar {infoNeeded}? Ficamos no aguardo."
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestInfoDialog(null)} className="bg-transparent border-white/20 text-white/60">Cancelar</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-[#060e1a] font-bold"
              disabled={infoNeeded.length < 5 || requestInfoMutation.isPending}
              onClick={() => requestInfoDialog && requestInfoMutation.mutate({ opportunityId: requestInfoDialog.id, infoNeeded })}
            >
              {requestInfoMutation.isPending ? "Enviando..." : "📤 Enviar Solicitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Módulo: Compliance ───────────────────────────────────────────────────────
function ComplianceTab() {
  const { data: stats } = trpc.president.getGovernanceStats.useQuery();
  const { data: allOpps } = trpc.president.listPendingOpportunities.useQuery();
  const { data: redFlags } = trpc.opportunities.list.useQuery({ complianceLevel: 'red', limit: 20 });

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={Shield}
        title="Supervisão de Compliance"
        subtitle="Visão geral da integridade e confiabilidade do ecossistema."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-emerald-400/8 border border-emerald-400/20">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="text-xs text-emerald-400/70 font-medium">Oportunidades Ativas</span>
          </div>
          <div className="text-3xl font-black text-emerald-400">{stats?.activeOpportunities ?? "—"}</div>
        </div>
        <div className="p-5 rounded-2xl bg-amber-400/8 border border-amber-400/20">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-amber-400" />
            <span className="text-xs text-amber-400/70 font-medium">Pendentes de Validação</span>
          </div>
          <div className="text-3xl font-black text-amber-400">{stats?.pendingOpportunities ?? "—"}</div>
        </div>
        <div className="p-5 rounded-2xl bg-red-400/8 border border-red-400/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-400" />
            <span className="text-xs text-red-400/70 font-medium">Alertas Vermelhos (IA)</span>
          </div>
          <div className="text-3xl font-black text-red-400">{stats?.redFlagOpportunities ?? "—"}</div>
        </div>
      </div>

      {/* Oportunidades de Alto Risco */}
      {redFlags && Array.isArray(redFlags) && redFlags.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-red-400/70 uppercase tracking-wider mb-3 flex items-center gap-2">
            <AlertTriangle size={13} /> Oportunidades com Baixa Confiabilidade — Ação Recomendada
          </h3>
          <div className="space-y-2">
            {(redFlags as Array<{ id: number; title: string; frauenTrustScore: number | null; sector: string | null }>).map((opp) => (
              <div key={opp.id} className="flex items-center justify-between p-4 rounded-xl bg-red-400/8 border border-red-400/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{opp.title}</p>
                  <p className="text-xs text-white/40">{opp.sector} {opp.frauenTrustScore != null ? `· Score: ${Math.round(opp.frauenTrustScore)}%` : ""}</p>
                </div>
                <Badge className="bg-red-400/15 text-red-300 border-red-400/30 text-xs ml-3 flex-shrink-0">🔴 Alto Risco</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Oportunidades Pendentes de Validação */}
      {allOpps && allOpps.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-400/70 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock size={13} /> Aguardando Validação
          </h3>
          <div className="space-y-2">
            {allOpps.map((item: { opp: { id: number; title: string; frauenTrustScore: number | null; sector: string | null }; publisherName: string | null; publisherEmail: string | null }) => (
              <div key={item.opp.id} className="flex items-center justify-between p-4 rounded-xl bg-amber-400/8 border border-amber-400/20">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{item.opp.title}</p>
                  <p className="text-xs text-white/40">{item.opp.sector} · Publicada por {item.publisherName || item.publisherEmail}</p>
                </div>
                <Badge className="bg-amber-400/15 text-amber-300 border-amber-400/30 text-xs ml-3 flex-shrink-0">🟠 Pendente</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-5 rounded-2xl bg-white/3 border border-white/8">
        <h3 className="text-sm font-semibold text-white mb-4">Legenda do Sistema de Compliance (IA)</h3>
        <div className="space-y-3">
          {[
            { color: "bg-emerald-400", label: "Verde — Altamente documentado", desc: "Oportunidade com documentação completa e verificável. Score acima de 80%." },
            { color: "bg-amber-400", label: "Amarelo — Boa documentação, precisa complementar", desc: "Score entre 50-79%. Documentação parcial, mas com boa base de confiança." },
            { color: "bg-orange-400", label: "Laranja — Pouco documentado, necessita validação", desc: "Score entre 20-49%. Requer atenção e documentação adicional antes de avançar." },
            { color: "bg-red-500", label: "Vermelho — Baixa confiabilidade", desc: "Score abaixo de 20%. Sinalizada pela IA como de alto risco. Revisão presidencial recomendada." },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className={`w-3 h-3 rounded-full ${item.color} mt-1 flex-shrink-0`} />
              <div>
                <p className="text-sm font-medium text-white">{item.label}</p>
                <p className="text-xs text-white/40">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function PresidentPanel() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  if (loading) return (
    <div className="min-h-screen bg-transparent flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
    </div>
  );

  if (!user || (user.role !== "president" && user.role !== "admin" && user.role !== "gold")) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <Lock size={40} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Acesso Restrito</h2>
          <p className="text-white/50 text-sm mb-6">Este painel é exclusivo para membras com Status Ouro.</p>
          <Button onClick={() => navigate("/dashboard")} className="bg-amber-400 hover:bg-amber-500 text-[#060e1a] font-bold">
            Voltar ao Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Visão Geral", icon: BarChart3 },
    { id: "gold", label: "Gestão Ouro", icon: Star },
    { id: "leaders", label: "Líderes", icon: Globe },
    { id: "opportunities", label: "Validações", icon: FileText },
    { id: "compliance", label: "Compliance", icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-transparent text-white">
      {/* Header */}
      <div className="border-b border-white/8 bg-[#0a1628]">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/dashboard")} className="text-white/40 hover:text-white transition-colors text-sm">
              ← Dashboard
            </button>
            <div className="w-px h-4 bg-white/15" />
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
                <Crown size={14} className="text-amber-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">Painel Ouro</h1>
                <p className="text-xs text-amber-400/70">MMM — Backoffice Institucional</p>
              </div>
            </div>
          </div>
          <Badge className="bg-amber-400/15 text-amber-300 border-amber-400/30 text-xs">
            <Crown size={10} className="mr-1" /> {user.role === "admin" ? "Admin" : "Ouro"}
          </Badge>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto pb-px">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap ${
                  isActive
                    ? "border-amber-400 text-amber-400"
                    : "border-transparent text-white/40 hover:text-white/70"
                }`}>
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "gold" && <GoldTab />}
        {activeTab === "leaders" && <LeadersTab />}
        {activeTab === "opportunities" && <OpportunitiesTab />}
        {activeTab === "compliance" && <ComplianceTab />}
      </div>
    </div>
  );
}
