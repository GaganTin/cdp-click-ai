import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, CheckCircle2, AlertTriangle, Wrench, X } from "lucide-react";
import { appClient } from "@/api/appClient";

// Per-announcement dismissal persisted in localStorage (keyed by id) so a closed
// banner stays closed across navigation/refresh - mirrors TrialBanner's approach.
const KEY = (id) => `announcement-dismissed:${id}`;
function isDismissed(id) {
  try { return localStorage.getItem(KEY(id)) === "true"; } catch { return false; }
}
function dismiss(id) {
  try { localStorage.setItem(KEY(id), "true"); } catch {}
}

// Monochrome-friendly styling per level. `maintenance` and `warning` get the
// attention treatment; info/success stay quiet.
const LEVEL = {
  info:        { icon: Info,         cls: "bg-secondary/60 border-border text-foreground" },
  success:     { icon: CheckCircle2, cls: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300" },
  warning:     { icon: AlertTriangle, cls: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-300" },
  maintenance: { icon: Wrench,       cls: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-300" },
};

export default function AnnouncementBanner() {
  // Refetch periodically so a freshly-published or expired announcement appears/
  // disappears without a full reload.
  const { data } = useQuery({
    queryKey: ["announcements", "active"],
    queryFn: () => appClient.announcements.listActive(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Track local dismissals so closing re-renders immediately (localStorage alone
  // wouldn't trigger React).
  const [, force] = useState(0);

  const announcements = (data || []).filter((a) => !(a.dismissible && isDismissed(a.id)));
  if (!announcements.length) return null;

  return (
    <>
      {announcements.map((a) => {
        const { icon: Icon, cls } = LEVEL[a.level] || LEVEL.info;
        return (
          <div key={a.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b text-sm ${cls}`}>
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">
                {a.title && <span className="font-semibold">{a.title} </span>}
                {a.body}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {a.link_url && (
                <a
                  href={a.link_url}
                  target={/^https?:\/\//.test(a.link_url) ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="font-semibold underline underline-offset-2 hover:opacity-80 whitespace-nowrap"
                >
                  {a.link_label || "Learn more"}
                </a>
              )}
              {a.dismissible && (
                <button
                  onClick={() => { dismiss(a.id); force((n) => n + 1); }}
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
