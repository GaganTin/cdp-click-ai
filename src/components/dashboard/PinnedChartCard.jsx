import { useState, useMemo } from "react";
import { Maximize2, Minimize2, Pencil, Check, TrendingUp, TrendingDown, MessageSquare, RefreshCw, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import MiniChart from "./MiniChart";
import ChartExplainer from "./ChartExplainer";
import { parseChartConfig } from "@/lib/utils";
import { normalizeSize } from "@/lib/chartSizes";
import { format, subDays, parseISO, isValid } from "date-fns";

const DATE_FILTERS = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "cal_month", label: "Last calendar month" },
  { key: "90d", label: "Last 90 days" },
  { key: "6m", label: "Last 6 months" },
  { key: "1y", label: "Last 1 year" },
  { key: "cal_year", label: "Last calendar year" },
];

// Rolling-window day counts (calendar periods are handled separately in windowFor).
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, "6m": 182, "1y": 365 };

const CHART_TYPES = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Pie" },
];

// Parse an x-axis value into a Date, or null if it isn't a date. parseISO does
// NOT throw on bad input - it returns an Invalid Date - so we must check validity
// explicitly. Handles the ISO shapes our queries emit ("2026-06-23", "2026-06",
// "2026") plus space-separated timestamps ("2026-06-23 12:00:00"). Anything else
// (category labels like "Chrome", "United States") returns null.
function toDate(val) {
  if (val == null || val === "") return null;
  const d = parseISO(String(val).trim().replace(" ", "T"));
  return isValid(d) ? d : null;
}

// The [from, to) date window for a period filter, or null for "all". Rolling
// periods end now; calendar periods cover the previous whole month / year.
function windowFor(filterKey, now) {
  if (filterKey === "cal_month") {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
             to:   new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (filterKey === "cal_year") {
    const y = now.getFullYear() - 1;
    return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
  }
  const days = PERIOD_DAYS[filterKey];
  if (!days) return null;
  return { from: subDays(now, days), to: now };
}

function applyDateFilter(data, xKey, filterKey) {
  if (filterKey === "all" || !data?.length) return data;
  const win = windowFor(filterKey, new Date());
  if (!win) return data;

  return data.filter(row => {
    const d = toDate(row[xKey]);
    if (!d) return true; // non-date x-axis (categorical) - keep the row
    return d >= win.from && d < win.to;
  });
}

export default function PinnedChartCard({ chart: initialChart, onRemove, onCycleSize, onUpdate, onDiscuss, onToggleAutoRefresh, dragHandleProps, size = "small" }) {
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

  const filteredConfig = useMemo(() => {
    // applyDateFilter keeps rows whose x-axis isn't a date, so this is safe on
    // categorical charts (the window simply has no effect there).
    const filtered = applyDateFilter(config.data, xKey, dateFilter);
    return { ...config, data: filtered };
  }, [chart.chart_config, dateFilter]);

  // % change of the primary metric: the selected window vs the immediately preceding
  // window of the SAME length (e.g. last 7 days vs the 7 days before that).
  const delta = useMemo(() => {
    if (!compare) return null;
    const win = windowFor(dateFilter, new Date());
    if (!win) return null; // "all time" has no comparable prior period
    const lenMs = win.to - win.from;
    const prevWin = { from: new Date(win.from.getTime() - lenMs), to: win.from };
    const sumWindow = (w) => (config.data || []).reduce((sum, row) => {
      const d = toDate(row[xKey]);
      if (d && d >= w.from && d < w.to) return sum + (Number(row[primaryKey]) || 0);
      return sum;
    }, 0);
    const cur = sumWindow(win);
    const prev = sumWindow(prevWin);
    if (prev === 0) return null;
    return { pct: (cur - prev) / prev, cur, prev };
  }, [compare, dateFilter, chart.chart_config]);

  const handleDiscuss = () => {
    onDiscuss?.({
      title,
      description: chart.description || "",
      chart_type: chartType,
      // Carry the LIVE chart type (chartType is editable after mount; filteredConfig
      // keeps the frozen original), so a pie/line stays a pie/line in the chat.
      chart_config: JSON.stringify({ ...filteredConfig, chart_type: chartType }),
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
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
          {/* Primary actions stay visible: explain what's on screen + discuss in chat.
              Explain key is period-aware so toggling date ranges reuses each summary. */}
          <ChartExplainer
            chart={{ ...chart, chart_type: chartType, title }}
            config={filteredConfig}
            chartKey={chart.id ? `pinned_${chart.id}_${dateFilter}` : undefined}
          />
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

          {/* Everything else (chart type, size, refresh, remove) lives in one menu
              so the card header stays uncluttered. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Chart options">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {onUpdate && (
                <>
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground">Chart type</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={chartType} onValueChange={changeType}>
                    {CHART_TYPES.map(ct => (
                      <DropdownMenuRadioItem key={ct.value} value={ct.value} className="text-xs">{ct.label}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              {onCycleSize && (
                <DropdownMenuItem className="text-xs" onSelect={onCycleSize}>
                  {sz === "large" ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  {sz === "large" ? "Collapse" : "Expand"}
                </DropdownMenuItem>
              )}
              {onToggleAutoRefresh && chart.query && (
                <DropdownMenuCheckboxItem
                  className="text-xs"
                  checked={autoRefresh}
                  onCheckedChange={toggleAutoRefresh}
                >
                  Auto-refresh daily
                </DropdownMenuCheckboxItem>
              )}
              {(onCycleSize || (onToggleAutoRefresh && chart.query)) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-xs text-destructive focus:text-destructive"
                onSelect={() => onRemove?.(chart)}
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove from tab
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* View controls: time period + comparison only - configuration lives in the ⋯ menu */}
      <div className="mb-3 flex-shrink-0 flex items-center gap-2 flex-wrap">
        {/* Time-period filter + comparison are available on every chart. On a
            categorical chart the window is simply a no-op (rows are kept). */}
        <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v); if (v === "all") setCompare(false); }}>
          <SelectTrigger className="h-6 text-[11px] w-32 px-2 border-border" title="Filter by time period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTERS.map(f => (
              <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Comparison is always against the immediately preceding window of the SAME
            length as the selected period (e.g. last 7 days vs the prior 7 days). */}
        <button
          type="button"
          onClick={() => setCompare(c => !c)}
          disabled={dateFilter === "all"}
          title={dateFilter === "all" ? "Pick a time period to compare against the previous one" : "Compare with the previous period of equal length"}
          className={`h-6 px-2 text-[11px] rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            compare ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Δ Compare
        </button>

        {compare && delta && (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
              delta.pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
            title={`${DATE_FILTERS.find(f => f.key === dateFilter)?.label}: ${Number(delta.cur).toLocaleString()} · Previous period: ${Number(delta.prev).toLocaleString()}`}
          >
            {delta.pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {(delta.pct * 100).toFixed(1)}%
            <span className="text-muted-foreground font-normal ml-1">
              ({Number(delta.cur).toLocaleString()} vs {Number(delta.prev).toLocaleString()})
            </span>
          </span>
        )}
        {compare && !delta && dateFilter !== "all" && (
          <span className="text-[10px] text-muted-foreground">No comparable data</span>
        )}

        {/* Refresh status - shown in both states so it's clear whether the chart is a
            live daily-refreshed view or a frozen snapshot. Toggling lives in the ⋯ menu. */}
        {chart.query && (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground"
            title={autoRefresh
              ? "Auto-refreshes daily - change in the ⋯ menu"
              : "Data is frozen as a snapshot - change in the ⋯ menu"}
          >
            <RefreshCw className="w-3 h-3" /> {autoRefresh ? "Daily" : "Snapshot"}
          </span>
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