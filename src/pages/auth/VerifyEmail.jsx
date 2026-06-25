import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";

// Codes that mean the pending sign-up is gone - send the user back to sign up.
const FATAL_CODES = new Set(["no_pending", "expired", "too_many_attempts"]);

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { checkUserAuth } = useAuth();
  const email = params.get("email") || "";
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  // No email in the URL means we got here without starting sign-up.
  useEffect(() => {
    if (!email) navigate("/register", { replace: true });
  }, [email, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      await appClient.auth.registerVerify(email, code);
      await checkUserAuth(); // account now exists + auth cookie set → logs in
      toast.success("Email verified - welcome to Meritma!");
      navigate("/");
    } catch (err) {
      toast.error(err.message);
      if (FATAL_CODES.has(err.payload?.code)) {
        navigate(`/register?email=${encodeURIComponent(email)}`);
      } else {
        setCode("");
      }
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      const r = await appClient.auth.registerResend(email);
      if (r?.sent) toast.success("A new code is on its way.");
      else toast.error(r?.error ? `Couldn't send the code: ${r.error}` : "Couldn't send a new code. Try again shortly.");
    } catch (err) {
      toast.error(err.message);
      if (FATAL_CODES.has(err.payload?.code)) navigate(`/register?email=${encodeURIComponent(email)}`);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={email ? `Enter the 6-digit code we sent to ${email}` : "Enter your verification code"}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Verification code</label>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
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
          {loading ? "Verifying…" : "Verify & create account"}
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
        Wrong email?{" "}
        <Link to="/register" className="text-foreground font-semibold hover:underline">
          Go back
        </Link>
      </p>
    </AuthLayout>
  );
}
