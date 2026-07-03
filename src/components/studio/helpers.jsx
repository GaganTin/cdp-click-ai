// Shared presentational helpers for the Studio (platform-owner) console.

export function fmtDate(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch { return "-"; }
}

// Compact relative-time for "last activity" columns.
export function fmtRelative(v) {
  if (!v) return "Never";
  const then = new Date(v).getTime();
  if (Number.isNaN(then)) return "Never";
  const diff = Date.now() - then;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < hr)  return `${Math.max(1, Math.round(diff / min))}m ago`;
  if (diff < day) return `${Math.round(diff / hr)}h ago`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return fmtDate(v);
}

// Convert a YYYY-MM-DD input value <-> the timestamptz we store/display.
export function toDateInput(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// Currency for AI-cost columns. Small amounts (< $1) get 4 dp so a few cents of
// usage doesn't render as "$0.00".
export function fmtCost(v, currency = "USD") {
  const n = Number(v) || 0;
  const digits = n > 0 && n < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: digits }).format(n);
  } catch {
    return `$${n.toFixed(digits)}`;
  }
}

export function PlanBadge({ plan }) {
  // Higher paid tiers (standard/enterprise) get the solid badge; Lite is the entry tier.
  const highlighted = plan === "standard" || plan === "enterprise";
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
      highlighted ? "bg-foreground text-background" : "bg-secondary text-muted-foreground border border-border"
    }`}>
      {plan || "lite"}
    </span>
  );
}

export function StatusPill({ active }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
      active ? "text-foreground" : "text-muted-foreground"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-foreground" : "bg-muted-foreground/50"}`} />
      {active ? "Active" : "Suspended"}
    </span>
  );
}

// Trial status string from an account row. Trial state is tier-agnostic: an
// account is in a trial iff it has a plan_expires_at (null once paid).
export function trialLabel(account) {
  if (!account || !account.plan_expires_at) return null;
  const exp = new Date(account.plan_expires_at).getTime();
  const days = Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0)  return { text: `Trial ended ${Math.abs(days)}d ago`, expired: true };
  if (days === 0) return { text: "Trial ends today", expired: false };
  return { text: `Trial: ${days}d left`, expired: false };
}

// Days until an account's trial ends (null if not on a trial / already paid).
export function trialDaysLeft(account) {
  if (!account || !account.plan_expires_at) return null;
  return Math.ceil((new Date(account.plan_expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// Build a CSV string from rows + column defs ([{key, label, get?}]) and download it.
export function downloadCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) =>
    columns.map((c) => esc(c.get ? c.get(r) : r[c.key])).join(",")
  ).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
