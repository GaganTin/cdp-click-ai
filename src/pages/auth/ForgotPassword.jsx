import { useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { Mail, ArrowLeft } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [debugToken, setDebugToken] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await appClient.auth.forgotPassword(email);
      setSent(true);
      // Dev-only: show token directly in UI
      if (result?.debug_reset_token) setDebugToken(result.debug_reset_token);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={sent ? "Check your email" : "Reset your password"}
      subtitle={sent ? `We sent a reset link to ${email}` : "Enter your email and we'll send you a reset link"}
    >
      {sent ? (
        <div className="space-y-6">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto">
            <Mail className="w-7 h-7 text-primary" />
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              The link expires in 1 hour. Check your spam folder if you don&apos;t see it.
            </p>
          </div>

          {debugToken && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md space-y-2">
              <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">Dev mode - reset token:</p>
              <Link
                to={`/reset-password?token=${debugToken}`}
                className="block text-xs text-blue-600 dark:text-blue-400 break-all hover:underline font-mono"
              >
                /reset-password?token={debugToken.slice(0, 20)}…
              </Link>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => { setSent(false); setEmail(""); setDebugToken(null); }}
              className="w-full py-2.5 px-4 border border-border text-sm font-medium rounded-md hover:bg-secondary transition-colors"
            >
              Try a different email
            </button>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
                placeholder="you@company.com"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>

          <Link
            to="/login"
            className="flex items-center justify-center gap-1.5 mt-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        </>
      )}
    </AuthLayout>
  );
}
