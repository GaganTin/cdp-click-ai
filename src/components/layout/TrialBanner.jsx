import { Link } from "react-router-dom";
import { AlertTriangle, Zap, X } from "lucide-react";
import { useState } from "react";
import { usePlan } from "@/lib/usePlan";

const STORAGE_KEY = "trial-banner-dismissed";

function readDismissed() {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}
function writeDismissed() {
  try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
}

export default function TrialBanner() {
  const { isFreePlan, isLoadingPlans, isTrialExpired, daysLeft, warningDays, upgradePlan } = usePlan();
  const [dismissed, setDismissed] = useState(readDismissed);

  // Don't render while plan data is loading- prevents the banner flashing in
  // then disappearing once the real plan/daysLeft values arrive.
  if (isLoadingPlans) return null;
  if (!isFreePlan) return null;

  // Paid upgrades are "contact sales" (no in-app price), so the period is blank.
  const upgradeLabel = upgradePlan
    ? (upgradePlan.period
        ? `${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
        : upgradePlan.name)
    : "a paid plan";

  // Trial expired: always visible, no dismiss
  if (isTrialExpired) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm">
        <div className="flex items-center gap-2 text-destructive font-medium">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Your free trial has ended. Upgrade to continue using features.
        </div>
        <Link
          to="/settings?tab=billing"
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 bg-destructive text-destructive-foreground text-xs font-semibold rounded-md hover:bg-destructive/90 transition-colors"
        >
          <Zap className="w-3 h-3" />
          Upgrade now
        </Link>
      </div>
    );
  }

  // Dismissed (persisted in localStorage so it survives navigation and refresh)
  if (dismissed) return null;

  const isUrgent = daysLeft <= warningDays;

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b text-sm ${
      isUrgent
        ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800"
        : "bg-secondary border-border"
    }`}>
      <div className={`flex items-center gap-2 ${isUrgent ? "text-yellow-800 dark:text-yellow-300" : "text-muted-foreground"}`}>
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {daysLeft === 0
          ? "Your free trial expires today."
          : daysLeft <= warningDays
          ? `Your free trial expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`
          : "You're on the free plan."}
        {" "}Upgrade to unlock full access.
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          to="/settings?tab=billing"
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-xs font-semibold rounded-md hover:bg-foreground/80 transition-colors"
        >
          <Zap className="w-3 h-3" />
          Upgrade to {upgradeLabel}
        </Link>
        <button
          onClick={() => { writeDismissed(); setDismissed(true); }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
