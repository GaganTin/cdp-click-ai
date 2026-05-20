import { Link } from "react-router-dom";
import { AlertTriangle, Zap, X } from "lucide-react";
import { useState } from "react";
import { usePlan } from "@/lib/usePlan";

export default function TrialBanner() {
  const { isFreePlan, isTrialExpired, daysLeft, warningDays, upgradePlan } = usePlan();
  const [dismissed, setDismissed] = useState(false);

  if (!isFreePlan || dismissed) return null;

  const upgradeLabel = upgradePlan
    ? `${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
    : "a paid plan";

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

  if (daysLeft > warningDays) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-sm">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {daysLeft === 0
          ? "Your free trial expires today."
          : `Your free trial expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
        {" "}Upgrade to keep full access.
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          to="/settings?tab=billing"
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 text-white text-xs font-semibold rounded-md hover:bg-amber-700 transition-colors"
        >
          <Zap className="w-3 h-3" />
          Upgrade to {upgradeLabel}
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600 hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
