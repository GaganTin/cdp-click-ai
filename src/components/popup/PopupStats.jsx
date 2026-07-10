import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import {
  BarChart2, Eye, MousePointerClick, Mail, XCircle,
  Clock, Users, Calendar, ExternalLink, MessageCircle, Link2,
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

function formatSecs(secs) {
  if (!secs) return "-";
  const s = Number(secs);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

// Pull the host out of a URL for a compact secondary label; tolerate junk hrefs.
function linkHost(url) {
  try { return new URL(url).host.replace(/^www\./, ""); }
  catch { return url; }
}

// WhatsApp deep-links (wa.me, api.whatsapp.com, whatsapp://) get their own icon so
// the most common pop-up CTA is recognisable at a glance.
function isWhatsApp(url) {
  return /(?:wa\.me|whatsapp\.com|whatsapp:)/i.test(url || "");
}

// Pull the phone number and prefilled message out of a WhatsApp deep-link. The
// number lives in the path (wa.me/<num>) or a `phone` param; the message in the
// `text` param. We keep distinct ?text= variants as separate rows upstream, and
// show the decoded message here so each CTA is legible.
function whatsappMeta(url) {
  try {
    const u = new URL(url);
    const num = (u.pathname.replace(/\D/g, "") || u.searchParams.get("phone") || "").trim();
    const text = (u.searchParams.get("text") || "").trim();
    return { num, text };
  } catch {
    return { num: "", text: "" };
  }
}

function LinkRow({ row, maxClicks }) {
  const url = row.link_url || "";
  const whatsapp = isWhatsApp(url);
  const Icon = whatsapp ? MessageCircle : ExternalLink;
  const wa = whatsapp ? whatsappMeta(url) : null;
  const pct = maxClicks > 0 ? (Number(row.clicks) / maxClicks) * 100 : 0;
  // Primary label: link text, or the WhatsApp number, or the host.
  const label = row.link_text || (wa?.num ? `WhatsApp +${wa.num}` : linkHost(url));
  // Secondary label: the prefilled WhatsApp message when present, else the host.
  const sub = wa?.text ? `"${wa.text}"` : linkHost(url);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${whatsapp ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs font-medium truncate hover:underline"
          title={url}
        >
          {label}
        </a>
        <span className="text-xs font-medium tabular-nums ml-auto flex-shrink-0">
          {Number(row.clicks).toLocaleString()}
          <span className="text-muted-foreground font-normal ml-1">
            {Number(row.unique_visitors).toLocaleString()} unique
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2 pl-[22px]">
        <MiniBar pct={pct} color={whatsapp ? "bg-green-600/60 dark:bg-green-500/60" : "bg-foreground/40"} />
        <span
          className={`text-[11px] truncate max-w-[55%] ${wa?.text ? "text-muted-foreground italic" : "text-muted-foreground"}`}
          title={wa?.text || url}
        >
          {sub}
        </span>
      </div>
    </div>
  );
}

// Stats modal for a single pop-up. Pulls from the same /popups/analytics endpoint
// the Analytics tab uses (shared query key, so it's cached) and picks out this
// pop-up's row, mirroring the email CampaignStats modal.
export default function PopupStats({ popupId, popupName, open, onClose, from, to }) {
  // Honour the Analytics tab's selected period so the modal's counts and the link
  // breakdown match the page (both are range-accurate server-side). The query keys
  // carry from/to so they refetch — and share cache with the page — when it changes.
  const { data: analytics = [], isLoading } = useQuery({
    queryKey: ["popup-analytics", from, to],
    queryFn: () => appClient.popup.getAnalytics({ from, to }),
    enabled: open && !!popupId,
    refetchInterval: 30000,
  });

  const { data: outboundLinks = [], isLoading: linksLoading } = useQuery({
    queryKey: ["popup-outbound-links", popupId, from, to],
    queryFn: () => appClient.popup.getOutboundLinks(popupId, { from, to }),
    enabled: open && !!popupId,
    refetchInterval: 30000,
  });

  const row = analytics.find(p => p.id === popupId);

  const impressions = Number(row?.impressions || 0);
  const uniqueViews = Number(row?.unique_views || 0);
  const clicks      = Number(row?.clicks || 0);
  const emails      = Number(row?.emails || 0);
  const dismissals  = Number(row?.dismissals || 0);

  const ctr           = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : null;
  const emailRate     = impressions > 0 ? ((emails / impressions) * 100).toFixed(1) : null;
  const dismissalRate = impressions > 0 ? ((dismissals / impressions) * 100).toFixed(1) : null;
  const convRate      = clicks > 0 ? ((emails / clicks) * 100).toFixed(1) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            Pop-Up Performance
            {(row?.name || popupName) && (
              <span className="font-normal text-muted-foreground truncate max-w-xs">
                - {row?.name || popupName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && (
          <div className="space-y-5 mt-1">

            {/* Pop-up meta */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <Badge variant="outline" className="capitalize">{row?.status || "-"}</Badge>
              {row?.interaction_type && (
                <span className="text-muted-foreground text-xs capitalize">
                  {String(row.interaction_type).replace(/_/g, " ")}
                </span>
              )}
              {row?.segment_name && (
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  <Users className="w-3.5 h-3.5" />
                  {row.segment_name}
                </span>
              )}
              {(row?.start_time || row?.end_time) && (
                <span className="text-muted-foreground text-xs flex items-center gap-1 ml-auto">
                  <Calendar className="w-3.5 h-3.5" />
                  {row?.start_time ? format(new Date(row.start_time), "MMM d, yyyy") : "-"}
                  {" → "}
                  {row?.end_time ? format(new Date(row.end_time), "MMM d, yyyy") : "No end"}
                </span>
              )}
            </div>

            {/* Primary KPI tiles */}
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Impressions"
                value={impressions.toLocaleString()}
                sub={`${uniqueViews.toLocaleString()} unique view${uniqueViews !== 1 ? "s" : ""}`}
                icon={Eye}
              />
              <StatTile
                label="Click-Through Rate"
                value={ctr ? `${ctr}%` : "-"}
                sub={`${clicks.toLocaleString()} click${clicks !== 1 ? "s" : ""}`}
                icon={MousePointerClick}
              />
              <StatTile
                label="Emails Collected"
                value={emails.toLocaleString()}
                sub={emailRate ? `${emailRate}% conversion` : "No emails yet"}
                icon={Mail}
              />
              <StatTile
                label="Avg Engagement"
                value={formatSecs(row?.avg_engagement_secs)}
                sub={dismissalRate ? `${dismissalRate}% dismiss rate` : "No dismissals"}
                icon={Clock}
                accent="text-muted-foreground"
              />
            </div>

            {/* Engagement funnel */}
            {impressions > 0 && (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Engagement Funnel
                </p>
                <div className="space-y-2.5">
                  <MetricRow label="Impressions"  count={impressions} total={impressions} color="bg-foreground" />
                  <MetricRow label="Unique Views" count={uniqueViews} total={impressions} color="bg-foreground/70" />
                  <MetricRow label="Clicks"       count={clicks}      total={impressions} color="bg-foreground/50" />
                  <MetricRow label="Emails"       count={emails}      total={impressions} color="bg-foreground/40" />
                  <MetricRow label="Dismissals"   count={dismissals}  total={impressions} color="bg-muted-foreground/40" />
                </div>
              </div>
            )}

            {/* Click → email conversion */}
            {clicks > 0 && (
              <div className="border border-border rounded-lg p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Click-to-Email Conversion
                </p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Clicks</p>
                    <p className="font-semibold">{clicks.toLocaleString()}</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Emails from clicks</p>
                    <p className="font-semibold">
                      {convRate ? `${convRate}%` : "0%"}
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        {emails.toLocaleString()} collected
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Top outbound links — where clicks actually went */}
            {clicks > 0 && (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    Top Outbound Links
                  </p>
                  {outboundLinks.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {outboundLinks.length} destination{outboundLinks.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {linksLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-4 h-4 border-2 border-border border-t-foreground rounded-full animate-spin" />
                  </div>
                ) : outboundLinks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Clicks were recorded, but no link destinations were captured for them.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {outboundLinks.map((r, i) => (
                      <LinkRow
                        key={r.link_url || i}
                        row={r}
                        maxClicks={Number(outboundLinks[0]?.clicks || 0)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {impressions === 0 && (
              <div className="flex items-start gap-2.5 px-3 py-2.5 bg-secondary border border-border rounded-lg text-xs text-muted-foreground">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  No impressions recorded yet. Stats will appear here once the WordPress plugin starts serving this pop-up to visitors.
                </span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground text-right">
              Auto-refreshes every 30 s · Emails collected are listed in the Emails Collected tab.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
