import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { useStickyState } from "@/lib/useStickyState";
import { Tag, CheckCircle2, AlertCircle, Layers, Users, Hash, BarChart2, ChevronRight } from "lucide-react";
import {
  KpiTile, ChartCard, BarBlock, HBarBlock, PieBlock, PieLegend, LineBlock, AnalyticsLoading,
} from "@/components/analytics/AnalyticsKit";

const SOURCE_LABEL = { web_content: "Content", rule: "Rule", manual: "Manual" };
const SOURCE_FILTERS = [["", "All sources"], ["web_content", "Content"], ["rule", "Rule"], ["manual", "Manual"]];
const STATUS_FILTERS = [["", "All statuses"], ["active", "Active"], ["draft", "Draft"], ["archived", "Archived"]];

function FilterPills({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {options.map(([val, label]) => (
        <button key={val || "all"} onClick={() => onChange(val)}
          className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
            value === val ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
          }`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function AttributesAnalyticsPanel({ onOpenAttribute }) {
  // Filter selections persist across refresh (localStorage).
  const [sourceFilter, setSourceFilter] = useStickyState("", "attributesAnalytics.sourceFilter");
  const [statusFilter, setStatusFilter] = useStickyState("", "attributesAnalytics.statusFilter");
  const { data, isLoading } = useQuery({
    queryKey: ["attributes-analytics"],
    queryFn: () => appClient.attributes.analytics(),
  });

  if (isLoading && !data) {
    return <div className="px-8 py-6"><AnalyticsLoading /></div>;
  }

  const k = data?.kpis || {};
  if (!isLoading && !Number(k.total_attributes)) {
    return (
      <div className="px-8 py-6 flex flex-col items-center text-sm text-muted-foreground py-20">
        <BarChart2 className="w-10 h-10 mb-3 opacity-20" />
        <p className="font-medium text-foreground mb-1">No attributes yet</p>
        <p className="text-xs">Create an attribute to see coverage analytics here.</p>
      </div>
    );
  }

  const bySource = (data?.by_source || []).map((r) => ({ name: SOURCE_LABEL[r.name] || r.name, value: r.value }));

  return (
    <div className="px-8 py-6 space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile label="Attributes" value={Number(k.total_attributes || 0).toLocaleString()}
          sub={`${Number(k.active_attributes || 0).toLocaleString()} active`} icon={Tag} />
        <KpiTile label="Approved values" value={Number(k.approved_values || 0).toLocaleString()} icon={CheckCircle2} />
        <KpiTile label="Pending review" value={Number(k.pending_values || 0).toLocaleString()}
          sub="AI-discovered, unapproved" icon={AlertCircle} />
        <KpiTile label="Profile tags" value={Number(k.total_tags || 0).toLocaleString()} icon={Hash} />
        <KpiTile label="Profiles covered" value={Number(k.profiles_covered || 0).toLocaleString()} icon={Users} />
        <KpiTile label="Active attributes" value={Number(k.active_attributes || 0).toLocaleString()} icon={Layers} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Profile coverage by attribute" subtitle="Distinct profiles tagged, top 12" resizable defaultWide
          explain={{ key: "attr_coverage", type: "horizontal-bar", data: data?.coverage }}>
          <HBarBlock data={data?.coverage} height={Math.max(200, (data?.coverage?.length || 1) * 26)} />
        </ChartCard>

        <ChartCard title="Attributes by source" subtitle="How values are produced" resizable
          explain={{ key: "attr_by_source", type: "bar", data: bySource }}>
          <BarBlock data={bySource} />
        </ChartCard>

        <ChartCard title="Value health" subtitle="Approved vs review vs merged" resizable
          explain={{ key: "attr_value_health", type: "pie", data: data?.value_health }}>
          <div className="grid grid-cols-2 gap-2 items-center">
            <PieBlock data={data?.value_health} />
            <PieLegend data={data?.value_health} />
          </div>
        </ChartCard>

        <ChartCard title="Top values" subtitle="Most-assigned values across attributes" resizable
          explain={{ key: "attr_top_values", type: "horizontal-bar", data: data?.top_values }}>
          <HBarBlock data={data?.top_values} />
        </ChartCard>

        <ChartCard title="Review backlog" subtitle="Pending values per attribute" resizable
          explain={{ key: "attr_review_backlog", type: "horizontal-bar", data: data?.review_backlog }}>
          <HBarBlock data={data?.review_backlog} color="#555" />
        </ChartCard>

        <ChartCard title="Tagging activity over time" subtitle="Profile tags first seen, by month" resizable defaultWide
          explain={{ key: "attr_tagging_over_time", type: "line", data: data?.tagging_over_time }}>
          <LineBlock data={data?.tagging_over_time} />
        </ChartCard>

        <ChartCard title="Page coverage" subtitle="Pages tagged per content attribute" resizable defaultWide
          explain={{ key: "attr_page_coverage", type: "horizontal-bar", data: data?.page_coverage }}>
          <HBarBlock data={data?.page_coverage} />
        </ChartCard>
      </div>

      {/* Per-attribute table - filterable + drill-down */}
      {(() => {
        const rows = (data?.table || []).filter(
          (r) => (!sourceFilter || r.source === sourceFilter) && (!statusFilter || r.status === statusFilter)
        );
        const filtered = sourceFilter || statusFilter;
        return (
          <ChartCard
            title="Attribute coverage"
            subtitle={filtered ? `${rows.length} of ${data?.table?.length || 0} attributes` : `${rows.length} attributes`}
          >
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <FilterPills options={SOURCE_FILTERS} value={sourceFilter} onChange={setSourceFilter} />
              <span className="text-border">|</span>
              <FilterPills options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
              {onOpenAttribute && rows.length > 0 && (
                <span className="text-[11px] text-muted-foreground ml-auto">Click a row to open the attribute</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="text-left font-medium py-2 px-3">Attribute</th>
                    <th className="text-left font-medium py-2 px-3">Source</th>
                    <th className="text-left font-medium py-2 px-3">Status</th>
                    <th className="text-right font-medium py-2 px-3">Values</th>
                    <th className="text-right font-medium py-2 px-3">Pending</th>
                    <th className="text-right font-medium py-2 px-3">Profiles covered</th>
                    {onOpenAttribute && <th className="w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={onOpenAttribute ? 7 : 6} className="py-6 text-center text-xs text-muted-foreground">No attributes match these filters.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id}
                      onClick={onOpenAttribute ? () => onOpenAttribute(r) : undefined}
                      className={`border-b border-border/60 last:border-0 group ${onOpenAttribute ? "cursor-pointer hover:bg-secondary/40" : ""}`}>
                      <td className="py-2 px-3 font-medium truncate max-w-[260px]">{r.name}</td>
                      <td className="py-2 px-3 text-muted-foreground">{SOURCE_LABEL[r.source] || r.source}</td>
                      <td className="py-2 px-3 text-muted-foreground capitalize">{r.status}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{Number(r.value_count).toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{r.pending_count > 0 ? Number(r.pending_count).toLocaleString() : "-"}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{Number(r.profiles_covered).toLocaleString()}</td>
                      {onOpenAttribute && <td className="px-2 text-muted-foreground"><ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        );
      })()}
    </div>
  );
}
