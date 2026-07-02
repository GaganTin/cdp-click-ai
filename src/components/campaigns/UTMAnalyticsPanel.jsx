import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { appClient } from "@/api/appClient";
import { useStickyState } from "@/lib/useStickyState";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";
import { Plus, Maximize2, Minimize2, X, Filter, ArrowUp, ArrowDown, ArrowUpDown, Info, Activity, Users, UserPlus, LogOut, Zap, TrendingUp, TrendingDown, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ChartExplainer from "@/components/dashboard/ChartExplainer";
import TableToolbar from "@/components/ui/TableToolbar";
import { KpiTile } from "@/components/analytics/AnalyticsKit";
import { useDiscussChart, buildDiscussPayload } from "@/lib/discussChart";
import { gaRowKey, gaDeltaPct, distinctValues, rowMatchesFilters } from "@/lib/gaTable";
import { useChartTheme, opacityFor } from "@/lib/chartTheme";

// Faded foreground opacity for the comparison ("previous period") series.
const PREV_OPACITY = 0.32;

// ── Date helpers ──────────────────────────────────────────────────────────────
const toDbDate  = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
const toInput   = (d) => new Date(d).toISOString().slice(0, 10);
const daysMs    = (n) => n * 86_400_000;

// ── Parameter filter columns available in the GA table ───────────────────────
const PARAM_COLS = [
  { col: "session_source",        label: "Source" },
  { col: "session_medium",        label: "Medium" },
  { col: "session_campaign_name", label: "Campaign" },
  { col: "device",                label: "Device" },
  { col: "country",               label: "Country" },
];

// ── Chart data fetchers ───────────────────────────────────────────────────────
// All data comes from the company-scoped /api/utm/* routes (server-side aggregation,
// parameterized, tenant-isolated). Each fetcher returns rows of { name, value }.
// paramFilters: { [col]: string } applied where the source table supports it.
function chartParams(s, e, paramFilters = {}) {
  return { start: toDbDate(s), end: toDbDate(e), ...paramFilters };
}

function fetchChart(key, s, e, paramFilters = {}) {
  const p = chartParams(s, e, paramFilters);
  switch (key) {
    case "source":     return appClient.utm.breakdown({ ...p, dim: "session_source", metric: "sessions", limit: 10 });
    case "medium":     return appClient.utm.breakdown({ ...p, dim: "session_medium", metric: "sessions", limit: 10 });
    case "campaign":   return appClient.utm.breakdown({ ...p, dim: "session_campaign_name", metric: "sessions", limit: 15 });
    case "daily":      return appClient.utm.timeseries(p);
    case "bounce":     return appClient.utm.breakdown({ ...p, dim: "session_source", metric: "bounce_rate", minSessions: 50, limit: 10 });
    case "engagement": return appClient.utm.breakdown({ ...p, dim: "session_source", metric: "engagement_rate", minSessions: 50, limit: 10 });
    case "device":     return appClient.utm.breakdown({ ...p, dim: "device", metric: "sessions", limit: 10 });
    case "country":    return appClient.utm.countries({ start: p.start, end: p.end, limit: 10 });
    default:           return Promise.resolve([]);
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-black text-white border border-white rounded-md px-3 py-2 text-xs shadow">
      <p className="font-medium mb-1 text-white">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-white">
          {p.name}: <span className="font-medium text-white">
            {typeof p.value === "number" && p.value % 1 !== 0 ? p.value.toFixed(2) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
};

// ── Chart renderer ────────────────────────────────────────────────────────────
function fmtName(v, isDate = false) {
  if (!v) return "(none)";
  if (isDate || v instanceof Date || (typeof v === "string" && v.includes("T")))
    return new Date(v).toLocaleDateString("en-AU", { month: "short", day: "numeric" });
  return String(v).length > 14 ? String(v).slice(0, 14) + "…" : String(v);
}

function mergeChartData(key, current, prev) {
  const isDate = key === "daily";
  if (isDate) {
    // align by index (relative day position)
    return current.map((d, i) => ({
      name: fmtName(d.name, true),
      value: Number(d.value),
      prev: prev?.[i] != null ? Number(prev[i].value) : undefined,
    }));
  }
  return current.map(d => {
    const prevRow = prev?.find(p => String(p.name) === String(d.name));
    return {
      name: fmtName(d.name),
      value: Number(d.value),
      prev: prevRow ? Number(prevRow.value) : undefined,
    };
  });
}

function renderChart(chartType, dataKey, current, prev, showCompare, theme) {
  const height = 200;
  if (!current?.length) return <p className="text-xs text-muted-foreground py-8 text-center">No data</p>;

  const display = mergeChartData(dataKey, current, prev);
  const fg = theme["--foreground"];
  const tick = { fontSize: 10, fill: theme["--muted-foreground"] };

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={display} margin={{ top: 0, right: 0, left: - 20, bottom: 0 }}>
          <XAxis dataKey="name" tick={tick} />
          <YAxis tick={tick} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(128,128,128,0.12)" }} />
          <Bar dataKey="value" name="Current" fill={fg} radius={[3, 3, 0, 0]} />
          {showCompare && <Bar dataKey="prev" name="Previous" fill={fg} fillOpacity={PREV_OPACITY} radius={[3, 3, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "horizontal-bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={display} layout="vertical" margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={tick} allowDecimals />
          <YAxis type="category" dataKey="name" tick={tick} width={110} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(128,128,128,0.12)" }} />
          <Bar dataKey="value" name="Current" fill={fg} radius={[0, 3, 3, 0]} />
          {showCompare && <Bar dataKey="prev" name="Previous" fill={fg} fillOpacity={PREV_OPACITY} radius={[0, 3, 3, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={display} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
            stroke={theme["--card"]} strokeWidth={2}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
            {display.map((_, i) => <Cell key={i} fill={fg} fillOpacity={opacityFor(i)} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={display} margin={{ top: 0, right: 10, left: - 20, bottom: 0 }}>
          <XAxis dataKey="name" tick={tick} />
          <YAxis tick={tick} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Line dataKey="value" name="Current" stroke={fg} strokeWidth={2} dot={{ r: 3 }} />
          {showCompare && <Line dataKey="prev" name="Previous" stroke={fg} strokeOpacity={PREV_OPACITY} strokeWidth={1.5} dot={{ r: 2 }} strokeDasharray="4 2" />}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={display} margin={{ top: 0, right: 10, left: - 20, bottom: 0 }}>
          <XAxis dataKey="name" tick={tick} />
          <YAxis tick={tick} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area dataKey="value" name="Current" stroke={fg} fill={fg} fillOpacity={0.12} strokeWidth={2} />
          {showCompare && <Area dataKey="prev" name="Previous" stroke={fg} strokeOpacity={PREV_OPACITY} fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return null;
}

// ── Chart types / data keys ───────────────────────────────────────────────────
const CHART_TYPES = [
  { key: "bar",            label: "Bar Chart" },
  { key: "horizontal-bar", label: "Horizontal Bar" },
  { key: "pie",            label: "Pie Chart" },
  { key: "line",           label: "Line Chart" },
  { key: "area",           label: "Area Chart" },
];

const DATA_KEYS = [
  { key: "source",     label: "Sessions by Source" },
  { key: "medium",     label: "Sessions by Medium" },
  { key: "campaign",   label: "Sessions by Campaign" },
  { key: "daily",      label: "Sessions Trend" },
  { key: "bounce",     label: "Bounce Rate by Source (%)" },
  { key: "engagement", label: "Engagement Rate by Source (%)" },
  { key: "device",     label: "Sessions by Device" },
  { key: "country",    label: "Top Countries" },
];

const DEFAULT_CHARTS = [
  { id: "1", title: "Sessions by Source",    dataKey: "source",     chartType: "bar",            size: "normal" },
  { id: "2", title: "Sessions by Device",    dataKey: "device",     chartType: "pie",            size: "normal" },
  { id: "3", title: "Sessions Trend",        dataKey: "daily",      chartType: "area",           size: "wide" },
  { id: "4", title: "Bounce Rate by Source", dataKey: "bounce",     chartType: "horizontal-bar", size: "normal" },
  { id: "5", title: "Sessions by Campaign",  dataKey: "campaign",   chartType: "bar",            size: "normal" },
  { id: "6", title: "Sessions by Medium",    dataKey: "medium",     chartType: "bar",            size: "normal" },
  { id: "7", title: "Top Countries",         dataKey: "country",    chartType: "horizontal-bar", size: "normal" },
];

// ── Chart edit dialog ─────────────────────────────────────────────────────────
function ChartEditDialog({ chart, onSave, onClose }) {
  const [title, setTitle] = useState(chart?.title || "");
  const [dataKey, setDataKey] = useState(chart?.dataKey || "source");
  const [chartType, setChartType] = useState(chart?.chartType || "bar");
  const isNew = !chart?.id;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">{isNew ? "Add Chart" : "Edit Chart"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-transparent outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Data</label>
            <select value={dataKey} onChange={e => setDataKey(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring">
              {DATA_KEYS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Chart Type</label>
            <select value={chartType} onChange={e => setChartType(e.target.value)}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring">
              {CHART_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onSave({ title: title || DATA_KEYS.find(d => d.key === dataKey)?.label, dataKey, chartType })}>
              {isNew ? "Add Chart" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UTMAnalyticsPanel() {
  const now = new Date();
  const theme = useChartTheme();

  // Period, compare toggle and filters persist across refresh (localStorage).
  const [curStart, setCurStart] = useStickyState(toInput(new Date(now - daysMs(30))), "utmAnalytics.curStart");
  const [curEnd,   setCurEnd]   = useStickyState(toInput(now), "utmAnalytics.curEnd");
  const [prevStart, setPrevStart] = useStickyState(toInput(new Date(now - daysMs(61))), "utmAnalytics.prevStart");
  const [prevEnd,   setPrevEnd]   = useStickyState(toInput(new Date(now - daysMs(31))), "utmAnalytics.prevEnd");
  const [compare,  setCompare]  = useStickyState(false, "utmAnalytics.compare");

  // paramFilters: { [col]: string } - single selected value per column
  const [paramFilters,    setParamFilters]    = useStickyState({}, "utmAnalytics.paramFilters");
  // availableVals: { [col]: string[] } - distinct values fetched from DB
  const [availableVals,   setAvailableVals]   = useState({});
  const [showParamFilter, setShowParamFilter] = useState(false);
  const [loadingVals,     setLoadingVals]     = useState(false);
  const paramFilterRef = useRef(null);

  const [charts, setCharts] = useState(DEFAULT_CHARTS);
  const [addingNew, setAddingNew] = useState(false);

  const [curData,  setCurData]  = useState({});
  const [prevData, setPrevData] = useState({});
  const [curKpis,  setCurKpis]  = useState(null);
  const [prevKpis, setPrevKpis] = useState(null);
  const [loading,  setLoading]  = useState(false);

  // Hand a chart over to the AI Analyst, scoped to the period/filters shown here.
  const discuss = useDiscussChart();
  const periodLabel = `${curStart} → ${curEnd}${compare ? " (vs previous period)" : ""}`;
  const discussChart = (chart) => discuss(buildDiscussPayload({
    title: chart.title,
    type: chart.chartType,
    data: curData[chart.dataKey] || [],
    period: periodLabel,
  }));

  // Use ref so loadAll always sees latest charts without being in its dep array
  const chartsRef = useRef(charts);
  chartsRef.current = charts;

  // Close filter panel on outside click
  useEffect(() => {
    const handler = (e) => { if (paramFilterRef.current && !paramFilterRef.current.contains(e.target)) setShowParamFilter(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-sync prev period to same duration shifted back
  const syncPrevPeriod = (cs, ce) => {
    const s = new Date(cs), e = new Date(ce);
    const duration = e - s;
    const pe = new Date(s.getTime() - daysMs(1));
    const ps = new Date(pe.getTime() - duration);
    setPrevEnd(toInput(pe));
    setPrevStart(toInput(ps));
  };

  // Stable key for paramFilters to use in dep array
  const paramFiltersKey = JSON.stringify(paramFilters);

  // Load all data for current + (optionally) previous period
  useEffect(() => {
    async function load() {
      setLoading(true);
      const keys = [...new Set(chartsRef.current.map(c => c.dataKey))];
      const s = new Date(curStart), e = new Date(curEnd);
      const ps = new Date(prevStart), pe = new Date(prevEnd);

      const [kpiRow, ...chartRows] = await Promise.all([
        appClient.utm.kpis(chartParams(s, e, paramFilters)),
        ...keys.map(k => fetchChart(k, s, e, paramFilters)),
      ]);
      setCurKpis(kpiRow || null);
      const cd = {};
      keys.forEach((k, i) => { cd[k] = chartRows[i]; });
      setCurData(cd);

      if (compare) {
        const [pkpiRow, ...pchartRows] = await Promise.all([
          appClient.utm.kpis(chartParams(ps, pe, paramFilters)),
          ...keys.map(k => fetchChart(k, ps, pe, paramFilters)),
        ]);
        setPrevKpis(pkpiRow || null);
        const pd = {};
        keys.forEach((k, i) => { pd[k] = pchartRows[i]; });
        setPrevData(pd);
      } else {
        setPrevKpis(null);
        setPrevData({});
      }
      setLoading(false);
    }
    load();
  }, [curStart, curEnd, prevStart, prevEnd, compare, paramFiltersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load distinct values for all columns when the filter panel opens
  useEffect(() => {
    if (!showParamFilter) return;
    const missing = PARAM_COLS.map(p => p.col).filter(col => !availableVals[col]);
    if (!missing.length) return;
    setLoadingVals(true);
    const s = new Date(curStart), e = new Date(curEnd);
    Promise.all(missing.map(col =>
      appClient.utm.paramValues({ col, start: toDbDate(s), end: toDbDate(e) }).then(vals => [col, vals])
    )).then(results => {
      setAvailableVals(prev => { const n = { ...prev }; results.forEach(([col, vals]) => { n[col] = vals; }); return n; });
      setLoadingVals(false);
    });
  }, [showParamFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddNew = (updates) => {
    setCharts(prev => [...prev, { id: Date.now().toString(), size: "normal", ...updates }]);
    setAddingNew(false);
    if (!curData[updates.dataKey]) {
      fetchChart(updates.dataKey, new Date(curStart), new Date(curEnd), paramFilters)
        .then(rows => setCurData(prev => ({ ...prev, [updates.dataKey]: rows })));
      if (compare) {
        fetchChart(updates.dataKey, new Date(prevStart), new Date(prevEnd), paramFilters)
          .then(rows => setPrevData(prev => ({ ...prev, [updates.dataKey]: rows })));
      }
    }
  };

  const handleDelete = (id) => setCharts(prev => prev.filter(c => c.id !== id));
  const toggleSize   = (id) => setCharts(prev => prev.map(c => c.id === id ? { ...c, size: c.size === "wide" ? "normal" : "wide" } : c));

  const fmt    = (v) => v != null ? Number(v).toLocaleString() : "-";
  const fmtPct = (v) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : "-";

  const KPI_DEFS = [
    { label: "Sessions",       cur: curKpis?.total_sessions,      prev: prevKpis?.total_sessions,      fmt: fmt,    icon: Activity, isRate: false },
    { label: "Active Users",   cur: curKpis?.total_users,         prev: prevKpis?.total_users,         fmt: fmt,    icon: Users,    isRate: false },
    { label: "New Users",      cur: curKpis?.total_new_users,     prev: prevKpis?.total_new_users,     fmt: fmt,    icon: UserPlus, isRate: false },
    { label: "Avg Bounce",     cur: curKpis?.avg_bounce_rate,     prev: prevKpis?.avg_bounce_rate,     fmt: fmtPct, icon: LogOut,   isRate: true  },
    { label: "Avg Engagement", cur: curKpis?.avg_engagement_rate, prev: prevKpis?.avg_engagement_rate, fmt: fmtPct, icon: Zap,      isRate: true  },
  ];

  return (
    <div className="overflow-auto h-full px-6 py-6 space-y-6">

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-4 p-4 border border-border rounded-lg bg-secondary/20">
        {/* Current period */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Period</p>
          <div className="flex items-center gap-1.5">
            <input type="date" value={curStart} onChange={e => setCurStart(e.target.value)}
              className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={curEnd} onChange={e => setCurEnd(e.target.value)}
              className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
          </div>
        </div>

        {/* Compare toggle */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Compare</p>
          <button
            onClick={() => { if (!compare) syncPrevPeriod(curStart, curEnd); setCompare(v => !v); }}
            className={`h-8 px-3 text-xs rounded-md border transition-colors ${compare ? "bg-foreground text-background border-foreground" : "bg-background border-input hover:bg-secondary"}`}>
            {compare ? "On" : "Off"}
          </button>
        </div>

        {/* Quick ranges */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Quick</p>
          <div className="flex gap-1">
            {[7, 30, 90].map(d => (
              <button key={d}
                onClick={() => { const e = new Date(); const s = new Date(e - daysMs(d)); setCurEnd(toInput(e)); setCurStart(toInput(s)); if (compare) syncPrevPeriod(toInput(s), toInput(e)); }}
                className="h-8 px-2.5 text-xs border border-input rounded-md bg-background hover:bg-secondary transition-colors">
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Comparison date pickers */}
        {compare && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">vs. Period</p>
            <div className="flex items-center gap-1.5">
              <input type="date" value={prevStart} onChange={e => setPrevStart(e.target.value)}
                className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
              <span className="text-xs text-muted-foreground">→</span>
              <input type="date" value={prevEnd} onChange={e => setPrevEnd(e.target.value)}
                className="h-8 px-2 text-xs border border-input rounded-md bg-background" />
            </div>
          </div>
        )}

        {/* Filters button - matches UTM links tab style */}
        <div ref={paramFilterRef} className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Filters</p>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowParamFilter(v => !v)}>
            <Filter className="w-3.5 h-3.5" /> Filters
            {Object.values(paramFilters).some(Boolean) && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
          </Button>

          {showParamFilter && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-80 md:w-[480px]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Filter by</p>
                {Object.values(paramFilters).some(Boolean) && (
                  <button onClick={() => setParamFilters({})} className="text-[11px] text-muted-foreground hover:text-foreground">Clear all</button>
                )}
              </div>
              {loadingVals ? (
                <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" /> Loading values…
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                  {PARAM_COLS.map(({ col, label }) => (
                    <div key={col}>
                      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                      <select value={paramFilters[col] || ""} onChange={e => setParamFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        <option value="">All</option>
                        {(availableVals[col] || []).map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active filter pills */}
      {Object.entries(paramFilters).some(([, v]) => v) && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(paramFilters).filter(([, v]) => v).map(([col, val]) => {
            const label = PARAM_COLS.find(p => p.col === col)?.label || col;
            return (
              <span key={col} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                {label}: <strong>{val}</strong>
                <button onClick={() => setParamFilters(prev => ({ ...prev, [col]: "" }))}
                  className="hover:text-foreground text-muted-foreground ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── KPI cards (shared AnalyticsKit) ────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {KPI_DEFS.map(kpi => (
          <KpiTile
            key={kpi.label}
            label={kpi.label}
            icon={kpi.icon}
            isRate={kpi.isRate}
            value={loading
              ? <span className="inline-block h-7 w-16 bg-secondary animate-pulse rounded align-middle" />
              : kpi.fmt(kpi.cur)}
            curr={compare && !loading ? kpi.cur : undefined}
            prev={compare && !loading ? kpi.prev : undefined}
            prevDisplay={kpi.fmt(kpi.prev)}
          />
        ))}
      </div>

      {/* ── Charts grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5">
        {charts.map(chart => (
          <div key={chart.id}
            className={`border border-border rounded-lg p-5 ${chart.size === "wide" ? "col-span-2" : "col-span-1"}`}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{chart.title}</p>
              <div className="flex items-center gap-1">
                <ChartExplainer
                  chart={{ title: chart.title, chart_type: chart.chartType, description: "" }}
                  config={{ data: curData[chart.dataKey] || [] }}
                  chartKey={chart.dataKey}
                />
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  title="Discuss this chart with the AI Analyst" onClick={() => discussChart(chart)}>
                  <MessageSquare className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleSize(chart.id)}>
                  {chart.size === "wide" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(chart.id)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {loading
              ? <div className="h-[200px] flex items-center justify-center"><div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>
              : renderChart(chart.chartType, chart.dataKey, curData[chart.dataKey] || [], prevData[chart.dataKey], compare, theme)
            }
          </div>
        ))}

        <button onClick={() => setAddingNew(true)}
          className="col-span-1 border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors min-h-[160px]">
          <Plus className="w-5 h-5" />
          <span className="text-xs font-medium">Add Chart</span>
        </button>
      </div>

      {addingNew && <ChartEditDialog chart={null} onSave={handleAddNew} onClose={() => setAddingNew(false)} />}
    </div>
  );
}

// ── Shared column info tooltip ────────────────────────────────────────────────
// The tooltip is portaled to <body> with fixed positioning so it escapes the
// table's overflow-auto scroll container, which would otherwise clip it.
function ColInfo({ text }) {
  const iconRef = useRef(null);
  const [coords, setCoords] = useState(null);

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (r) setCoords({ left: r.left + r.width / 2, top: r.top });
  };
  const hide = () => setCoords(null);

  return (
    <span
      ref={iconRef}
      className="ml-0.5 inline-flex items-center cursor-default"
      onClick={e => e.stopPropagation()}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <Info className="w-3 h-3 opacity-40 hover:opacity-80 transition-opacity" />
      {coords && createPortal(
        <span
          style={{ position: "fixed", left: coords.left, top: coords.top - 8, transform: "translate(-50%, -100%)" }}
          className="pointer-events-none z-[100] w-56 p-2.5 text-[11px] leading-relaxed bg-popover border border-border rounded-lg shadow-lg text-foreground font-normal normal-case tracking-normal text-left whitespace-normal"
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}

// ── GA UTM Links Table ────────────────────────────────────────────────────────
const fmtNum = (v) => (v != null ? Number(v).toLocaleString() : "-");
const fmtRate = (v) => (v != null ? `${(Number(v) * 100).toFixed(1)}%` : "-");

const UTM_COLS = [
  { key: "session_source",        label: "Source",      defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "session_medium",        label: "Medium",      defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "session_campaign_name", label: "Campaign",    defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "session_content",       label: "Content",     defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "session_term",          label: "Term",        defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "session_utm_id",        label: "UTM ID",      defaultVisible: true,  filterable: true,  filterType: "multiselect" },
  { key: "sessions",              label: "Sessions",    defaultVisible: true,  filterable: false, numeric: true, align: "right", format: fmtNum,  info: "GA4 Sessions: the number of sessions that began on your site or app. A session is a period of user engagement that starts when a user opens your site/app in the foreground; it ends after 30 minutes of inactivity (a new session starts on the user's return)." },
  { key: "active_users",          label: "Active Users",defaultVisible: true,  filterable: false, numeric: true, align: "right", format: fmtNum,  info: "GA4 Active Users: the number of distinct users who had an engaged session (a session lasting 10+ seconds, with a conversion event, or 2+ page/screen views). In GA4 this is the primary 'Users' metric, counting only people who actively engaged rather than every visitor." },
  { key: "new_users",             label: "New Users",   defaultVisible: true,  filterable: false, numeric: true, align: "right", format: fmtNum,  info: "GA4 New Users: the number of users who interacted with your site or app for the first time, counted by the first_visit (or first_open) event. Returning users are excluded." },
  { key: "bounce_rate",           label: "Bounce",      defaultVisible: true,  filterable: false, numeric: true, align: "right", format: fmtRate, info: "GA4 Bounce Rate: the percentage of sessions that were NOT engaged - i.e. sessions shorter than 10 seconds with no conversion event and fewer than 2 page/screen views. It is the inverse of Engagement Rate (Bounce Rate = 100% − Engagement Rate), and differs from the old Universal Analytics single-page-visit definition." },
  { key: "engagement_rate",       label: "Engagement",  defaultVisible: true,  filterable: false, numeric: true, align: "right", format: fmtRate, info: "GA4 Engagement Rate: the percentage of sessions that were engaged sessions - sessions that lasted 10+ seconds, included a conversion event, or had 2 or more page/screen views - out of all sessions." },
];

// Period options for the GA table; keys match the `days` value sent to the API
// ("all" = full history, no date filter).
export const GA_PERIODS = [
  { value: "all", label: "All time" },
  { value: "7",   label: "Last 7 days" },
  { value: "30",  label: "Last 30 days" },
  { value: "90",  label: "Last 90 days" },
  { value: "365", label: "Last 365 days" },
];
const gaPeriodLabel = (days) =>
  (GA_PERIODS.find(p => p.value === String(days))?.label || "All time").toLowerCase();

// Relative % change of a metric vs the comparison period, as a small coloured badge.
function GADelta({ curr, prev }) {
  const pct = gaDeltaPct(curr, prev);
  if (pct == null) return null;
  const p = Number(prev);
  const up = pct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-medium tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
      title={`vs previous period: ${p.toLocaleString()}`}
    >
      {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
      {up ? "+" : ""}{pct.toFixed(0)}%
    </span>
  );
}

export function GAUtmLinksSection({ days = "all", compare = false, onDaysChange, onCompareChange }) {
  const discuss = useDiscussChart();
  const [utmLinks, setUtmLinks]     = useState([]);
  const [prevLinks, setPrevLinks]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState("");
  const [filters, setFilters]       = useState({});
  const [colOrder, setColOrder]     = useState(() => UTM_COLS.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(UTM_COLS.filter(c => c.defaultVisible === false).map(c => c.key)));
  const [selected, setSelected]     = useState(new Set());
  const [sortKey, setSortKey]       = useState("");
  const [sortDir, setSortDir]       = useState("asc");

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Comparison is only meaningful for a finite window (all-time has no prior period).
  const wantCompare = compare && days !== "all";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      appClient.utm.links(days),
      wantCompare ? appClient.utm.links(days, true) : Promise.resolve(null),
    ])
      .then(([rows, prevRows]) => {
        if (cancelled) return;
        setUtmLinks(rows || []);
        setPrevLinks(prevRows || null);
        setLoading(false);
      })
      .catch(e => { if (!cancelled) { setError(e?.message || "Failed to load GA UTM data"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [days, wantCompare]);

  const setFilter  = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const toggleCol  = (k) => setHiddenCols(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else if (colOrder.filter(x => !n.has(x)).length > 1) n.add(k); return n; });
  const moveCol    = (k, d) => setColOrder(p => { const i = p.indexOf(k); if (i < 0) return p; const n = [...p]; if (d === "up" && i > 0) [n[i-1], n[i]] = [n[i], n[i-1]]; else if (d === "down" && i < p.length - 1) [n[i], n[i+1]] = [n[i+1], n[i]]; return n; });

  // Dropdown filter options come from the values actually present in the loaded
  // rows (which are the DB utm table rows for the selected period) - so every
  // option maps to at least one visible row, and the list respects the period.
  const filterCols = UTM_COLS.map(c =>
    c.filterType === "multiselect" ? { ...c, options: distinctValues(utmLinks, c.key) } : c
  );

  const filtered = utmLinks.filter(row => {
    if (search) {
      const q = search.toLowerCase();
      if (!UTM_COLS.some(c => String(row[c.key] || "").toLowerCase().includes(q))) return false;
    }
    return rowMatchesFilters(row, filters);
  });

  const sortCol = UTM_COLS.find(c => c.key === sortKey);
  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        let cmp;
        if (sortCol?.numeric) {
          const av = a[sortKey] == null ? -Infinity : Number(a[sortKey]);
          const bv = b[sortKey] == null ? -Infinity : Number(b[sortKey]);
          cmp = av - bv;
        } else {
          cmp = String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""));
        }
        return sortDir === "asc" ? cmp : - cmp;
      })
    : filtered;

  const visibleCols = colOrder.filter(k => !hiddenCols.has(k)).map(k => UTM_COLS.find(c => c.key === k)).filter(Boolean);

  // Row key for GA rows (no ID - composite key). Includes session_utm_id to match
  // the /links GROUP BY exactly, so selection and prev-period lookups are 1:1.
  const rowKey = gaRowKey;

  // Previous-period rows keyed for O(1) lookup when rendering per-metric deltas.
  const prevByKey = wantCompare && prevLinks
    ? new Map(prevLinks.map(r => [rowKey(r), r]))
    : null;

  const allPageIds     = filtered.map(rowKey);
  const allSelected    = allPageIds.length > 0 && allPageIds.every(k => selected.has(k));
  const someSelected   = allPageIds.some(k => selected.has(k));
  const toggleRow      = (key) => setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAll      = () => {
    if (allSelected) { setSelected(prev => { const n = new Set(prev); allPageIds.forEach(k => n.delete(k)); return n; }); }
    else             { setSelected(prev => { const n = new Set(prev); allPageIds.forEach(k => n.add(k)); return n; }); }
  };

  const selectedRows   = filtered.filter(row => selected.has(rowKey(row)));

  const exportCsv = (rows = filtered) => {
    if (!rows.length) return;
    const header = visibleCols.map(c => c.label).join(",");
    const body = rows.map(row => visibleCols.map(c => {
      const v = String(row[c.key] || "");
      return v.includes(",") ? `"${v}"` : v;
    }).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "ga-utm-links.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const copySelected = () => {
    const header = "Source\tMedium\tCampaign\tContent\tTerm";
    const rows = selectedRows.map(r =>
      [r.session_source, r.session_medium, r.session_campaign_name, r.session_content, r.session_term]
        .map(v => v || "")
        .join("\t")
    ).join("\n");
    navigator.clipboard.writeText(`${header}\n${rows}`);
  };

  // Hand the current (filtered + sorted) table to the AI Analyst, scoped to whatever
  // time period is selected - the same rows shown here. When comparison is on, each
  // row also carries its previous-period value and % delta (matching the on-screen
  // table), plus an aggregate Sessions delta so the chat message states the change.
  const discussTable = () => {
    const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
    const METRICS = [
      { key: "sessions", label: "Sessions" },
      { key: "active_users", label: "Active users" },
      { key: "new_users", label: "New users" },
      { key: "bounce_rate", label: "Bounce rate" },
      { key: "engagement_rate", label: "Engagement rate" },
    ];

    const rows = sorted.slice(0, 50).map(r => {
      const prev = wantCompare && prevByKey ? prevByKey.get(rowKey(r)) : null;
      const row = {
        name: [r.session_source, r.session_medium, r.session_campaign_name].filter(Boolean).join(" / ") || "(not set)",
      };
      for (const m of METRICS) {
        row[m.key] = r[m.key];
        if (wantCompare) {
          row[`${m.key}_prev`] = prev ? prev[m.key] ?? null : null;
          row[`${m.key}_delta_pct`] = prev ? round1(gaDeltaPct(r[m.key], prev[m.key])) : null;
        }
      }
      return row;
    });

    // Columns: each metric, followed by its prev + Δ% when comparing.
    const columns = [{ key: "name", label: "Source / Medium / Campaign" }];
    for (const m of METRICS) {
      columns.push({ key: m.key, label: m.label });
      if (wantCompare) {
        columns.push({ key: `${m.key}_prev`, label: `${m.label} (prev)` });
        columns.push({ key: `${m.key}_delta_pct`, label: `${m.label} Δ%` });
      }
    }

    // Aggregate Sessions delta across the sent rows, so buildDiscussPrompt emits the
    // "Change vs previous period" context line.
    let delta = null;
    if (wantCompare && prevByKey) {
      const sent = sorted.slice(0, 50);
      const cur = sent.reduce((s, r) => s + (Number(r.sessions) || 0), 0);
      const prevTotal = sent.reduce((s, r) => {
        const p = prevByKey.get(rowKey(r));
        return s + (p ? Number(p.sessions) || 0 : 0);
      }, 0);
      if (prevTotal > 0) delta = { pct: (cur - prevTotal) / prevTotal, current: cur, previous: prevTotal };
    }

    discuss(buildDiscussPayload({
      title: `GA Traffic Performance (${gaPeriodLabel(days)}${wantCompare ? " vs previous period" : ""})`,
      description: "GA4 source / medium / campaign performance from the UTM page",
      render: "table",
      data: rows,
      columns,
      period: `${gaPeriodLabel(days)}${wantCompare ? " vs previous period" : ""}`,
      delta,
      source: "Campaigns (UTM) page",
    }));
  };

  // Header stays visible in every state (loading / error / empty / table) so the time
  // period filter is always reachable - including when the current window has no data.
  const header = (
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        GA Traffic Performance ({gaPeriodLabel(days)}{wantCompare ? " vs previous period" : ""})
      </h3>
      <div className="flex items-center gap-1.5">
        {onDaysChange && (
          <select value={String(days)} onChange={e => onDaysChange(e.target.value)}
            title="Filter this table by time period"
            className="h-7 px-2 text-[11px] bg-background border border-input rounded-md text-foreground">
            {GA_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        )}
        {onCompareChange && (
          <button type="button" onClick={() => onCompareChange(!compare)} disabled={days === "all"}
            title={days === "all" ? "Pick a time period to compare against the previous one" : "Compare with the previous period"}
            className={`h-7 px-2 text-[11px] rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              wantCompare ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:text-foreground"
            }`}>
            Δ Compare
          </button>
        )}
        <button type="button" onClick={discussTable} disabled={!sorted.length}
          title="Discuss this table with the AI Analyst"
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="mt-8">
        {header}
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
          <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
          Loading GA UTM data…
        </div>
      </div>
    );
  }

  // A genuine fetch failure is surfaced (so it isn't mistaken for "no data").
  if (error) {
    return (
      <div className="mt-8">
        {header}
        <p className="text-xs text-muted-foreground">Couldn't load GA UTM data: {error}</p>
      </div>
    );
  }
  // Loaded but nothing to show: the GA data has no traffic in the selected window.
  // Say so (and keep the period filter above) rather than rendering nothing.
  if (utmLinks.length === 0) {
    return (
      <div className="mt-8">
        {header}
        <p className="text-xs text-muted-foreground">
          No Google Analytics traffic found for {gaPeriodLabel(days)}. Connect and sync
          Google Analytics, and this table will list the source / medium / campaign
          combinations seen in your data.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {header}
      <TableToolbar
        search={search} onSearch={v => { setSearch(v); setSelected(new Set()); }}
        columns={filterCols} colOrder={colOrder} hiddenCols={hiddenCols}
        onToggleCol={toggleCol} onMoveCol={moveCol}
        filters={filters} onFilter={setFilter}
        resultCount={filtered.length} totalCount={utmLinks.length}
        placeholder="Search source, medium, campaign…"
      />

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
          <span className="font-medium text-sm flex-shrink-0">{selected.size} selected</span>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={copySelected}
              className="h-7 px-2.5 text-xs rounded-md bg-background/10 text-background hover:bg-background/20 flex items-center gap-1.5">
              Copy params
            </button>
            <button
              onClick={() => exportCsv(selectedRows)}
              className="h-7 px-2.5 text-xs rounded-md bg-background/10 text-background hover:bg-background/20 flex items-center gap-1.5">
              Export CSV
            </button>
          </div>
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0">
            Clear
          </button>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-auto max-h-72">
        <table className="w-full text-xs">
          <thead className="bg-secondary/50 sticky top-0">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" className="rounded border-border cursor-pointer"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll} />
              </th>
              {visibleCols.map(col => (
                <th key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}>
                  <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
                    {col.label}
                    {col.info && <ColInfo text={col.info} />}
                    {sortKey === col.key
                      ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                      : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={visibleCols.length + 1} className="px-3 py-4 text-center text-muted-foreground">No results match your filter.</td></tr>
            ) : sorted.map((row, i) => {
              const key = rowKey(row);
              const isSelected = selected.has(key);
              return (
                <tr key={i}
                  className={`border-t border-border cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/20"}`}
                  onClick={() => toggleRow(key)}>
                  <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded border-border cursor-pointer"
                      checked={isSelected} onChange={() => toggleRow(key)} />
                  </td>
                  {visibleCols.map(col => {
                    const prevRow = col.numeric && prevByKey ? prevByKey.get(key) : null;
                    return (
                      <td key={col.key} className={`px-3 py-1.5 max-w-[160px] truncate whitespace-nowrap ${col.align === "right" ? "text-right tabular-nums" : ""}`}>
                        <div className={col.align === "right" ? "flex flex-col items-end leading-tight" : ""}>
                          <span>{col.format ? col.format(row[col.key]) : (row[col.key] || "-")}</span>
                          {prevRow && <GADelta curr={row[col.key]} prev={prevRow[col.key]} />}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
