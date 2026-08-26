import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

// ─── Tipos ───────────────────────────────────────────────────────────────────
type Notification = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  isRead: boolean | null;
  createdAt: Date;
};

// ─── Ícone por tipo de notificação ───────────────────────────────────────────
function NotifIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    gold_granted: "⭐",
    gold_revoked: "🔻",
    opportunity_approved: "✅",
    opportunity_rejected: "❌",
    new_match: "⚡",
    interest_received: "💬",
    compliance_update: "🛡️",
    system: "📎",
    new_message: "✉️",
  };
  return <span className="text-base">{icons[type] ?? "🔔"}</span>;
}

// ─── Formatar tempo relativo ──────────────────────────────────────────────────
function timeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const notificationsQuery = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 30_000, // poll a cada 30s
    staleTime: 15_000,
  });
  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => notificationsQuery.refetch(),
  });

  const notifications: Notification[] = (notificationsQuery.data || []) as Notification[];
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Animar sino quando chegar nova notificação
  useEffect(() => {
    if (unreadCount > 0) {
      setAnimating(true);
      const t = setTimeout(() => setAnimating(false), 800);
      return () => clearTimeout(t);
    }
  }, [unreadCount]);

  // Fechar ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setOpen((o) => !o);
  };

  const handleMarkAllRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    markAllReadMutation.mutate();
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Botão sino */}
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/8 transition-colors duration-200"
        title="Notificações"
        style={{ color: unreadCount > 0 ? "#f5a623" : "rgba(255,255,255,0.45)" }}
      >
        {/* Ícone sino SVG */}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            animation: animating ? "bellShake 0.6s cubic-bezier(0.36,0.07,0.19,0.97)" : "none",
            transformOrigin: "top center",
          }}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Badge de contagem */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center text-[9px] font-black text-[#060e1a] rounded-full min-w-[16px] h-4 px-1"
            style={{
              background: "linear-gradient(135deg, #f5a623, #ffd166)",
              animation: "badgePop 0.3s cubic-bezier(0.23,1,0.32,1)",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Overlay para fechar */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div
            className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl overflow-hidden shadow-2xl shadow-black/50"
            style={{
              background: "linear-gradient(180deg, #0d1b2e 0%, #0a1628 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
              animation: "dropdownIn 0.2s cubic-bezier(0.23,1,0.32,1)",
              transformOrigin: "top right",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Notificações</span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#f5a623]/20 text-[#f5a623] border border-[#f5a623]/30">
                    {unreadCount} nova{unreadCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-white/35 hover:text-white/70 transition-colors"
                >
                  Marcar todas como lidas
                </button>
              )}
            </div>

            {/* Lista de notificações */}
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="text-3xl mb-2">🔔</div>
                  <p className="text-white/30 text-xs">Nenhuma notificação ainda</p>
                </div>
              ) : (
                notifications.slice(0, 20).map((notif, i) => (
                  <NotifItem
                    key={notif.id}
                    notif={notif}
                    index={i}
                    onClose={() => setOpen(false)}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-white/8 px-4 py-2.5 text-center">
                <Link href="/dashboard" onClick={() => setOpen(false)}>
                  <span className="text-[11px] text-[#f5a623]/70 hover:text-[#f5a623] transition-colors cursor-pointer">
                    Ver todas as notificações
                  </span>
                </Link>
              </div>
            )}
          </div>
        </>
      )}

      {/* Keyframes injetados via style tag */}
      <style>{`
        @keyframes bellShake {
          0%, 100% { transform: rotate(0deg); }
          15% { transform: rotate(12deg); }
          30% { transform: rotate(-10deg); }
          45% { transform: rotate(8deg); }
          60% { transform: rotate(-6deg); }
          75% { transform: rotate(4deg); }
          90% { transform: rotate(-2deg); }
        }
        @keyframes badgePop {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes dropdownIn {
          0% { opacity: 0; transform: scale(0.95) translateY(-8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes notifSlideIn {
          0% { opacity: 0; transform: translateX(12px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Item de notificação ──────────────────────────────────────────────────────
function NotifItem({ notif, index, onClose }: { notif: Notification; index: number; onClose: () => void }) {
  const isUnread = !notif.isRead;

  const content = (
    <div
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 ${
        isUnread ? "bg-[#f5a623]/4 hover:bg-[#f5a623]/8" : "hover:bg-white/4"
      }`}
      style={{
        animation: `notifSlideIn 0.25s cubic-bezier(0.23,1,0.32,1) ${index * 30}ms both`,
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Ícone */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5"
        style={{ background: isUnread ? "rgba(245,166,35,0.12)" : "rgba(255,255,255,0.05)" }}>
        <NotifIcon type={notif.type} />
      </div>

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-xs font-semibold leading-tight ${isUnread ? "text-white" : "text-white/60"}`}>
            {notif.title}
          </p>
          {isUnread && (
            <div className="w-1.5 h-1.5 rounded-full bg-[#f5a623] flex-shrink-0 mt-1" />
          )}
        </div>
        {notif.body && (
          <p className="text-[11px] text-white/40 mt-0.5 leading-relaxed line-clamp-2">
            {notif.body}
          </p>
        )}
        <p className="text-[10px] text-white/25 mt-1">
          {timeAgo(notif.createdAt)}
        </p>
      </div>
    </div>
  );

  if (notif.actionUrl) {
    return (
      <Link href={notif.actionUrl} onClick={onClose}>
        {content}
      </Link>
    );
  }
  return content;
}
