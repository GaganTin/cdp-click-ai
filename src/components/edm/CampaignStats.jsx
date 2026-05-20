import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { BarChart2, Mail, MousePointerClick, UserMinus, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

function StatTile({ label, value, sub, icon: Icon, color = "text-foreground" }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Email Performance
            {data?.campaign?.name && (
              <span className="font-normal text-muted-foreground">- {data.campaign.name}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        )}

        {data && (
          <div className="space-y-4 mt-2">
            <div className="flex items-center gap-3 text-sm">
              <Badge variant="outline">{data.campaign?.status}</Badge>
              <span className="text-muted-foreground">
                {data.campaign?.total_recipients?.toLocaleString()} recipients
              </span>
              {data.campaign?.sent_at && (
                <span className="text-muted-foreground">
                  Sent {new Date(data.campaign.sent_at).toLocaleDateString()}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Delivered"
                value={Number(data.sends?.delivered || data.sends?.sent || 0).toLocaleString()}
                sub={`of ${data.campaign?.total_recipients?.toLocaleString()} sent`}
                icon={Mail}
              />
              <StatTile
                label="Unique Opens"
                value={data.rates?.open_rate || "-"}
                sub={`${data.events?.open?.unique || 0} unique openers`}
                icon={Mail}
                color="text-blue-600"
              />
              <StatTile
                label="Unique Clicks"
                value={data.rates?.click_rate || "-"}
                sub={`CTOR ${data.rates?.click_to_open || "-"}`}
                icon={MousePointerClick}
                color="text-green-600"
              />
              <StatTile
                label="Unsubscribes"
                value={data.rates?.unsubscribe_rate || "-"}
                sub={`${data.events?.unsubscribe?.unique || 0} total`}
                icon={UserMinus}
                color={Number((data.rates?.unsubscribe_rate || "0%").replace("%","")) > 0.5 ? "text-amber-600" : "text-foreground"}
              />
            </div>

            {data.sends?.bounced > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {data.sends.bounced} bounced addresses have been automatically added to the suppression list.
              </div>
            )}

            {data.events?.click?.total > 0 && (
              <div className="border border-border rounded-lg p-4">
                <p className="text-xs font-medium mb-2">Engagement</p>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Total opens</span>
                    <span className="text-foreground font-medium">{data.events.open?.total || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total clicks</span>
                    <span className="text-foreground font-medium">{data.events.click?.total || 0}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
