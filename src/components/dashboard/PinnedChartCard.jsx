import { useState, useMemo } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MiniChart from "./MiniChart";
import ChartExplainer from "./ChartExplainer";
import { parseChartConfig } from "@/lib/utils";
import { format, subDays, subMonths, parseISO, isAfter } from "date-fns";

const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large", wide: "Wide" };

const DATE_FILTERS = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "6m", label: "Last 6 months" },
  { key: "1y", label: "Last 1 year" },
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

export default function PinnedChartCard({ chart: initialChart, onRemove, onCycleSize, size = "medium" }) {
  const [chart] = useState(initialChart);
  const [dateFilter, setDateFilter] = useState("all");

  const config = parseChartConfig(chart.chart_config);

  const filteredConfig = useMemo(() => {
    const xKey = config.xKey || "name";
    const filtered = applyDateFilter(config.data, xKey, dateFilter);
    return { ...config, data: filtered };
  }, [chart.chart_config, dateFilter]);

  return (
    <div className="bg-card border border-border rounded-lg p-5 hover:shadow-sm transition-shadow h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between mb-2 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold truncate">{chart.title}</h3>
          {chart.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{chart.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <ChartExplainer chart={chart} config={config} />
          {onCycleSize && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              title={`Resize chart (${SIZE_LABELS[size] || "Medium"})`}
              onClick={onCycleSize}
            >
              {size === "large" ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Remove chart" onClick={() => onRemove?.(chart)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Date filter */}
      <div className="mb-3 flex-shrink-0">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-6 text-[11px] w-32 px-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTERS.map(f => (
              <SelectItem key={f.key} value={f.key} className="text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <MiniChart type={chart.chart_type} config={filteredConfig} />
      </div>

      {chart.last_refreshed && (
        <p className="text-[10px] text-muted-foreground mt-2 flex-shrink-0">
          Refreshed {format(new Date(chart.last_refreshed), "MMM d, h:mm a")}
        </p>
      )}

    </div>
  );
}