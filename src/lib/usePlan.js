import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";

export function usePlan() {
  const { currentCompany, user } = useAuth();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: appClient.plans.list,
    staleTime: 10 * 60 * 1000,
  });

  // account_plan is authoritative (billing); currentCompany.plan is a denormalised copy.
  const planId = user?.account_plan ?? currentCompany?.plan ?? "lite";
  const planConfig = plans.find(p => p.id === planId) ?? null;

  // The next tier up (used by upgrade prompts so they always reference the right plan name/price)
  const upgradePlan = plans
    .filter(p => p.sort_order > (planConfig?.sort_order ?? 0) && p.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

  const trialDays = planConfig?.trial_days ?? null;
  const warningDays = planConfig?.warning_days ?? 7;
  const limits = planConfig?.limits ?? {};

  // plan_expires_at is the sole "in trial" marker (null/absent => paid) and is
  // authoritative. Only fall back to (created_date + trial_days) when the server
  // field is entirely ABSENT (legacy /me responses) - never when it is explicitly
  // null, or a paid account on a trial-capable tier (e.g. a paying Lite customer,
  // whose tier still has trial_days=90) would be mis-read as an expired trial.
  const rawExpiry = user?.account_plan_expires_at;
  const planExpiresAt = rawExpiry ? new Date(rawExpiry) : null;
  const createdDate = currentCompany?.created_date ? new Date(currentCompany.created_date) : null;
  const trialExpiresAt = planExpiresAt
    ?? (rawExpiry === undefined && createdDate && trialDays
      ? new Date(createdDate.getTime() + trialDays * 24 * 60 * 60 * 1000)
      : null);

  // Trial state is tier-agnostic: an account is "in trial" iff it has an expiry.
  const inTrial = !!trialExpiresAt;
  // Back-compat aliases: 'free' used to mean "on the trial plan" and 'paid' the
  // converted plan; both now map to trial state, not a literal plan id.
  const isFreePlan = inTrial;
  const isPaidPlan = !inTrial;
  // When the trial converted to paid (null while still on a trial).
  const upgradedAt = user?.account_plan_upgraded_at ? new Date(user.account_plan_upgraded_at) : null;
  const isTrialExpired = trialExpiresAt ? new Date() > trialExpiresAt : false;
  const daysLeft = trialExpiresAt
    ? Math.max(0, Math.ceil((trialExpiresAt - new Date()) / (24 * 60 * 60 * 1000)))
    : 0;

  // While plans are loading, optimistically allow features (avoids flash-of-locked-UI)
  const canUseFeatures = isLoading ? true : !isTrialExpired;

  // null in limits means unlimited
  const isUnlimited = (key) => limits[key] === null || limits[key] === undefined;

  return {
    plan: planId,
    planConfig,
    upgradePlan,
    plans,
    isLoadingPlans: isLoading,
    inTrial,
    isFreePlan,
    isPaidPlan,
    upgradedAt,
    isTrialExpired,
    daysLeft,
    warningDays,
    trialExpiresAt,
    canUseFeatures,
    limits,
    isUnlimited,
  };
}
