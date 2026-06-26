import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { Eye, EyeOff, CheckCircle } from "lucide-react";
import { passwordError, PASSWORD_HINT } from "@/lib/password";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ new_password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    const pwErr = passwordError(form.new_password);
    if (pwErr) {
      toast.error(pwErr);
      return;
    }
    if (!token) {
      toast.error("Missing reset token - please use the link from your email");
      return;
    }
    setLoading(true);
    try {
      await appClient.auth.resetPassword(token, form.new_password);
      setDone(true);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <CheckCircle className="w-12 h-12 text-foreground mx-auto" />
          <h1 className="text-2xl font-bold">Password updated</h1>
          <p className="text-sm text-muted-foreground">
            Your password has been changed. You can now sign in with your new password.
          </p>
          <button
            onClick={() => navigate("/login")}
            className="w-full py-2 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Set new password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a strong password for your account
          </p>
        </div>

        {!token && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
            Invalid reset link. Please request a new one.
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                required
                minLength={8}
                value={form.new_password}
                onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
                className="w-full px-3 py-2 pr-10 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Create a strong password"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{PASSWORD_HINT}</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confirm password</label>
            <input
              type="password"
              required
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Repeat password"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !token}
            className="w-full py-2 px-4 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link to="/login" className="hover:text-foreground">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
