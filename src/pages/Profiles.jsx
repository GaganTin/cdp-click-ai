import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCheck, Ghost, Search, ChevronLeft, ChevronRight,
  Mail, Phone, Calendar, MapPin, Globe, BookOpen,
  Activity, ExternalLink, Filter, X,
  Star, MousePointer, Clock, MessageCircle,
  TrendingUp, CheckSquare, ChevronDown, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, parseISO, isValid } from "date-fns";

const TABS = [
  { key: "customer", label: "Customers", icon: UserCheck },
  { key: "anonymous", label: "Anonymous", icon: Ghost },
];

function safeDate(val, fmt = "MMM d, yyyy") {
  if (!val) return null;
  try {
    const d = typeof val === "string" && /^\d{8}$/.test(val)
      ? parseISO(val.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))
      : parseISO(val);
    return isValid(d) ? format(d, fmt) : null;
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

function CustomerCard({ profile }) {
  const [expanded, setExpanded] = useState(false);
  const hasGa = Number(profile.ga_sessions) > 0;
  const hasSeminars = Number(profile.seminar_count) > 0;
  const hasAttributes = Number(profile.attribute_count) > 0;
  const joinDate = safeDate(profile.member_join_date);
  const gaFirstSeen = safeDate(profile.ga_first_seen);
  const gaLastSeen = safeDate(profile.ga_last_seen);

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
              {profile.is_opt_in_email && (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Email opt-in</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{profile.primary_email}</p>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
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
                        <span className="truncate">{p}</span>
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
                    <span className="truncate">{p}</span>
                  </div>
                ))}
                {profile.pages_visited.length > 8 && (
                  <p className="text-[10px] text-muted-foreground">+{profile.pages_visited.length - 8} more</p>
                )}
              </div>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground font-mono break-all pt-1">
            Visitor ID: {profile.visitor_id}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveFilters({ filters, labels, onRemove }) {
  const active = Object.entries(filters).filter(([, v]) => v);
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {active.map(([key, value]) => (
        <span key={key} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
          {labels[key] || key}: <strong>{value === "true" ? "Yes" : value}</strong>
          <button onClick={() => onRemove(key)} className="hover:text-foreground text-muted-foreground ml-0.5">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export default function Profiles() {
  const [activeTab, setActiveTab] = useState("customer");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [custFilters, setCustFilters] = useState({ reg_channel: "", education_level: "", age_group: "", gender: "", nationality: "", preferred_language: "", has_ga: "" });
  const [anonFilters, setAnonFilters] = useState({ source_medium: "", has_form_complete: "" });
  const queryClient = useQueryClient();
  const LIMIT = 20;

  useEffect(() => { setPage(1); }, [activeTab, search, custFilters, anonFilters]);

  const { data: custFilterOpts } = useQuery({ queryKey: ["profiles-cust-filters"], queryFn: () => appClient.profiles.customerFilters() });
  const { data: anonFilterOpts } = useQuery({ queryKey: ["profiles-anon-filters"], queryFn: () => appClient.profiles.anonymousFilters() });

  const isCustomer = activeTab === "customer";

  const { data: custData, isLoading: custLoading } = useQuery({
    queryKey: ["profiles-customers", search, page, custFilters],
    queryFn: () => appClient.profiles.listCustomers({ search, page, limit: LIMIT, ...custFilters }),
    enabled: isCustomer,
    keepPreviousData: true,
  });
  const { data: anonData, isLoading: anonLoading } = useQuery({
    queryKey: ["profiles-anonymous", search, page, anonFilters],
    queryFn: () => appClient.profiles.listAnonymous({ search, page, limit: LIMIT, ...anonFilters }),
    enabled: !isCustomer,
    keepPreviousData: true,
  });

  const profiles = isCustomer ? (custData?.profiles || []) : (anonData?.profiles || []);
  const total = isCustomer ? (custData?.total || 0) : (anonData?.total || 0);
  const isLoading = isCustomer ? custLoading : anonLoading;
  const totalPages = Math.ceil(total / LIMIT);

  const setCustFilter = (k, v) => setCustFilters(f => ({ ...f, [k]: v }));
  const setAnonFilter = (k, v) => setAnonFilters(f => ({ ...f, [k]: v }));

  const hasActiveFilters = isCustomer
    ? Object.values(custFilters).some(Boolean)
    : Object.values(anonFilters).some(Boolean);

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
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearch(""); setPage(1); }}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Search + filters */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isCustomer ? "Search name, email, or member no…" : "Search visitor ID…"}
                className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button
              variant="outline" size="sm" className="h-9 gap-1.5"
              onClick={() => setShowFilters(f => !f)}
            >
              <Filter className="w-3.5 h-3.5" /> Filters
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
            </Button>
          </div>

          {showFilters && (
            <div className="mt-3 p-4 border border-border rounded-lg bg-secondary/20 flex flex-wrap gap-3">
              {isCustomer ? (
                <>
                  {[
                    { key: "reg_channel", label: "Channel", opts: custFilterOpts?.reg_channels },
                    { key: "education_level", label: "Education", opts: custFilterOpts?.education_levels },
                    { key: "age_group", label: "Age group", opts: custFilterOpts?.age_groups },
                    { key: "gender", label: "Gender", opts: custFilterOpts?.genders },
                    { key: "nationality", label: "Nationality", opts: custFilterOpts?.nationalities },
                    { key: "preferred_language", label: "Language", opts: custFilterOpts?.languages },
                  ].map(f => (
                    <div key={f.key}>
                      <p className="text-[10px] text-muted-foreground mb-1">{f.label}</p>
                      <select value={custFilters[f.key]} onChange={e => setCustFilter(f.key, e.target.value)}
                        className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        <option value="">All</option>
                        {(f.opts || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Web activity</p>
                    <select value={custFilters.has_ga} onChange={e => setCustFilter("has_ga", e.target.value)}
                      className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      <option value="">All</option>
                      <option value="true">Has GA data</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Source / Medium</p>
                    <select value={anonFilters.source_medium} onChange={e => setAnonFilter("source_medium", e.target.value)}
                      className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      <option value="">All</option>
                      {(anonFilterOpts?.source_mediums || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Intent level</p>
                    <select value={anonFilters.has_form_complete} onChange={e => setAnonFilter("has_form_complete", e.target.value)}
                      className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      <option value="">All visitors</option>
                      <option value="true">Completed a form (high intent)</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {isCustomer
            ? <ActiveFilters filters={custFilters} labels={{ reg_channel: "Channel", education_level: "Education", age_group: "Age", gender: "Gender", nationality: "Nationality", preferred_language: "Language", has_ga: "Web data" }} onRemove={k => setCustFilter(k, "")} />
            : <ActiveFilters filters={anonFilters} labels={{ source_medium: "Source/Medium", has_form_complete: "Form completed" }} onRemove={k => setAnonFilter(k, "")} />
          }
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profiles.map(p => isCustomer
              ? <CustomerCard key={p.member_id} profile={p} />
              : <AnonymousCard key={p.visitor_id} profile={p} />
            )}
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
    </div>
  );
}
