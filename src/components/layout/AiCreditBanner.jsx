import { Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Zap, X } from "lucide-react";
import { appClient } from "@/api/appClient";
import { usePlan } from "@/lib/usePlan";
import { toCredits } from "@/lib/credits";

// Proactive heads-up when the account nears (>=90%) or hits (100%) its billing-
// period AI credit limit, so users aren't surprised when AI features start getting
// blocked (enforced server-side via app.ai_quota — paid plans reset on their
// billing-day anniversary, trials get one flat allowance for the whole trial).
// Dismissal is keyed by month + severity bucket so: closing the "running low" note
// doesn't suppress the later "used up" note, and both reappear over time. Mirrors
// TrialBanner.
const WARN_AT = 90;
const monthKey = () => { try { return new Date().toISOString().slice(0, 7); } catch { return "x"; } };
const KEY = (bucket) => `ai-credit-banner:${monthKey()}:${bucket}`;
const isDismissed = (bucket) => { try { return localStorage.getItem(KEY(bucket)) === "true"; } catch { return false; } };
const dismiss = (bucket) => { try { localStorage.setItem(KEY(bucket), "true"); } catch {} };

export default function AiCreditBanner() {
  const { isTrialExpired, inTrial } = usePlan();
  const { data } = useQuery({
    queryKey: ["ai-quota"],
    queryFn: () => appClient.billing.getAiQuota(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  // Local bump so dismissing re-renders immediately (localStorage alone won't).
  const [, force] = useState(0);

  // Nothing to show: still loading, unlimited plan (pct null), or below threshold.
  if (!data || data.limit == null || data.pct == null || data.pct < WARN_AT) return null;
  // Trial-expired accounts already get the (red) TrialBanner + AI is blocked by the
  // trial gate; don't stack a second red banner on top.
  if (isTrialExpired) return null;

  const bucket = data.over ? "over" : "warn";
  if (isDismissed(bucket)) return null;

  const usedC = toCredits(data.used).toLocaleString();
  const limitC = toCredits(data.limit).toLocaleString();
  const styles = data.over
    ? "bg-destructive/10 border-destructive/20 text-destructive"
    : "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/30 dark:border-yellow-800 dark:text-yellow-300";

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b text-sm ${styles}`}>
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">
          {data.over
            ? (inTrial
                ? `You've used all ${limitC} of your free trial AI credits (${usedC} / ${limitC}). AI features are paused — purchase a plan to keep using them.`
                : `You've used all your AI credits for this billing period (${usedC} / ${limitC}). AI features are paused until your credits reset next billing month.`)
            : `You've used ${data.pct}% of your AI credits (${usedC} / ${limitC}). ${inTrial ? "Purchase a plan" : "Upgrade"} to avoid interruptions.`}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          to="/settings?tab=billing"
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-xs font-semibold rounded-md hover:bg-foreground/80 transition-colors whitespace-nowrap"
        >
          <Zap className="w-3 h-3" /> Upgrade
        </Link>
        <button
          onClick={() => { dismiss(bucket); force((n) => n + 1); }}
          className="opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
