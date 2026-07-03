import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { Activity, ShoppingCart, DollarSign, Target } from "lucide-react";
import {
  KpiTile, ChartCard, HBarBlock, AnalyticsLoading, AnalyticsPeriodProvider,
} from "@/components/analytics/AnalyticsKit";

// Channel attribution, joined server-side from the GA base cubes:
//   - channel_daily + transaction_metrics    : traffic (sessions) -> GA revenue by channel.
//   - channel_daily + acquisition_firstuser_daily : first-touch vs last-touch by channel.
// Company scope is applied server-side (x-company-id header, injected by appClient).

const PERIODS = [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 365, label: "Last 365 days" },
];

const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const num = (v) => (v != null ? Number(v).toLocaleString() : "-");
const money = (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-");

export default function ChannelAttributionPanel() {
  const [days, setDays] = useState(90);
  const range = useMemo(() => ({
    start: ymd(new Date(Date.now() - days * 86400000)),
    end: ymd(new Date()),
  }), [days]);

  const commerceQ = useQuery({
    queryKey: ["utm-channel-commerce", range.start, range.end],
    queryFn: () => appClient.utm.channelCommerce(range),
  });
  const touchQ = useQuery({
    queryKey: ["utm-channel-touch", range.start, range.end],
    queryFn: () => appClient.utm.channelTouch(range),
  });

  const cc = commerceQ.data || [];
  const ct = touchQ.data || [];

  const totals = useMemo(() => cc.reduce((a, r) => ({
    sessions: a.sessions + Number(r.sessions || 0),
    conversions: a.conversions + Number(r.key_events || 0),
    transactions: a.transactions + Number(r.transactions || 0),
    revenue: a.revenue + Number(r.purchase_revenue || 0),
  }), { sessions: 0, conversions: 0, transactions: 0, revenue: 0 }), [cc]);

  const sessionsByChannel = cc.map((r) => ({ name: r.name || "(unknown)", value: Number(r.sessions || 0) }));
  const revenueByChannel = cc
    .map((r) => ({ name: r.name || "(unknown)", value: Number(r.purchase_revenue || 0) }))
    .filter((d) => d.value > 0);

  const loading = commerceQ.isLoading || touchQ.isLoading;
  const err = commerceQ.error || touchQ.error;

  return (
    <AnalyticsPeriodProvider label={PERIODS.find((p) => p.value === days)?.label || ""}>
      <div className="px-6 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Channel attribution</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Traffic → GA revenue by channel, and first-touch vs last-touch, from your GA channel &amp; ecommerce data.
            </p>
          </div>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 px-3 text-sm border border-input rounded-md bg-background"
          >
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {loading ? (
          <AnalyticsLoading />
        ) : err ? (
          <div className="border border-border rounded-lg p-6 text-sm text-muted-foreground">
            Couldn't load channel data. If Google Analytics was just connected, this populates after the next
            sync of the acquisition + ecommerce cubes. ({String(err.message || err)})
          </div>
        ) : cc.length === 0 && ct.length === 0 ? (
          <div className="border border-border rounded-lg p-6 text-sm text-muted-foreground">
            No channel data for this period yet. It appears once the GA acquisition + ecommerce cubes have synced.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile label="Sessions" value={num(totals.sessions)} icon={Activity} />
              <KpiTile label="Conversions" value={num(totals.conversions)} sub="GA key events" icon={Target} />
              <KpiTile label="Transactions" value={num(totals.transactions)} icon={ShoppingCart} />
              <KpiTile label="Revenue (GA)" value={money(totals.revenue)} icon={DollarSign} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard title="Sessions by channel" subtitle="Last-touch default channel group"
                data={sessionsByChannel} explain={{ type: "bar", data: sessionsByChannel }}>
                <HBarBlock data={sessionsByChannel} height={Math.max(200, sessionsByChannel.length * 28)} />
              </ChartCard>
              <ChartCard title="Revenue by channel" subtitle="GA purchase revenue"
                data={revenueByChannel} explain={{ type: "bar", data: revenueByChannel }}>
                <HBarBlock data={revenueByChannel} height={Math.max(200, revenueByChannel.length * 28)} />
              </ChartCard>
            </div>

            <div className="border border-border rounded-lg bg-card p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">First-touch vs last-touch by channel</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  First-touch = user acquisition (discovery); last-touch = session (where the conversion landed).
                  The channels that acquire users aren't always the ones that convert them.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left font-medium py-2 pr-3">Channel</th>
                      <th className="text-right font-medium py-2 px-3">First-touch users</th>
                      <th className="text-right font-medium py-2 px-3">Last-touch users</th>
                      <th className="text-right font-medium py-2 px-3">First-touch conv.</th>
                      <th className="text-right font-medium py-2 pl-3">Last-touch conv.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ct.map((r) => (
                      <tr key={r.name} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-3 font-medium">{r.name || "(unknown)"}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(r.first_active_users)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(r.last_active_users)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{num(r.first_key_events)}</td>
                        <td className="py-2 pl-3 text-right tabular-nums">{num(r.last_key_events)}</td>
                      </tr>
                    ))}
                    {ct.length === 0 && (
                      <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">
                        No first/last-touch data for this period.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AnalyticsPeriodProvider>
  );
}
