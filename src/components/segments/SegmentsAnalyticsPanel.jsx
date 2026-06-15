import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { Layers, CheckCircle2, FileEdit, Lock, RefreshCw, Users, BarChart2 } from "lucide-react";
import { format } from "date-fns";
import {
  KpiTile, ChartCard, BarBlock, HBarBlock, PieBlock, PieLegend, LineBlock, AnalyticsLoading,
} from "@/components/analytics/AnalyticsKit";

const STATUS_OF = (s) => s.status || "draft";
const TYPE_LABEL = { customer: "Customer", anonymous_profile: "Anonymous" };

// Bucket a last_refreshed timestamp by age, for daily-refresh segments.
function freshnessBucket(ts) {
  if (!ts) return "Never";
  const days = (Date.now() - new Date(ts).getTime()) / 86_400_000;
  if (days < 1) return "Today";
  if (days <= 7) return "≤ 7 days";
  if (days <= 30) return "≤ 30 days";
  return "Stale (30d+)";
}
const FRESH_ORDER = ["Today", "≤ 7 days", "≤ 30 days", "Stale (30d+)", "Never"];

export default function SegmentsAnalyticsPanel() {
  const { data: segments = [], isLoading } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date"),
  });

  const a = useMemo(() => {
    const counts = (pred) => segments.filter(pred).length;
    const byStatus = ["active", "draft", "archived"].map((s) => ({
      name: s[0].toUpperCase() + s.slice(1), value: counts((x) => STATUS_OF(x) === s),
    }));
    const byType = Object.entries(
      segments.reduce((m, s) => { const t = s.segment_type || "customer"; m[t] = (m[t] || 0) + 1; return m; }, {})
    ).map(([k, v]) => ({ name: TYPE_LABEL[k] || k, value: v }));
    const usage = [
      { name: "In use (locked)", value: counts((s) => s.is_used) },
      { name: "Not in use", value: counts((s) => !s.is_used) },
    ];
    const sized = segments.filter((s) => Number(s.estimated_size) > 0);
    const sizeDist = [...sized]
      .sort((x, y) => Number(y.estimated_size) - Number(x.estimated_size))
      .slice(0, 12)
      .map((s) => ({ name: s.name, value: Number(s.estimated_size) }));
    const refreshSegs = segments.filter((s) => s.daily_refresh);
    const freshnessMap = refreshSegs.reduce((m, s) => {
      const b = freshnessBucket(s.last_refreshed); m[b] = (m[b] || 0) + 1; return m;
    }, {});
    const freshness = FRESH_ORDER.filter((b) => freshnessMap[b]).map((b) => ({ name: b, value: freshnessMap[b] }));
    const createdMap = segments.reduce((m, s) => {
      if (!s.created_date) return m;
      const key = format(new Date(s.created_date), "yyyy-MM");
      m[key] = (m[key] || 0) + 1; return m;
    }, {});
    const createdOverTime = Object.entries(createdMap).sort(([x], [y]) => x.localeCompare(y)).map(([name, value]) => ({ name, value }));
    const totalReach = sized.reduce((s, x) => s + Number(x.estimated_size), 0);
    return {
      total: segments.length,
      active: counts((s) => STATUS_OF(s) === "active"),
      draft: counts((s) => STATUS_OF(s) === "draft"),
      archived: counts((s) => STATUS_OF(s) === "archived"),
      inUse: counts((s) => s.is_used),
      refreshOn: refreshSegs.length,
      totalReach,
      avgSize: sized.length ? Math.round(totalReach / sized.length) : 0,
      byStatus, byType, usage, sizeDist, freshness, createdOverTime,
    };
  }, [segments]);

  if (isLoading) {
    return <div className="px-8 py-6"><AnalyticsLoading /></div>;
  }

  if (!segments.length) {
    return (
      <div className="px-8 py-6 flex flex-col items-center text-sm text-muted-foreground py-20">
        <BarChart2 className="w-10 h-10 mb-3 opacity-20" />
        <p className="font-medium text-foreground mb-1">No segments yet</p>
        <p className="text-xs">Create a segment to see analytics here.</p>
      </div>
    );
  }

  return (
    <div className="px-8 py-6 space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile label="Segments" value={a.total.toLocaleString()} icon={Layers} />
        <KpiTile label="Active" value={a.active.toLocaleString()} sub={`${a.draft} draft · ${a.archived} archived`} icon={CheckCircle2} />
        <KpiTile label="Drafts" value={a.draft.toLocaleString()} icon={FileEdit} />
        <KpiTile label="In use" value={a.inUse.toLocaleString()} sub="locked by a campaign / pop-up" icon={Lock} />
        <KpiTile label="Daily refresh on" value={a.refreshOn.toLocaleString()} icon={RefreshCw} />
        <KpiTile label="Total reach" value={a.totalReach.toLocaleString()} sub={`avg ${a.avgSize.toLocaleString()} / segment`} icon={Users} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Segment size distribution" subtitle="Estimated size, top 12" resizable defaultWide
          explain={{ key: "segments_size_dist", type: "horizontal-bar", data: a.sizeDist }}>
          <HBarBlock data={a.sizeDist} height={Math.max(200, a.sizeDist.length * 26)} />
        </ChartCard>

        <ChartCard title="By status" subtitle="Lifecycle state" resizable
          explain={{ key: "segments_by_status", type: "pie", data: a.byStatus }}>
          <div className="grid grid-cols-2 gap-2 items-center">
            <PieBlock data={a.byStatus} />
            <PieLegend data={a.byStatus} />
          </div>
        </ChartCard>

        <ChartCard title="By type" subtitle="Customer vs anonymous" resizable
          explain={{ key: "segments_by_type", type: "pie", data: a.byType }}>
          <div className="grid grid-cols-2 gap-2 items-center">
            <PieBlock data={a.byType} />
            <PieLegend data={a.byType} />
          </div>
        </ChartCard>

        <ChartCard title="Usage" subtitle="Locked vs editable" resizable
          explain={{ key: "segments_usage", type: "pie", data: a.usage }}>
          <div className="grid grid-cols-2 gap-2 items-center">
            <PieBlock data={a.usage} />
            <PieLegend data={a.usage} />
          </div>
        </ChartCard>

        <ChartCard title="Refresh freshness" subtitle="Daily-refresh segments by last run" resizable
          explain={{ key: "segments_freshness", type: "bar", data: a.freshness }}>
          <BarBlock data={a.freshness} />
        </ChartCard>

        <ChartCard title="Segments created over time" subtitle="By month" resizable defaultWide
          explain={{ key: "segments_created_over_time", type: "line", data: a.createdOverTime }}>
          <LineBlock data={a.createdOverTime} />
        </ChartCard>
      </div>

      {/* Table */}
      <ChartCard title="All segments" subtitle={`${segments.length} total`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2 px-3">Name</th>
                <th className="text-left font-medium py-2 px-3">Type</th>
                <th className="text-right font-medium py-2 px-3">Size</th>
                <th className="text-left font-medium py-2 px-3">Status</th>
                <th className="text-center font-medium py-2 px-3">In use</th>
                <th className="text-center font-medium py-2 px-3">Refresh</th>
                <th className="text-left font-medium py-2 px-3">Last refreshed</th>
              </tr>
            </thead>
            <tbody>
              {[...segments]
                .sort((x, y) => Number(y.estimated_size || 0) - Number(x.estimated_size || 0))
                .map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 px-3 font-medium truncate max-w-[260px]">{s.name}</td>
                    <td className="py-2 px-3 text-muted-foreground">{TYPE_LABEL[s.segment_type || "customer"] || s.segment_type}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{s.estimated_size ? Number(s.estimated_size).toLocaleString() : "-"}</td>
                    <td className="py-2 px-3 text-muted-foreground capitalize">{STATUS_OF(s)}</td>
                    <td className="py-2 px-3 text-center text-muted-foreground">{s.is_used ? "Yes" : "-"}</td>
                    <td className="py-2 px-3 text-center text-muted-foreground">{s.daily_refresh ? "Daily" : "-"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{s.last_refreshed ? format(new Date(s.last_refreshed), "MMM d, yyyy") : "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
