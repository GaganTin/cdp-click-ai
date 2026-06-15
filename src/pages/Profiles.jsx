import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  UserCheck, Ghost, Search, ChevronLeft, ChevronRight,
  Mail, Phone, Calendar, MapPin, Globe, BookOpen,
  Activity, ExternalLink, Filter, X,
  Star, MousePointer, Clock, MessageCircle, Eye, Copy,
  TrendingUp, CheckSquare, ChevronDown, ChevronUp, Users,
  Upload, Trash2,
  ShoppingBag, Hash, BarChart2, ArrowUp, ArrowDown,
} from "lucide-react";
import { useStickyState } from "@/lib/useStickyState";
import ProfilesAnalyticsPanel from "@/components/profiles/ProfilesAnalyticsPanel";
import ProfileImportDialog from "@/components/import/ProfileImportDialog";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format, parseISO, isValid, differenceInCalendarDays } from "date-fns";

const TABS = [
  { key: "customer", label: "Customers", icon: UserCheck },
  { key: "anonymous", label: "Anonymous", icon: Ghost },
  { key: "analytics", label: "Analytics", icon: BarChart2 },
];

// Sort fields (resolved server-side) + group dimensions (applied to the current page).
const CUST_SORT_OPTS  = [["join_date", "Join date"], ["name", "Name"], ["orders", "Orders"], ["spend", "Spend"], ["last_order", "Last order"], ["sessions", "Web sessions"], ["last_seen", "Last seen"]];
const ANON_SORT_OPTS  = [["events", "Events"], ["page_views", "Page views"], ["sessions", "Sessions"], ["last_seen", "Last seen"], ["first_seen", "First seen"]];
const CUST_GROUP_OPTS = [["none", "None"], ["channel", "Reg. channel"], ["source", "Source"], ["age_group", "Age group"], ["purchases", "Has purchases"]];
const ANON_GROUP_OPTS = [["none", "None"], ["source_medium", "Source / Medium"], ["intent", "Form completed"]];

// Percent-decode URLs for display so Chinese (and any non-ASCII) reads naturally.
const decodeUrl = (u) => { try { return decodeURIComponent(u || ""); } catch { return u || ""; } };

function safeDate(val, fmt = "MMM d, yyyy") {
  if (!val) return null;
  try {
    const d = typeof val === "string" && /^\d{8}$/.test(val)
      ? parseISO(val.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))
      : parseISO(val);
    return isValid(d) ? format(d, fmt) : null;
  } catch { return null; }
}

// "today" / "yesterday" / "N days ago" relative to now, for a timestamp value.
function daysAgoLabel(val) {
  if (!val) return null;
  try {
    const d = parseISO(val);
    if (!isValid(d)) return null;
    const n = differenceInCalendarDays(new Date(), d);
    if (n <= 0) return "today";
    if (n === 1) return "yesterday";
    return `${n} days ago`;
  } catch { return null; }
}

function StatBox({ label, value }) {
  return (
    <div className="rounded-md px-3 py-2 text-center bg-secondary/50">
      <p className="text-sm font-semibold">{Number(value || 0).toLocaleString()}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{children}</p>;
}

function Pill({ children, active }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${active ? "border-foreground/50 text-foreground" : "border-border text-muted-foreground opacity-50"}`}>
      {children}
    </span>
  );
}

// How a profile got tagged - shown so users can see the value's origin.
const AFFINITY_SOURCE_LABEL = { web_content: "content", rule: "rule", manual: "manual" };

function AffinitiesBlock({ entityType, entityId }) {
  const { data = [] } = useQuery({
    queryKey: ["profile-affinities", entityType, entityId],
    queryFn: () => appClient.attributes.profileAttributes(entityType, entityId),
    enabled: !!entityId,
  });
  if (!data.length) return null;
  // Flat "(source) Attribute: Value" chips. Dedupe identical
  // (source, attribute, value): the same value from the same source AND attribute
  // never repeats, but the same value is kept when the source differs OR the
  // attribute differs - e.g. (content) Country: Australia next to both
  // (rule) University Country: Australia and (content) University Country: Australia.
  const seen = new Set();
  const tags = [];
  for (const a of data) {
    const key = `${a.source}|${a.attribute_name}|${String(a.value ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(a);
  }
  return (
    <div>
      <SectionTitle>Affinities & Attributes</SectionTitle>
      <div className="flex flex-wrap gap-1">
        {tags.map((a, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/40 border border-border">
            <span className="text-muted-foreground">({AFFINITY_SOURCE_LABEL[a.source] || a.source}) {a.attribute_name}: </span>
            <strong>{a.value}</strong>
            {a.score > 1 && <span className="text-muted-foreground"> ·{a.score}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

const ORDER_STATUS_STYLE = {
  completed: "bg-foreground text-background",
  confirmed: "border border-border text-foreground",
  cancelled: "border border-border text-muted-foreground line-through",
  draft:     "border border-border text-muted-foreground",
};

// Lazily fetches a member's Shopify orders (only mounts when the card is expanded).
function TransactionsBlock({ memberId, fmtMoney }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-transactions", memberId],
    queryFn: () => appClient.profiles.transactions(memberId),
    enabled: !!memberId,
  });
  const orders = data?.orders || [];
  if (isLoading) return <p className="text-[11px] text-muted-foreground">Loading orders…</p>;
  if (!orders.length) return null;
  return (
    <div>
      <SectionTitle>Recent Orders ({orders.length})</SectionTitle>
      <div className="space-y-1.5">
        {orders.slice(0, 10).map(o => {
          const items = Array.isArray(o.items) ? o.items : [];
          return (
            <div key={o.trxn_id} className="rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium font-mono">{o.trxn_ref || o.trxn_id}</span>
                <span className="text-[11px] font-semibold">{fmtMoney(o.amount, o.currency)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                {o.trxn_date && <span>{safeDate(o.trxn_date)}</span>}
                <span className={`px-1.5 py-px rounded-full text-[9px] ${ORDER_STATUS_STYLE[o.trxn_order_status] || "border border-border text-muted-foreground"}`}>
                  {o.trxn_order_status}
                </span>
                {o.trxn_channel && <span>· {o.trxn_channel}</span>}
              </div>
              {items.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {items.slice(0, 4).map((it, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate">{it.qty}× {it.name || it.sku || "Item"}</span>
                      <span className="flex-shrink-0">{fmtMoney(it.unit_price, o.currency)}</span>
                    </div>
                  ))}
                  {items.length > 4 && <p className="text-[10px] text-muted-foreground">+{items.length - 4} more item{items.length - 4 !== 1 ? "s" : ""}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightRow({ label, value, sub }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right truncate">
        {value}{sub != null && <span className="text-muted-foreground font-normal"> {sub}</span>}
      </span>
    </div>
  );
}

// Lazily-loaded "Top" web/transaction values + marketing touchpoints for a profile.
function InsightsBlock({ type, id }) {
  const { data, isLoading } = useQuery({
    queryKey: ["profile-insights", type, id],
    queryFn: () => type === "customer" ? appClient.profiles.insights(id) : appClient.profiles.anonymousInsights(id),
    enabled: !!id,
  });
  if (isLoading) return <p className="text-[11px] text-muted-foreground">Loading insights…</p>;
  if (!data) return null;
  const web = data.web || {};
  const tx = data.transactions || {};
  const tp = data.touchpoints || {};
  const clip = (u) => { const d = decodeUrl(u); return d.length > 46 ? d.slice(0, 46) + "…" : d; };

  const webItems = [
    web.top_page && { label: "Top page", value: clip(web.top_page.value), sub: `·${web.top_page.count}` },
    web.top_outbound_link && { label: "Top outbound link", value: clip(web.top_outbound_link.value), sub: `·${web.top_outbound_link.count}` },
    web.engagement_events > 0 && { label: "Engagement", value: `${web.engagement_events.toLocaleString()} events` },
    web.top_content_attribute && { label: `Top ${web.top_content_attribute.name}`, value: web.top_content_attribute.value, sub: web.top_content_attribute.score > 1 ? `·${web.top_content_attribute.score}` : null },
  ].filter(Boolean);

  const txItems = [
    tx.top_product && { label: "Top product", value: tx.top_product.value, sub: `·${tx.top_product.qty}` },
    tx.top_category && { label: "Top category", value: tx.top_category.value, sub: `·${tx.top_category.qty}` },
    tx.top_channel && { label: "Top channel", value: tx.top_channel.value },
  ].filter(Boolean);

  const emails = tp.emails || [];
  const popups = tp.popups || [];          // pop-ups whose form they submitted
  const popupsSeen = tp.popups_seen || []; // pop-ups they were shown / clicked
  const utm = tp.utm_links || [];
  const segments = data.segments || [];

  // Compose the full UTM string for display from the campaign's parts.
  const utmFull = (u) => {
    const parts = [
      u.utm_source && `source=${u.utm_source}`,
      u.utm_medium && `medium=${u.utm_medium}`,
      u.utm_campaign && `campaign=${u.utm_campaign}`,
      u.utm_term && `term=${u.utm_term}`,
      u.utm_content && `content=${u.utm_content}`,
    ].filter(Boolean);
    return parts.join(" · ");
  };
  const utmHref = (u) => {
    if (!u.base_url) return null;
    const qs = [
      u.utm_source && `utm_source=${encodeURIComponent(u.utm_source)}`,
      u.utm_medium && `utm_medium=${encodeURIComponent(u.utm_medium)}`,
      u.utm_campaign && `utm_campaign=${encodeURIComponent(u.utm_campaign)}`,
      u.utm_term && `utm_term=${encodeURIComponent(u.utm_term)}`,
      u.utm_content && `utm_content=${encodeURIComponent(u.utm_content)}`,
    ].filter(Boolean).join("&");
    const base = /^https?:\/\//i.test(u.base_url) ? u.base_url : `https://${u.base_url}`;
    return qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
  };

  const hasTouchpoints = emails.length || popups.length || popupsSeen.length || utm.length;
  if (!webItems.length && !txItems.length && !hasTouchpoints && !segments.length) return null;

  return (
    <>
      {webItems.length > 0 && (
        <div>
          <SectionTitle>Top Web Activity</SectionTitle>
          <div className="space-y-1">{webItems.map((it, i) => <InsightRow key={i} {...it} />)}</div>
        </div>
      )}
      {txItems.length > 0 && (
        <div>
          <SectionTitle>Top Purchases</SectionTitle>
          <div className="space-y-1">{txItems.map((it, i) => <InsightRow key={i} {...it} />)}</div>
        </div>
      )}
      {segments.length > 0 && (
        <div>
          <SectionTitle>Segments</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {segments.map((s) => (
              <span key={s.id} className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-secondary/40 text-foreground flex items-center gap-1">
                <Users className="w-2.5 h-2.5" /> {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {hasTouchpoints > 0 && (
        <div>
          <SectionTitle>Touchpoints</SectionTitle>
          <div className="space-y-2.5">
            {emails.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><Mail className="w-3 h-3" /> Email campaigns sent</p>
                <div className="space-y-1">
                  {emails.map((e, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate">{e.campaign}</span>
                      <span className="flex-shrink-0">
                        {e.clicked ? <Badge variant="secondary" className="text-[9px] h-4 px-1">clicked</Badge>
                          : e.opened ? <Badge variant="secondary" className="text-[9px] h-4 px-1">opened</Badge>
                          : <span className="text-[10px] text-muted-foreground">{e.status}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {utm.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> UTM links</p>
                <div className="space-y-1">
                  {utm.map((u, i) => {
                    const href = utmHref(u);
                    return (
                      <div key={i} className="text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{u.name || u.utm_campaign}</span>
                          {href && <button onClick={() => { navigator.clipboard.writeText(href); toast.success("UTM link copied"); }} title="Copy UTM link" className="text-muted-foreground hover:text-foreground flex-shrink-0"><Copy className="w-2.5 h-2.5" /></button>}
                        </div>
                        {utmFull(u) && <p className="text-[10px] text-muted-foreground truncate">{utmFull(u)}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {popupsSeen.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> Pop-ups seen</p>
                <div className="flex flex-wrap gap-1">
                  {popupsSeen.map((p, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground flex items-center gap-1">
                      {p.name}{p.clicked && <Badge variant="secondary" className="text-[9px] h-3.5 px-1">clicked</Badge>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {popups.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> Pop-up forms submitted</p>
                <div className="flex flex-wrap gap-1">
                  {popups.map((p, i) => <span key={i} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">{p.name}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CustomerCard({ profile, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasGa = Number(profile.ga_sessions) > 0;
  const hasSeminars = Number(profile.seminar_count) > 0;
  const hasAttributes = Number(profile.attribute_count) > 0;
  const joinDate = safeDate(profile.member_join_date);
  const gaFirstSeen = safeDate(profile.ga_first_seen);
  const gaLastSeen = safeDate(profile.ga_last_seen);
  // Purchase aggregates (from commerce."order" + manual.sale, joined server-side)
  const orderCount = Number(profile.order_count) || 0;
  const totalSpend = Number(profile.total_spend) || 0;
  const hasOrders = orderCount > 0;
  const lastOrder = safeDate(profile.last_order_date);
  const firstOrder = safeDate(profile.first_order_date);
  const currency = profile.order_currency || "";
  const fmtMoney = (n, cur) => `${(cur || currency) ? (cur || currency) + " " : ""}${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const money = (n) => fmtMoney(n);
  const avgOrder = hasOrders ? totalSpend / orderCount : 0;

  const initials = (profile.eng_first_name?.[0] || profile.display_name?.[0] || "?").toUpperCase();
  const attrs = profile.attributes && typeof profile.attributes === "object" ? profile.attributes : {};
  const seminars = Array.isArray(profile.seminars) ? profile.seminars : [];

  return (
    <div className="border border-border rounded-lg bg-card hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-sm font-bold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{profile.eng_full_name || profile.display_name || "Unknown"}</h3>
              {profile.member_no && (
                <span className="text-[10px] text-muted-foreground font-mono">#{profile.member_no}</span>
              )}
              {hasGa && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-0.5">
                  <Activity className="w-2.5 h-2.5" /> Web active
                </Badge>
              )}
              {hasOrders && (
                <Badge className="text-[10px] h-4 px-1.5 gap-0.5 bg-foreground text-background">
                  <ShoppingBag className="w-2.5 h-2.5" /> {orderCount} order{orderCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {profile.is_opt_in_email && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Email opt-in</Badge>
              )}
              {profile.is_imported && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-0.5">
                  <Upload className="w-2.5 h-2.5" /> Imported
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{profile.primary_email}</p>
            {profile.member_id && (
              <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5 flex items-center gap-1">
                <Hash className="w-2.5 h-2.5" />{profile.member_id}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {profile.is_imported && (
              confirmDelete ? (
                <>
                  <span className="text-[11px] text-muted-foreground">Delete?</span>
                  <button
                    onClick={() => { onDelete(profile.member_id); setConfirmDelete(false); }}
                    className="text-[11px] text-destructive hover:underline font-medium"
                  >Yes</button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >No</button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete imported profile"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )
            )}
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Quick facts */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
          {joinDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Joined {joinDate}</span>}
          {profile.member_reg_channel && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {profile.member_reg_channel}</span>}
          {profile.education_level && <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" /> {profile.education_level}</span>}
          {profile.age_group && <span>{profile.age_group}</span>}
          {profile.gender && <span>{profile.gender}</span>}
          {profile.nationality && <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {profile.nationality}</span>}
        </div>

        {/* Activity summary */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <StatBox label="Web sessions" value={profile.ga_sessions} />
          <StatBox label="Seminars" value={profile.seminar_count} />
          <StatBox label="Attributes" value={profile.attribute_count} />
        </div>

        {/* Web activity summary strip */}
        {hasGa && (
          <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
            <span className="font-medium text-foreground">Web activity: </span>
            {profile.ga_total_events?.toLocaleString()} events across {profile.ga_sessions} session{profile.ga_sessions !== 1 ? "s" : ""}
            {gaFirstSeen && <>
              {" · "}
              {gaFirstSeen === gaLastSeen ? `seen ${gaFirstSeen}` : `${gaFirstSeen} → ${gaLastSeen}`}
            </>}
            {profile.ga_top_source_medium && profile.ga_top_source_medium !== "(not set)" && (
              <> · via <strong className="text-foreground">{profile.ga_top_source_medium}</strong></>
            )}
            {profile.ga_visitor_ids?.length > 0 && (
              <span className="ml-1 font-mono text-[10px] opacity-60">· GA ID: {profile.ga_visitor_ids[0]}{profile.ga_visitor_ids.length > 1 ? ` +${profile.ga_visitor_ids.length - 1}` : ""}</span>
            )}
          </div>
        )}

        {/* Purchase summary strip */}
        {hasOrders && (
          <div className="mt-3 text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3 flex flex-wrap items-center gap-x-1">
            <span className="font-medium text-foreground inline-flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Purchases:</span>
            <span>
              {orderCount} order{orderCount !== 1 ? "s" : ""} · <strong className="text-foreground">{money(totalSpend)}</strong> total
              {lastOrder && <> · last order {lastOrder}{profile.last_order_date && <span className="opacity-70"> ({daysAgoLabel(profile.last_order_date)})</span>}</>}
            </span>
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">

          {/* Contact & profile */}
          <div>
            <SectionTitle>Contact & Profile</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {profile.primary_phone && <span className="flex items-center gap-1 text-muted-foreground"><Phone className="w-3 h-3" /> {profile.primary_phone}</span>}
              {profile.secondary_email && <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" /> {profile.secondary_email}</span>}
              {profile.preferred_language && <span>Language: <strong className="text-foreground">{profile.preferred_language}</strong></span>}
              {profile.preferred_channel && <span>Pref. channel: <strong className="text-foreground">{profile.preferred_channel}</strong></span>}
              {profile.income_level && <span>Income: <strong className="text-foreground">{profile.income_level}</strong></span>}
              {profile.employment_status && <span>Employment: <strong className="text-foreground">{profile.employment_status}</strong></span>}
              {profile.marital_status && <span>Marital: <strong className="text-foreground">{profile.marital_status}</strong></span>}
              {profile.title && <span>Title: <strong className="text-foreground">{profile.title}</strong></span>}
            </div>
          </div>

          {/* Consent flags */}
          <div>
            <SectionTitle>Communication Consent</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={profile.is_opt_in_email}>Email</Pill>
              <Pill active={profile.is_opt_in_call === "true" || profile.is_opt_in_call === true}>Call</Pill>
              <Pill active={profile.is_opt_in_sms === "true" || profile.is_opt_in_sms === true}>SMS</Pill>
              <Pill active={profile.is_opt_in_dm === "true" || profile.is_opt_in_dm === true}>DM</Pill>
              <Pill active={profile.is_subscriber_only}>Subscriber</Pill>
            </div>
          </div>

          {/* Top web/transaction values + marketing touchpoints (lazy-loaded) */}
          <InsightsBlock type="customer" id={profile.member_id} />

          {/* Membership attributes (intended year, year group, etc.) */}
          {hasAttributes && (
            <div>
              <SectionTitle>Study Intentions</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {Object.entries(attrs).map(([k, v]) => (
                  <div key={k} className="bg-secondary/40 rounded px-2 py-1 text-[10px]">
                    <span className="text-muted-foreground">{k.replace(/_/g, " ")}: </span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Purchases (Shopify) */}
          {hasOrders && (
            <div>
              <SectionTitle>Purchases</SectionTitle>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <StatBox label="Orders" value={orderCount} />
                <div className="rounded-md px-3 py-2 text-center bg-secondary/50">
                  <p className="text-sm font-semibold">{money(totalSpend)}</p>
                  <p className="text-[10px] text-muted-foreground">Total spend</p>
                </div>
                <div className="rounded-md px-3 py-2 text-center bg-secondary/50">
                  <p className="text-sm font-semibold">{money(avgOrder)}</p>
                  <p className="text-[10px] text-muted-foreground">Avg order</p>
                </div>
              </div>
              <div className="text-[11px] space-y-0.5 text-muted-foreground">
                {firstOrder && <p>First order: <strong className="text-foreground">{firstOrder}</strong>{lastOrder && firstOrder !== lastOrder && <> · Last order: <strong className="text-foreground">{lastOrder}</strong></>}</p>}
              </div>
            </div>
          )}

          {/* Order history (lazy-loaded) */}
          {hasOrders && <TransactionsBlock memberId={profile.member_id} fmtMoney={fmtMoney} />}

          {/* Behavioral / custom attributes */}
          <AffinitiesBlock entityType="customer" entityId={profile.member_id} />

          {/* GA web activity */}
          {hasGa && (
            <div>
              <SectionTitle>Web Activity (GA4)</SectionTitle>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                <StatBox label="Events" value={profile.ga_total_events} />
                <StatBox label="Page views" value={profile.ga_page_views} />
                <StatBox label="Form starts" value={profile.ga_form_starts} />
                <StatBox label="Form completes" value={profile.ga_form_completes} />
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                <StatBox label="Scrolls" value={profile.ga_scroll_events} />
                <StatBox label="WhatsApp" value={profile.ga_whatsapp_clicks} />
                <StatBox label="Downloads" value={profile.ga_file_downloads} />
              </div>
              <div className="text-[11px] space-y-0.5 text-muted-foreground">
                {gaFirstSeen && <p>First seen: <strong className="text-foreground">{gaFirstSeen}</strong>{gaLastSeen && gaFirstSeen !== gaLastSeen && <> · Last seen: <strong className="text-foreground">{gaLastSeen}</strong></>}</p>}
                {profile.ga_top_source_medium && <p>Top source: <strong className="text-foreground">{profile.ga_top_source_medium}</strong></p>}
                {profile.ga_top_campaign && profile.ga_top_campaign !== "(not set)" && <p>Top campaign: <strong className="text-foreground">{profile.ga_top_campaign}</strong></p>}
              </div>
              {profile.ga_pages_visited?.length > 0 && (
                <div className="mt-2">
                  <SectionTitle>Pages visited</SectionTitle>
                  <div className="space-y-0.5">
                    {profile.ga_pages_visited.slice(0, 6).map(p => (
                      <div key={p} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        <span className="truncate">{decodeUrl(p)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Seminars */}
          {hasSeminars && (
            <div>
              <SectionTitle>Seminar Registrations ({profile.seminar_count})</SectionTitle>
              <div className="space-y-1">
                {seminars.slice(0, 5).map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <CheckSquare className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-foreground leading-snug">{s.event_name}</p>
                      {s.event_date && <p className="text-muted-foreground">{safeDate(s.event_date)}</p>}
                    </div>
                  </div>
                ))}
                {seminars.length > 5 && (
                  <p className="text-[10px] text-muted-foreground">+{seminars.length - 5} more</p>
                )}
              </div>
            </div>
          )}

          {profile.tags && (
            <div>
              <SectionTitle>Tags</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {profile.tags.split(",").map(t => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t.trim()}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnonymousCard({ profile }) {
  const [expanded, setExpanded] = useState(false);
  const hasFormComplete = Number(profile.form_completes) > 0;
  const hasWhatsapp = Number(profile.whatsapp_clicks) > 0;
  const firstSeen = safeDate(profile.first_seen);
  const lastSeen = safeDate(profile.last_seen);
  const shortId = profile.visitor_id?.slice(0, 14) + (profile.visitor_id?.length > 14 ? "…" : "");

  return (
    <div className="border border-border rounded-lg bg-card hover:shadow-sm transition-shadow">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0">
            <Ghost className="w-4.5 h-4.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold font-mono">{shortId}</h3>
              {hasFormComplete && (
                <Badge className="text-[10px] h-4 px-1.5 gap-0.5 bg-foreground text-background">
                  <Star className="w-2.5 h-2.5" /> High intent
                </Badge>
              )}
              {hasWhatsapp && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-0.5">
                  <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{profile.top_source_medium || "Unknown source"}</p>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-4 gap-1.5 mt-3">
          <StatBox label="Events" value={profile.total_events} />
          <StatBox label="Page views" value={profile.page_views} />
          <StatBox label="Sessions" value={profile.sessions} />
          <StatBox label="Forms" value={profile.form_completes} />
        </div>

        {/* Timeline */}
        {(firstSeen || lastSeen) && (
          <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground">
            {firstSeen && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> First: <strong className="text-foreground ml-0.5">{firstSeen}</strong></span>}
            {lastSeen && firstSeen !== lastSeen && <span>Last: <strong className="text-foreground">{lastSeen}</strong></span>}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">

          {/* Top web values + marketing touchpoints (lazy-loaded) */}
          <InsightsBlock type="anonymous" id={profile.visitor_id} />

          {/* Extended metrics */}
          <div>
            <SectionTitle>All Behaviour Signals</SectionTitle>
            <div className="grid grid-cols-4 gap-1.5">
              <StatBox label="Form starts" value={profile.form_starts} />
              <StatBox label="Scrolls" value={profile.scroll_events} />
              <StatBox label="WhatsApp" value={profile.whatsapp_clicks} />
              <StatBox label="Downloads" value={profile.file_downloads} />
              <StatBox label="Clicks" value={profile.click_events} />
              <StatBox label="Engagement" value={profile.user_engagement} />
              <StatBox label="First visits" value={profile.first_visits} />
            </div>
          </div>

          {/* Campaign exposure */}
          {(profile.campaigns?.length > 0 || profile.source_mediums?.length > 0) && (
            <div>
              <SectionTitle>Campaign Exposure</SectionTitle>
              {profile.top_campaign && profile.top_campaign !== "(not set)" && (
                <p className="text-[11px] mb-1">Top campaign: <strong className="text-foreground">{profile.top_campaign}</strong></p>
              )}
              {profile.source_mediums?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {profile.source_mediums.slice(0, 6).map(sm => (
                    <span key={sm} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                      {sm}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Events triggered */}
          {profile.events?.length > 0 && (
            <div>
              <SectionTitle>Events triggered</SectionTitle>
              <div className="flex flex-wrap gap-1">
                {profile.events.map(e => (
                  <span key={e} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-2.5 h-2.5" /> {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pages visited */}
          {profile.pages_visited?.length > 0 && (
            <div>
              <SectionTitle>Pages visited ({profile.pages_visited.length})</SectionTitle>
              <div className="space-y-0.5">
                {profile.pages_visited.slice(0, 8).map(p => (
                  <div key={p} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <MousePointer className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{decodeUrl(p)}</span>
                  </div>
                ))}
                {profile.pages_visited.length > 8 && (
                  <p className="text-[10px] text-muted-foreground">+{profile.pages_visited.length - 8} more</p>
                )}
              </div>
            </div>
          )}

          {/* Behavioral / custom attributes */}
          <AffinitiesBlock entityType="anonymous" entityId={profile.visitor_id} />

          <div className="text-[10px] text-muted-foreground font-mono break-all pt-1">
            Visitor ID: {profile.visitor_id}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveFilters({ filters, labels, onRemove, inline }) {
  const chip = (key, value, display) => (
    <span key={`${key}:${value}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
      {labels[key] || key}: <strong>{display}</strong>
      <button onClick={() => onRemove(key, value)} className="hover:text-foreground text-muted-foreground ml-0.5">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
  const chips = [];
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) value.forEach(v => chips.push(chip(key, v, v)));
    else if (value) chips.push(chip(key, value, value === "true" ? "Yes" : value));
  }
  if (!chips.length) return null;
  if (inline) return <>{chips}</>;
  return <div className="flex flex-wrap gap-1.5 mt-2">{chips}</div>;
}

function filtersToSegmentCriteria(filters, isCustomer) {
  if (!isCustomer) {
    return {
      source: filters.source || [],
      medium: filters.medium || [],
      has_form_complete: filters.has_form_complete === "true" ? "true" : "",
    };
  }
  return {
    reg_channel:       filters.reg_channel || [],
    education_level:   filters.education_level || [],
    age_group:         filters.age_group || [],
    gender:            filters.gender || [],
    nationality:       filters.nationality || [],
    preferred_language: filters.preferred_language || [],
    employment_status: filters.employment_status || [],
    income_level:      filters.income_level || [],
    member_type:       filters.member_type || [],
    preferred_channel: filters.preferred_channel || [],
    is_opt_in_email:   filters.opt_in_email === "true" ? "true" : "",
    opt_in_sms:        filters.opt_in_sms === "true" ? "true" : "",
    is_subscriber:     filters.is_subscriber === "true" ? "true" : "",
    has_ga_activity:   filters.has_ga === "true" ? "true" : "",
    min_ga_sessions:   filters.min_ga_sessions || "",
    has_seminars:      filters.has_seminars === "true" ? "true" : "",
    has_attributes:    filters.has_attributes === "true" ? "true" : "",
    has_transactions:  filters.has_transactions === "true" ? "true" : "",
    min_orders:        filters.min_orders || "",
    min_spend:         filters.min_spend || "",
    ordered_within:    filters.ordered_within || "",
  };
}

function criteriaToChips(crit) {
  const labels = {
    reg_channel:        v => `channel: ${v}`,
    education_level:    v => `education: ${v}`,
    age_group:          v => `age group: ${v}`,
    gender:             v => `gender: ${v}`,
    nationality:        v => `nationality: ${v}`,
    preferred_language: v => `language: ${v}`,
    employment_status:  v => `employment: ${v}`,
    income_level:       v => `income: ${v}`,
    member_type:        v => `member type: ${v}`,
    preferred_channel:  v => `preferred channel: ${v}`,
    is_opt_in_email:    () => `email opted-in`,
    opt_in_sms:         () => `SMS opted-in`,
    is_subscriber:      () => `subscriber only`,
    has_ga_activity:    () => `has web activity`,
    min_ga_sessions:    v => `${v}+ GA sessions`,
    has_seminars:       () => `attended seminar`,
    has_attributes:     () => `has study intentions`,
    has_transactions:   () => `has purchases`,
    min_orders:         v => `${v}+ orders`,
    min_spend:          v => `${v}+ spend`,
    ordered_within:     v => `ordered in last ${v} days`,
    source_medium:      v => `source/medium: ${v}`,
    source:             v => `source: ${v}`,
    medium:             v => `medium: ${v}`,
    has_form_complete:  () => `completed a form`,
  };
  return Object.entries(crit)
    .filter(([k, v]) => k !== "attribute_value_ids" && (Array.isArray(v) ? v.length : v))
    .map(([k, v]) => labels[k]?.(v) || `${k}: ${v}`);
}

export default function Profiles() {
  const [activeTab, setActiveTab] = useState("customer");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [saveSegmentOpen, setSaveSegmentOpen] = useState(false);
  const [segmentName, setSegmentName] = useState("");
  const [segmentDesc, setSegmentDesc] = useState("");
  // Multi-select demographic fields hold arrays; boolean/threshold fields stay scalar strings.
  const [custFilters, setCustFilters] = useState({
    reg_channel: [], education_level: [], age_group: [], gender: [], nationality: [], preferred_language: [],
    employment_status: [], income_level: [], member_type: [], preferred_channel: [],
    has_ga: "", min_ga_sessions: "", has_seminars: "", has_attributes: "",
    opt_in_email: "", opt_in_sms: "", is_subscriber: "", is_imported: "",
    has_transactions: "", min_orders: "", min_spend: "", ordered_within: "",
  });
  const [anonFilters, setAnonFilters] = useState({ source: [], medium: [], has_form_complete: "" });
  // Sort (server-side) + group (current page) per tab; persisted across refreshes.
  const [custSort, setCustSort] = useStickyState("join_date", "prof.custSort");
  const [custDir, setCustDir] = useStickyState("desc", "prof.custDir");
  const [custGroup, setCustGroup] = useStickyState("none", "prof.custGroup");
  const [anonSort, setAnonSort] = useStickyState("events", "prof.anonSort");
  const [anonDir, setAnonDir] = useStickyState("desc", "prof.anonDir");
  const [anonGroup, setAnonGroup] = useStickyState("none", "prof.anonGroup");
  // Applied-attribute filters, keyed by attribute id → selected value id (AND across attributes).
  const [attrFilters, setAttrFilters] = useState({});
  // Import dialog (UI lives in the shared ProfileImportDialog)
  const [importOpen, setImportOpen] = useState(false);
  const filterRef = useRef(null);
  const queryClient = useQueryClient();
  const LIMIT = 20;

  const saveSegmentMutation = useMutation({
    mutationFn: (data) => appClient.entities.Segment.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      setSaveSegmentOpen(false);
      setSegmentName("");
      setSegmentDesc("");
      toast.success("Segment saved");
    },
    onError: (err) => toast.error(err.message || "Failed to save segment"),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: (memberId) => appClient.profiles.deleteProfile(memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles-customers"] });
      toast.success("Profile deleted");
    },
    onError: (err) => toast.error(err.message || "Failed to delete profile"),
  });

  const handleSaveSegment = () => {
    const isCustomer = activeTab === "customer";
    const filters = isCustomer ? custFilters : anonFilters;
    const crit = filtersToSegmentCriteria(filters, isCustomer);
    if (attrValueIds.length) crit.attribute_value_ids = attrValueIds;
    const chips = [...criteriaToChips(crit), ...attrChips];
    const activeCrit = Object.fromEntries(Object.entries(crit).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
    const descParts = chips.length ? `Criteria: ${chips.join(", ")}.` : "";
    const description = segmentDesc
      ? (chips.length ? `${segmentDesc} ${descParts}` : segmentDesc)
      : descParts;
    saveSegmentMutation.mutate({
      name: segmentName,
      description,
      segment_type: isCustomer ? "customer" : "anonymous_profile",
      status: "draft",
      estimated_size: (isCustomer ? custData?.total : anonData?.total) || undefined,
      metadata: {
        ...(chips.length ? { criteria: chips } : {}),
        ...(Object.keys(activeCrit).length ? { filter_criteria: activeCrit } : {}),
      },
    });
  };

  useEffect(() => { setPage(1); }, [activeTab, search, custFilters, anonFilters, attrFilters, custSort, custDir, anonSort, anonDir]);

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: custFilterOpts } = useQuery({ queryKey: ["profiles-cust-filters"], queryFn: () => appClient.profiles.customerFilters() });
  const { data: anonFilterOpts } = useQuery({ queryKey: ["profiles-anon-filters"], queryFn: () => appClient.profiles.anonymousFilters() });
  // Active attributes (with applied values) available to filter by, scoped per tab.
  const { data: attrOptions = [] } = useQuery({ queryKey: ["attribute-options"], queryFn: () => appClient.attributes.options() });

  // Lightweight total counts per tab (unfiltered) for the tab labels.
  const { data: custCount } = useQuery({ queryKey: ["profiles-customers-count"], queryFn: () => appClient.profiles.listCustomers({ page: 1, limit: 1 }) });
  const { data: anonCount } = useQuery({ queryKey: ["profiles-anonymous-count"], queryFn: () => appClient.profiles.listAnonymous({ page: 1, limit: 1 }) });
  const tabCounts = { customer: custCount?.total, anonymous: anonCount?.total };

  const isCustomer = activeTab === "customer";

  // Attributes relevant to the current tab (scope "both" applies to either).
  const scopedAttrs = attrOptions.filter(a => a.scope === "both" || a.scope === activeTab);
  // attrFilters: { [attributeId]: valueId[] }. Within an attribute the values are OR'd;
  // across attributes they're AND'd, encoded as `attr_groups` = "v1,v2;v3" (";"-separated groups).
  const attrValueIds = Object.values(attrFilters).flat().filter(Boolean);
  const attr_groups = Object.values(attrFilters)
    .map(vals => (vals || []).filter(Boolean).join(","))
    .filter(Boolean)
    .join(";");
  // attribute id → value id → human label, for chips and segment descriptions.
  const attrLabel = (attrId, valId) => {
    const a = attrOptions.find(x => String(x.id) === String(attrId));
    const v = a?.values.find(x => String(x.id) === String(valId));
    return a && v ? `${a.name}: ${v.value}` : null;
  };
  const attrChips = Object.entries(attrFilters)
    .flatMap(([aid, vals]) => (vals || []).map(vid => attrLabel(aid, vid)))
    .filter(Boolean);

  const { data: custData, isLoading: custLoading } = useQuery({
    queryKey: ["profiles-customers", search, page, custFilters, attr_groups, custSort, custDir],
    queryFn: () => appClient.profiles.listCustomers({ search, page, limit: LIMIT, ...custFilters, attr_groups, sort: custSort, dir: custDir }),
    enabled: isCustomer,
    keepPreviousData: true,
  });
  const { data: anonData, isLoading: anonLoading } = useQuery({
    queryKey: ["profiles-anonymous", search, page, anonFilters, attr_groups, anonSort, anonDir],
    queryFn: () => appClient.profiles.listAnonymous({ search, page, limit: LIMIT, ...anonFilters, attr_groups, sort: anonSort, dir: anonDir }),
    enabled: !isCustomer,
    keepPreviousData: true,
  });

  const profiles = isCustomer ? (custData?.profiles || []) : (anonData?.profiles || []);
  const total = isCustomer ? (custData?.total || 0) : (anonData?.total || 0);
  const isLoading = isCustomer ? custLoading : anonLoading;
  const totalPages = Math.ceil(total / LIMIT);

  // Group the current page's profiles (server already sorted them). null = no grouping.
  const groupKey = isCustomer ? custGroup : anonGroup;
  const groupOf = (p) => {
    if (isCustomer) {
      if (groupKey === "channel")   return p.member_reg_channel || "Unknown channel";
      if (groupKey === "source")    return p.member_source || "ga";
      if (groupKey === "age_group") return p.age_group || "Unknown age";
      if (groupKey === "purchases") return Number(p.order_count) > 0 ? "Has purchases" : "No purchases";
    } else {
      if (groupKey === "source_medium") return p.top_source_medium || "Unknown source";
      if (groupKey === "intent")        return Number(p.form_completes) > 0 ? "Completed a form" : "No form";
    }
    return null;
  };
  const groupedProfiles = (() => {
    if (groupKey === "none") return null;
    const map = new Map();
    for (const p of profiles) {
      const k = groupOf(p) ?? "Other";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  })();
  const renderCard = (p) => isCustomer
    ? <CustomerCard key={p.member_id} profile={p} onDelete={deleteProfileMutation.mutate} />
    : <AnonymousCard key={p.visitor_id} profile={p} />;

  const setCustFilter = (k, v) => setCustFilters(f => ({ ...f, [k]: v }));
  const setAnonFilter = (k, v) => setAnonFilters(f => ({ ...f, [k]: v }));
  const setAttrFilter = (attrId, vals) => setAttrFilters(f => {
    const next = { ...f };
    if (vals && vals.length) next[attrId] = vals; else delete next[attrId];
    return next;
  });

  // A filter is active if any array field has entries or any scalar field is set.
  const anyFilterSet = (obj) => Object.values(obj).some(v => Array.isArray(v) ? v.length > 0 : !!v);
  const hasActiveFilters = (isCustomer ? anyFilterSet(custFilters) : anyFilterSet(anonFilters)) || attrValueIds.length > 0;

  // "Applied attributes" filter section - one dropdown per active attribute that
  // applies to the current tab. Picking a value narrows the list to profiles tagged with it.
  const attrFilterSection = scopedAttrs.length > 0 && (
    <div className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Applied attributes</p>
      <div className="grid grid-cols-3 gap-3">
        {scopedAttrs.map(a => (
          <div key={a.id}>
            <p className="text-[10px] text-muted-foreground mb-1 truncate" title={a.name}>{a.name}</p>
            <MultiSelect
              value={attrFilters[a.id] || []}
              onChange={v => setAttrFilter(a.id, v)}
              options={a.values.map(v => ({ value: v.id, label: `${v.value}${v.profile_count > 0 ? ` (${v.profile_count})` : ""}` }))}
              placeholder="All"
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Profiles</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Known customers and anonymous visitors built from your data.
            </p>
          </div>
          {activeTab === "customer" && (
            <div className="flex items-center gap-2">
              <Button size="sm" className="h-9 gap-1.5"
                onClick={() => setImportOpen(true)}>
                <Upload className="w-3.5 h-3.5" /> Import Profiles
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = tabCounts[tab.key];
            return (
              <button key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearch(""); setPage(1); setAttrFilters({}); }}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {tab.label}
                {count > 0 && <span className="text-[10px] text-muted-foreground">{count.toLocaleString()}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "analytics" ? <ProfilesAnalyticsPanel /> : (
        <div className="px-8 py-6">
        {/* Search + filters */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isCustomer ? "Search name, email, member ID or no…" : "Search visitor ID…"}
                className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div ref={filterRef} className="relative">
              <Button
                variant="outline" size="sm" className="h-9 gap-1.5"
                onClick={() => setShowFilters(f => !f)}
              >
                <Filter className="w-3.5 h-3.5" /> Filters
                {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
              </Button>
              {showFilters && (
                <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg overflow-hidden w-[540px] max-h-[480px] overflow-y-auto">
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Filter by</p>
                    {hasActiveFilters && (
                      <button
                        onClick={() => {
                          setCustFilters({ reg_channel: [], education_level: [], age_group: [], gender: [], nationality: [], preferred_language: [], employment_status: [], income_level: [], member_type: [], preferred_channel: [], has_ga: "", min_ga_sessions: "", has_seminars: "", has_attributes: "", opt_in_email: "", opt_in_sms: "", is_subscriber: "", is_imported: "", has_transactions: "", min_orders: "", min_spend: "", ordered_within: "" });
                          setAnonFilters({ source: [], medium: [], has_form_complete: "" });
                          setAttrFilters({});
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >Clear all</button>
                    )}
                  </div>
                  {isCustomer ? (
                    <div className="divide-y divide-border">
                      <div className="p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demographics</p>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { key: "reg_channel",       label: "Channel",     opts: custFilterOpts?.reg_channels },
                            { key: "age_group",          label: "Age group",   opts: custFilterOpts?.age_groups },
                            { key: "gender",             label: "Gender",      opts: custFilterOpts?.genders },
                            { key: "nationality",        label: "Nationality", opts: custFilterOpts?.nationalities },
                            { key: "education_level",    label: "Education",   opts: custFilterOpts?.education_levels },
                            { key: "employment_status",  label: "Employment",  opts: custFilterOpts?.employment_statuses },
                            { key: "income_level",       label: "Income",      opts: custFilterOpts?.income_levels },
                            { key: "member_type",        label: "Member type", opts: custFilterOpts?.member_types },
                            { key: "preferred_language", label: "Language",    opts: custFilterOpts?.languages },
                          ].map(f => (
                            <div key={f.key}>
                              <p className="text-[10px] text-muted-foreground mb-1">{f.label}</p>
                              <MultiSelect value={custFilters[f.key]} onChange={v => setCustFilter(f.key, v)} options={f.opts || []} placeholder="All" />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Communication</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Email opt-in</p>
                            <select value={custFilters.opt_in_email} onChange={e => setCustFilter("opt_in_email", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Opted in</option>
                              <option value="false">Not opted in</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">SMS opt-in</p>
                            <select value={custFilters.opt_in_sms} onChange={e => setCustFilter("opt_in_sms", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Opted in</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Subscriber only</p>
                            <select value={custFilters.is_subscriber} onChange={e => setCustFilter("is_subscriber", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Subscriber only</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Preferred channel</p>
                            <MultiSelect value={custFilters.preferred_channel} onChange={v => setCustFilter("preferred_channel", v)} options={custFilterOpts?.preferred_channels || []} placeholder="All" />
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Activity</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Web activity</p>
                            <select value={custFilters.has_ga} onChange={e => setCustFilter("has_ga", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Has web data</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Min. GA sessions</p>
                            <input type="number" min="0" inputMode="numeric" value={custFilters.min_ga_sessions} onChange={e => setCustFilter("min_ga_sessions", e.target.value)}
                              placeholder="Any" className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Seminars</p>
                            <select value={custFilters.has_seminars} onChange={e => setCustFilter("has_seminars", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Attended seminar</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Attributes</p>
                            <select value={custFilters.has_attributes} onChange={e => setCustFilter("has_attributes", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Has study intentions</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Source</p>
                            <select value={custFilters.is_imported} onChange={e => setCustFilter("is_imported", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Imported only</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Purchases</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Has purchases</p>
                            <select value={custFilters.has_transactions} onChange={e => setCustFilter("has_transactions", e.target.value)}
                              className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                              <option value="">All</option>
                              <option value="true">Has orders</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Min. orders</p>
                            <input type="number" min="0" inputMode="numeric" value={custFilters.min_orders} onChange={e => setCustFilter("min_orders", e.target.value)}
                              placeholder="Any" className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Min. spend</p>
                            <input type="number" min="0" inputMode="numeric" value={custFilters.min_spend} onChange={e => setCustFilter("min_spend", e.target.value)}
                              placeholder="Any" className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">Ordered within (days)</p>
                            <input type="number" min="0" inputMode="numeric" value={custFilters.ordered_within} onChange={e => setCustFilter("ordered_within", e.target.value)}
                              placeholder="Any time" className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                        </div>
                      </div>
                      {attrFilterSection}
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Source</p>
                          <MultiSelect value={anonFilters.source} onChange={v => setAnonFilter("source", v)} options={anonFilterOpts?.sources || []} placeholder="All" />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Medium</p>
                          <MultiSelect value={anonFilters.medium} onChange={v => setAnonFilter("medium", v)} options={anonFilterOpts?.mediums || []} placeholder="All" />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">Intent level</p>
                          <select value={anonFilters.has_form_complete} onChange={e => setAnonFilter("has_form_complete", e.target.value)}
                            className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                            <option value="">All visitors</option>
                            <option value="true">Completed a form (high intent)</option>
                          </select>
                        </div>
                      </div>
                      </div>
                      {attrFilterSection}
                    </div>
                  )}
                  {/* Sort + Group (applies to the active tab; mirrors Attributes) */}
                  <div className="p-4 border-t border-border space-y-3">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Sort by</p>
                      <div className="flex items-center gap-2">
                        <select value={isCustomer ? custSort : anonSort} onChange={e => (isCustomer ? setCustSort : setAnonSort)(e.target.value)}
                          className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          {(isCustomer ? CUST_SORT_OPTS : ANON_SORT_OPTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button type="button" onClick={() => (isCustomer ? setCustDir : setAnonDir)(d => d === "asc" ? "desc" : "asc")}
                          className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                          {(isCustomer ? custDir : anonDir) === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> Asc</> : <><ArrowDown className="w-3.5 h-3.5" /> Desc</>}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Group by</p>
                      <select value={isCustomer ? custGroup : anonGroup} onChange={e => (isCustomer ? setCustGroup : setAnonGroup)(e.target.value)}
                        className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        {(isCustomer ? CUST_GROUP_OPTS : ANON_GROUP_OPTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {hasActiveFilters && (
              <Button
                variant="outline" size="sm" className="h-9 gap-1.5"
                onClick={() => {
                  const chips = [...criteriaToChips(filtersToSegmentCriteria(isCustomer ? custFilters : anonFilters, isCustomer)), ...attrChips];
                  setSegmentDesc(chips.length ? `Criteria: ${chips.join(", ")}.` : "");
                  setSegmentName("");
                  setSaveSegmentOpen(true);
                }}
              >
                <Users className="w-3.5 h-3.5" /> Save as Segment
              </Button>
            )}
          </div>

          {(hasActiveFilters) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {isCustomer
                ? <ActiveFilters inline filters={custFilters} labels={{
                    reg_channel: "Channel", education_level: "Education", age_group: "Age", gender: "Gender",
                    nationality: "Nationality", preferred_language: "Language", employment_status: "Employment",
                    income_level: "Income", member_type: "Member type", preferred_channel: "Pref. channel",
                    has_ga: "Web data", min_ga_sessions: "Min sessions", has_seminars: "Seminars",
                    has_attributes: "Attributes", opt_in_email: "Email opt-in", opt_in_sms: "SMS opt-in",
                    is_subscriber: "Subscriber", is_imported: "Source",
                    has_transactions: "Purchases", min_orders: "Min orders", min_spend: "Min spend",
                    ordered_within: "Ordered within (days)",
                  }} onRemove={(k, v) => setCustFilter(k, Array.isArray(custFilters[k]) ? custFilters[k].filter(x => x !== v) : "")} />
                : <ActiveFilters inline filters={anonFilters} labels={{ source: "Source", medium: "Medium", has_form_complete: "Form completed" }} onRemove={(k, v) => setAnonFilter(k, Array.isArray(anonFilters[k]) ? anonFilters[k].filter(x => x !== v) : "")} />
              }
              {Object.entries(attrFilters).filter(([, v]) => v).map(([aid, vid]) => (
                <span key={aid} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                  {attrLabel(aid, vid) || "Attribute"}
                  <button onClick={() => setAttrFilter(aid, "")} className="hover:text-foreground text-muted-foreground ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 bg-secondary animate-pulse rounded-lg" />
            ))}
          </div>
        ) : profiles.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            {isCustomer ? <UserCheck className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" /> : <Ghost className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />}
            <p className="text-sm font-medium mb-1">No profiles found</p>
            <p className="text-xs text-muted-foreground">
              {isCustomer ? "Try adjusting your filters." : "No anonymous visitors matched the current filters."}
            </p>
          </div>
        ) : groupedProfiles ? (
          <div className="space-y-6">
            {groupedProfiles.map(g => (
              <div key={g.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{g.label} · {g.items.length}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{g.items.map(renderCard)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profiles.map(renderCard)}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, total)} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 gap-1" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
        </div>
        )}
      </div>

      {/* Import Profiles dialog (shared component, also used on the Import Data page) */}
      <ProfileImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Save as Segment dialog */}
      <Dialog open={saveSegmentOpen} onOpenChange={setSaveSegmentOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Save as Segment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs">Segment Name</Label>
              <Input
                value={segmentName}
                onChange={e => setSegmentName(e.target.value)}
                placeholder={isCustomer ? "e.g. Email Opted-in Web Visitors" : "e.g. High-Intent Anonymous Visitors"}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={segmentDesc}
                onChange={e => setSegmentDesc(e.target.value)}
                className="mt-1" rows={3}
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Applied criteria</p>
              <div className="flex flex-wrap gap-1.5">
                {[...criteriaToChips(filtersToSegmentCriteria(isCustomer ? custFilters : anonFilters, isCustomer)), ...attrChips].map((chip, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border text-muted-foreground">{chip}</span>
                ))}
              </div>
              {total > 0 && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Estimated size: <strong className="text-foreground">{total.toLocaleString()} profiles</strong> matching current filters
                </p>
              )}
            </div>
            <Button
              className="w-full"
              disabled={!segmentName.trim() || saveSegmentMutation.isPending}
              onClick={handleSaveSegment}
            >
              {saveSegmentMutation.isPending ? "Saving…" : "Create Segment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
