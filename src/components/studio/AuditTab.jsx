import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { fmtRelative } from "./helpers.jsx";

// Platform-wide audit feed. Read-only; filter by action type.
const ACTIONS = ["", "update", "delete", "role_change", "impersonate", "invite", "send", "create", "login", "logout"];

function actionStyle(a) {
  // Monochrome: high-signal actions get the filled treatment, the rest are muted.
  if (["delete", "impersonate", "role_change", "invite"].includes(a)) return "bg-foreground text-background";
  return "bg-secondary text-muted-foreground";
}

function summarize(changes) {
  if (!changes || typeof changes !== "object") return "";
  const entries = Object.entries(changes).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return "";
  return entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
}

export default function AuditTab() {
  const [action, setAction] = useState("");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["admin", "audit", action],
    queryFn: () => appClient.admin.listAudit({ action, limit: 200 }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Every action taken across the platform (most recent first, last 200).</p>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="h-9 px-3 border border-input rounded-md bg-background text-sm">
          {ACTIONS.map((a) => <option key={a} value={a}>{a === "" ? "All actions" : a}</option>)}
        </select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2.5">When</th>
              <th className="text-left font-medium px-4 py-2.5">Who</th>
              <th className="text-left font-medium px-4 py-2.5">Action</th>
              <th className="text-left font-medium px-4 py-2.5">Target</th>
              <th className="text-left font-medium px-4 py-2.5">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
            ) : !rows?.length ? (
              <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">No activity.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmtRelative(r.occurred_at)}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.user_name || r.user_email || "System"}</div>
                  {r.user_email && r.user_name && <div className="text-xs text-muted-foreground">{r.user_email}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionStyle(r.action)}`}>{r.action}</span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.resource_type || "-"}
                  {r.account_name && <div className="text-xs">{r.account_name}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate" title={summarize(r.changes)}>
                  {summarize(r.changes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
