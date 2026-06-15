import { MailWarning, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";

// Dismissal is session-scoped (not localStorage) so the nudge returns next session
// until the user actually verifies - verification matters more than a trial reminder.
const STORAGE_KEY = "email-verify-banner-dismissed";

function readDismissed() {
  try { return sessionStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}

export default function EmailVerifyBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [sending, setSending] = useState(false);

  if (!user || user.is_email_verified || dismissed) return null;

  const resend = async () => {
    setSending(true);
    try {
      const r = await appClient.auth.resendVerification();
      if (r?.already_verified) toast.success("Your email is already verified.");
      else if (r?.sent) toast.success("Verification email sent - check your inbox.");
      else toast.error(r?.error ? `Couldn't send the email: ${r.error}` : "We couldn't send the email. Please try again shortly.");
    } catch (e) {
      toast.error(e?.message || "Couldn't send verification email.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 text-sm">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
        <MailWarning className="w-4 h-4 flex-shrink-0" />
        <span>
          Please verify your email{user.email ? ` (${user.email})` : ""} to secure your account.
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={resend}
          disabled={sending}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-foreground text-background text-xs font-semibold rounded-md hover:bg-foreground/80 disabled:opacity-50 transition-colors"
        >
          {sending ? "Sending…" : "Resend email"}
        </button>
        <button
          onClick={() => {
            try { sessionStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
            setDismissed(true);
          }}
          className="text-amber-800/70 dark:text-amber-300/70 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
