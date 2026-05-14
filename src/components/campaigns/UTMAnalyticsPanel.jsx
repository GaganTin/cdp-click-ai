import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";
import { Plus, Maximize2, Minimize2, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ChartExplainer from "@/components/dashboard/ChartExplainer";

const COLORS = ["#1a1a1a", "#555", "#888", "#aaa", "#ccc", "#e0e0e0"];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-md px-3 py-2 text-xs shadow">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">{p.name}: <span className="text-foreground font-medium">{typeof p.value === "number" && p.value % 1 !== 0 ? p.value.toFixed(3) : p.value}</span></p>
      ))}
    </div>
  );
};

const CHART_TYPES = [
  { key: "bar", label: "Bar Chart" },
  { key: "horizontal-bar", label: "Horizontal Bar" },
  { key: "pie", label: "Pie Chart" },
  { key: "line", label: "Line Chart" },
  { key: "area", label: "Area Chart" },
];

const DATA_KEYS = [
  { key: "source", label: "Sessions by Source" },
  { key: "medium", label: "Sessions by Medium" },
  { key: "campaign", label: "Sessions by Campaign" },
  { key: "daily", label: "Daily Sessions (30d)" },
  { key: "bounce", label: "Bounce Rate by Source (%)" },
  { key: "engagement", label: "Engagement Rate by Source (%)" },
  { key: "device", label: "Sessions by Device" },
  { key: "country", label: "Top Countries" },
];

const DEFAULT_CHARTS = [
  { id: "1", title: "Sessions by Source", dataKey: "source", chartType: "bar", size: "normal" },
  { id: "2", title: "Sessions by Device", dataKey: "device", chartType: "pie", size: "normal" },
  { id: "3", title: "Daily Sessions (30d)", dataKey: "daily", chartType: "area", size: "wide" },
  { id: "4", title: "Bounce Rate by Source (%)", dataKey: "bounce", chartType: "horizontal-bar", size: "normal" },
  { id: "5", title: "Sessions by Campaign", dataKey: "campaign", chartType: "bar", size: "normal" },
  { id: "6", title: "Sessions by Medium", dataKey: "medium", chartType: "bar", size: "normal" },
  { id: "7", title: "Top Countries", dataKey: "country", chartType: "horizontal-bar", size: "normal" },
];

// GA auto-tagged values that are not real UTM campaigns
const GA_AUTO_CAMPAIGNS = `('(not set)', '(organic)', '(direct)', '(referral)', '(none)', '(cross-network)')`;

const QUERIES = {
  source: `SELECT session_source AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_source NOT IN ('(not set)', '(none)') GROUP BY session_source ORDER BY value DESC LIMIT 10`,
  medium: `SELECT session_medium AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_medium NOT IN ('(not set)', '(none)') GROUP BY session_medium ORDER BY value DESC LIMIT 10`,
  campaign: `SELECT session_campaign_name AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_campaign_name NOT IN ${GA_AUTO_CAMPAIGNS} AND session_campaign_name NOT LIKE '{%' GROUP BY session_campaign_name ORDER BY value DESC LIMIT 15`,
  daily: `SELECT TO_DATE(date, 'YYYYMMDD') AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') GROUP BY date ORDER BY date ASC`,
  bounce: `SELECT session_source AS name, ROUND((AVG(bounce_rate) * 100)::numeric, 1) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_source NOT IN ('(not set)', '(none)') GROUP BY session_source HAVING SUM(sessions) >= 50 ORDER BY SUM(sessions) DESC LIMIT 10`,
  engagement: `SELECT session_source AS name, ROUND((AVG(engagement_rate) * 100)::numeric, 1) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_source NOT IN ('(not set)', '(none)') GROUP BY session_source HAVING SUM(sessions) >= 50 ORDER BY SUM(sessions) DESC LIMIT 10`,
  device: `SELECT device AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') GROUP BY device ORDER BY value DESC`,
  country: `SELECT country AS name, SUM(sessions) AS value FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') GROUP BY country ORDER BY value DESC LIMIT 10`,
  kpis: `SELECT SUM(sessions) AS total_sessions, SUM(active_users) AS total_users, SUM(new_users) AS total_new_users, ROUND(AVG(bounce_rate)::numeric, 3) AS avg_bounce_rate, ROUND(AVG(engagement_rate)::numeric, 3) AS avg_engagement_rate FROM ga_landing.utm_daily_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD')`,
  utm_links: `SELECT DISTINCT session_source, session_medium, session_campaign_name, session_content, session_term, session_utm_id FROM ga_landing.utm_daily_full_param_performance WHERE date >= TO_CHAR(NOW() - INTERVAL '30 days', 'YYYYMMDD') AND session_campaign_name NOT IN ${GA_AUTO_CAMPAIGNS} ORDER BY session_source, session_medium, session_campaign_name LIMIT 200`,
};

async function runQuery(key) {
  const res = await appClient.functions.invoke("queryPostgres", { query: QUERIES[key] });
  return res.data?.rows || [];
}

function renderChart(chartType, data) {
  const height = 200;
  if (!data?.length) return <p className="text-xs text-muted-foreground py-8 text-center">No data</p>;

  const maxNameLen = chartType === "horizontal-bar" ? 18 : 12;
  const fmtName = (v) => {
    if (!v) return "(none)";
    if (v instanceof Date || (typeof v === "string" && v.includes("T"))) return new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return String(v).length > maxNameLen ? String(v).slice(0, maxNameLen) + "…" : String(v);
  };
  const displayData = data.map(d => ({ ...d, name: fmtName(d.name), value: Number(d.value) }));

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={displayData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" name="Value" fill="#1a1a1a" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "horizontal-bar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={displayData} layout="vertical" margin={{ top: 0, right: 20, left: 5, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" name="Value" fill="#555" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "pie") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={displayData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
            {displayData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={displayData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Line dataKey="value" stroke="#1a1a1a" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={displayData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area dataKey="value" stroke="#1a1a1a" fill="#e8e8e8" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return null;
}

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

export default function UTMAnalyticsPanel() {
  const [charts, setCharts] = useState(DEFAULT_CHARTS);
  const [addingNew, setAddingNew] = useState(false);
  const [chartData, setChartData] = useState({});
  const [kpis, setKpis] = useState(null);
  const [utmLinks, setUtmLinks] = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(new Set());
  const [utmSearch, setUtmSearch] = useState("");

  const loadData = async (key) => {
    if (loadingKeys.has(key)) return;
    setLoadingKeys(prev => new Set([...prev, key]));
    const rows = await runQuery(key);
    setChartData(prev => ({ ...prev, [key]: rows }));
    setLoadingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
  };

  useEffect(() => {
    runQuery("kpis").then(rows => setKpis(rows[0] || null));
    runQuery("utm_links").then(rows => setUtmLinks(rows));
    DEFAULT_CHARTS.forEach(c => loadData(c.dataKey));
  }, []);

  const dataForKey = (key, chart = null) => {
    if (chart?._aiData) return chart._aiData;
    return chartData[key] || [];
  };

  const handleAddNew = (updates) => {
    setCharts(prev => [...prev, { id: Date.now().toString(), size: "normal", ...updates }]);
    if (updates.dataKey && !chartData[updates.dataKey]) loadData(updates.dataKey);
    setAddingNew(false);
  };

  const handleDelete = (id) => setCharts(prev => prev.filter(c => c.id !== id));
  const toggleSize = (id) => setCharts(prev => prev.map(c => c.id === id ? { ...c, size: c.size === "wide" ? "normal" : "wide" } : c));

  const filteredUtmLinks = utmSearch
    ? utmLinks.filter(row =>
        ["session_source", "session_medium", "session_campaign_name", "session_content", "session_term", "session_utm_id"]
          .some(col => String(row[col] || "").toLowerCase().includes(utmSearch.toLowerCase()))
      )
    : utmLinks;

  const fmt = (v) => v != null ? Number(v).toLocaleString() : "—";
  const fmtPct = (v) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : "—";

  return (
    <div className="overflow-auto h-full px-6 py-6 space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: "Sessions (30d)", value: fmt(kpis?.total_sessions) },
          { label: "Active Users", value: fmt(kpis?.total_users) },
          { label: "New Users", value: fmt(kpis?.total_new_users) },
          { label: "Avg Bounce Rate", value: fmtPct(kpis?.avg_bounce_rate) },
          { label: "Avg Engagement", value: fmtPct(kpis?.avg_engagement_rate) },
        ].map(kpi => (
          <div key={kpi.label} className="border border-border rounded-lg p-4 text-center">
            <p className="text-2xl font-semibold font-heading">{kpi.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-2 gap-5">
        {charts.map(chart => {
          const isLoading = loadingKeys.has(chart.dataKey);
          return (
            <div key={chart.id}
              className={`border border-border rounded-lg p-5 ${chart.size === "wide" ? "col-span-2" : "col-span-1"}`}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{chart.title}</p>
                <div className="flex items-center gap-1">
                  <ChartExplainer
                    chart={{ title: chart.title, chart_type: chart.chartType, description: "" }}
                    config={{ data: dataForKey(chart.dataKey, chart) }}
                    chartKey={chart.dataKey}
                  />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleSize(chart.id)}>
                    {chart.size === "wide" ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" title="Delete chart" onClick={() => handleDelete(chart.id)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {isLoading
                ? <div className="h-[200px] flex items-center justify-center"><div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>
                : renderChart(chart.chartType, dataForKey(chart.dataKey, chart))
              }
            </div>
          );
        })}

        {/* Add chart card */}
        <button onClick={() => setAddingNew(true)}
          className="col-span-1 border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors min-h-[160px]">
          <Plus className="w-5 h-5" />
          <span className="text-xs font-medium">Add Chart</span>
        </button>
      </div>

      {/* Distinct UTM Links Table */}
      {utmLinks.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Distinct UTM Links from GA (last 30d) — {filteredUtmLinks.length} of {utmLinks.length} combinations
            </h3>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={utmSearch}
                onChange={e => setUtmSearch(e.target.value)}
                placeholder="Filter by source, medium, campaign…"
                className="pl-8 pr-3 py-1.5 text-xs border border-input rounded-md bg-transparent outline-none focus:ring-1 focus:ring-ring w-64"
              />
            </div>
          </div>
          <div className="border border-border rounded-lg overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead className="bg-secondary/50 sticky top-0">
                <tr>
                  {["Source", "Medium", "Campaign", "Content", "Term", "UTM ID"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUtmLinks.length === 0
                  ? <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">No results match your filter.</td></tr>
                  : filteredUtmLinks.map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.session_source || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.session_medium || "—"}</td>
                      <td className="px-3 py-1.5 max-w-[160px] truncate">{row.session_campaign_name || "—"}</td>
                      <td className="px-3 py-1.5 max-w-[120px] truncate">{row.session_content || "—"}</td>
                      <td className="px-3 py-1.5 max-w-[120px] truncate">{row.session_term || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.session_utm_id || "—"}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addingNew && <ChartEditDialog chart={null} onSave={handleAddNew} onClose={() => setAddingNew(false)} />}
    </div>
  );
}
