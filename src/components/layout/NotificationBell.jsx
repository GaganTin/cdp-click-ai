import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, Mail, RefreshCw, UserPlus, Check, CheckCheck, X, Trash2,
} from "lucide-react";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";
import { usePreferences } from "@/lib/PreferencesContext";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// One icon per notification type (keys match app.notifications.type).
const TYPE_ICON = {
  campaign_completed: Mail,
  sync_status:        RefreshCw,
  new_leads:          UserPlus,
};

// Sync notifications carry metadata.trigger ("manual" | "daily") so we can tell a
// user-triggered sync apart from the scheduled daily run. Returns null for others.
function syncTrigger(n) {
  if (n.type !== "sync_status") return null;
  const trig = n.metadata?.trigger;
  if (trig === "daily" || n.metadata?.scheduled) return "daily";
  if (trig === "manual") return "manual";
  return null;
}

function relativeTime(val) {
  if (!val) return "";
  const diff = Date.now() - new Date(val).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(val).toLocaleDateString();
}

export default function NotificationBell({ collapsed = false }) {
  const { currentCompany } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Poll every 60s so the badge stays fresh without a socket.
  const { data } = useQuery({
    queryKey: ["notifications", currentCompany?.id],
    queryFn: () => appClient.notifications.list({ limit: 20 }),
    enabled: !!currentCompany?.id,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const notifications = data?.notifications ?? [];
  const unread = data?.unread_count ?? 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications", currentCompany?.id] });

  const markRead = useMutation({ mutationFn: (id) => appClient.notifications.markRead(id), onSuccess: invalidate });
  const markAll  = useMutation({ mutationFn: () => appClient.notifications.markAllRead(), onSuccess: invalidate });
  const removeOne = useMutation({ mutationFn: (id) => appClient.notifications.remove(id), onSuccess: invalidate });
  const clearAll  = useMutation({ mutationFn: () => appClient.notifications.clearAll(), onSuccess: invalidate });

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const onItemClick = (n) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={t("Notifications")}
        className={cn(
          "relative flex items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors",
          collapsed ? "justify-center p-2.5 w-full" : "w-full gap-3 px-3 py-2.5"
        )}
      >
        <span className="relative flex-shrink-0">
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className={cn(
              "absolute flex items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold",
              collapsed
                ? "-top-1 -right-1 w-2 h-2 p-0"
                : "-top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 text-[9px] leading-none"
            )}>
              {!collapsed && (unread > 9 ? "9+" : unread)}
            </span>
          )}
        </span>
        {!collapsed && <span className="text-sm font-medium flex-1 text-left">{t("Notifications")}</span>}
        {!collapsed && unread > 0 && (
          <span className="text-[10px] font-semibold text-primary">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute z-50 bottom-full mb-1 w-80 bg-popover border border-border rounded-lg shadow-lg overflow-hidden",
          collapsed ? "left-full ml-1 bottom-0 mb-0" : "left-0"
        )}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <p className="text-sm font-semibold">{t("Notifications")}</p>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {t("Mark all read")}
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => clearAll.mutate()}
                  disabled={clearAll.isPending}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("Clear all")}
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
                <p className="text-sm text-muted-foreground">{t("You're all caught up.")}</p>
              </div>
            ) : (
              // Items are truncated to keep the list compact; hovering shows the full
              // title + body in a portaled tooltip (escapes this panel's overflow).
              <TooltipProvider delayDuration={250}>
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] || Bell;
                const trigger = syncTrigger(n);
                return (
                  <Tooltip key={n.id}>
                    <TooltipTrigger asChild>
                  <button
                    onClick={() => onItemClick(n)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 px-3 py-3 border-b border-border/60 last:border-0 hover:bg-secondary/60 transition-colors",
                      !n.is_read && "bg-yellow-50 dark:bg-yellow-950/20"
                    )}
                  >
                    <span className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
                      n.is_read ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary"
                    )}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("text-sm truncate", n.is_read ? "font-medium" : "font-semibold")}>{n.title}</span>
                        {trigger && (
                          <span className="flex-shrink-0 rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {trigger === "daily" ? t("Daily") : t("Manual")}
                          </span>
                        )}
                        {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                      </span>
                      {n.body && <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</span>}
                      <span className="block text-[11px] text-muted-foreground/70 mt-1">{relativeTime(n.created_date)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                      {!n.is_read && (
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                          title={t("Mark read")}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); removeOne.mutate(n.id); }}
                        title={t("Clear")}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </span>
                    </span>
                  </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="start" collisionPadding={8}
                      className="max-w-xs whitespace-normal break-words bg-popover text-popover-foreground border border-border shadow-lg p-3">
                      <p className="text-sm font-semibold mb-0.5">{n.title}</p>
                      {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                      <p className="text-[11px] text-muted-foreground/70 mt-1.5">{relativeTime(n.created_date)}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              </TooltipProvider>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
