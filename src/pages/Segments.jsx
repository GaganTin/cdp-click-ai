import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Users, MoreHorizontal, Trash2, Pencil, Copy, Archive, Lock, UserCheck, Ghost, Search, SlidersHorizontal, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import { Link } from "react-router-dom";


const TABS = [
  { key: "customer", label: "Customers", icon: UserCheck, description: "Segments based on known customer profiles." },
  { key: "anonymous_profile", label: "Anonymous", icon: Ghost, description: "Segments based on anonymous visitor behavior." },
];

const EMPTY = { name: "", description: "", estimated_size: "", status: "draft", segment_type: "customer" };

const GROUPS = [
  { key: "active", label: "Active", filter: s => s.status === "active" },
  { key: "inactive", label: "Draft", filter: s => s.status === "draft" || !s.status },
  { key: "archived", label: "Archived", filter: s => s.status === "archived" },
];

function CriteriaRow({ label, value, onChange, opts }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 h-7 px-2 text-xs bg-background border border-input rounded-md text-foreground"
      >
        <option value="">Any</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

const CUST_CRITERIA_EMPTY = {
  reg_channel: "", education_level: "", age_group: "", gender: "", nationality: "", preferred_language: "",
  employment_status: "", income_level: "", member_type: "", preferred_channel: "",
  is_opt_in_email: "", opt_in_sms: "", is_subscriber: "",
  has_ga_activity: "", min_ga_sessions: "", has_seminars: "", has_attributes: "",
};
const ANON_CRITERIA_EMPTY = { source_medium: "", has_form_complete: "" };

function criteriaToChips(criteria, isCustomer) {
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
  return Object.entries(criteria)
    .filter(([, v]) => v)
    .map(([k, v]) => labels[k]?.(v) || `${k}: ${v}`);
}

function SegmentForm({ initialValues, initialCriteria, onSubmit, isPending, submitLabel = "Save", segmentType = "customer" }) {
  const isCustomer = segmentType === "customer";
  const emptyCrit = isCustomer ? CUST_CRITERIA_EMPTY : ANON_CRITERIA_EMPTY;

  const [form, setForm] = useState(initialValues || EMPTY);
  const [showCriteria, setShowCriteria] = useState(!!(initialCriteria && Object.values(initialCriteria).some(Boolean)));
  const [criteria, setCriteria] = useState(() => {
    // Prefer initialCriteria prop, then fall back to metadata.filter_criteria on the segment
    const stored = initialValues?.metadata?.filter_criteria;
    return { ...emptyCrit, ...(initialCriteria || stored || {}) };
  });

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

  const activeCriteria = Object.entries(criteria).filter(([, v]) => v);
  const chips = criteriaToChips(criteria, isCustomer);

  const handleSubmit = () => {
    const descParts = chips.length ? `Criteria: ${chips.join(", ")}.` : "";
    const description = form.description
      ? (chips.length ? `${form.description} ${descParts}` : form.description)
      : descParts;
    const existingMeta = initialValues?.metadata || {};
    const metadata = {
      ...existingMeta,
      ...(chips.length ? { criteria: chips } : {}),
      ...(activeCriteria.length ? { filter_criteria: Object.fromEntries(activeCriteria) } : {}),
    };
    onSubmit({
      ...form,
      description,
      estimated_size: form.estimated_size ? Number(form.estimated_size) : undefined,
      metadata,
    });
  };

  return (
    <div className="space-y-4 mt-2">
      <div>
        <Label className="text-xs">Segment Name</Label>
        <Input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder={isCustomer ? "High-Value Seminar Members" : "High-Intent Anonymous Visitors"}
          className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Description</Label>
        <Textarea value={form.description} onChange={e => set("description", e.target.value)}
          placeholder="Describe who this segment targets and why..." className="mt-1" rows={2} />
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
            Profile criteria
            {activeCriteria.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{activeCriteria.length} active</Badge>
            )}
          </span>
          <span className="text-muted-foreground">{showCriteria ? "▲" : "▼"}</span>
        </button>

        {showCriteria && (
          <div className="px-3 pb-3 pt-2 border-t border-border space-y-3">
            {isCustomer ? (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Demographics</p>
                  <div className="space-y-1.5">
                    <CriteriaRow label="Reg. channel"  value={criteria.reg_channel}       onChange={v => setCrit("reg_channel", v)}       opts={custFilters?.reg_channels || []} />
                    <CriteriaRow label="Age group"     value={criteria.age_group}          onChange={v => setCrit("age_group", v)}          opts={custFilters?.age_groups || []} />
                    <CriteriaRow label="Gender"        value={criteria.gender}             onChange={v => setCrit("gender", v)}             opts={custFilters?.genders || []} />
                    <CriteriaRow label="Nationality"   value={criteria.nationality}        onChange={v => setCrit("nationality", v)}        opts={custFilters?.nationalities || []} />
                    <CriteriaRow label="Education"     value={criteria.education_level}    onChange={v => setCrit("education_level", v)}    opts={custFilters?.education_levels || []} />
                    <CriteriaRow label="Employment"    value={criteria.employment_status}  onChange={v => setCrit("employment_status", v)}  opts={custFilters?.employment_statuses || []} />
                    <CriteriaRow label="Income"        value={criteria.income_level}       onChange={v => setCrit("income_level", v)}       opts={custFilters?.income_levels || []} />
                    <CriteriaRow label="Member type"   value={criteria.member_type}        onChange={v => setCrit("member_type", v)}        opts={custFilters?.member_types || []} />
                    <CriteriaRow label="Language"      value={criteria.preferred_language} onChange={v => setCrit("preferred_language", v)} opts={custFilters?.languages || []} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Communication</p>
                  <div className="space-y-1.5">
                    <CriteriaRow label="Email opt-in"  value={criteria.is_opt_in_email}   onChange={v => setCrit("is_opt_in_email", v)}   opts={["true"]} />
                    <CriteriaRow label="SMS opt-in"    value={criteria.opt_in_sms}         onChange={v => setCrit("opt_in_sms", v)}         opts={["true"]} />
                    <CriteriaRow label="Subscriber"    value={criteria.is_subscriber}      onChange={v => setCrit("is_subscriber", v)}      opts={["true"]} />
                    <CriteriaRow label="Pref. channel" value={criteria.preferred_channel}  onChange={v => setCrit("preferred_channel", v)}  opts={custFilters?.preferred_channels || []} />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Activity</p>
                  <div className="space-y-1.5">
                    <CriteriaRow label="Web activity"  value={criteria.has_ga_activity}   onChange={v => setCrit("has_ga_activity", v)}   opts={["true"]} />
                    <CriteriaRow label="Min. sessions" value={criteria.min_ga_sessions}    onChange={v => setCrit("min_ga_sessions", v)}    opts={["1", "3", "5", "10"]} />
                    <CriteriaRow label="Seminars"      value={criteria.has_seminars}       onChange={v => setCrit("has_seminars", v)}       opts={["true"]} />
                    <CriteriaRow label="Attributes"    value={criteria.has_attributes}     onChange={v => setCrit("has_attributes", v)}     opts={["true"]} />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <CriteriaRow label="Source / Medium" value={criteria.source_medium}    onChange={v => setCrit("source_medium", v)}    opts={anonFilters?.source_mediums || []} />
                <CriteriaRow label="Form completed"  value={criteria.has_form_complete} onChange={v => setCrit("has_form_complete", v)} opts={["true"]} />
              </div>
            )}
            {chips.length > 0 && (
              <div className="pt-1 flex flex-wrap gap-1">
                {chips.map((c, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border text-muted-foreground">{c}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Estimated Size (optional)</Label>
          <Input type="number" value={form.estimated_size} onChange={e => set("estimated_size", e.target.value)} placeholder="10000" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={form.status || "draft"} onValueChange={v => set("status", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={!form.name || isPending} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}

export default function Segments() {
  const [activeTab, setActiveTab] = useState("customer");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: "" });
  const queryClient = useQueryClient();

  const { data: allSegments = [], isLoading } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date"),
  });

  const segments = allSegments.filter(s => {
    const q = search.toLowerCase();
    const matchesType = (s.segment_type || "customer") === activeTab;
    const matchesSearch = !q || s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
    const matchesStatus = !filters.status || s.status === filters.status;
    return matchesType && matchesSearch && matchesStatus;
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = Object.values(filters).some(Boolean);

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.Segment.create({ ...data, segment_type: activeTab }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      setCreateOpen(false);
      toast.success("Segment created");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.Segment.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      setEditTarget(null);
      toast.success("Segment updated");
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
    if (nameTaken) { toast.error("A segment with this name already exists."); return; }
    createMutation.mutate(data);
  };

  const handleEdit = (data) => {
    const nameTaken = allSegments.some(s =>
      s.id !== editTarget.id &&
      (s.segment_type || "customer") === (editTarget.segment_type || activeTab) &&
      s.name.toLowerCase() === data.name.trim().toLowerCase()
    );
    if (nameTaken) { toast.error("A segment with this name already exists."); return; }
    updateMutation.mutate({ id: editTarget.id, data });
  };

  const handleClone = (seg) => {
    const { id, created_date, updated_date, created_by, ...rest } = seg;
    createMutation.mutate({ ...rest, name: `${seg.name} (copy)`, status: "draft", is_used: false });
  };

  const handleArchive = (seg) => {
    updateMutation.mutate({ id: seg.id, data: { status: "archived" } });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Segments</h1>
            <p className="text-sm text-muted-foreground mt-1">Create audience segments for targeted campaigns.</p>
          </div>
          <Button size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> New Segment
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
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
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Search + Filter */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search segments..."
                className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> Filters
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
            </Button>
          </div>
          {showFilters && (
            <div className="mt-3 p-4 border border-border rounded-lg bg-secondary/20 flex flex-wrap gap-4">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Status</p>
                <select value={filters.status} onChange={e => setFilter("status", e.target.value)}
                  className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                  <option value="">All</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          )}
          {hasActiveFilters && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {filters.status && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                  Status: <strong>{filters.status}</strong>
                  <button onClick={() => setFilter("status", "")} className="hover:text-foreground text-muted-foreground ml-0.5">
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
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No {activeTab === "customer" ? "Customer" : "Anonymous"} segments yet</p>
          <p className="text-xs text-muted-foreground mb-4">{TABS.find(t => t.key === activeTab)?.description}</p>
          <Link to="/"><Button variant="outline" size="sm" className="gap-1.5">Ask AI to create a segment</Button></Link>
        </div>
      ) : (
        <div className="space-y-8">
          {GROUPS.map(group => {
            const items = segments.filter(group.filter);
            if (!items.length) return null;
            return (
              <div key={group.key}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{group.label} · {items.length}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(seg => (
                    <div key={seg.id} className={`border border-border rounded-lg p-5 transition-shadow ${seg.status === "archived" ? "opacity-60" : "hover:shadow-sm"}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="text-sm font-semibold">{seg.name}</h3>
                            {seg.status && seg.status !== "draft" && (
                              <Badge variant="secondary" className="text-[10px]">{seg.status}</Badge>
                            )}
                            {seg.is_used && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                                <Lock className="w-2.5 h-2.5" /> locked
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
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleClone(seg)}>
                              <Copy className="w-3.5 h-3.5 mr-2" /> Clone
                            </DropdownMenuItem>
                            {seg.status !== "archived" && (
                              <DropdownMenuItem onClick={() => handleArchive(seg)}>
                                <Archive className="w-3.5 h-3.5 mr-2" /> Archive
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => deleteMutation.mutate(seg.id)} className="text-destructive">
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground flex-wrap">
                        {seg.estimated_size && (
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {seg.estimated_size.toLocaleString()} users</span>
                        )}
                        {seg.tags?.length > 0 && seg.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-[10px] h-5">{tag}</Badge>
                        ))}
                        <span>Created {format(new Date(seg.created_date), "MMM d, yyyy")}</span>
                        {seg.updated_date && seg.updated_date !== seg.created_date && (
                          <span>Updated {format(new Date(seg.updated_date), "MMM d, yyyy")}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">Create {activeTab === "customer" ? "Customer" : "Anonymous"} Segment</DialogTitle></DialogHeader>
          <div className="overflow-y-auto flex-1 pr-1">
            <SegmentForm onSubmit={handleCreate} isPending={createMutation.isPending} submitLabel="Create Segment" segmentType={activeTab} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle className="font-heading">Edit Segment</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="overflow-y-auto flex-1 pr-1">
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
