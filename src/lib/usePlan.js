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
  const planId = user?.account_plan ?? currentCompany?.plan ?? "free";
  const planConfig = plans.find(p => p.id === planId) ?? null;

  // The next tier up (used by upgrade prompts so they always reference the right plan name/price)
  const upgradePlan = plans
    .filter(p => p.sort_order > (planConfig?.sort_order ?? 0) && p.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

  const trialDays = planConfig?.trial_days ?? null;
  const warningDays = planConfig?.warning_days ?? 7;
  const limits = planConfig?.limits ?? {};

  // Authoritative trial end is the account's stored plan_expires_at; only fall back
  // to (workspace created_date + trial_days) when the server value is absent.
  const planExpiresAt = user?.account_plan_expires_at ? new Date(user.account_plan_expires_at) : null;
  const createdDate = currentCompany?.created_date ? new Date(currentCompany.created_date) : null;
  const trialExpiresAt = planExpiresAt
    ?? (createdDate && trialDays
      ? new Date(createdDate.getTime() + trialDays * 24 * 60 * 60 * 1000)
      : null);

  const isFreePlan = planId === "free";
  const isPaidPlan = planId === "paid";
  // When the account moved onto the paid plan (null while on free).
  const upgradedAt = user?.account_plan_upgraded_at ? new Date(user.account_plan_upgraded_at) : null;
  const isTrialExpired = isFreePlan && trialExpiresAt ? new Date() > trialExpiresAt : false;
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
