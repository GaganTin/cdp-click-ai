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
  SlidersHorizontal, Receipt, MailCheck, DollarSign,
} from "lucide-react";
import { fmtDate, fmtRelative, toDateInput, StatusPill, trialLabel, fmtCost } from "./helpers.jsx";
import { toCredits, toTokens } from "@/lib/credits";

const LIMIT_FIELDS = [
  ["profiles",     "Profiles"],
  ["campaigns",    "Campaigns"],
  ["ai_tokens",    "AI credits"],
  ["team_members", "Team members"],
  ["workspaces",   "Workspaces"],
];

// Limit overrides are stored as raw values; ai_tokens is shown/edited in credits
// (100,000 tokens = 1 credit), so convert at the load (raw->display) and save
// (display->raw) boundaries.
const overridesToDisplay = (ov = {}) =>
  Object.fromEntries(Object.entries(ov).map(([k, v]) =>
    [k, v == null ? "" : String(k === "ai_tokens" ? toCredits(v) : v)]));
const overridesToRaw = (ov = {}) =>
  Object.fromEntries(Object.entries(ov).map(([k, v]) =>
    [k, k === "ai_tokens" && v !== "" && v != null ? String(toTokens(Number(v))) : v]));

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
  const [plan, setPlan] = useState("lite");
  const [expiry, setExpiry] = useState("");
  const [active, setActive] = useState(true);
  const [demoEnabled, setDemoEnabled] = useState(true);
  const [overrides, setOverrides] = useState({});
  const [billingNotes, setBillingNotes] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");

  useEffect(() => {
    if (account) {
      setPlan(account.plan || "lite");
      setExpiry(toDateInput(account.plan_expires_at));
      setActive(account.is_active !== false);
      setDemoEnabled(account.demo_enabled !== false);
      const s = account.settings || {};
      setOverrides(overridesToDisplay(s.limit_overrides || {}));
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
      r?.already_verified ? "Already verified" : `${label} ${r?.sent === false ? "(email not sent - check mail config)" : "sent"}`
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

  const [grantKind, setGrantKind] = useState("ai_tokens");
  const [grantBlocks, setGrantBlocks] = useState(1);
  const grant = useMutation({
    mutationFn: () => appClient.addons.grant(accountId, grantKind, Number(grantBlocks) || 1),
    onSuccess: () => {
      toast.success("Add-on granted");
      setGrantBlocks(1);
      qc.invalidateQueries({ queryKey: ["admin", "account", accountId] });
    },
    onError: (e) => toast.error(e.message || "Grant failed"),
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

  const origOverrides = overridesToDisplay(account?.settings?.limit_overrides || {});

  const dirty = account && (
    plan !== (account.plan || "lite") ||
    expiry !== toDateInput(account.plan_expires_at) ||
    active !== (account.is_active !== false) ||
    demoEnabled !== (account.demo_enabled !== false) ||
    JSON.stringify(overrides) !== JSON.stringify(origOverrides) ||
    billingNotes !== (account.settings?.billing_notes || "") ||
    paymentRef !== (account.settings?.payment_reference || "")
  );

  const onSave = () => {
    save.mutate({
      plan,
      is_active: active,
      demo_enabled: demoEnabled,
      // Trial state is tier-agnostic: a set expiry means "on trial", clearing it
      // converts to paid (the DB trigger stamps plan_upgraded_at).
      plan_expires_at: expiry ? new Date(expiry).toISOString() : null,
      limit_overrides: overridesToRaw(overrides),
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
                    {["lite", "standard", "enterprise"].map((p) => (
                      <button key={p} onClick={() => setPlan(p)}
                        className={`px-3 py-1 rounded-md text-sm capitalize transition-colors ${
                          plan === p ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
                        }`}>{p}</button>
                    ))}
                  </div>
                </div>

                {/* Trial expiry is tier-agnostic - set a date to put the account on
                    a trial, clear it to convert to paid. */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Trial ends</span>
                  <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-44" />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm">Account active</span>
                  <Switch checked={active} onCheckedChange={setActive} />
                </div>

                {/* Whether this account's users see the shared read-only demo
                    workspace in their switcher. */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm">Demo workspace</span>
                    <p className="text-xs text-muted-foreground">Show the shared read-only demo workspace to this account's users</p>
                  </div>
                  <Switch checked={demoEnabled} onCheckedChange={setDemoEnabled} />
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
                  const base = key === "ai_tokens" && baseLimits[key] != null ? toCredits(baseLimits[key]) : baseLimits[key];
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

            {/* Manual add-on grant (support / comps). Prepaid buckets: 1 AI block =
                5M tokens (50 credits); 1 email block = 10,000 emails. */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" /> Grant add-on
              </h3>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Type</label>
                  <select className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                    value={grantKind} onChange={(e) => setGrantKind(e.target.value)}>
                    <option value="ai_tokens">AI credits (5M tokens / block)</option>
                    <option value="email_credits">Email credits (10,000 / block)</option>
                  </select>
                </div>
                <div className="w-24">
                  <label className="block text-xs text-muted-foreground mb-1">Blocks</label>
                  <Input type="number" min="1" value={grantBlocks}
                    onChange={(e) => setGrantBlocks(e.target.value)} />
                </div>
                <Button variant="outline" disabled={grant.isPending} onClick={() => grant.mutate()}>
                  {grant.isPending ? "Granting…" : "Grant"}
                </Button>
              </div>
            </section>

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
                    <div className="grid grid-cols-5 gap-2 mt-3 text-center">
                      {[["Members", w.member_count], ["Profiles", w.profiles], ["Campaigns", w.campaigns], ["AI credits", toCredits(w.ai_tokens)], ["AI cost", w.ai_cost, true]].map(([l, v, money]) => (
                        <div key={l}>
                          <p className="text-sm font-semibold tabular-nums">{money ? fmtCost(v) : Number(v).toLocaleString()}</p>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!data.workspaces.length && <p className="text-sm text-muted-foreground">No workspaces.</p>}
              </div>
            </section>

            {/* AI usage & cost */}
            {data.ai_usage && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <DollarSign className="w-4 h-4" /> AI usage &amp; cost
                </h3>
                <div className="grid grid-cols-3 gap-2 text-center border border-border rounded-lg p-3 bg-secondary/20">
                  {[
                    ["Total cost", fmtCost(data.ai_usage.total_cost, data.ai_usage.currency)],
                    ["Total credits", toCredits(data.ai_usage.total_tokens).toLocaleString()],
                    ["In / Out", `${toCredits(data.ai_usage.input_tokens).toLocaleString()} / ${toCredits(data.ai_usage.output_tokens).toLocaleString()}`],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-sm font-semibold tabular-nums">{v}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
                    </div>
                  ))}
                </div>

                {data.ai_usage.by_user?.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-2">By user</th>
                          <th className="text-right font-medium px-3 py-2">Credits</th>
                          <th className="text-right font-medium px-3 py-2">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ai_usage.by_user.map((r) => (
                          <tr key={r.user_id || "unattributed"} className="border-t border-border">
                            <td className="px-3 py-2 truncate">{r.email || r.full_name || "Unattributed"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{toCredits(r.tokens).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtCost(r.cost, data.ai_usage.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {data.ai_usage.by_feature?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.ai_usage.by_feature.map((f) => (
                      <span key={f.feature} className="text-[11px] px-2 py-1 rounded-md bg-secondary text-muted-foreground">
                        {f.feature.replace(/_/g, " ")}: {fmtCost(f.cost, data.ai_usage.currency)}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

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
                        onClick={() => { if (window.confirm(`View the app as ${u.email}? This replaces your current session - log out to return to your own.`)) impersonate.mutate(u.id); }}
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
