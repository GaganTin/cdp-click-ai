import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { AuthLayout, GoogleButton, MicrosoftButton, OrDivider } from "@/components/layout/AuthLayout";

const ERROR_MESSAGES = {
  google_cancelled: "Google sign-in was cancelled.",
  google_not_configured: "Google sign-in is not available right now.",
  oauth_failed: "Sign-in failed. Please try again.",
  google_no_email: "Couldn't retrieve your email from Google. Please try again.",
  microsoft_cancelled: "Microsoft sign-in was cancelled.",
  microsoft_not_configured: "Microsoft sign-in is not available right now.",
  microsoft_no_email: "Couldn't retrieve your email from Microsoft. Please try again.",
  server_error: "Something went wrong. Please try again.",
  account_deleted: "This account has been deleted and its email can no longer be used to sign in. Please use a different email.",
};

// Codes that mean the login challenge is gone - send the user back to sign in.
const MFA_FATAL_CODES = new Set(["invalid_challenge", "expired", "too_many_attempts"]);

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { checkUserAuth } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  // When set, the password was correct but the account has 2FA on - we collect
  // the emailed code before completing sign-in. { id, sent }
  const [mfa, setMfa] = useState(null);

  // Show any OAuth error from the URL
  useEffect(() => {
    const err = searchParams.get("error");
    if (err && ERROR_MESSAGES[err]) toast.error(ERROR_MESSAGES[err]);
  }, []);

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const finishLogin = async () => {
    await checkUserAuth();
    navigate("/");
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await appClient.auth.login(form.email, form.password);
      // 2FA-enabled account: the password is only the first factor.
      if (res?.mfa_required) {
        setMfa({ id: res.challenge_id, sent: res.sent });
        if (res.sent) toast.success(`We sent a 6-digit code to ${form.email}.`);
        else toast.error(res.error ? `Couldn't send your code: ${res.error}` : "Couldn't send your code. Try resending it.");
        return;
      }
      await finishLogin();
    } catch (err) {
      // No account for this email → send them to sign-up with it pre-filled.
      if (err.status === 404 || err.payload?.code === "no_account") {
        toast.error("No account is associated with this email. Let's create one.");
        navigate(`/register?email=${encodeURIComponent(form.email)}`);
        return;
      }
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (mfa) {
    return <MfaStep email={form.email} challenge={mfa} setChallenge={setMfa} onSuccess={finishLogin} />;
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace">
      <div className="space-y-3">
        <GoogleButton action="Sign in" />
        <MicrosoftButton action="Sign in" />
      </div>
      <OrDivider />

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Email</label>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={handle}
            className="w-full px-3 py-2.5 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
            placeholder="you@company.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium">Password</label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={form.password}
              onChange={handle}
              className="w-full px-3 py-2.5 pr-10 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Don&apos;t have an account?{" "}
        <Link to="/register" className="text-foreground font-semibold hover:underline">
          Create one free
        </Link>
      </p>
    </AuthLayout>
  );
}

// Second-factor step: collect the 6-digit code emailed after a correct password.
function MfaStep({ email, challenge, setChallenge, onSuccess }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      await appClient.auth.loginVerifyMfa(challenge.id, code);
      toast.success("Welcome back!");
      await onSuccess();
    } catch (err) {
      toast.error(err.message);
      if (MFA_FATAL_CODES.has(err.payload?.code)) setChallenge(null); // back to password form
      else setCode("");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      const r = await appClient.auth.loginResendMfa(challenge.id);
      if (r?.sent) toast.success("A new code is on its way.");
      else toast.error(r?.error ? `Couldn't send the code: ${r.error}` : "Couldn't send a new code. Try again shortly.");
    } catch (err) {
      toast.error(err.message);
      if (MFA_FATAL_CODES.has(err.payload?.code)) setChallenge(null);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Two-factor authentication"
      subtitle={email ? `Enter the 6-digit code we sent to ${email}` : "Enter your sign-in code"}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="mfa-code" className="block text-sm font-medium mb-1.5">Verification code</label>
          <input
            id="mfa-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit verification code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full px-3 py-3 border border-border rounded-md bg-background text-center text-2xl font-semibold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-ring placeholder:tracking-normal placeholder:text-base placeholder:text-muted-foreground/50"
            placeholder="000000"
          />
        </div>

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Verifying…" : "Verify & sign in"}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Didn&apos;t get a code?{" "}
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="text-foreground font-semibold hover:underline disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
      </p>
      <p className="text-center text-sm text-muted-foreground mt-2">
        <button
          type="button"
          onClick={() => setChallenge(null)}
          className="text-foreground font-semibold hover:underline"
        >
          Back to sign in
        </button>
      </p>
    </AuthLayout>
  );
}
