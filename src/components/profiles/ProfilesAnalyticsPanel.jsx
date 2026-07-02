import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { useStickyState } from "@/lib/useStickyState";
import { usePreferences } from "@/lib/PreferencesContext";
import { Users, Ghost, MailCheck, Activity, ShoppingBag, UserPlus, BarChart2, UserCheck } from "lucide-react";
import {
  KpiTile, ChartCard, BarBlock, HBarBlock, PieBlock, PieLegend, LineBlock,
  DateRangeBar, AnalyticsLoading, AnalyticsPeriodProvider, rangeLabel,
} from "@/components/analytics/AnalyticsKit";

const DEMO_DIMS = [
  { key: "age_group", label: "Age group" },
  { key: "gender", label: "Gender" },
  { key: "education_level", label: "Education" },
  { key: "income_level", label: "Income" },
  { key: "member_type", label: "Member type" },
  { key: "nationality", label: "Nationality" },
];

const ENGAGEMENT_ORDER = ["0", "1-2", "3-5", "6-10", "10+"];
const pct = (num, denom) => (denom > 0 ? ((num / denom) * 100).toFixed(1) : "0.0");
const pctNum = (num, denom) => (denom > 0 ? (num / denom) * 100 : 0);

// Compact identification funnel: Visitors → Engaged → Identified → Customers → Buyers.
function IdentificationFunnel() {
  const { t } = usePreferences();
  const { data } = useQuery({ queryKey: ["profiles-funnel"], queryFn: () => appClient.profiles.funnel() });
  if (!data) return null;
  const steps = [
    { label: t("Visitors"),   value: data.visitors,   icon: Ghost },
    { label: t("Engaged"),    value: data.engaged,    icon: Activity },
    { label: t("Identified"), value: data.identified, icon: UserCheck },
    { label: t("Customers"),  value: data.customers,  icon: Users },
    { label: t("Buyers"),     value: data.buyers,     icon: ShoppingBag },
  ];
  const max = Math.max(...steps.map(s => Number(s.value) || 0), 1);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {steps.map((s, i) => {
        const Icon = s.icon;
        const val = Number(s.value) || 0;
        const prev = i > 0 ? (Number(steps[i - 1].value) || 0) : null;
        const conv = prev != null && prev > 0 ? Math.round((val / prev) * 100) : null;
        return (
          <div key={s.label} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="w-3.5 h-3.5" /> {s.label}</div>
            <p className="text-xl font-semibold mt-1">{val.toLocaleString()}</p>
            <div className="h-1 rounded-full bg-secondary mt-2 overflow-hidden">
              <div className="h-full bg-foreground/70" style={{ width: `${Math.round((val / max) * 100)}%` }} />
            </div>
            {conv != null && <p className="text-[10px] text-muted-foreground mt-1">{conv}% {t("of previous")}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function ProfilesAnalyticsPanel() {
  // Period, compare and demographic-dimension selections persist across refresh.
  const [range, setRange] = useStickyState({ from: "", to: "" }, "profilesAnalytics.range");
  const [compare, setCompare] = useStickyState(false, "profilesAnalytics.compare");
  const [compareRange, setCompareRange] = useStickyState({ from: "", to: "" }, "profilesAnalytics.compareRange");
  const [demoDim, setDemoDim] = useStickyState("age_group", "profilesAnalytics.demoDim");

  const { data, isLoading } = useQuery({
    queryKey: ["profiles-analytics", range.from, range.to],
    queryFn: () => appClient.profiles.analytics(range),
    keepPreviousData: true,
  });
  const { data: prevRaw } = useQuery({
    queryKey: ["profiles-analytics-prev", compareRange.from, compareRange.to],
    queryFn: () => appClient.profiles.analytics(compareRange),
    enabled: compare && !!(compareRange.from && compareRange.to),
    keepPreviousData: true,
  });
  const cmp = compare ? prevRaw : null;

  const bar = <DateRangeBar from={range.from} to={range.to} onChange={setRange}
    compare={compare} setCompare={setCompare} compareRange={compareRange} onCompareChange={setCompareRange} />;

  if (isLoading && !data) {
    return <div className="px-8 py-6">{bar}<AnalyticsLoading /></div>;
  }

  const k = data?.kpis || {};
  const total = Number(k.total_customers || 0);
  const pk = cmp?.kpis || {};
  const prevTotal = Number(pk.total_customers || 0);
  const demo = data?.demographics?.[demoDim] || [];
  const prevDemo = cmp?.demographics?.[demoDim] || null;
  const engagement = [...(data?.engagement || [])].sort(
    (a, b) => ENGAGEMENT_ORDER.indexOf(a.name) - ENGAGEMENT_ORDER.indexOf(b.name)
  );
  const prevEngagement = cmp ? [...(cmp.engagement || [])].sort(
    (a, b) => ENGAGEMENT_ORDER.indexOf(a.name) - ENGAGEMENT_ORDER.indexOf(b.name)
  ) : null;
  const knownVsAnon = [
    { name: "Known customers", value: total },
    { name: "Anonymous", value: Number(k.anonymous_total || 0) },
  ];
  const prevKnownVsAnon = cmp ? [
    { name: "Known customers", value: prevTotal },
    { name: "Anonymous", value: Number(pk.anonymous_total || 0) },
  ] : null;

  return (
    <AnalyticsPeriodProvider label={rangeLabel(range)}>
    <div className="px-8 py-6 space-y-6">
      {bar}

      {/* Identification funnel: Visitors → Engaged → Identified → Customers → Buyers */}
      <IdentificationFunnel />

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile label="Customers" value={total.toLocaleString()} icon={Users}
          curr={total} prev={cmp ? prevTotal : undefined} prevDisplay={prevTotal.toLocaleString()} />
        <KpiTile label="Anonymous" value={Number(k.anonymous_total || 0).toLocaleString()}
          sub={`${Number(k.anonymous_high_intent || 0).toLocaleString()} high-intent`} icon={Ghost}
          curr={Number(k.anonymous_total || 0)} prev={cmp ? Number(pk.anonymous_total || 0) : undefined} prevDisplay={Number(pk.anonymous_total || 0).toLocaleString()} />
        <KpiTile label="Email opt-in" value={`${pct(k.opt_in_email, total)}%`}
          sub={`${Number(k.opt_in_email || 0).toLocaleString()} contacts`} icon={MailCheck}
          curr={pctNum(k.opt_in_email, total)} prev={cmp ? pctNum(pk.opt_in_email, prevTotal) : undefined} prevDisplay={`${pct(pk.opt_in_email, prevTotal)}%`} />
        <KpiTile label="Web active" value={`${pct(k.web_active, total)}%`}
          sub={`${Number(k.web_active || 0).toLocaleString()} with sessions`} icon={Activity}
          curr={pctNum(k.web_active, total)} prev={cmp ? pctNum(pk.web_active, prevTotal) : undefined} prevDisplay={`${pct(pk.web_active, prevTotal)}%`} />
        <KpiTile label="With purchases" value={Number(k.with_purchases || 0).toLocaleString()}
          sub={`${pct(k.with_purchases, total)}% of customers`} icon={ShoppingBag}
          curr={Number(k.with_purchases || 0)} prev={cmp ? Number(pk.with_purchases || 0) : undefined} prevDisplay={Number(pk.with_purchases || 0).toLocaleString()} />
        <KpiTile label="New (period)" value={Number(k.new_in_range || 0).toLocaleString()}
          sub={range.from || range.to ? "in selected range" : "all time"} icon={UserPlus}
          curr={Number(k.new_in_range || 0)} prev={cmp ? Number(pk.new_in_range || 0) : undefined} prevDisplay={Number(pk.new_in_range || 0).toLocaleString()} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="New customers over time" subtitle="By join month" resizable defaultWide
          explain={{ key: "profiles_new_over_time", type: "line", data: data?.new_over_time }}
          prevData={cmp?.new_over_time}>
          <LineBlock data={data?.new_over_time} height={240} prevData={cmp?.new_over_time} />
        </ChartCard>

        <ChartCard
          title="Demographics"
          subtitle="Customer breakdown"
          resizable
          explain={{ key: `profiles_demographics_${demoDim}`, type: "bar", data: demo }}
          prevData={prevDemo}
          right={
            <select value={demoDim} onChange={(e) => setDemoDim(e.target.value)}
              className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
              {DEMO_DIMS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          }>
          <BarBlock data={demo} prevData={prevDemo} />
        </ChartCard>

        <ChartCard title="Acquisition channel" subtitle="Registration channel" resizable
          explain={{ key: "profiles_channels", type: "horizontal-bar", data: data?.channels }}
          prevData={cmp?.channels}>
          <HBarBlock data={data?.channels} prevData={cmp?.channels} />
        </ChartCard>

        <ChartCard title="Top web source / medium" subtitle="GA top source per customer" resizable
          explain={{ key: "profiles_sources", type: "horizontal-bar", data: data?.sources }}
          prevData={cmp?.sources}>
          <HBarBlock data={data?.sources} prevData={cmp?.sources} />
        </ChartCard>

        <ChartCard title="Web engagement" subtitle="Customers by session count" resizable
          explain={{ key: "profiles_engagement", type: "bar", data: engagement }}
          prevData={prevEngagement}>
          <BarBlock data={engagement} prevData={prevEngagement} />
        </ChartCard>

        <ChartCard title="Communication consent" subtitle="Opted-in customers by channel" resizable
          explain={{ key: "profiles_consent", type: "bar", data: data?.consent }}
          prevData={cmp?.consent}>
          <BarBlock data={data?.consent} prevData={cmp?.consent} />
        </ChartCard>

        <ChartCard title="Known vs anonymous" subtitle="Audience composition" resizable
          explain={{ key: "profiles_known_vs_anon", type: "pie", data: knownVsAnon }}
          prevData={prevKnownVsAnon}>
          <div className="grid grid-cols-2 gap-2 items-center">
            <PieBlock data={knownVsAnon} />
            <PieLegend data={knownVsAnon} />
          </div>
        </ChartCard>

        <ChartCard title="Anonymous traffic sources" subtitle="Top source / medium for visitors" resizable
          explain={{ key: "profiles_anonymous_sources", type: "horizontal-bar", data: data?.anonymous_sources }}
          prevData={cmp?.anonymous_sources}>
          <HBarBlock data={data?.anonymous_sources} opacity={0.55} prevData={cmp?.anonymous_sources} />
        </ChartCard>
      </div>

      {/* Demographic breakdown table */}
      <ChartCard title="Demographic breakdown" subtitle={DEMO_DIMS.find((d) => d.key === demoDim)?.label}>
        {demo.length === 0 ? (
          <div className="flex flex-col items-center text-sm text-muted-foreground py-10">
            <BarChart2 className="w-8 h-8 mb-2 opacity-20" /> No data for this dimension.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2 px-3">{DEMO_DIMS.find((d) => d.key === demoDim)?.label}</th>
                  <th className="text-right font-medium py-2 px-3">Customers</th>
                  <th className="text-right font-medium py-2 px-3">Share</th>
                </tr>
              </thead>
              <tbody>
                {demo.map((r) => (
                  <tr key={r.name} className="border-b border-border/60 last:border-0">
                    <td className="py-2 px-3 capitalize">{r.name}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{Number(r.value).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{pct(r.value, total)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
    </AnalyticsPeriodProvider>
  );
}
