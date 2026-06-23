import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  LayoutGrid, CreditCard, ShieldCheck, Search, Building2, Users,
  TrendingUp, Clock, AlertTriangle, Download, Activity, LifeBuoy, DollarSign,
} from "lucide-react";
import { fmtDate, fmtRelative, downloadCsv, trialLabel, trialDaysLeft, PlanBadge, StatusPill, fmtCost } from "@/components/studio/helpers.jsx";
import AccountDetailDrawer from "@/components/studio/AccountDetailDrawer.jsx";
import PlansTab from "@/components/studio/PlansTab.jsx";
import OwnersTab from "@/components/studio/OwnersTab.jsx";
import AuditTab from "@/components/studio/AuditTab.jsx";
import SupportTab from "@/components/studio/SupportTab.jsx";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "plans",    label: "Plans",    icon: CreditCard },
  { id: "owners",   label: "Owners",   icon: ShieldCheck },
  { id: "support",  label: "Support",  icon: LifeBuoy },
  { id: "activity", label: "Activity", icon: Activity },
];

function StatCard({ icon: Icon, label, value, sub, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left border rounded-lg p-4 transition-colors ${
        onClick ? "cursor-pointer hover:bg-secondary/30" : "cursor-default"
      } ${active ? "border-foreground" : "border-border"}`}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-2xl font-semibold tracking-tight mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </button>
  );
}

// Simple CSS bar sparkline of daily signups (last 30 days).
function SignupTrend({ daily }) {
  if (!daily?.length) return null;
  const max = Math.max(1, ...daily.map((d) => d.n));
  const total = daily.reduce((s, d) => s + d.n, 0);
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Signups · last 30 days
        </span>
        <span className="text-xs text-muted-foreground">{total} total</span>
      </div>
      <div className="flex items-end gap-[3px] h-16">
        {daily.map((d) => (
          <div key={d.d} className="flex-1 bg-foreground/80 hover:bg-foreground rounded-sm transition-colors"
            style={{ height: `${Math.max(4, (d.n / max) * 100)}%` }}
            title={`${d.d}: ${d.n} signup${d.n === 1 ? "" : "s"}`} />
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ onOpenAccount }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("created_date");
  const [expiringOnly, setExpiringOnly] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => appClient.admin.getStats(),
  });
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["admin", "accounts", search, sort],
    queryFn: () => appClient.admin.listAccounts({ search, sort }),
  });

  const shown = (accounts || []).filter((a) => {
    if (!expiringOnly) return true;
    const d = trialDaysLeft(a);
    return d != null && d >= 0 && d <= 7;
  });

  const exportCsv = () => {
    downloadCsv("clients.csv", accounts || [], [
      { key: "name", label: "Client" },
      { key: "owner_email", label: "Owner" },
      { key: "plan", label: "Plan" },
      { key: "user_count", label: "Users" },
      { key: "workspace_count", label: "Workspaces" },
      { key: "ai_tokens", label: "AI tokens" },
      { label: "AI cost (USD)", get: (a) => (Number(a.ai_cost) || 0).toFixed(6) },
      { label: "Signed up", get: (a) => fmtDate(a.created_date) },
      { label: "Last active", get: (a) => (a.last_activity ? new Date(a.last_activity).toISOString() : "") },
      { label: "Status", get: (a) => (a.is_active !== false ? "active" : "suspended") },
      { label: "Trial ends", get: (a) => (a.plan_expires_at ? fmtDate(a.plan_expires_at) : "") },
    ]);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard icon={Building2} label="Clients" value={stats?.total_accounts ?? "-"}
          sub={stats ? `${stats.paid_accounts} paid · ${stats.free_accounts} free` : ""} />
        <StatCard icon={Users} label="Users" value={stats?.total_users ?? "-"}
          sub={stats ? `${stats.total_workspaces} workspaces` : ""} />
        <StatCard icon={TrendingUp} label="New (30d)" value={stats?.signups_30d ?? "-"}
          sub={stats ? `${stats.suspended_accounts} suspended` : ""} />
        <StatCard icon={Clock} label="Active trials" value={stats?.active_trials ?? "-"}
          sub={stats ? `${stats.expired_trials} expired` : ""} />
        <StatCard icon={DollarSign} label="AI cost" value={stats ? fmtCost(stats.total_ai_cost) : "-"}
          sub={stats ? `${Number(stats.total_ai_tokens || 0).toLocaleString()} tokens` : ""} />
        <StatCard icon={AlertTriangle} label="Expiring ≤7d" value={stats?.expiring_7d ?? "-"}
          sub={expiringOnly ? "filtering" : "click to filter"}
          onClick={() => setExpiringOnly((v) => !v)} active={expiringOnly} />
      </div>

      <SignupTrend daily={stats?.signups_daily} />

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-72">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search clients or owner email…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        <div className="flex items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="h-9 px-3 border border-input rounded-md bg-background text-sm">
            <option value="created_date">Newest</option>
            <option value="name">Name</option>
            <option value="plan">Plan</option>
            <option value="last_activity">Last active</option>
          </select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!accounts?.length} className="h-9">
            <Download className="w-4 h-4" /> Export
          </Button>
        </div>
      </div>

      {expiringOnly && (
        <p className="text-xs text-muted-foreground -mt-3">
          Showing only accounts whose trial ends within 7 days.
        </p>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">Client</th>
              <th className="text-left font-medium px-4 py-2.5">Plan</th>
              <th className="text-right font-medium px-4 py-2.5">Users</th>
              <th className="text-right font-medium px-4 py-2.5">Workspaces</th>
              <th className="text-right font-medium px-4 py-2.5">AI cost</th>
              <th className="text-left font-medium px-4 py-2.5">Signed up</th>
              <th className="text-left font-medium px-4 py-2.5">Last active</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
            ) : !shown.length ? (
              <tr><td colSpan={8} className="px-4 py-6 text-muted-foreground">No clients found.</td></tr>
            ) : shown.map((a) => {
              const trial = trialLabel(a);
              return (
                <tr key={a.id} onClick={() => onOpenAccount(a.id)}
                  className="border-t border-border hover:bg-secondary/30 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.name || "Untitled"}</div>
                    <div className="text-xs text-muted-foreground">{a.owner_email || "-"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <PlanBadge plan={a.plan} />
                    {trial && (
                      <div className={`text-[11px] mt-1 ${trial.expired ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {trial.text}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.user_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{a.workspace_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums" title={`${Number(a.ai_tokens || 0).toLocaleString()} tokens`}>{fmtCost(a.ai_cost)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(a.created_date)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtRelative(a.last_activity)}</td>
                  <td className="px-4 py-3"><StatusPill active={a.is_active !== false} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Studio() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "overview";
  const [openAccountId, setOpenAccountId] = useState(null);

  // Shared with OverviewTab via the same query key; used for the Support badge.
  const { data: stats } = useQuery({ queryKey: ["admin", "stats"], queryFn: () => appClient.admin.getStats() });
  const openTickets = stats?.open_tickets || 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-8 pt-8 flex-shrink-0">
        <h1 className="font-heading text-3xl font-semibold tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-7 h-7" /> Studio
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Platform owner console - manage every client, their plan and your fellow owners.
        </p>
        <div className="flex border-b border-border gap-6 mt-5">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              <tab.icon className="w-3.5 h-3.5" /> {tab.label}
              {tab.id === "support" && openTickets > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-foreground text-background text-[10px] font-semibold">
                  {openTickets}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === "overview" && <OverviewTab onOpenAccount={setOpenAccountId} />}
        {activeTab === "plans"    && <PlansTab />}
        {activeTab === "owners"   && <OwnersTab currentUserId={user?.id} />}
        {activeTab === "support"  && <SupportTab />}
        {activeTab === "activity" && <AuditTab />}
      </main>

      {openAccountId && (
        <AccountDetailDrawer accountId={openAccountId} onClose={() => setOpenAccountId(null)} />
      )}
    </div>
  );
}
