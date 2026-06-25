// Shared building blocks for the page-level Analytics tabs (Profiles, Segments,
// Attributes). Mirrors the look of UTMAnalyticsPanel / EDM / Pop-up analytics:
// a date-range bar, KPI tiles, and titled chart cards (recharts).
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ChartExplainer from "@/components/dashboard/ChartExplainer";

export const COLORS = ["#1a1a1a", "#555", "#888", "#aaa", "#c4c4c4", "#dcdcdc", "#ebebeb"];
export const PREV_COLOR = "#c4c4c4";  // muted series for the comparison period

const fmt = (n) => Number(n || 0).toLocaleString();
const DAY_MS = 86_400_000;

// Previous period of equal length, ending the day before the current period starts.
export function syncPrevPeriod(from, to) {
  if (!from || !to) return { from: "", to: "" };
  const s = new Date(from), e = new Date(to);
  const dur = e - s;
  const pe = new Date(s.getTime() - DAY_MS);
  const ps = new Date(pe.getTime() - dur);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(ps), to: iso(pe) };
}

// % change badge: a positive change shows an up trend icon + green "+x%", a negative
// change shows a down trend icon + red "-x%" (purely directional, matching the UTM
// analytics delta). Extra props (e.g. isRate) passed by callers are ignored.
export function Delta({ curr, prev }) {
  if (prev == null || curr == null || Number(prev) === 0) return null;
  const pct = ((Number(curr) - Number(prev)) / Math.abs(Number(prev))) * 100;
  if (!isFinite(pct)) return null;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${positive ? "text-green-600" : "text-red-500"}`}>
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {positive ? "+" : "-"}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Merge a comparison series onto the current data as a `prev` key (by category name).
export function mergeByName(data = [], prevData) {
  if (!prevData) return data;
  const pm = new Map(prevData.map((p) => [String(p.name), Number(p.value)]));
  return data.map((d) => ({ ...d, prev: pm.get(String(d.name)) }));
}
// Align a comparison time-series by position (relative day/month index).
export function mergeByIndex(data = [], prevData) {
  if (!prevData) return data;
  return data.map((d, i) => ({ ...d, prev: prevData[i] != null ? Number(prevData[i].value) : undefined }));
}

// ── KPI tile ──────────────────────────────────────────────────────────────────
// Pass `curr`+`prev` (numbers) and optional `prevDisplay` to show a comparison delta.
export function KpiTile({ label, value, sub, icon: Icon, curr, prev, prevDisplay, isRate = false }) {
  const showDelta = prev != null && curr != null;
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <p className="text-2xl font-heading font-semibold tracking-tight mt-1.5">{value}</p>
      {sub != null && sub !== "" && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      {showDelta && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Delta curr={curr} prev={prev} isRate={isRate} />
          {prevDisplay != null && <span className="text-[10px] text-muted-foreground">vs {prevDisplay}</span>}
        </div>
      )}
    </div>
  );
}

// ── Titled chart card ─────────────────────────────────────────────────────────
// Optional, opt-in extras (matching the UTM analytics cards):
//   explain={{ key, type, data }} → AI summary popover (Sparkles)
//   resizable + defaultWide       → Expand/Shrink button toggling col-span in a
//                                   2-col grid. Use `defaultWide` instead of a
//                                   hard-coded "lg:col-span-2" so it can shrink.
export function ChartCard({ title, subtitle, children, right, className = "", explain, resizable = false, defaultWide = false }) {
  const [wide, setWide] = useState(defaultWide);
  const span = resizable ? (wide ? "lg:col-span-2" : "lg:col-span-1") : "";
  return (
    <div className={`border border-border rounded-lg bg-card p-4 ${span} ${className}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {right}
          {explain && (
            <ChartExplainer
              chart={{ title, chart_type: explain.type || "chart", description: subtitle }}
              config={{ data: explain.data }}
              chartKey={explain.key}
            />
          )}
          {resizable && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title={wide ? "Shrink" : "Expand"} onClick={() => setWide((w) => !w)}>
              {wide ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-md px-2.5 py-1.5 shadow-sm">
      {label != null && <p className="text-[11px] font-medium mb-0.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-[11px] text-muted-foreground">
          {p.name}: <span className="text-foreground font-medium">{fmt(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

const EmptyChart = ({ height = 220 }) => (
  <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
    No data yet.
  </div>
);

// ── Vertical bar ──────────────────────────────────────────────────────────────
export function BarBlock({ data = [], height = 220, color = "#1a1a1a", prevData = null }) {
  if (!data.length) return <EmptyChart height={height} />;
  const merged = prevData ? mergeByName(data, prevData) : data;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={merged} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} interval={0} angle={merged.length > 6 ? -30 : 0} textAnchor={merged.length > 6 ? "end" : "middle"} height={merged.length > 6 ? 56 : 24} />
        <YAxis tick={{ fontSize: 10, fill: "#888" }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {prevData && <Bar dataKey="prev" name="Previous" fill={PREV_COLOR} radius={[3, 3, 0, 0]} maxBarSize={48} />}
        <Bar dataKey="value" name={prevData ? "Current" : "value"} fill={color} radius={[3, 3, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Horizontal bar (good for long category labels) ────────────────────────────
export function HBarBlock({ data = [], height = 240, color = "#1a1a1a", prevData = null }) {
  if (!data.length) return <EmptyChart height={height} />;
  const merged = prevData ? mergeByName(data, prevData) : data;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={merged} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: "#888" }} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#888" }} width={130}
          tickFormatter={(v) => (String(v).length > 20 ? String(v).slice(0, 20) + "…" : v)} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {prevData && <Bar dataKey="prev" name="Previous" fill={PREV_COLOR} radius={[0, 3, 3, 0]} maxBarSize={22} />}
        <Bar dataKey="value" name={prevData ? "Current" : "value"} fill={color} radius={[0, 3, 3, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Pie / donut ───────────────────────────────────────────────────────────────
export function PieBlock({ data = [], height = 220 }) {
  const rows = data.filter((d) => Number(d.value) > 0);
  if (!rows.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={2}>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Legend for a pie (kept separate so cards can place it where they like).
export function PieLegend({ data = [] }) {
  const rows = data.filter((d) => Number(d.value) > 0);
  const total = rows.reduce((s, d) => s + Number(d.value), 0) || 1;
  if (!rows.length) return null;
  return (
    <div className="space-y-1.5 mt-2">
      {rows.map((d, i) => (
        <div key={d.name} className="flex items-center gap-2 text-[11px]">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
          <span className="flex-1 truncate capitalize">{d.name}</span>
          <span className="text-muted-foreground tabular-nums">{fmt(d.value)} · {((d.value / total) * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Line (time series) ────────────────────────────────────────────────────────
export function LineBlock({ data = [], height = 220, color = "#1a1a1a", prevData = null }) {
  if (!data.length) return <EmptyChart height={height} />;
  const merged = prevData ? mergeByIndex(data, prevData) : data;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 4, right: 12, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#888" }} />
        <YAxis tick={{ fontSize: 10, fill: "#888" }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} />
        {prevData && <Line type="monotone" dataKey="prev" name="Previous" stroke={PREV_COLOR} strokeWidth={2} strokeDasharray="4 3" dot={false} />}
        <Line type="monotone" dataKey="value" name={prevData ? "Current" : "value"} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Date range bar with quick ranges (matches Pop-up / UTM analytics) ──────────
// Optional compare props: pass `compare`, `setCompare`, `compareRange` ({from,to})
// and `onCompareChange` to enable a UTM-style "Compare" toggle + comparison period.
// Optional `t` translates the chrome labels (defaults to identity); optional `note`
// renders a right-aligned summary line (e.g. "12 campaigns in range").
export function DateRangeBar({ from, to, onChange, compare, setCompare, compareRange, onCompareChange, t = (s) => s, note }) {
  const canCompare = typeof setCompare === "function";
  // Changing the current period re-syncs the comparison period when compare is on.
  const set = (f, t) => {
    onChange({ from: f, to: t });
    if (compare && f && t && onCompareChange) onCompareChange(syncPrevPeriod(f, t));
  };
  const toggleCompare = () => {
    if (!compare && from && to && onCompareChange) onCompareChange(syncPrevPeriod(from, to));
    setCompare(!compare);
  };
  const setCmp = (f, t) => onCompareChange?.({ from: f, to: t });
  return (
    <div className="flex flex-wrap items-end gap-4 p-4 border border-border rounded-lg bg-secondary/20">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Period")}</p>
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} onChange={(e) => set(e.target.value, to)}
            className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
          <span className="text-xs text-muted-foreground">→</span>
          <input type="date" value={to} onChange={(e) => set(from, e.target.value)}
            className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
        </div>
      </div>
      {canCompare && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Compare")}</p>
          <button onClick={toggleCompare}
            className={`h-8 px-3 text-xs border rounded-md transition-colors ${
              compare ? "bg-foreground text-background border-foreground" : "border-input bg-background hover:bg-secondary"
            }`}>
            {compare ? t("On") : t("Off")}
          </button>
        </div>
      )}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Quick")}</p>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => {
            const today = new Date();
            const fromStr = new Date(today - d * 86_400_000).toISOString().slice(0, 10);
            const toStr = today.toISOString().slice(0, 10);
            const active = from === fromStr && to === toStr;
            return (
              <button key={d} onClick={() => set(fromStr, toStr)}
                className={`h-8 px-2.5 text-xs border rounded-md transition-colors ${
                  active ? "bg-foreground text-background border-foreground" : "border-input bg-background hover:bg-secondary"
                }`}>
                {d}d
              </button>
            );
          })}
        </div>
      </div>
      {canCompare && compare && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("vs. Period")}</p>
          <div className="flex items-center gap-1.5">
            <input type="date" value={compareRange?.from || ""} onChange={(e) => setCmp(e.target.value, compareRange?.to || "")}
              className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={compareRange?.to || ""} onChange={(e) => setCmp(compareRange?.from || "", e.target.value)}
              className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
          </div>
        </div>
      )}
      {(from || to) && (
        <button onClick={() => set("", "")}
          className="h-8 px-3 text-xs border border-input rounded-md bg-background hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground self-end">
          {t("Clear")}
        </button>
      )}
      {note && <p className="self-end pb-1 text-xs text-muted-foreground ml-auto">{note}</p>}
    </div>
  );
}

// ── Loading / empty states ────────────────────────────────────────────────────
export function AnalyticsLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
    </div>
  );
}
