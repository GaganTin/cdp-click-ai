import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  X, Users, Building2, Crown, Mail, KeyRound, LogIn, Trash2,
  SlidersHorizontal, Receipt, MailCheck,
} from "lucide-react";
import { fmtDate, fmtRelative, toDateInput, StatusPill, trialLabel } from "./helpers.jsx";

const LIMIT_FIELDS = [
  ["profiles",     "Profiles"],
  ["campaigns",    "Campaigns"],
  ["ai_tokens",    "AI tokens"],
  ["team_members", "Team members"],
  ["workspaces",   "Workspaces"],
];

// Right-side slide-over showing one account's users, workspaces and usage, plus
// owner controls: plan, trial, suspend, per-account limit overrides, billing
// notes, per-user email/impersonate actions, and account deletion.
export default function AccountDetailDrawer({ accountId, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "account", accountId],
    queryFn: () => appClient.admin.getAccount(accountId),
    enabled: !!accountId,
  });
  const { data: plans } = useQuery({ queryKey: ["admin", "plans"], queryFn: () => appClient.admin.listPlans() });

  const account = data?.account;
  const [plan, setPlan] = useState("free");
  const [expiry, setExpiry] = useState("");
  const [active, setActive] = useState(true);
  const [overrides, setOverrides] = useState({});
  const [billingNotes, setBillingNotes] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");

  useEffect(() => {
    if (account) {
      setPlan(account.plan || "free");
      setExpiry(toDateInput(account.plan_expires_at));
      setActive(account.is_active !== false);
      const s = account.settings || {};
      const ov = s.limit_overrides || {};
      setOverrides(Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, v == null ? "" : String(v)])));
      setBillingNotes(s.billing_notes || "");
      setPaymentRef(s.payment_reference || "");
    }
  }, [account]);

  const baseLimits = plans?.find((p) => p.id === plan)?.limits || {};

  const save = useMutation({
    mutationFn: (patch) => appClient.admin.updateAccount(accountId, patch),
    onSuccess: () => {
      toast.success("Account updated");
      qc.invalidateQueries({ queryKey: ["admin", "account", accountId] });
      qc.invalidateQueries({ queryKey: ["admin", "accounts"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (e) => toast.error(e.message || "Update failed"),
  });

  const userAction = useMutation({
    mutationFn: ({ fn, id }) => appClient.admin[fn](id),
    onSuccess: (r, { label }) => toast[r?.sent === false && r?.error ? "warning" : "success"](
      r?.already_verified ? "Already verified" : `${label} ${r?.sent === false ? "(email not sent — check mail config)" : "sent"}`
    ),
    onError: (e) => toast.error(e.message || "Action failed"),
  });

  const impersonate = useMutation({
    mutationFn: (id) => appClient.admin.impersonate(id),
    onSuccess: (r) => {
      toast.success(`Now viewing as ${r.user.email}`);
      window.location.href = "/";
    },
    onError: (e) => toast.error(e.message || "Impersonation failed"),
  });

  const del = useMutation({
    mutationFn: () => appClient.admin.deleteAccount(accountId),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries({ queryKey: ["admin", "accounts"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      onClose();
    },
    onError: (e) => toast.error(e.message || "Delete failed"),
  });

  const origOverrides = (() => {
    const ov = account?.settings?.limit_overrides || {};
    return Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, v == null ? "" : String(v)]));
  })();

  const dirty = account && (
    plan !== (account.plan || "free") ||
    expiry !== toDateInput(account.plan_expires_at) ||
    active !== (account.is_active !== false) ||
    JSON.stringify(overrides) !== JSON.stringify(origOverrides) ||
    billingNotes !== (account.settings?.billing_notes || "") ||
    paymentRef !== (account.settings?.payment_reference || "")
  );

  const onSave = () => {
    save.mutate({
      plan,
      is_active: active,
      plan_expires_at: plan === "free" ? (expiry ? new Date(expiry).toISOString() : null) : null,
      limit_overrides: overrides,
      billing_notes: billingNotes,
      payment_reference: paymentRef,
    });
  };

  const trial = trialLabel(account);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-background border-l border-border shadow-xl h-full overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-semibold truncate">{account?.name || "Account"}</h2>
            <p className="text-xs text-muted-foreground truncate">{account?.owner_email || "-"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : !account ? (
          <div className="p-6 text-sm text-muted-foreground">Account not found.</div>
        ) : (
          <div className="p-6 space-y-8">
            {/* Plan & status controls */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Crown className="w-4 h-4" /> Plan &amp; status</h3>
              <div className="space-y-3 border border-border rounded-lg p-4 bg-secondary/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Plan</span>
                  <div className="flex gap-1.5">
                    {["free", "paid"].map((p) => (
                      <button key={p} onClick={() => setPlan(p)}
                        className={`px-3 py-1 rounded-md text-sm capitalize transition-colors ${
                          plan === p ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                        }`}>{p}</button>
                    ))}
                  </div>
                </div>

                {plan === "free" && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">Trial ends</span>
                    <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-44" />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm">Account active</span>
                  <Switch checked={active} onCheckedChange={setActive} />
                </div>

                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>Signed up {fmtDate(account.created_date)}</span>
                  {account.plan_upgraded_at && <span>Paid since {fmtDate(account.plan_upgraded_at)}</span>}
                </div>
              </div>
            </section>

            {/* Per-account limit overrides */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" /> Limit overrides
              </h3>
              <p className="text-xs text-muted-foreground">
                Override this client&apos;s limits without changing the plan. Blank = use the {plan} plan default.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {LIMIT_FIELDS.map(([key, label]) => {
                  const base = baseLimits[key];
                  return (
                    <div key={key}>
                      <label className="block text-xs text-muted-foreground mb-1">{label}</label>
                      <Input type="number" min="0"
                        value={overrides[key] ?? ""}
                        placeholder={base == null ? "Unlimited" : `Plan: ${base}`}
                        onChange={(e) => setOverrides((o) => ({ ...o, [key]: e.target.value }))} />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Billing notes (offline payments) */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Receipt className="w-4 h-4" /> Billing notes</h3>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Payment reference</label>
                <Input value={paymentRef} placeholder="e.g. Invoice #1042 / bank transfer"
                  onChange={(e) => setPaymentRef(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Notes</label>
                <Textarea value={billingNotes} rows={2} placeholder="Paid until, contact, terms…"
                  onChange={(e) => setBillingNotes(e.target.value)} />
              </div>
            </section>

            <Button onClick={onSave} disabled={!dirty || save.isPending} className="w-full">
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>

            {/* Workspaces */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Workspaces ({data.workspaces.length})
              </h3>
              <div className="space-y-2">
                {data.workspaces.map((w) => (
                  <div key={w.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{w.name}</p>
                        <p className="text-xs text-muted-foreground">Created {fmtDate(w.created_date)}</p>
                      </div>
                      <StatusPill active={w.is_active !== false} />
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                      {[["Members", w.member_count], ["Profiles", w.profiles], ["Campaigns", w.campaigns], ["AI tokens", w.ai_tokens]].map(([l, v]) => (
                        <div key={l}>
                          <p className="text-sm font-semibold tabular-nums">{Number(v).toLocaleString()}</p>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!data.workspaces.length && <p className="text-sm text-muted-foreground">No workspaces.</p>}
              </div>
            </section>

            {/* Users */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4" /> Users ({data.users.length})
              </h3>
              <div className="space-y-1.5">
                {data.users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        {u.full_name || u.email}
                        {u.is_platform_admin && <Crown className="w-3 h-3 text-foreground" />}
                        {!u.is_email_verified && <span className="text-[10px] text-muted-foreground">unverified</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {u.email} · {fmtRelative(u.last_login_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!u.is_email_verified && (
                        <button title="Resend verification"
                          onClick={() => userAction.mutate({ fn: "sendVerification", id: u.id, label: "Verification email" })}
                          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"><MailCheck className="w-4 h-4" /></button>
                      )}
                      <button title="Send password reset"
                        onClick={() => userAction.mutate({ fn: "sendReset", id: u.id, label: "Password reset" })}
                        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"><KeyRound className="w-4 h-4" /></button>
                      <button title="Impersonate (view as this user)"
                        onClick={() => { if (window.confirm(`View the app as ${u.email}? This replaces your current session — log out to return to your own.`)) impersonate.mutate(u.id); }}
                        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground"><LogIn className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Danger zone */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Trash2 className="w-4 h-4" /> Danger zone
              </h3>
              <div className="border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Permanently delete this account and ALL its data (users, workspaces, profiles, campaigns…).
                  This cannot be undone. Type <span className="font-medium text-foreground">{account.name}</span> to confirm.
                </p>
                <Input value={confirmDelete} placeholder={account.name}
                  onChange={(e) => setConfirmDelete(e.target.value)} />
                <Button
                  disabled={confirmDelete !== account.name || del.isPending}
                  onClick={() => del.mutate()} className="w-full">
                  {del.isPending ? "Deleting…" : "Delete account permanently"}
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
