import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageSquare, Users, Lock, Crown, ArrowLeft, Send, Search, Info } from "lucide-react";

export default function Connections() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"messages" | "groups">("messages");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState("");

  const isGold = user?.role === "gold" || user?.role === "admin" || user?.role === "president";

  // Queries
  const { data: messages, refetch: refetchMessages } = trpc.connections.getMessages.useQuery(
    { recipientId: selectedConversation! },
    { enabled: !!selectedConversation && isGold }
  );
  const { data: conversations } = trpc.connections.getConversations.useQuery(
    undefined,
    { enabled: isGold }
  );
  const { data: groups } = trpc.connections.getGroups.useQuery(
    undefined,
    { enabled: isGold }
  );

  // Mutations
  const sendMessageMutation = trpc.connections.sendMessage.useMutation({
    onSuccess: () => {
      setNewMessage("");
      refetchMessages();
      toast.success(t("connections.messageSent"));
    },
    onError: (err: any) => toast.error(err.message || t("connections.sendMessageError")),
  });

  if (!isGold) {
    return (
      <div className="min-h-screen bg-transparent text-white flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-700/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-6">
            <Lock className="w-10 h-10 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-amber-400 mb-3">{t("connections.goldRestrictedTitle")}</h2>
          <p className="text-gray-400 mb-6 leading-relaxed">
            {t("connections.goldRestrictedDescription")}
          </p>
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6 text-left">
            <p className="text-amber-300 text-sm font-medium mb-2">{t("connections.goldAccessListTitle")}</p>
            <ul className="text-gray-400 text-sm space-y-1">
              <li>• {t("connections.goldAccessItemMessages")}</li>
              <li>• {t("connections.goldAccessItemGroups")}</li>
              <li>• {t("connections.goldAccessItemInterest")}</li>
              <li>• {t("connections.goldAccessItemProfiles")}</li>
            </ul>
          </div>
          <Button
            onClick={() => navigate("/dashboard")}
            className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("connections.backToDashboard")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-black/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="text-gray-400 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                {t("connections.title")}
              </h1>
              <p className="text-xs text-amber-400">{t("connections.goldExclusiveSubtitle")}</p>
            </div>
          </div>
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
            <Crown className="w-3 h-3 mr-1" />
            {t("connections.goldBadge")}
          </Badge>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <Button
            onClick={() => setActiveTab("messages")}
            variant={activeTab === "messages" ? "default" : "ghost"}
            className={activeTab === "messages"
              ? "bg-amber-500 text-black hover:bg-amber-600"
              : "text-gray-400 hover:text-white"
            }
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            {t("connections.tabMessages")}
          </Button>
          <Button
            onClick={() => setActiveTab("groups")}
            variant={activeTab === "groups" ? "default" : "ghost"}
            className={activeTab === "groups"
              ? "bg-amber-500 text-black hover:bg-amber-600"
              : "text-gray-400 hover:text-white"
            }
          >
            <Users className="w-4 h-4 mr-2" />
            {t("connections.tabGroups")}
          </Button>
        </div>

        {activeTab === "messages" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Lista de conversas */}
            <div className="lg:col-span-1">
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-gray-400">{t("connections.conversationsTitle")}</CardTitle>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      placeholder={t("connections.searchPlaceholder")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 bg-white/5 border-white/10 text-white text-sm"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {!conversations || conversations.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>{t("connections.noConversations")}</p>
                      <p className="text-xs mt-1">{t("connections.noConversationsHint")}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {conversations
                        .filter((c: any) => !searchQuery || c.otherUser?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map((conv: any) => (
                          <button
                            key={conv.userId}
                            onClick={() => setSelectedConversation(conv.userId)}
                            className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors ${selectedConversation === conv.userId ? "bg-amber-500/10 border-l-2 border-amber-500" : ""}`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500/30 to-amber-700/30 flex items-center justify-center text-amber-400 font-bold text-sm flex-shrink-0">
                                {conv.otherUser?.name?.[0] ?? "?"}
                              </div>
                              <div className="min-w-0">
                                <p className="text-white text-sm font-medium truncate">{conv.otherUser?.name ?? t("connections.defaultUserName")}</p>
                                <p className="text-gray-500 text-xs truncate">{conv.lastMessage ?? t("connections.noMessagesPlaceholder")}</p>
                              </div>
                              {conv.unread > 0 && (
                                <Badge className="ml-auto bg-amber-500 text-black text-xs px-1.5 py-0.5 min-w-[20px] text-center">
                                  {conv.unread}
                                </Badge>
                              )}
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Área de mensagens */}
            <div className="lg:col-span-2">
              {!selectedConversation ? (
                <Card className="bg-white/5 border-white/10 h-full min-h-[400px] flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">{t("connections.selectConversationPrompt")}</p>
                  </div>
                </Card>
              ) : (
                <Card className="bg-white/5 border-white/10 flex flex-col" style={{ minHeight: "500px" }}>
                  <CardHeader className="border-b border-white/10 pb-3">
                    <CardTitle className="text-sm text-white">
                      {conversations?.find((c: any) => c.userId === selectedConversation)?.otherUser?.name ?? t("connections.defaultConversationTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
                    {!messages || messages.length === 0 ? (
                      <div className="text-center text-gray-500 text-sm py-8">
                        <p>{t("connections.emptyChat")}</p>
                      </div>
                    ) : (
                      messages.map((msg: any) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.senderId === user?.id ? "justify-end" : "justify-start"}`}
                        >
                          <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                            msg.senderId === user?.id
                              ? "bg-amber-500 text-black"
                              : "bg-white/10 text-white"
                          }`}>
                            <p>{msg.content}</p>
                            <p className={`text-xs mt-1 ${msg.senderId === user?.id ? "text-black/60" : "text-gray-500"}`}>
                              {new Date(msg.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                  <div className="border-t border-white/10 p-4 flex gap-2">
                    <Textarea
                      placeholder={t("connections.messagePlaceholder")}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      className="bg-white/5 border-white/10 text-white text-sm resize-none"
                      rows={2}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (newMessage.trim()) {
                            sendMessageMutation.mutate({ recipientId: selectedConversation, content: newMessage.trim() });
                          }
                        }
                      }}
                    />
                    <Button
                      onClick={() => {
                        if (newMessage.trim()) {
                          sendMessageMutation.mutate({ recipientId: selectedConversation, content: newMessage.trim() });
                        }
                      }}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      className="bg-amber-500 hover:bg-amber-600 text-black self-end"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {activeTab === "groups" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{t("connections.tabGroups")}</h2>
              <Button
                className="bg-amber-500 hover:bg-amber-600 text-black text-sm"
                onClick={() => toast.info(t("connections.groupsComingSoon"))}
              >
                <Users className="w-4 h-4 mr-2" />
                {t("connections.createGroupButton")}
              </Button>
            </div>

            {!groups || groups.length === 0 ? (
              <Card className="bg-white/5 border-white/10">
                <CardContent className="py-16 text-center">
                  <Users className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                  <p className="text-gray-400 font-medium mb-2">{t("connections.noGroups")}</p>
                  <p className="text-gray-600 text-sm max-w-sm mx-auto">
                    {t("connections.noGroupsHint")}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {groups.map((group: any) => (
                  <Card key={group.id} className="bg-white/5 border-white/10 hover:border-amber-500/30 transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-700/20 flex items-center justify-center">
                          <Users className="w-5 h-5 text-amber-400" />
                        </div>
                        <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400">
                          {t("connections.membersCount", { count: group.memberCount ?? 0 })}
                        </Badge>
                      </div>
                      <h3 className="text-white font-medium mb-1">{group.name}</h3>
                      <p className="text-gray-500 text-xs">{group.description ?? t("connections.defaultGroupDescription")}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
