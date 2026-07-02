import { useState, useRef, useEffect, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, MoreHorizontal, Trash2, Pencil, Copy, Archive, Lock, UserCheck, Ghost, Search, SlidersHorizontal, Filter, X, RefreshCw, Download, BarChart2, ArrowUp, ArrowDown, Loader2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Lightbulb, Mail, MousePointer2 } from "lucide-react";
import { useStickyState } from "@/lib/useStickyState";
import SegmentsAnalyticsPanel from "@/components/segments/SegmentsAnalyticsPanel";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { usePreferences } from "@/lib/PreferencesContext";


const TABS = [
  { key: "customer", label: "Customers", icon: UserCheck, description: "Segments based on known customer profiles." },
  { key: "anonymous_profile", label: "Anonymous", icon: Ghost, description: "Segments based on anonymous visitor behavior." },
  { key: "analytics", label: "Analytics", icon: BarChart2, description: "Insight across your segment library." },
];

const EMPTY = { name: "", description: "", estimated_size: "", status: "draft", segment_type: "customer", daily_refresh: false, time_period: "30" };

// Single-select criteria row (booleans / thresholds with a small fixed option set).
function CriteriaRow({ label, value, onChange, opts }) {
  const { t } = usePreferences();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 h-7 px-2 text-xs bg-background border border-input rounded-md text-foreground"
      >
        <option value="">{t("Any")}</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// Free-entry numeric criteria row - the user types any number (threshold / days).
function NumberCriteriaRow({ label, value, onChange, placeholder = "Any", min = 0 }) {
  const { t } = usePreferences();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={t(placeholder)}
        className="flex-1 h-7 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

// Numeric range row: an operator (≥ / ≤ / between) plus one or two inputs.
// Stored as the existing min_<field> / max_<field> keys so the resolver and any
// saved segments keep working - the operator is derived from which bounds are set.
function RangeCriteriaRow({ label, field, criteria, setCrit, placeholder = "Any" }) {
  const { t } = usePreferences();
  const minKey = `min_${field}`, maxKey = `max_${field}`;
  const min = criteria[minKey] ?? "";
  const max = criteria[maxKey] ?? "";
  // Operator is explicit local state (seeded from saved bounds) - it can't be
  // derived from the values alone, or an empty field could never show ≤/between.
  const [op, setOp] = useState(min && max ? "between" : (max && !min ? "lte" : "gte"));
  const setMin = v => setCrit(minKey, v);
  const setMax = v => setCrit(maxKey, v);
  // Carry the value across when switching operators so the user doesn't retype.
  const changeOp = next => {
    setOp(next);
    if (next === "gte") { if (!min && max) setMin(max); setMax(""); }
    else if (next === "lte") { if (!max && min) setMax(min); setMin(""); }
    // "between" keeps both bounds as-is
  };
  const numCls = "w-full h-7 px-2 text-xs bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-1.5">
        <select value={op} onChange={e => changeOp(e.target.value)}
          className="h-7 px-1.5 text-xs bg-background border border-input rounded-md text-foreground flex-shrink-0">
          <option value="gte">≥</option>
          <option value="lte">≤</option>
          <option value="between">{t("between")}</option>
        </select>
        {(op === "gte" || op === "between") && (
          <input type="number" inputMode="numeric" min={0} value={min} onChange={e => setMin(e.target.value)}
            placeholder={op === "between" ? t("min") : t(placeholder)} className={numCls} />
        )}
        {op === "between" && <span className="text-[11px] text-muted-foreground flex-shrink-0">–</span>}
        {(op === "lte" || op === "between") && (
          <input type="number" inputMode="numeric" min={0} value={max} onChange={e => setMax(e.target.value)}
            placeholder={op === "between" ? t("max") : t(placeholder)} className={numCls} />
        )}
      </div>
    </div>
  );
}

// Collapsible group of criteria rows. Collapsed by default; shows a count badge
// so active filters inside a closed group stay discoverable.
function CriteriaGroup({ title, activeCount = 0, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-secondary/40 transition-colors"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="flex items-center gap-1.5">
          {activeCount > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{activeCount}</Badge>}
          <span className="text-muted-foreground text-[10px]">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && <div className="px-2.5 pb-2.5 pt-1 space-y-1.5">{children}</div>}
    </div>
  );
}

// Searchable multi-select criteria row for value-list fields (match any of the picks).
function MultiCriteriaRow({ label, value, onChange, opts }) {
  const { t } = usePreferences();
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <MultiSelect className="flex-1 pl-3" value={value} onChange={onChange} options={opts} placeholder={t("Any")} />
    </div>
  );
}

const CUST_CRITERIA_EMPTY = {
  reg_channel: [], education_level: [], age_group: [], gender: [], nationality: [], preferred_language: [],
  employment_status: [], income_level: [], member_type: [], preferred_channel: [],
  is_opt_in_email: "", opt_in_sms: "", is_subscriber: "",
  has_ga_activity: "", min_ga_sessions: "", max_ga_sessions: "", has_seminars: "", has_attributes: "",
  has_transactions: "", min_orders: "", max_orders: "", min_spend: "", max_spend: "", ordered_within: "",
  source: [], medium: [], campaign: [],
  min_page_views: "", max_page_views: "", min_sessions: "", max_sessions: "", min_engagement: "", max_engagement: "",
  visited_within: "", has_form_complete: "",
};
const ANON_CRITERIA_EMPTY = {
  source: [], medium: [], campaign: [], has_form_complete: "",
  min_page_views: "", max_page_views: "", min_sessions: "", max_sessions: "", min_engagement: "", max_engagement: "",
  visited_within: "",
};

// Numeric range fields (label keyed by the min_<field>/max_<field> base). Rendered
// as one combined chip ("orders: 2–10" / "spend: ≥1000") rather than two.
const RANGE_LABELS = {
  ga_sessions: "GA sessions",
  page_views:  "page views",
  sessions:    "visits",
  engagement:  "engagement",
  orders:      "orders",
  spend:       "spend",
};
function rangeChip(label, min, max) {
  if (min && max) return `${label}: ${min}–${max}`;
  if (min) return `${label}: ≥${min}`;
  if (max) return `${label}: ≤${max}`;
  return null;
}

function criteriaToChips(criteria) {
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
    has_seminars:       () => `attended seminar`,
    has_attributes:     () => `has study intentions`,
    has_transactions:   () => `has purchases`,
    ordered_within:     v => `ordered in last ${v} days`,
    source_medium:      v => `source/medium: ${v}`,
    source:             v => `source: ${v}`,
    medium:             v => `medium: ${v}`,
    campaign:           v => `campaign: ${v}`,
    visited_within:     v => `visited in last ${v} days`,
    has_form_complete:  () => `completed a form`,
  };
  // Combined range chips first; their min_/max_ keys are then skipped below.
  const consumed = new Set();
  const rangeChips = [];
  for (const [field, label] of Object.entries(RANGE_LABELS)) {
    consumed.add(`min_${field}`); consumed.add(`max_${field}`);
    const c = rangeChip(label, criteria[`min_${field}`], criteria[`max_${field}`]);
    if (c) rangeChips.push(c);
  }
  const rest = Object.entries(criteria)
    .filter(([k, v]) => !consumed.has(k) && (Array.isArray(v) ? v.length : v))
    .map(([k, v]) => labels[k]?.(v) || `${k}: ${v}`);
  return [...rangeChips, ...rest];
}

function SegmentForm({ initialValues, initialCriteria, onSubmit, isPending, submitLabel = "Save", segmentType = "customer" }) {
  const { t } = usePreferences();
  const isCustomer = segmentType === "customer";
  const emptyCrit = isCustomer ? CUST_CRITERIA_EMPTY : ANON_CRITERIA_EMPTY;

  const [form, setForm] = useState(
    initialValues
      ? { ...initialValues, time_period: initialValues.metadata?.time_period || "30" }
      : EMPTY
  );
  const [showCriteria, setShowCriteria] = useState(
    !!(initialCriteria && Object.values(initialCriteria).some(Boolean)) ||
    !!(initialValues?.metadata?.filter_criteria?.attribute_value_ids?.length)
  );
  const [criteria, setCriteria] = useState(() => {
    // Prefer initialCriteria prop, then fall back to metadata.filter_criteria on the segment
    const stored = initialValues?.metadata?.filter_criteria;
    const merged = { ...emptyCrit, ...(initialCriteria || stored || {}) };
    delete merged.attribute_value_ids; // handled separately (array, not a flat field)
    // Coerce array fields to arrays (older segments stored scalar strings).
    for (const k of Object.keys(merged)) {
      if (Array.isArray(emptyCrit[k]) && !Array.isArray(merged[k])) merged[k] = merged[k] ? [merged[k]] : [];
    }
    return merged;
  });

  // Attribute / affinity criteria (behavioral & rule attributes)
  const [attrValueIds, setAttrValueIds] = useState(
    () => initialValues?.metadata?.filter_criteria?.attribute_value_ids || []
  );
  const { data: attrOptions = [] } = useQuery({
    queryKey: ["attribute-options"],
    queryFn: () => appClient.attributes.options(),
  });
  const valueLabel = useMemo(() => {
    const m = {};
    for (const a of attrOptions) for (const v of a.values) m[v.id] = `${a.name}: ${v.value}`;
    return m;
  }, [attrOptions]);

  const { data: custFilters } = useQuery({
    queryKey: ["profiles-cust-filters"],
    queryFn: () => appClient.profiles.customerFilters(),
    enabled: isCustomer,
  });
  const { data: anonFilters } = useQuery({
    queryKey: ["profiles-anon-filters"],
    queryFn: () => appClient.profiles.anonymousFilters(),
    enabled: !isCustomer,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setCrit = (k, v) => setCriteria(c => ({ ...c, [k]: v }));

  const countActive = (keys) => keys.filter(k => { const v = criteria[k]; return Array.isArray(v) ? v.length : v; }).length;
  // A numeric range (min_<f>/max_<f>) counts as one active filter, not two.
  const countRange = (fields) => fields.filter(f => criteria[`min_${f}`] || criteria[`max_${f}`]).length;
  const activeCriteria = Object.entries(criteria).filter(([, v]) => (Array.isArray(v) ? v.length : v));
  const chips = criteriaToChips(criteria);
  const attrChips = attrValueIds.map((id) => valueLabel[id]).filter(Boolean);
  const allChips = [...chips, ...attrChips];

  // Live preview: how many profiles currently match the criteria being built.
  // Debounced so dragging/typing a range doesn't fire a request per keystroke.
  const previewBody = useMemo(() => {
    const fc = Object.fromEntries(Object.entries(criteria).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
    if (attrValueIds.length) fc.attribute_value_ids = attrValueIds;
    return { segment_type: segmentType, filter_criteria: fc };
  }, [criteria, attrValueIds, segmentType]);
  const [previewKey, setPreviewKey] = useState(() => JSON.stringify(previewBody));
  useEffect(() => {
    const k = JSON.stringify(previewBody);
    const id = setTimeout(() => setPreviewKey(k), 400);
    return () => clearTimeout(id);
  }, [previewBody]);
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ["segment-preview-count", previewKey],
    queryFn: () => appClient.segments.previewCount(JSON.parse(previewKey)),
    enabled: !!previewKey,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
  const previewCount = previewData?.count;

  const handleSubmit = () => {
    // Description is whatever the user typed - never auto-appended. The criteria are
    // kept separately in metadata.criteria, so mixing them into the description just
    // duplicated the "Criteria: …" text on every re-save.
    const existingMeta = initialValues?.metadata || {};
    const filterCriteria = Object.fromEntries(activeCriteria);
    if (attrValueIds.length) filterCriteria.attribute_value_ids = attrValueIds;
    const metadata = {
      ...existingMeta,
      ...(allChips.length ? { criteria: allChips } : {}),
      ...(Object.keys(filterCriteria).length ? { filter_criteria: filterCriteria } : {}),
      ...(form.time_period ? { time_period: form.time_period } : {}),
    };
    onSubmit({
      ...form,
      description: form.description || "",
      estimated_size: form.estimated_size ? Number(form.estimated_size) : undefined,
      metadata,
    });
  };

  return (
    <div className="space-y-4 mt-2">
      <div>
        <Label className="text-xs">{t("Segment Name")}</Label>
        <Input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder={isCustomer ? t("High-Value Seminar Members") : t("High-Intent Anonymous Visitors")}
          className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">{t("Description")}</Label>
        <Textarea value={form.description} onChange={e => set("description", e.target.value)}
          placeholder={t("Describe who this segment targets and why...")} className="mt-1" rows={2} />
      </div>

      {/* Profile-based criteria builder */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCriteria(s => !s)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium hover:bg-secondary/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            {t("Profile criteria")}
            {activeCriteria.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{activeCriteria.length} {t("active")}</Badge>
            )}
          </span>
          <span className="text-muted-foreground">{showCriteria ? "▲" : "▼"}</span>
        </button>

        {showCriteria && (
          <div className="px-3 pb-3 pt-2 border-t border-border space-y-3">
            {isCustomer ? (
              <>
                <CriteriaGroup title={t("Demographics")} activeCount={countActive(["reg_channel","age_group","gender","nationality","education_level","employment_status","income_level","member_type","preferred_language"])}>
                  <MultiCriteriaRow label={t("Reg. channel")}  value={criteria.reg_channel}       onChange={v => setCrit("reg_channel", v)}       opts={custFilters?.reg_channels || []} />
                  <MultiCriteriaRow label={t("Age group")}     value={criteria.age_group}          onChange={v => setCrit("age_group", v)}          opts={custFilters?.age_groups || []} />
                  <MultiCriteriaRow label={t("Gender")}        value={criteria.gender}             onChange={v => setCrit("gender", v)}             opts={custFilters?.genders || []} />
                  <MultiCriteriaRow label={t("Nationality")}   value={criteria.nationality}        onChange={v => setCrit("nationality", v)}        opts={custFilters?.nationalities || []} />
                  <MultiCriteriaRow label={t("Education")}     value={criteria.education_level}    onChange={v => setCrit("education_level", v)}    opts={custFilters?.education_levels || []} />
                  <MultiCriteriaRow label={t("Employment")}    value={criteria.employment_status}  onChange={v => setCrit("employment_status", v)}  opts={custFilters?.employment_statuses || []} />
                  <MultiCriteriaRow label={t("Income")}        value={criteria.income_level}       onChange={v => setCrit("income_level", v)}       opts={custFilters?.income_levels || []} />
                  <MultiCriteriaRow label={t("Member type")}   value={criteria.member_type}        onChange={v => setCrit("member_type", v)}        opts={custFilters?.member_types || []} />
                  <MultiCriteriaRow label={t("Language")}      value={criteria.preferred_language} onChange={v => setCrit("preferred_language", v)} opts={custFilters?.languages || []} />
                </CriteriaGroup>
                <CriteriaGroup title={t("Communication")} activeCount={countActive(["is_opt_in_email","opt_in_sms","is_subscriber","preferred_channel"])}>
                  <CriteriaRow label={t("Email opt-in")}  value={criteria.is_opt_in_email}   onChange={v => setCrit("is_opt_in_email", v)}   opts={["true"]} />
                  <CriteriaRow label={t("SMS opt-in")}    value={criteria.opt_in_sms}         onChange={v => setCrit("opt_in_sms", v)}         opts={["true"]} />
                  <CriteriaRow label={t("Subscriber")}    value={criteria.is_subscriber}      onChange={v => setCrit("is_subscriber", v)}      opts={["true"]} />
                  <MultiCriteriaRow label={t("Pref. channel")} value={criteria.preferred_channel}  onChange={v => setCrit("preferred_channel", v)}  opts={custFilters?.preferred_channels || []} />
                </CriteriaGroup>
                <CriteriaGroup title={t("Activity")} activeCount={countActive(["has_ga_activity","has_seminars","has_attributes"]) + countRange(["ga_sessions"])}>
                  <CriteriaRow label={t("Web activity")}  value={criteria.has_ga_activity}   onChange={v => setCrit("has_ga_activity", v)}   opts={["true"]} />
                  <RangeCriteriaRow label={t("GA sessions")} field="ga_sessions" criteria={criteria} setCrit={setCrit} placeholder="e.g. 3" />
                  <CriteriaRow label={t("Seminars")}      value={criteria.has_seminars}       onChange={v => setCrit("has_seminars", v)}       opts={["true"]} />
                  <CriteriaRow label={t("Attributes")}    value={criteria.has_attributes}     onChange={v => setCrit("has_attributes", v)}     opts={["true"]} />
                </CriteriaGroup>
                <CriteriaGroup title={t("Web Activity")} activeCount={countActive(["source","medium","campaign","visited_within","has_form_complete"]) + countRange(["page_views","sessions","engagement"])}>
                  <MultiCriteriaRow label={t("Source")}          value={criteria.source}        onChange={v => setCrit("source", v)}        opts={custFilters?.sources || []} />
                  <MultiCriteriaRow label={t("Medium")}          value={criteria.medium}        onChange={v => setCrit("medium", v)}        opts={custFilters?.mediums || []} />
                  <MultiCriteriaRow label={t("Campaign")}        value={criteria.campaign}      onChange={v => setCrit("campaign", v)}      opts={custFilters?.campaigns || []} />
                  <RangeCriteriaRow label={t("Page views")} field="page_views" criteria={criteria} setCrit={setCrit} placeholder="e.g. 10" />
                  <RangeCriteriaRow label={t("Visits")}     field="sessions"   criteria={criteria} setCrit={setCrit} placeholder="e.g. 3" />
                  <RangeCriteriaRow label={t("Engagement")} field="engagement" criteria={criteria} setCrit={setCrit} placeholder="e.g. 25" />
                  <NumberCriteriaRow label={t("Visited within (days)")} value={criteria.visited_within} onChange={v => setCrit("visited_within", v)} placeholder="e.g. 90" />
                  <CriteriaRow label={t("Form completed")}  value={criteria.has_form_complete} onChange={v => setCrit("has_form_complete", v)} opts={["true"]} />
                </CriteriaGroup>
                <CriteriaGroup title={t("Purchases")} activeCount={countActive(["has_transactions","ordered_within"]) + countRange(["orders","spend"])}>
                  <CriteriaRow label={t("Has purchases")}  value={criteria.has_transactions} onChange={v => setCrit("has_transactions", v)} opts={["true"]} />
                  <RangeCriteriaRow label={t("Orders")} field="orders" criteria={criteria} setCrit={setCrit} placeholder="e.g. 2" />
                  <RangeCriteriaRow label={t("Spend")}  field="spend"  criteria={criteria} setCrit={setCrit} placeholder="e.g. 1000" />
                  <NumberCriteriaRow label={t("Ordered within (days)")} value={criteria.ordered_within} onChange={v => setCrit("ordered_within", v)} placeholder="e.g. 90" />
                </CriteriaGroup>
              </>
            ) : (
              <CriteriaGroup title={t("Web Activity")} activeCount={countActive(["source","medium","campaign","visited_within","has_form_complete"]) + countRange(["page_views","sessions","engagement"])}>
                <MultiCriteriaRow label={t("Source")}          value={criteria.source}           onChange={v => setCrit("source", v)}           opts={anonFilters?.sources || []} />
                <MultiCriteriaRow label={t("Medium")}          value={criteria.medium}           onChange={v => setCrit("medium", v)}           opts={anonFilters?.mediums || []} />
                <MultiCriteriaRow label={t("Campaign")}        value={criteria.campaign}         onChange={v => setCrit("campaign", v)}         opts={anonFilters?.campaigns || []} />
                <RangeCriteriaRow label={t("Page views")} field="page_views" criteria={criteria} setCrit={setCrit} placeholder="e.g. 10" />
                <RangeCriteriaRow label={t("Visits")}     field="sessions"   criteria={criteria} setCrit={setCrit} placeholder="e.g. 3" />
                <RangeCriteriaRow label={t("Engagement")} field="engagement" criteria={criteria} setCrit={setCrit} placeholder="e.g. 25" />
                <NumberCriteriaRow label={t("Visited within (days)")} value={criteria.visited_within} onChange={v => setCrit("visited_within", v)} placeholder="e.g. 30" />
                <CriteriaRow label={t("Form completed")}  value={criteria.has_form_complete} onChange={v => setCrit("has_form_complete", v)} opts={["true"]} />
              </CriteriaGroup>
            )}
            {/* Rule-based attributes unlock detailed, reusable criteria here. */}
            <div className="rounded-md border border-dashed border-border bg-secondary/20 p-2.5">
              <p className="text-[11px] text-muted-foreground">
                <strong className="text-foreground">{t("Need more detailed targeting?")}</strong> {t("Build a")}{" "}
                <Link to="/attributes" className="underline hover:text-foreground">{t("rule-based attribute")}</Link>{" "}
                {t("(combine sessions, purchases, pop-ups, even other segments into one label), then select its values here under")} <strong>{t("Applied Attributes")}</strong>.
              </p>
            </div>
            {attrOptions.length > 0 && (
              <CriteriaGroup title={t("Applied Attributes")} activeCount={attrValueIds.length}>
                {attrOptions.map(a => {
                  const aIds = a.values.map(v => v.id);
                  const selected = attrValueIds.filter(id => aIds.includes(id));
                  return (
                    <MultiCriteriaRow
                      key={a.id}
                      label={a.name}
                      value={selected}
                      onChange={vals => setAttrValueIds(cur => [...cur.filter(id => !aIds.includes(id)), ...vals])}
                      opts={a.values.map(v => ({ value: v.id, label: `${v.value}${v.profile_count ? ` (${v.profile_count})` : ""}` }))}
                    />
                  );
                })}
              </CriteriaGroup>
            )}
            {allChips.length > 0 && (
              <div className="pt-1 flex flex-wrap gap-1">
                {allChips.map((c, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border text-muted-foreground">{c}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("Time Period")}</Label>
          <Select value={form.time_period || "30"} onValueChange={v => set("time_period", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("Last 7 days")}</SelectItem>
              <SelectItem value="14">{t("Last 14 days")}</SelectItem>
              <SelectItem value="30">{t("Last 30 days")}</SelectItem>
              <SelectItem value="60">{t("Last 60 days")}</SelectItem>
              <SelectItem value="90">{t("Last 90 days")}</SelectItem>
              {isCustomer && (
                <>
                  <SelectItem value="180">{t("Last 6 months")}</SelectItem>
                  <SelectItem value="365">{t("Last 1 year")}</SelectItem>
                  <SelectItem value="all">{t("Overall")}</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{t("Status")}</Label>
          <Select value={form.status || "draft"} onValueChange={v => set("status", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">{t("Draft")}</SelectItem>
              <SelectItem value="active">{t("Active")}</SelectItem>
              <SelectItem value="archived">{t("Archived")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg p-3 flex items-start justify-between gap-3 bg-secondary/10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <p className="text-xs font-medium">{t("Daily Refresh")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            {t("Re-evaluate this segment's members every night at 2 AM. pop ups using this segment will automatically receive the updated targeting list.")}
          </p>
        </div>
        <Switch
          checked={!!form.daily_refresh}
          onCheckedChange={v => set("daily_refresh", v)}
          className="flex-shrink-0 mt-0.5"
        />
      </div>

      <div className="border border-border rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 bg-secondary/10">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="w-3.5 h-3.5 flex-shrink-0" />
          {allChips.length ? t("Profiles matching these criteria") : t("Total profiles (no criteria yet)")}
        </div>
        <div className="text-sm font-semibold flex items-center gap-1.5 flex-shrink-0">
          {previewLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
          {previewCount == null ? "—" : previewCount.toLocaleString()}
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={!form.name || isPending} className="w-full">
        {t(submitLabel)}
      </Button>
    </div>
  );
}

// Live member count for a segment card (anonymous segments have no stored size).
function SegmentSize({ segmentId }) {
  const { t } = usePreferences();
  const { data } = useQuery({
    queryKey: ["segment-size", segmentId],
    queryFn: () => appClient.segments.size(segmentId),
    staleTime: 5 * 60 * 1000,
  });
  if (data?.count == null) return null;
  return (
    <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {data.count.toLocaleString()} {t("users")}</span>
  );
}

export default function Segments() {
  const { t } = usePreferences();
  const [activeTab, setActiveTab] = useState("customer");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: [], is_used: "" });
  const [sortBy, setSortBy] = useStickyState("created", "seg.sortBy");
  const [sortDir, setSortDir] = useStickyState("desc", "seg.sortDir");
  const [groupBy, setGroupBy] = useStickyState("status", "seg.groupBy");
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const filterRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: allSegments = [], isLoading } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date"),
  });

  const segments = allSegments.filter(s => {
    const q = search.toLowerCase();
    const matchesType = (s.segment_type || "customer") === activeTab;
    if (!matchesType) return false;
    if (q && !s.name?.toLowerCase().includes(q) && !s.description?.toLowerCase().includes(q)) return false;
    if (filters.status.length && !filters.status.includes(s.status || "draft")) return false;
    if (filters.is_used === "yes" && !s.is_used) return false;
    if (filters.is_used === "no" && s.is_used) return false;
    return true;
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = filters.status.length > 0 || !!filters.is_used;

  // Sort (client-side, full list) + group dimension.
  const sortGet = {
    created: s => s.created_date || "",
    name:    s => (s.name || "").toLowerCase(),
    size:    s => Number(s.estimated_size) || 0,
    updated: s => s.updated_date || s.created_date || "",
  }[sortBy] || (s => s.created_date || "");
  const sortedSegments = [...segments].sort((a, b) => {
    const av = sortGet(a), bv = sortGet(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });
  const GROUP_DIMS = {
    status: [
      { key: "active",   label: t("Active"),   filter: s => s.status === "active" },
      { key: "inactive", label: t("Draft"),    filter: s => s.status === "draft" || !s.status },
      { key: "archived", label: t("Archived"), filter: s => s.status === "archived" },
    ],
    refresh: [
      { key: "on",  label: t("Daily refresh on"), filter: s => !!s.daily_refresh },
      { key: "off", label: t("Manual"),           filter: s => !s.daily_refresh },
    ],
    none: [{ key: "all", label: t("All"), filter: () => true }],
  };
  const gridGroups = (GROUP_DIMS[groupBy] || GROUP_DIMS.status).filter(g => sortedSegments.some(g.filter));
  const grouped = groupBy !== "none";
  const allCollapsed = grouped && gridGroups.length > 0 && gridGroups.every(g => collapsedGroups.has(g.key));
  const toggleAllGroups = () => setCollapsedGroups(allCollapsed ? new Set() : new Set(gridGroups.map(g => g.key)));
  const toggleGroup = (k) => setCollapsedGroups(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const SEG_SORT_OPTS  = [["created", t("Created")], ["name", t("Name")], ["size", t("Estimated size")], ["updated", t("Last updated")]];
  const SEG_GROUP_OPTS = [["status", t("Status")], ["refresh", t("Daily refresh")], ["none", t("None")]];

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.Segment.create({ ...data, segment_type: activeTab }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      setCreateOpen(false);
      toast.success(t("Segment created"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.Segment.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      setEditTarget(null);
      toast.success(t("Segment updated"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.Segment.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["segments"] }),
  });

  const handleCreate = (data) => {
    const nameTaken = allSegments.some(s =>
      (s.segment_type || "customer") === activeTab &&
      s.name.toLowerCase() === data.name.trim().toLowerCase()
    );
    if (nameTaken) { toast.error(t("A segment with this name already exists.")); return; }
    createMutation.mutate(data);
  };

  const handleEdit = (data) => {
    const nameTaken = allSegments.some(s =>
      s.id !== editTarget.id &&
      (s.segment_type || "customer") === (editTarget.segment_type || activeTab) &&
      s.name.toLowerCase() === data.name.trim().toLowerCase()
    );
    if (nameTaken) { toast.error(t("A segment with this name already exists.")); return; }
    updateMutation.mutate({ id: editTarget.id, data });
  };

  const handleClone = (seg) => {
    const { id, created_date, updated_date, created_by, ...rest } = seg;
    createMutation.mutate({ ...rest, name: `${seg.name} (copy)`, status: "draft", is_used: false });
  };

  const handleArchive = (seg) => {
    updateMutation.mutate({ id: seg.id, data: { status: "archived" } });
  };

  const handleExport = async (seg) => {
    try {
      toast.info(t("Resolving segment profiles…"));
      await appClient.segments.exportCsv(seg.id, seg.name);
      toast.success(t("Segment exported to CSV"));
    } catch (e) {
      toast.error(e.message || t("Export failed"));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Segments")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("Create audience segments for targeted campaigns.")}</p>
          </div>
          {activeTab !== "analytics" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> {t("New Segment")}
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = allSegments.filter(s => (s.segment_type || "customer") === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === tab.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tab.label)}
                {count > 0 && <span className="text-[10px] text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "analytics" ? <SegmentsAnalyticsPanel /> : (
        <div className="px-8 py-6">
        {/* Search + Filter */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("Search segments...")}
                className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div ref={filterRef} className="relative">
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
                <Filter className="w-3.5 h-3.5" /> {t("Filters")}
                {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
              </Button>
              {showFilters && (
                <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-72">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                    {hasActiveFilters && (
                      <button onClick={() => setFilters({ status: [], is_used: "" })} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                      <MultiSelect value={filters.status} onChange={v => setFilter("status", v)}
                        options={["draft","active","archived"]} placeholder={t("All")} />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("Usage")}</p>
                      <select value={filters.is_used} onChange={e => setFilter("is_used", e.target.value)}
                        className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        <option value="">{t("All")}</option>
                        <option value="yes">{t("In use (locked)")}</option>
                        <option value="no">{t("Not in use")}</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Sort by")}</p>
                    <div className="flex items-center gap-2">
                      <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                        className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        {SEG_SORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <button type="button" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                        className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                        {sortDir === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> {t("Asc")}</> : <><ArrowDown className="w-3.5 h-3.5" /> {t("Desc")}</>}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Group by")}</p>
                    <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
                      className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      {SEG_GROUP_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
            {grouped && gridGroups.length > 1 && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={toggleAllGroups}>
                {allCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
                {allCollapsed ? t("Expand all") : t("Collapse all")}
              </Button>
            )}
          </div>
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {filters.status.map(v => (
                <span key={v} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                  {t("Status")}: <strong>{v}</strong>
                  <button onClick={() => setFilter("status", filters.status.filter(x => x !== v))} className="hover:text-foreground text-muted-foreground ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {filters.is_used && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                  {t("Usage")}: <strong>{filters.is_used === "yes" ? t("In use") : t("Not in use")}</strong>
                  <button onClick={() => setFilter("is_used", "")} className="hover:text-foreground text-muted-foreground ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-secondary animate-pulse rounded-lg" />)}</div>
      ) : segments.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 max-w-2xl mx-auto space-y-6">
          {/* What a segment is */}
          <div className="text-center space-y-2">
            <Users className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
            <p className="text-base font-semibold">{t("No")} {activeTab === "customer" ? t("Customer") : t("Anonymous")} {t("segments yet")}</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-lg mx-auto">
              {t("Segments are saved audiences - groups of people who share the same behaviour, attributes, or source. You define a segment once and it becomes a live audience you can target again and again.")}
            </p>
          </div>

          {/* What you can do with them */}
          <div className="rounded-lg bg-secondary/30 p-4 space-y-3">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" /> {t("What you can do with a segment")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                [MousePointer2, t("Show pop ups"), t("Trigger on-site messages only for visitors in the segment.")],
                [Mail, t("Send email"), t("Aim an email campaign at exactly this audience.")],
                [BarChart2, t("Track & refine"), t("Watch the segment size change and tune the criteria over time.")],
              ].map(([Icon, title, desc]) => (
                <div key={title} className="space-y-1">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <p className="text-xs font-medium">{title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Customer vs anonymous */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">{t("Two kinds of segment")}</p>
            <ul className="space-y-1.5 text-[11px] text-muted-foreground">
              <li className="flex gap-2">
                <UserCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span><strong className="text-foreground">{t("Customer")}</strong> - {t("known people you already have contact details for - ideal for email.")}</span>
              </li>
              <li className="flex gap-2">
                <Ghost className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span><strong className="text-foreground">{t("Anonymous")}</strong> - {t("visitors you haven't identified yet, matched by on-site behaviour - ideal for pop ups.")}</span>
              </li>
            </ul>
          </div>

          {/* How to start */}
          <div className="border-t border-border pt-4 text-center space-y-3">
            <p className="text-xs text-muted-foreground">{t("Build one by hand with filters and criteria, or simply describe the audience you want and let the AI create it for you.")}</p>
            <Link to="/"><Button variant="outline" size="sm" className="gap-1.5">{t("Ask AI to create a segment")}</Button></Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {gridGroups.map(group => {
            const items = sortedSegments.filter(group.filter);
            if (!items.length) return null;
            return (
              <div key={group.key}>
                {grouped && (
                  <button onClick={() => toggleGroup(group.key)} className="flex items-center gap-1.5 mb-3 group/h">
                    {collapsedGroups.has(group.key) ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover/h:text-foreground">{group.label} · {items.length}</span>
                  </button>
                )}
                {!(grouped && collapsedGroups.has(group.key)) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(seg => (
                    <div key={seg.id} className={`border border-border rounded-lg p-5 transition-shadow ${seg.status === "archived" ? "opacity-60" : "hover:shadow-sm"}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-sm font-semibold">{seg.name}</h3>
                            {(!seg.status || seg.status === "draft") ? (
                              <Badge variant="outline" className="text-[10px]">{t("draft")}</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">{seg.status}</Badge>
                            )}
                            {seg.is_used && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                                <Lock className="w-2.5 h-2.5" /> {t("locked")}
                              </span>
                            )}
                          </div>
                          {seg.description && <p className="text-xs text-muted-foreground line-clamp-2">{seg.description}</p>}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!seg.is_used && seg.status !== "archived" && (
                              <DropdownMenuItem onClick={() => setEditTarget(seg)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> {t("Edit")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleClone(seg)}>
                              <Copy className="w-3.5 h-3.5 mr-2" /> {t("Clone")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleExport(seg)}>
                              <Download className="w-3.5 h-3.5 mr-2" /> {t("Export CSV")}
                            </DropdownMenuItem>
                            {seg.status !== "archived" && (
                              <DropdownMenuItem onClick={() => handleArchive(seg)}>
                                <Archive className="w-3.5 h-3.5 mr-2" /> {t("Archive")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => deleteMutation.mutate(seg.id)} className="text-destructive">
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> {t("Delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground flex-wrap">
                        {(seg.segment_type || "customer") === "anonymous_profile" ? (
                          <SegmentSize segmentId={seg.id} />
                        ) : seg.estimated_size && (
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {seg.estimated_size.toLocaleString()} {t("users")}</span>
                        )}
                        {seg.daily_refresh && (
                          <span className="flex items-center gap-1 text-foreground/70">
                            <RefreshCw className="w-3 h-3" />
                            {seg.last_refreshed
                              ? `${t("Refreshed")} ${formatDistanceToNow(new Date(seg.last_refreshed), { addSuffix: true })}`
                              : t("Daily refresh on")}
                          </span>
                        )}
                        {seg.tags?.length > 0 && seg.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-[10px] h-5">{tag}</Badge>
                        ))}
                        <span>{t("Created")} {format(new Date(seg.created_date), "MMM d, yyyy")}</span>
                        {seg.updated_date && seg.updated_date !== seg.created_date && (
                          <span>{t("Updated")} {format(new Date(seg.updated_date), "MMM d, yyyy")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>
        )}

      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">{t("Create")} {activeTab === "customer" ? t("Customer") : t("Anonymous")} {t("Segment")}</DialogTitle></DialogHeader>
          <div className="overflow-y-auto flex-1 px-1">
            <SegmentForm onSubmit={handleCreate} isPending={createMutation.isPending} submitLabel="Create Segment" segmentType={activeTab} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">{t("Edit Segment")}</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="overflow-y-auto flex-1 px-1">
              <SegmentForm
                initialValues={editTarget}
                onSubmit={handleEdit}
                isPending={updateMutation.isPending}
                submitLabel="Save Changes"
                segmentType={editTarget.segment_type || activeTab}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
