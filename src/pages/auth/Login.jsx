import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { AuthLayout, GoogleButton, OrDivider } from "@/components/layout/AuthLayout";

const ERROR_MESSAGES = {
  google_cancelled: "Google sign-in was cancelled.",
  google_not_configured: "Google sign-in is not available right now.",
  oauth_failed: "Google sign-in failed. Please try again.",
  google_no_email: "Couldn't retrieve your email from Google. Please try again.",
  server_error: "Something went wrong. Please try again.",
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { checkUserAuth } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(true);

  // Show any OAuth error from the URL
  useEffect(() => {
    const err = searchParams.get("error");
    if (err && ERROR_MESSAGES[err]) toast.error(ERROR_MESSAGES[err]);

    // Check if Google OAuth is configured
    fetch("/api/auth/google/status")
      .then(r => r.json())
      .then(d => setGoogleAvailable(d.configured))
      .catch(() => setGoogleAvailable(false));
  }, []);

  const handle = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await appClient.auth.login(form.email, form.password);
      await checkUserAuth();
      navigate("/");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your workspace">
      {googleAvailable && (
        <>
          <GoogleButton action="Sign in" />
          <OrDivider />
        </>
      )}

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
