import { Link } from "react-router-dom";
import { Lock, Zap } from "lucide-react";
import { usePlan } from "@/lib/usePlan";

/**
 * Wraps a feature that requires an active plan.
 * When the free trial has expired, renders an upgrade prompt instead.
 * All copy is derived from the DB - no prices hardcoded here.
 *
 * Props:
 *  - children   : the real feature UI (optional - omit to render standalone upgrade wall)
 *  - feature    : short label shown in the lock message (e.g. "AI Analyst")
 *  - inline     : render a small inline lock badge instead of a full-page wall
 */
export default function PlanGate({ children = null, feature = "this feature", inline = false }) {
  const { canUseFeatures, upgradePlan } = usePlan();

  if (canUseFeatures) return children;

  const upgradeLabel = upgradePlan
    ? (upgradePlan.period
        ? `Upgrade to ${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
        : `Upgrade to ${upgradePlan.name}`)
    : "Upgrade your plan";

  if (inline) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-not-allowed select-none">
        <Lock className="w-3 h-3" />
        Upgrade to unlock
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
        <Lock className="w-5 h-5 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-base">Your free trial has ended</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Upgrade to continue using {feature}. Your data is safe - nothing has been deleted.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {upgradePlan && (
          <Link
            to="/settings?tab=billing"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Zap className="w-4 h-4" />
            {upgradeLabel}
          </Link>
        )}
        <a
          href={upgradePlan?.cta_external ? upgradePlan.cta_href : "mailto:support@clickcdp.com?subject=Upgrade to Paid"}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Contact sales
        </a>
      </div>
    </div>
  );
}

/**
 * Wraps a button/action that requires an active plan.
 * When expired, disables the action and shows an upgrade link.
 */
export function PlanGatedButton({ children, onClick, className = "", disabled = false, ...props }) {
  const { canUseFeatures } = usePlan();

  if (!canUseFeatures) {
    return (
      <Link
        to="/settings?tab=billing"
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${className} opacity-60 cursor-not-allowed`}
        title="Your free trial has ended - upgrade to continue"
        onClick={e => e.stopPropagation()}
      >
        <Lock className="w-3.5 h-3.5 flex-shrink-0" />
        {children}
      </Link>
    );
  }

  return (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  );
}
