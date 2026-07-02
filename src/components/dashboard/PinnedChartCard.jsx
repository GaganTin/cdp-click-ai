import { useState, useMemo } from "react";
import { X, Maximize2, Minimize2, Pencil, Check, TrendingUp, TrendingDown, MessageSquare, RefreshCw, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MiniChart from "./MiniChart";
import ChartExplainer from "./ChartExplainer";
import { parseChartConfig } from "@/lib/utils";
import { normalizeSize, sizeMeta } from "@/lib/chartSizes";
import { format, subDays, subMonths, parseISO, isAfter, isValid } from "date-fns";

const DATE_FILTERS = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "6m", label: "Last 6 months" },
  { key: "1y", label: "Last 1 year" },
];

// Approximate day counts per finite period, used for the delta (current vs previous window).
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, "6m": 182, "1y": 365 };

const CHART_TYPES = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
];

function applyDateFilter(data, xKey, filterKey) {
  if (filterKey === "all" || !data?.length) return data;
  const now = new Date();
  const cutoff =
    filterKey === "7d" ? subDays(now, 7) :
    filterKey === "30d" ? subDays(now, 30) :
    filterKey === "90d" ? subDays(now, 90) :
    filterKey === "6m" ? subMonths(now, 6) :
    filterKey === "1y" ? subMonths(now, 12) : null;
  if (!cutoff) return data;

  return data.filter(row => {
    const val = row[xKey];
    if (!val) return true;
    try {
      const d = parseISO(String(val));
      return isAfter(d, cutoff);
    } catch {
      return true; // non-date x-axis - keep all
    }
  });
}

export default function PinnedChartCard({ chart: initialChart, onRemove, onCycleSize, onUpdate, onDiscuss, onRefresh, onToggleAutoRefresh, dragHandleProps, size = "small" }) {
  const sz = normalizeSize(size);
  const [chart] = useState(initialChart);

  // Daily-refresh vs snapshot. Charts auto-refresh daily by default (metadata.auto_refresh
  // undefined === on); toggling off freezes the current data as a snapshot. Only meaningful
  // for charts that have a stored query to re-run.
  const [autoRefresh, setAutoRefresh] = useState(chart.metadata?.auto_refresh !== false);
  const toggleAutoRefresh = () => {
    const next = !autoRefresh;
    setAutoRefresh(next);
    onToggleAutoRefresh?.(chart.id, next);
  };

  const config = parseChartConfig(chart.chart_config);
  const xKey = config.xKey || "name";
  const primaryKey = config.series?.[0]?.dataKey || config.dataKey || "value";

  // Chart type is editable on the dashboard: change instantly (local) and persist.
  const [chartType, setChartType] = useState(initialChart.chart_type || config.chart_type || "bar");
  const changeType = (v) => { setChartType(v); onUpdate?.({ ...chart, chart_type: v }); };

  // Manual re-run of the chart's stored query.
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(chart.id); } finally { setRefreshing(false); }
  };

  // Time-period filter + delta can be pre-set by the AI (date_filter / show_delta on
  // the chart config) or toggled manually here. Both paths are supported.
  const initialFilter = DATE_FILTERS.some(f => f.key === config.date_filter) ? config.date_filter : "all";
  const [dateFilter, setDateFilter] = useState(initialFilter);
  const [compare, setCompare] = useState(!!config.show_delta && initialFilter !== "all");

  // Local title so a rename shows immediately (chart object is frozen on mount).
  const [title, setTitle] = useState(initialChart.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialChart.title || "");

  const saveTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== title) {
      setTitle(next);
      onUpdate?.({ ...chart, title: next });
    }
    setEditingTitle(false);
  };

  // Delta/compare only makes sense for a finite period over date-based data.
  const isDateData = useMemo(
    () => (config.data || []).some(r => isValid(parseISO(String(r[xKey])))),
    [chart.chart_config]
  );

  const filteredConfig = useMemo(() => {
    const filtered = applyDateFilter(config.data, xKey, dateFilter);
    return { ...config, data: filtered };
  }, [chart.chart_config, dateFilter]);

  // % change of the primary metric: current window vs the immediately preceding window.
  const delta = useMemo(() => {
    if (!compare || !isDateData) return null;
    const days = PERIOD_DAYS[dateFilter];
    if (!days) return null;
    const now = new Date();
    const curStart = subDays(now, days);
    const prevStart = subDays(now, days * 2);
    const sumBetween = (from, to) => (config.data || []).reduce((sum, row) => {
      const d = parseISO(String(row[xKey]));
      if (isValid(d) && isAfter(d, from) && !isAfter(d, to)) return sum + (Number(row[primaryKey]) || 0);
      return sum;
    }, 0);
    const cur = sumBetween(curStart, now);
    const prev = sumBetween(prevStart, curStart);
    if (prev === 0) return null;
    return { pct: (cur - prev) / prev, cur, prev };
  }, [compare, isDateData, dateFilter, chart.chart_config]);

  const handleDiscuss = () => {
    onDiscuss?.({
      title,
      description: chart.description || "",
      chart_type: chartType,
      chart_config: JSON.stringify(filteredConfig),
      period: DATE_FILTERS.find(f => f.key === dateFilter)?.label || "All time",
      delta: delta ? { pct: delta.pct, current: delta.cur, previous: delta.prev } : null,
    });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-5 hover:shadow-sm transition-shadow h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-2 flex-shrink-0">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground mt-0.5 mr-1 flex-shrink-0"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}
        <div className="min-w-0 flex-1 group/title">
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <Input
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                onBlur={saveTitle}
                className="h-7 text-sm"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onMouseDown={e => e.preventDefault()} onClick={saveTitle}>
                <Check className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <h3 className="text-sm font-semibold truncate flex items-center gap-1">
              {title}
              {onUpdate && (
                <button
                  className="opacity-0 group-hover/title:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0"
                  title="Rename chart"
                  onClick={() => { setTitleDraft(title || ""); setEditingTitle(true); }}
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </h3>
          )}
          {chart.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{chart.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {/* Explain only what's on screen: the filtered/visible data, current type & title.
              Key is period-aware so toggling date ranges reuses each view's summary. */}
          <ChartExplainer
            chart={{ ...chart, chart_type: chartType, title }}
            config={filteredConfig}
            chartKey={chart.id ? `pinned_${chart.id}_${dateFilter}` : undefined}
          />
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title={chart.query ? "Refresh data now" : "This chart has no saved query to refresh"}
              disabled={refreshing || !chart.query}
              onClick={doRefresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
          {onDiscuss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title="Discuss this chart with the AI Analyst"
              onClick={handleDiscuss}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          )}
          {onCycleSize && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title={`Resize chart (${sizeMeta(sz).name})`}
              onClick={onCycleSize}
            >
              {sz === "large" ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Remove from this tab" onClick={() => onRemove?.(chart)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Chart type + date filter + delta/compare */}
      <div className="mb-3 flex-shrink-0 flex items-center gap-2 flex-wrap">
        {onUpdate && (
          <Select value={chartType} onValueChange={changeType}>
            <SelectTrigger className="h-6 text-[11px] w-24 px-2 border-border" title="Chart type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(ct => (
                <SelectItem key={ct.value} value={ct.value} className="text-xs">{ct.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v); if (v === "all") setCompare(false); }}>
          <SelectTrigger className="h-6 text-[11px] w-32 px-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTERS.map(f => (
              <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDateData && (
          <button
            type="button"
            onClick={() => setCompare(c => !c)}
            disabled={dateFilter === "all"}
            title={dateFilter === "all" ? "Pick a time period to compare against the previous one" : "Compare with the previous period"}
            className={`h-6 px-2 text-[11px] rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              compare ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Δ Compare
          </button>
        )}

        {compare && delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
              delta.pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
            title={`Current: ${Number(delta.cur).toLocaleString()} · Previous: ${Number(delta.prev).toLocaleString()}`}
          >
            {delta.pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {(delta.pct * 100).toFixed(1)}%
          </span>
        )}
        {compare && !delta && dateFilter !== "all" && (
          <span className="text-[10px] text-muted-foreground">No prior-period data</span>
        )}

        {onToggleAutoRefresh && chart.query && (
          <button
            type="button"
            onClick={toggleAutoRefresh}
            title={autoRefresh
              ? "Auto-refreshes daily — click to freeze this chart as a snapshot"
              : "Snapshot (data frozen) — click to auto-refresh daily"}
            className={`h-6 px-2 text-[11px] rounded-md border transition-colors inline-flex items-center gap-1 ml-auto ${
              autoRefresh
                ? "bg-foreground text-background border-foreground"
                : "bg-background border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <RefreshCw className="w-3 h-3" />
            {autoRefresh ? "Daily" : "Snapshot"}
          </button>
        )}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <MiniChart type={chartType} config={filteredConfig} />
      </div>

      {chart.last_refreshed && (
        <p className="text-[10px] text-muted-foreground mt-2 flex-shrink-0">
          Refreshed {format(new Date(chart.last_refreshed), "MMM d, h:mm a")}
        </p>
      )}

    </div>
  );
}