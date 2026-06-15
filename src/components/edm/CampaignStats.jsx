import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import {
  BarChart2, Mail, MousePointerClick, UserMinus, XCircle,
  TrendingUp, Users, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

function StatTile({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {label}
      </div>
      <p className={`text-2xl font-bold tabular-nums ${accent ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MiniBar({ pct, color = "bg-foreground" }) {
  return (
    <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
      />
    </div>
  );
}

function MetricRow({ label, count, total, color }) {
  const pct = total > 0 ? ((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <MiniBar pct={pct} color={color} />
      <span className="text-xs font-medium tabular-nums w-14 text-right">
        {count.toLocaleString()}
        <span className="text-muted-foreground font-normal ml-1">
          ({pct.toFixed(1)}%)
        </span>
      </span>
    </div>
  );
}

export default function CampaignStats({ campaignId, open, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["edm-stats", campaignId],
    queryFn: () => appClient.edm.getCampaignStats(campaignId),
    enabled: open && !!campaignId,
    refetchInterval: 30000,
  });

  const delivered  = Number(data?.sends?.delivered || data?.sends?.sent || 0);
  const opens      = Number(data?.events?.open?.unique   || 0);
  const clicks     = Number(data?.events?.click?.unique  || 0);
  const unsubs     = Number(data?.events?.unsubscribe?.unique || 0);
  const bounced    = Number(data?.sends?.bounced || 0);
  const total      = Number(data?.campaign?.total_recipients || 0);

  const openRate   = delivered > 0 ? ((opens  / delivered) * 100).toFixed(1) : null;
  const clickRate  = delivered > 0 ? ((clicks / delivered) * 100).toFixed(1) : null;
  const ctor       = opens     > 0 ? ((clicks / opens)     * 100).toFixed(1) : null;
  const unsubRate  = delivered > 0 ? ((unsubs / delivered) * 100).toFixed(1) : null;
  const bounceRate = total     > 0 ? ((bounced / total)    * 100).toFixed(1) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Email Performance
            {data?.campaign?.name && (
              <span className="font-normal text-muted-foreground truncate max-w-xs">
                - {data.campaign.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        )}

        {data && (
          <div className="space-y-5 mt-1">

            {/* Campaign meta */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <Badge variant="outline" className="capitalize">{data.campaign?.status}</Badge>
              <span className="text-muted-foreground flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {total.toLocaleString()} recipients
              </span>
              {data.campaign?.sent_at && (
                <span className="text-muted-foreground text-xs ml-auto">
                  Sent {format(new Date(data.campaign.sent_at), "MMM d, yyyy · h:mm a")}
                </span>
              )}
            </div>

            {/* Primary KPI tiles */}
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Delivered"
                value={delivered.toLocaleString()}
                sub={`${total > 0 ? ((delivered/total)*100).toFixed(1) : 0}% of ${total.toLocaleString()} sent`}
                icon={Mail}
              />
              <StatTile
                label="Open Rate"
                value={openRate ? `${openRate}%` : "-"}
                sub={`${opens.toLocaleString()} unique opener${opens !== 1 ? "s" : ""}`}
                icon={TrendingUp}
              />
              <StatTile
                label="Click Rate"
                value={clickRate ? `${clickRate}%` : "-"}
                sub={ctor ? `CTOR ${ctor}%` : "No clicks yet"}
                icon={MousePointerClick}
              />
              <StatTile
                label="Unsubscribes"
                value={unsubRate ? `${unsubRate}%` : "-"}
                sub={`${unsubs.toLocaleString()} opted out`}
                icon={UserMinus}
                accent="text-muted-foreground"
              />
            </div>

            {/* Funnel breakdown */}
            {delivered > 0 && (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Delivery Funnel
                </p>
                <div className="space-y-2.5">
                  <MetricRow label="Delivered"   count={delivered} total={total}     color="bg-foreground" />
                  <MetricRow label="Opened"      count={opens}     total={delivered} color="bg-foreground/70" />
                  <MetricRow label="Clicked"     count={clicks}    total={delivered} color="bg-foreground/50" />
                  <MetricRow label="Unsubscribed" count={unsubs}   total={delivered} color="bg-muted-foreground/40" />
                  {bounced > 0 && (
                    <MetricRow label="Bounced"   count={bounced}   total={total}     color="bg-destructive/40" />
                  )}
                </div>
              </div>
            )}

            {/* Total vs unique */}
            {(data.events?.open?.total > 0 || data.events?.click?.total > 0) && (
              <div className="border border-border rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Total vs Unique Engagements
                </p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Opens</p>
                    <p className="font-semibold">
                      {(data.events.open?.total || 0).toLocaleString()}
                      <span className="text-xs text-muted-foreground font-normal ml-1">total</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {opens.toLocaleString()} unique
                      {data.events.open?.total > 0 && opens > 0 && (
                        <span className="ml-1">
                          ({((data.events.open.total / opens)).toFixed(1)}× avg per opener)
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Clicks</p>
                    <p className="font-semibold">
                      {(data.events.click?.total || 0).toLocaleString()}
                      <span className="text-xs text-muted-foreground font-normal ml-1">total</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {clicks.toLocaleString()} unique
                      {data.events.click?.total > 0 && clicks > 0 && (
                        <span className="ml-1">
                          ({((data.events.click.total / clicks)).toFixed(1)}× avg per clicker)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Bounce warning */}
            {bounced > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-destructive/10 border border-destructive/20 rounded-lg text-xs text-destructive">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>{bounced.toLocaleString()}</strong> bounced address{bounced !== 1 ? "es" : ""} (
                  {bounceRate}%) have been automatically added to the suppression list.
                </span>
              </div>
            )}

            {/* Suppression notices */}
            {unsubs > 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-secondary border border-border rounded-lg text-xs text-muted-foreground">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>{unsubs.toLocaleString()}</strong> recipient{unsubs !== 1 ? "s" : ""} unsubscribed and {unsubs !== 1 ? "have" : "has"} been suppressed from future sends.
                </span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground text-right">
              Auto-refreshes every 30 s · Last updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
