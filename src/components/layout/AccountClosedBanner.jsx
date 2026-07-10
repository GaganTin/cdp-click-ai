import { AlertTriangle, Mail } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

/**
 * Shown when the account has been CLOSED by the retention purge: 6 months after an
 * unconverted trial ended, all workspace data is deleted and app.accounts.is_active
 * flips to false (see server/lib/billingLifecycle.js). The account + owner user
 * shell survives (so the email stays registered), but there is nothing left to use
 * until they subscribe again.
 *
 * Driven by the ACCOUNT-level flag from /auth/me (user.account_is_active), not the
 * current workspace - a closed account may still land on the shared demo workspace
 * or on the workspace selector, and the banner must show in both. Non-dismissible.
 * Reactivation is sales-driven (no in-app payment flow), so the CTA is a mailto.
 */
export default function AccountClosedBanner() {
  const { user } = useAuth();
  // Only render once the retention purge has actually run (account_purged) AND the
  // account is still inactive. This avoids the "data deleted" wording for a plain
  // platform-admin deactivation, and hides the banner if sales later reactivates.
  if (!user || user.account_is_active !== false || user.account_purged !== true) return null;

  const isOwner = !!user.is_account_owner;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20 text-sm">
      <div className="flex items-center gap-2 text-destructive font-medium">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        {isOwner
          ? "Your account has been closed and its data deleted. Reactivate by subscribing to a plan."
          : "This account has been closed and its data deleted. Contact your account owner to reactivate."}
      </div>
      {isOwner && (
        <a
          href="mailto:support@clickcdp.com?subject=Reactivate my account"
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 bg-destructive text-destructive-foreground text-xs font-semibold rounded-md hover:bg-destructive/90 transition-colors"
        >
          <Mail className="w-3 h-3" />
          Reactivate
        </a>
      )}
    </div>
  );
}
