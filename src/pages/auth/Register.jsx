import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { Eye, EyeOff, Check } from "lucide-react";
import { AuthLayout, GoogleButton, MicrosoftButton, OrDivider } from "@/components/layout/AuthLayout";

function PasswordStrength({ password }) {
  const checks = [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "Contains a number", ok: /\d/.test(password) },
    { label: "Contains a letter", ok: /[a-zA-Z]/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="mt-2 space-y-1">
      {checks.map(c => (
        <div key={c.label} className={`flex items-center gap-1.5 text-xs ${c.ok ? "text-foreground" : "text-muted-foreground"}`}>
          <Check className={`w-3 h-3 ${c.ok ? "opacity-100" : "opacity-30"}`} />
          {c.label}
        </div>
      ))}
    </div>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Pre-fill the email when arriving from the login page ("no account" redirect).
  const [form, setForm] = useState({ full_name: "", email: searchParams.get("email") || "", password: "", company_name: "" });
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (form.password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      // Don't create the account yet - email a code and verify it first.
      const res = await appClient.auth.registerStart(form);
      if (res?.sent) {
        toast.success(`We sent a 6-digit code to ${form.email}.`);
      } else {
        toast.error("We couldn't send your verification code. You can resend it on the next page.");
      }
      navigate(`/verify-email?email=${encodeURIComponent(form.email)}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start with a free workspace, no credit card needed"
    >
      <div className="space-y-3">
        <GoogleButton action="Sign up" />
        <MicrosoftButton action="Sign up" />
      </div>
      <OrDivider />

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Full name</label>
            <input
              name="full_name"
              type="text"
              autoComplete="name"
              required
              value={form.full_name}
              onChange={handle}
              className="w-full px-3 py-2.5 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
              placeholder="Jane Smith"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Work email</label>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={handle}
              className="w-full px-3 py-2.5 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
              placeholder="jane@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Password</label>
            <div className="relative">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                value={form.password}
                onChange={handle}
                className="w-full px-3 py-2.5 pr-10 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
                placeholder="Min 8 characters"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PasswordStrength password={form.password} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Retype password</label>
            <div className="relative">
              <input
                name="confirm_password"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
                placeholder="Re-enter your password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(s => !s)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirm && form.password !== confirm && (
              <p className="mt-1 text-xs text-destructive">Passwords do not match</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Company name</label>
            <input
              name="company_name"
              type="text"
              required
              value={form.company_name}
              onChange={handle}
              className="w-full px-3 py-2.5 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/60"
              placeholder="Acme Inc."
            />
            <p className="mt-1 text-xs text-muted-foreground">You can add team members after signing up</p>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating account…" : "Create free account"}
        </button>

        <p className="text-xs text-center text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>
          {" "}and{" "}
          <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Already have an account?{" "}
        <Link to="/login" className="text-foreground font-semibold hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
