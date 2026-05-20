import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  UserCheck, Ghost, Search, ChevronLeft, ChevronRight,
  Mail, Phone, Calendar, MapPin, Globe, BookOpen,
  Activity, ExternalLink, Filter, X,
  Star, MousePointer, Clock, MessageCircle,
  TrendingUp, CheckSquare, ChevronDown, ChevronUp, Users,
  Upload, Download, Trash2, FileText, AlertCircle, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

function CustomerCard({ profile, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
              {profile.is_imported && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-0.5">
                  <Upload className="w-2.5 h-2.5" /> Imported
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{profile.primary_email}</p>
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

function filtersToSegmentCriteria(filters, isCustomer) {
  if (!isCustomer) {
    return {
      source_medium: filters.source_medium || "",
      has_form_complete: filters.has_form_complete === "true" ? "true" : "",
    };
  }
  return {
    reg_channel:       filters.reg_channel || "",
    education_level:   filters.education_level || "",
    age_group:         filters.age_group || "",
    gender:            filters.gender || "",
    nationality:       filters.nationality || "",
    preferred_language: filters.preferred_language || "",
    employment_status: filters.employment_status || "",
    income_level:      filters.income_level || "",
    member_type:       filters.member_type || "",
    preferred_channel: filters.preferred_channel || "",
    is_opt_in_email:   filters.opt_in_email === "true" ? "true" : "",
    opt_in_sms:        filters.opt_in_sms === "true" ? "true" : "",
    is_subscriber:     filters.is_subscriber === "true" ? "true" : "",
    has_ga_activity:   filters.has_ga === "true" ? "true" : "",
    min_ga_sessions:   filters.min_ga_sessions || "",
    has_seminars:      filters.has_seminars === "true" ? "true" : "",
    has_attributes:    filters.has_attributes === "true" ? "true" : "",
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
    source_medium:      v => `source: ${v}`,
    has_form_complete:  () => `completed a form`,
  };
  return Object.entries(crit)
    .filter(([, v]) => v)
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
  const [custFilters, setCustFilters] = useState({
    reg_channel: "", education_level: "", age_group: "", gender: "", nationality: "", preferred_language: "",
    employment_status: "", income_level: "", member_type: "", preferred_channel: "",
    has_ga: "", min_ga_sessions: "", has_seminars: "", has_attributes: "",
    opt_in_email: "", opt_in_sms: "", is_subscriber: "", is_imported: "",
  });
  const [anonFilters, setAnonFilters] = useState({ source_medium: "", has_form_complete: "" });
  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const fileInputRef = useRef(null);
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

  const importMutation = useMutation({
    mutationFn: (file) => appClient.profiles.importProfiles(file),
    onSuccess: (data) => {
      setImportResults(data);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ["profiles-customers"] });
    },
    onError: (err) => toast.error(err.message || "Import failed"),
  });

  const handleSaveSegment = () => {
    const isCustomer = activeTab === "customer";
    const filters = isCustomer ? custFilters : anonFilters;
    const crit = filtersToSegmentCriteria(filters, isCustomer);
    const chips = criteriaToChips(crit);
    const activeCrit = Object.fromEntries(Object.entries(crit).filter(([, v]) => v));
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
          {activeTab === "customer" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-9 gap-1.5"
                onClick={() => appClient.profiles.downloadTemplate()}>
                <Download className="w-3.5 h-3.5" /> Template
              </Button>
              <Button size="sm" className="h-9 gap-1.5"
                onClick={() => { setImportOpen(true); setImportResults(null); setImportFile(null); }}>
                <Upload className="w-3.5 h-3.5" /> Import Profiles
              </Button>
            </div>
          )}
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
            {hasActiveFilters && (
              <Button
                variant="outline" size="sm" className="h-9 gap-1.5"
                onClick={() => {
                  const chips = criteriaToChips(filtersToSegmentCriteria(isCustomer ? custFilters : anonFilters, isCustomer));
                  setSegmentDesc(chips.length ? `Criteria: ${chips.join(", ")}.` : "");
                  setSegmentName("");
                  setSaveSegmentOpen(true);
                }}
              >
                <Users className="w-3.5 h-3.5" /> Save as Segment
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="mt-3 border border-border rounded-lg bg-secondary/20 overflow-hidden">
              {isCustomer ? (
                <div className="divide-y divide-border">
                  {/* Demographics */}
                  <div className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Demographics</p>
                    <div className="flex flex-wrap gap-3">
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
                          <select value={custFilters[f.key]} onChange={e => setCustFilter(f.key, e.target.value)}
                            className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                            <option value="">All</option>
                            {(f.opts || []).map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Communication */}
                  <div className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Communication</p>
                    <div className="flex flex-wrap gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Email opt-in</p>
                        <select value={custFilters.opt_in_email} onChange={e => setCustFilter("opt_in_email", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Opted in</option>
                          <option value="false">Not opted in</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">SMS opt-in</p>
                        <select value={custFilters.opt_in_sms} onChange={e => setCustFilter("opt_in_sms", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Opted in</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Subscriber only</p>
                        <select value={custFilters.is_subscriber} onChange={e => setCustFilter("is_subscriber", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Subscriber only</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Preferred channel</p>
                        <select value={custFilters.preferred_channel} onChange={e => setCustFilter("preferred_channel", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          {(custFilterOpts?.preferred_channels || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Activity */}
                  <div className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Activity</p>
                    <div className="flex flex-wrap gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Web activity</p>
                        <select value={custFilters.has_ga} onChange={e => setCustFilter("has_ga", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Has web data</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Min. GA sessions</p>
                        <select value={custFilters.min_ga_sessions} onChange={e => setCustFilter("min_ga_sessions", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">Any</option>
                          <option value="1">1+ sessions</option>
                          <option value="3">3+ sessions</option>
                          <option value="5">5+ sessions</option>
                          <option value="10">10+ sessions</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Seminars</p>
                        <select value={custFilters.has_seminars} onChange={e => setCustFilter("has_seminars", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Attended seminar</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Attributes</p>
                        <select value={custFilters.has_attributes} onChange={e => setCustFilter("has_attributes", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Has study intentions</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1">Source</p>
                        <select value={custFilters.is_imported} onChange={e => setCustFilter("is_imported", e.target.value)}
                          className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          <option value="">All</option>
                          <option value="true">Imported only</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 flex flex-wrap gap-3">
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
                </div>
              )}
            </div>
          )}

          {isCustomer
            ? <ActiveFilters filters={custFilters} labels={{
                reg_channel: "Channel", education_level: "Education", age_group: "Age", gender: "Gender",
                nationality: "Nationality", preferred_language: "Language", employment_status: "Employment",
                income_level: "Income", member_type: "Member type", preferred_channel: "Pref. channel",
                has_ga: "Web data", min_ga_sessions: "Min sessions", has_seminars: "Seminars",
                has_attributes: "Attributes", opt_in_email: "Email opt-in", opt_in_sms: "SMS opt-in",
                is_subscriber: "Subscriber", is_imported: "Source",
              }} onRemove={k => setCustFilter(k, "")} />
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
              ? <CustomerCard key={p.member_id} profile={p} onDelete={deleteProfileMutation.mutate} />
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

      {/* Import Profiles dialog */}
      <Dialog open={importOpen} onOpenChange={v => { setImportOpen(v); if (!v) { setImportResults(null); setImportFile(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Import Customer Profiles</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {!importResults ? (
              <>
                <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Step 1 - Download the template</p>
                  <p className="text-[11px] text-muted-foreground">Fill in your profile data using the template. The <strong>primary_email</strong> column is required. Leave <strong>member_id</strong> blank to auto-generate one.</p>
                  <Button variant="outline" size="sm" className="gap-1.5"
                    onClick={() => appClient.profiles.downloadTemplate()}>
                    <Download className="w-3.5 h-3.5" /> Download Template CSV
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Step 2 - Upload your filled template</p>
                  <div
                    className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setImportFile(f); }}
                  >
                    <input
                      ref={fileInputRef} type="file" accept=".csv" className="hidden"
                      onChange={e => setImportFile(e.target.files[0] || null)}
                    />
                    {importFile ? (
                      <div className="flex items-center justify-center gap-2 text-sm">
                        <FileText className="w-4 h-4 text-foreground" />
                        <span className="font-medium">{importFile.name}</span>
                        <button onClick={e => { e.stopPropagation(); setImportFile(null); }} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs">
                        <Upload className="w-5 h-5 mx-auto mb-1 opacity-40" />
                        Click to select CSV or drag and drop
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                  Profiles with the same email, member ID, or phone as existing profiles will be skipped.
                </div>

                <Button
                  className="w-full gap-1.5"
                  disabled={!importFile || importMutation.isPending}
                  onClick={() => importMutation.mutate(importFile)}
                >
                  {importMutation.isPending ? "Importing…" : <><Upload className="w-3.5 h-3.5" /> Import Profiles</>}
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="font-medium text-sm">Import complete</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                    <p className="text-2xl font-bold">{importResults.imported}</p>
                    <p className="text-[11px] text-muted-foreground">Profiles imported</p>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                    <p className="text-2xl font-bold">{importResults.skipped}</p>
                    <p className="text-[11px] text-muted-foreground">Skipped</p>
                  </div>
                </div>
                {importResults.errors?.length > 0 && (
                  <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1 max-h-40 overflow-auto">
                    <p className="text-[11px] font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Skipped rows</p>
                    {importResults.errors.map((e, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">Row {e.row}: {e.error}</p>
                    ))}
                  </div>
                )}
                <Button className="w-full" onClick={() => { setImportOpen(false); setImportResults(null); }}>
                  Done
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                {criteriaToChips(filtersToSegmentCriteria(isCustomer ? custFilters : anonFilters, isCustomer)).map((chip, i) => (
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
