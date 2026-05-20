import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus, BarChart2, Send, Pencil, Trash2, MoreHorizontal,
  Mail, Clock, CheckCircle2, XCircle, RefreshCw,
  ShieldOff, Search, Filter, Zap, Play, Pause, Layout,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import CampaignEditor from "@/components/edm/CampaignEditor";
import CampaignStats from "@/components/edm/CampaignStats";
import TemplateEditor from "@/components/edm/TemplateEditor";

const TABS = [
  { key: "campaigns",    label: "Campaigns",    icon: Mail },
  { key: "templates",    label: "Templates",    icon: Layout },
  { key: "automations",  label: "Automations",  icon: Zap },
  { key: "suppression",  label: "Suppression",  icon: ShieldOff },
];

const STATUS_STYLES = {
  draft:     "bg-secondary text-secondary-foreground",
  scheduled: "bg-blue-100 text-blue-800",
  sending:   "bg-amber-100 text-amber-800",
  sent:      "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground opacity-60",
};

const STATUS_ICONS = {
  draft:     Clock,
  scheduled: Clock,
  sending:   RefreshCw,
  sent:      CheckCircle2,
  cancelled: XCircle,
};

const REASON_STYLES = {
  bounced:      "bg-red-100 text-red-700",
  complained:   "bg-orange-100 text-orange-700",
  unsubscribed: "bg-amber-100 text-amber-700",
  manual:       "bg-secondary text-muted-foreground",
};

// ── Campaign card ─────────────────────────────────────────────────────────────
const STATUS_ACCENT = {
  draft:     "#94a3b8",
  scheduled: "#3b82f6",
  sending:   "#f59e0b",
  sent:      "#10b981",
  cancelled: "#d1d5db",
};

function CampaignCard({ campaign, onEdit, onStats, onSend, onDelete }) {
  const [confirmSend, setConfirmSend] = useState(false);
  const Icon = STATUS_ICONS[campaign.status] || Clock;
  const canSend = ["draft", "scheduled"].includes(campaign.status);
  const canEdit = ["draft", "scheduled"].includes(campaign.status);
  const accent = STATUS_ACCENT[campaign.status] || "#94a3b8";

  return (
    <>
      <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all group flex flex-col">
        {/* Color accent bar */}
        <div className="h-1 flex-shrink-0" style={{ background: accent }} />

        <div className="p-4 flex flex-col gap-3 flex-1">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-snug truncate">{campaign.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{campaign.subject}</p>
            </div>
            <Badge className={`${STATUS_STYLES[campaign.status]} text-[10px] h-4 px-1.5 gap-0.5 flex items-center flex-shrink-0 mt-0.5`}>
              <Icon className={`w-2.5 h-2.5 ${campaign.status === "sending" ? "animate-spin" : ""}`} />
              {campaign.status}
            </Badge>
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            {campaign.segment_name && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 flex-shrink-0" />
                {campaign.segment_name}
              </span>
            )}
            {campaign.total_recipients > 0 && (
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {campaign.total_recipients.toLocaleString()}
              </span>
            )}
            <span className="ml-auto">{format(new Date(campaign.created_date), "MMM d, yyyy")}</span>
          </div>

          {/* Sent stats */}
          {campaign.status === "sent" && (campaign.open_count > 0 || campaign.click_count > 0) && (
            <div className="flex items-center gap-4 pt-1 border-t border-border">
              {campaign.total_recipients > 0 && campaign.open_count > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground">Opens</p>
                  <p className="text-sm font-semibold">{Math.round((campaign.open_count / campaign.total_recipients) * 100)}%</p>
                </div>
              )}
              {campaign.total_recipients > 0 && campaign.click_count > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground">Clicks</p>
                  <p className="text-sm font-semibold">{Math.round((campaign.click_count / campaign.total_recipients) * 100)}%</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
          {canEdit && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onEdit(campaign)}>
              <Pencil className="w-3 h-3" /> Edit
            </Button>
          )}
          {canSend && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setConfirmSend(true)}>
              <Send className="w-3 h-3" /> Send
            </Button>
          )}
          {campaign.status === "sent" && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onStats(campaign)}>
              <BarChart2 className="w-3 h-3" /> Stats
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive" onClick={() => onDelete(campaign.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send campaign now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will send <strong>"{campaign.name}"</strong> to all opted-in recipients in the
              selected segment. Suppressed emails are automatically excluded. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmSend(false); onSend(campaign.id); }}>
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Campaigns tab ─────────────────────────────────────────────────────────────
function CampaignsTab({ onCreate, onEdit, onStats }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["edm-campaigns"],
    queryFn: () => appClient.edm.listCampaigns(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-campaigns"] }); toast.success("Campaign deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id) => appClient.edm.sendCampaign(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      toast.success(`Sending to ${data.total_recipients?.toLocaleString()} recipients…`);
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = campaigns.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const GROUPS = [
    { key: "sending",  label: "Sending",  filter: c => c.status === "sending" },
    { key: "draft",    label: "Drafts",   filter: c => ["draft","scheduled"].includes(c.status) },
    { key: "sent",     label: "Sent",     filter: c => c.status === "sent" },
    { key: "archived", label: "Archived", filter: c => c.status === "cancelled" },
  ].filter(g => filtered.some(g.filter));

  return (
    <div className="px-8 py-6 max-w-5xl">
      {/* Search + filter row */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search campaigns…"
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
            <Filter className="w-3.5 h-3.5" /> Filters
            {statusFilter && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
          </Button>
        </div>
        {showFilters && (
          <div className="mt-3 p-4 border border-border rounded-lg bg-secondary/20 flex gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Status</p>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground"
              >
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No campaigns yet</p>
          <p className="text-xs mb-4">Create your first campaign, or ask the AI Analyst to draft one for you.</p>
          <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </Button>
        </div>
      )}

      {GROUPS.map(group => (
        <div key={group.key} className="mb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {group.label}
          </p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {filtered.filter(group.filter).map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onEdit={onEdit}
                onStats={onStats}
                onSend={(id) => sendMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────
function TemplateCard({ template, onEdit, onDelete }) {
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
      <div className="h-1 flex-shrink-0 bg-gradient-to-r from-violet-400 to-indigo-400" />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{template.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.subject}</p>
          </div>
          <span className="text-[11px] text-muted-foreground flex-shrink-0 mt-0.5">
            {format(new Date(template.created_date || template.updated_date || Date.now()), "MMM d, yyyy")}
          </span>
        </div>
        {template.variables?._blocks && (
          <p className="text-[11px] text-muted-foreground">
            {template.variables._blocks.length} block{template.variables._blocks.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
      <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onEdit(template)}>
          <Pencil className="w-3 h-3" /> Edit
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive" onClick={() => onDelete(template.id)}>
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function TemplatesTab({ onCreate, onEdit }) {
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["edm-templates"],
    queryFn: () => appClient.edm.listTemplates(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-templates"] }); toast.success("Template deleted"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="px-8 py-6 max-w-5xl">
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && templates.length === 0 && (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Layout className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No templates yet</p>
          <p className="text-xs mb-4">Create reusable email templates to quickly start new campaigns.</p>
          <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
            <Plus className="w-3.5 h-3.5" /> New Template
          </Button>
        </div>
      )}

      {!isLoading && templates.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {templates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={onEdit}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Suppression tab ───────────────────────────────────────────────────────────
function SuppressionTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState("");

  const { data: suppressed = [], isLoading } = useQuery({
    queryKey: ["edm-suppression"],
    queryFn: () => appClient.edm.listSuppression(),
  });

  const addMutation = useMutation({
    mutationFn: (email) => appClient.edm.addSuppression(email, "manual"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-suppression"] });
      setAdding("");
      toast.success("Added to suppression list");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (email) => appClient.edm.removeSuppression(email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-suppression"] });
      toast.success("Removed from suppression list");
    },
  });

  const filtered = suppressed.filter(s =>
    !search || s.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="px-8 py-6 max-w-5xl">
      {/* Actions row */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search suppressed emails…"
            className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input
            value={adding}
            onChange={e => setAdding(e.target.value)}
            placeholder="email@example.com"
            className="h-9 w-56 px-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={e => e.key === "Enter" && adding && addMutation.mutate(adding)}
          />
          <Button
            variant="outline" size="sm" className="h-9 gap-1.5"
            onClick={() => adding && addMutation.mutate(adding)}
            disabled={!adding || addMutation.isPending}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        {suppressed.length.toLocaleString()} suppressed emails — bounces, unsubscribes, and complaints are added automatically.
      </p>

      <div className="border border-border rounded-lg overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
          </div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <ShieldOff className="w-8 h-8 mx-auto mb-2 opacity-20" />
            No suppressed emails
          </div>
        )}
        {filtered.map(s => (
          <div key={s.email} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/20">
            <span className="flex-1 text-sm font-mono">{s.email}</span>
            <Badge className={`${REASON_STYLES[s.reason] || REASON_STYLES.manual} text-[10px]`}>
              {s.reason}
            </Badge>
            <span className="text-xs text-muted-foreground w-16 text-right">
              {format(new Date(s.added_at), "MMM d")}
            </span>
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => removeMutation.mutate(s.email)}
            >
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Automations tab ───────────────────────────────────────────────────────────
const TRIGGER_LABELS = {
  manual:             "Manual",
  scheduled:          "Scheduled",
  // Member Lifecycle
  new_member:         "New Member Joins",
  member_upgraded:    "Member Upgraded",
  member_expired:     "Membership Expired",
  member_anniversary: "Membership Anniversary",
  // Offline Engagement
  seminar_attended:   "Seminar Attended",
  webinar_attended:   "Webinar Attended",
  form_submitted:     "Form Submitted",
  event_registered:   "Event Registered",
  // Web Activity
  high_activity:      "Highly Active",
  page_viewed:        "Page Viewed",
  file_downloaded:    "File Downloaded",
  whatsapp_clicked:   "WhatsApp Clicked",
  // Re-engagement
  inactivity_30d:     "30-day Inactive",
  inactivity_60d:     "60-day Inactive",
  inactivity_90d:     "90-day Inactive",
  inactivity_180d:    "6-month Inactive",
  // Date-based
  birthday:           "Birthday",
  join_anniversary:   "Join Anniversary",
};

function AutomationFormDialog({ open, onClose, onSave, initial = null }) {
  const [name, setName] = useState(initial?.name || "");
  const [triggerType, setTriggerType] = useState(initial?.trigger_type || "new_member");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("Automation name is required");
    setSaving(true);
    try {
      await onSave({ name: name.trim(), trigger_type: triggerType, trigger_config: {}, status: "draft" });
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Automation" : "New Automation"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <Label className="text-xs mb-1.5 block">Automation Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Welcome series" autoFocus />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Trigger</Label>
            <Select value={triggerType} onValueChange={setTriggerType}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-[280px] overflow-y-auto w-[var(--radix-select-trigger-width)]">
                <SelectGroup>
                  <SelectLabel className="text-[11px] font-semibold text-muted-foreground">Member Lifecycle</SelectLabel>
                  <SelectItem value="new_member">New Member Joins</SelectItem>
                  <SelectItem value="member_upgraded">Member Type Upgraded</SelectItem>
                  <SelectItem value="member_expired">Membership Expired</SelectItem>
                  <SelectItem value="member_anniversary">Membership Anniversary</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[11px] font-semibold text-muted-foreground">Offline Engagement</SelectLabel>
                  <SelectItem value="seminar_attended">Attends a Seminar</SelectItem>
                  <SelectItem value="webinar_attended">Attends a Webinar</SelectItem>
                  <SelectItem value="form_submitted">Submits a Form</SelectItem>
                  <SelectItem value="event_registered">Registers for an Event</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[11px] font-semibold text-muted-foreground">Web Activity</SelectLabel>
                  <SelectItem value="high_activity">Highly Active (5+ sessions)</SelectItem>
                  <SelectItem value="page_viewed">Views a Specific Page</SelectItem>
                  <SelectItem value="file_downloaded">Downloads a File</SelectItem>
                  <SelectItem value="whatsapp_clicked">Clicks WhatsApp</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[11px] font-semibold text-muted-foreground">Re-engagement</SelectLabel>
                  <SelectItem value="inactivity_30d">30 Days Inactive</SelectItem>
                  <SelectItem value="inactivity_60d">60 Days Inactive</SelectItem>
                  <SelectItem value="inactivity_90d">90 Days Inactive</SelectItem>
                  <SelectItem value="inactivity_180d">6 Months Inactive</SelectItem>
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[11px] font-semibold text-muted-foreground">Date-based</SelectLabel>
                  <SelectItem value="birthday">Member Birthday</SelectItem>
                  <SelectItem value="join_anniversary">Join Date Anniversary</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            After creating, add email steps from the automation detail view. Link them to saved draft campaigns.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : initial ? "Update" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AutomationsTab({ onCreate, createOpen, onCreateClose }) {
  const qc = useQueryClient();

  // createOpen/onCreateClose controlled from parent (header button); fallback to local state
  const formOpen = createOpen ?? false;
  const closeForm = onCreateClose ?? (() => {});

  const { data: automations = [], isLoading } = useQuery({
    queryKey: ["edm-automations"],
    queryFn: () => appClient.edm.listAutomations(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.edm.createAutomation(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-automations"] }); toast.success("Automation created"); },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }) => appClient.edm.updateAutomation(id, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-automations"] }); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteAutomation(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-automations"] }); toast.success("Automation deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const openForm = onCreate ?? (() => {});

  return (
    <div className="px-8 py-6 max-w-5xl">
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && automations.length === 0 && (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No automations yet</p>
          <p className="text-xs mb-4">Create an automation to send emails based on member actions like joining or going inactive.</p>
          <Button size="sm" className="gap-1.5 h-9" onClick={openForm}>
            <Plus className="w-3.5 h-3.5" /> New Automation
          </Button>
        </div>
      )}

      {!isLoading && automations.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          {automations.map(a => (
            <div key={a.id} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/20 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{a.name}</p>
                  <Badge
                    className={`text-[10px] h-4 px-1.5 ${a.status === "active" ? "bg-green-100 text-green-800" : "bg-secondary text-secondary-foreground"}`}
                  >
                    {a.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Trigger: {TRIGGER_LABELS[a.trigger_type] || a.trigger_type}
                </p>
              </div>
              <span className="text-xs text-muted-foreground hidden md:block">
                {format(new Date(a.created_date), "MMM d, yyyy")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => toggleMutation.mutate({ id: a.id, status: a.status === "active" ? "draft" : "active" })}
                >
                  {a.status === "active"
                    ? <><Pause className="w-3 h-3" /> Pause</>
                    : <><Play className="w-3 h-3" /> Activate</>
                  }
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate(a.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AutomationFormDialog
        open={formOpen}
        onClose={closeForm}
        onSave={(data) => createMutation.mutateAsync(data)}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EDM() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("campaigns");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [statsTarget, setStatsTarget] = useState(null);
  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateEditTarget, setTemplateEditTarget] = useState(null);

  const createMutation = useMutation({
    mutationFn: (data) => appClient.edm.createCampaign(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      setEditorOpen(false);
      toast.success("Campaign saved as draft");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.edm.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      setEditTarget(null);
      setEditorOpen(false);
      toast.success("Campaign updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (formData) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data: formData });
    else createMutation.mutate(formData);
  };

  const templateCreateMutation = useMutation({
    mutationFn: (data) => appClient.edm.createTemplate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-templates"] });
      setTemplateEditorOpen(false);
      setTemplateEditTarget(null);
      toast.success("Template saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const templateUpdateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.edm.updateTemplate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-templates"] });
      setTemplateEditorOpen(false);
      setTemplateEditTarget(null);
      toast.success("Template updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleTemplateSave = (data) => {
    if (templateEditTarget) templateUpdateMutation.mutate({ id: templateEditTarget.id, data });
    else templateCreateMutation.mutate(data);
  };

  const openCreate = () => { setEditTarget(null); setEditorOpen(true); };
  const openEdit   = (c)  => { setEditTarget(c);    setEditorOpen(true); };
  const openTemplateCreate = () => { setTemplateEditTarget(null); setTemplateEditorOpen(true); };
  const openTemplateEdit   = (t)  => { setTemplateEditTarget(t);    setTemplateEditorOpen(true); };

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches Campaigns / Segments pattern */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Email</h1>
            <p className="text-sm text-muted-foreground mt-1">Build, send, and track email marketing campaigns.</p>
          </div>
          {tab === "campaigns" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5" /> New Campaign
            </Button>
          )}
          {tab === "templates" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={openTemplateCreate}>
              <Plus className="w-3.5 h-3.5" /> New Template
            </Button>
          )}
          {tab === "automations" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setAutomationFormOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New Automation
            </Button>
          )}
        </div>

        {/* Tabs — identical markup to Campaigns / Segments */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto min-h-0">
        {tab === "campaigns" && (
          <CampaignsTab
            onCreate={openCreate}
            onEdit={openEdit}
            onStats={setStatsTarget}
          />
        )}
        {tab === "templates" && (
          <TemplatesTab
            onCreate={openTemplateCreate}
            onEdit={openTemplateEdit}
          />
        )}
        {tab === "automations" && (
          <AutomationsTab
            onCreate={() => setAutomationFormOpen(true)}
            createOpen={automationFormOpen}
            onCreateClose={() => setAutomationFormOpen(false)}
          />
        )}
        {tab === "suppression"  && <SuppressionTab />}
      </div>

      <CampaignEditor
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditTarget(null); }}
        onSave={handleSave}
        initial={editTarget}
      />

      <CampaignStats
        campaignId={statsTarget?.id}
        open={!!statsTarget}
        onClose={() => setStatsTarget(null)}
      />

      <TemplateEditor
        open={templateEditorOpen}
        onClose={() => { setTemplateEditorOpen(false); setTemplateEditTarget(null); }}
        onSave={handleTemplateSave}
        initial={templateEditTarget}
      />
    </div>
  );
}
