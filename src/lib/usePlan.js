import { useAuth } from "@/lib/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";

export function usePlan() {
  const { currentCompany } = useAuth();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: appClient.plans.list,
    staleTime: 10 * 60 * 1000,
  });

  const planId = currentCompany?.plan ?? "free";
  const planConfig = plans.find(p => p.id === planId) ?? null;

  // The next tier up (used by upgrade prompts so they always reference the right plan name/price)
  const upgradePlan = plans
    .filter(p => p.sort_order > (planConfig?.sort_order ?? 0) && p.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

  const trialDays = planConfig?.trial_days ?? null;
  const warningDays = planConfig?.warning_days ?? 7;
  const limits = planConfig?.limits ?? {};

  const createdDate = currentCompany?.created_date ? new Date(currentCompany.created_date) : null;
  const trialExpiresAt = createdDate && trialDays
    ? new Date(createdDate.getTime() + trialDays * 24 * 60 * 60 * 1000)
    : null;

  const isFreePlan = planId === "free";
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
    isProPlan: planId === "pro",
    isEnterprise: planId === "enterprise",
    isTrialExpired,
    daysLeft,
    warningDays,
    trialExpiresAt,
    canUseFeatures,
    limits,
    isUnlimited,
  };
}
