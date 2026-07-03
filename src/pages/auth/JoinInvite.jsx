import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Building2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

// localStorage key a logged-out invitee's token is parked under, so we can resume
// the accept flow after they sign in / register (any auth method - including the
// OAuth round-trip that drops URL params). Consumed by PendingInviteRedirect.
export const PENDING_INVITE_KEY = "pending_invite_token";

const ROLE_LABEL = { admin: "Admin", contributor: "Contributor", viewer: "Viewer" };

export default function JoinInvite() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, checkUserAuth, switchCompany, logout } = useAuth();

  const [preview, setPreview] = useState(null);   // { email, company_name, inviter_name, role, valid, ... }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);       // terminal error message
  const [accepting, setAccepting] = useState(false);
  const acceptOnce = useRef(false);

  // Park the token so we can resume after auth, then fetch the invite preview.
  // Only while logged out - that's the only case that needs to survive an auth
  // round-trip; parking it while signed in would hijack the user's next login.
  useEffect(() => {
    if (token && !isAuthenticated) localStorage.setItem(PENDING_INVITE_KEY, token);
    let alive = true;
    (async () => {
      try {
        const p = await appClient.companies.getInvitation(token);
        if (!alive) return;
        setPreview(p);
        if (!p.valid) {
          localStorage.removeItem(PENDING_INVITE_KEY);
          setError(
            p.status === "accepted" ? "This invitation has already been accepted."
            : p.expired ? "This invitation has expired. Ask an admin to send a new one."
            : "This invitation is no longer valid."
          );
        }
      } catch (e) {
        if (!alive) return;
        localStorage.removeItem(PENDING_INVITE_KEY);
        setError(e.status === 404 ? "This invitation link is invalid." : e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const emailMatches =
    isAuthenticated && preview && user?.email?.toLowerCase() === preview.email?.toLowerCase();

  // Auto-accept once, when signed in as the invited email on a valid invite.
  useEffect(() => {
    if (!emailMatches || !preview?.valid || accepting || acceptOnce.current || error) return;
    acceptOnce.current = true;
    setAccepting(true);
    (async () => {
      try {
        const res = await appClient.companies.acceptInvitation(token);
        localStorage.removeItem(PENDING_INVITE_KEY);
        // Reload membership, then drop the user into the workspace they just joined.
        const me = await appClient.auth.me().catch(() => null);
        await checkUserAuth();
        const joined = (me?.companies || []).find((c) => c.id === res.company_id);
        if (joined) switchCompany(joined);
        toast.success(`You've joined ${res.company_name || "the workspace"}.`);
        navigate("/", { replace: true });
      } catch (e) {
        localStorage.removeItem(PENDING_INVITE_KEY);
        setError(e.message || "We couldn't accept this invitation.");
        setAccepting(false);
      }
    })();
  }, [emailMatches, preview, accepting, error, token, checkUserAuth, switchCompany, navigate]);

  const signOutAndSwitch = async () => {
    // Keep the parked token so the flow resumes once they sign in as the invited email.
    await logout();
    navigate("/login", { replace: true });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const Card = ({ children }) => (
    <div className="space-y-5 text-center">{children}</div>
  );

  if (loading) {
    return (
      <AuthLayout title="Workspace invitation">
        <Card>
          <Loader2 className="w-8 h-8 text-muted-foreground mx-auto animate-spin" />
          <p className="text-sm text-muted-foreground">Loading your invitation…</p>
        </Card>
      </AuthLayout>
    );
  }

  if (error) {
    return (
      <AuthLayout title="Workspace invitation">
        <Card>
          <XCircle className="w-9 h-9 text-destructive mx-auto" />
          <p className="text-sm text-foreground">{error}</p>
          <Link to="/" className="inline-block text-sm font-medium text-primary hover:underline">
            Go to Meritma
          </Link>
        </Card>
      </AuthLayout>
    );
  }

  const workspace = preview?.company_name || "a workspace";
  const inviter = preview?.inviter_name;
  const roleLabel = ROLE_LABEL[preview?.role] || preview?.role;

  // Signed in, accepting (or about to auto-accept).
  if (emailMatches) {
    return (
      <AuthLayout title="Workspace invitation">
        <Card>
          <Loader2 className="w-8 h-8 text-muted-foreground mx-auto animate-spin" />
          <p className="text-sm text-muted-foreground">Joining {workspace}…</p>
        </Card>
      </AuthLayout>
    );
  }

  // Signed in as the WRONG account.
  if (isAuthenticated && !emailMatches) {
    return (
      <AuthLayout title="Workspace invitation">
        <Card>
          <XCircle className="w-9 h-9 text-muted-foreground mx-auto" />
          <p className="text-sm text-foreground">
            This invitation was sent to <strong>{preview?.email}</strong>, but you're signed in as{" "}
            <strong>{user?.email}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Sign in with the invited email to accept it.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={signOutAndSwitch}
              className="w-full py-2.5 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Sign in as {preview?.email}
            </button>
            <button
              onClick={() => { localStorage.removeItem(PENDING_INVITE_KEY); navigate("/", { replace: true }); }}
              className="w-full py-2.5 px-4 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors"
            >
              Not now
            </button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  // Logged out - invite the recipient to sign in or create an account.
  return (
    <AuthLayout title="You're invited">
      <Card>
        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mx-auto">
          <Building2 className="w-6 h-6 text-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            {inviter ? <><strong>{inviter}</strong> invited you</> : "You've been invited"} to join{" "}
            <strong>{workspace}</strong>
            {roleLabel ? <> as a <strong>{roleLabel}</strong></> : null}.
          </p>
          <p className="text-xs text-muted-foreground">
            Sign in or create an account with <strong>{preview?.email}</strong> to accept.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Link
            to={`/register?email=${encodeURIComponent(preview?.email || "")}`}
            className="w-full py-2.5 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Create your account
          </Link>
          <Link
            to="/login"
            className="w-full py-2.5 px-4 rounded-md border border-border text-sm font-medium hover:bg-secondary transition-colors"
          >
            I already have an account
          </Link>
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> This invitation is valid for 7 days.
        </p>
      </Card>
    </AuthLayout>
  );
}
