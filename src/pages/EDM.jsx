import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { usePlan } from "@/lib/usePlan";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus, BarChart2, Send, Pencil, Trash2,
  Mail, Clock, CheckCircle2, XCircle, RefreshCw,
  ShieldOff, Search, Filter, Layout, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import CampaignEditor from "@/components/edm/CampaignEditor";
import CampaignStats from "@/components/edm/CampaignStats";
import TemplateEditor from "@/components/edm/TemplateEditor";

const TABS = [
  { key: "emails",      label: "Emails",      icon: Mail },
  { key: "templates",   label: "Templates",   icon: Layout },
  { key: "analytics",   label: "Analytics",   icon: BarChart2 },
  { key: "suppression", label: "Suppression", icon: ShieldOff },
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

const STATUS_ACCENT = {
  draft:     "#94a3b8",
  scheduled: "#3b82f6",
  sending:   "#f59e0b",
  sent:      "#10b981",
  cancelled: "#d1d5db",
};

// ── Email card ─────────────────────────────────────────────────────────────────
function EmailCard({ campaign, onEdit, onStats, onSend, onDelete }) {
  const [confirmSend, setConfirmSend] = useState(false);
  const { canUseFeatures } = usePlan();
  const Icon = STATUS_ICONS[campaign.status] || Clock;
  const canSend = ["draft", "scheduled"].includes(campaign.status) && canUseFeatures;
  const canEdit = ["draft", "scheduled"].includes(campaign.status);
  const accent = STATUS_ACCENT[campaign.status] || "#94a3b8";

  return (
    <>
      <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all group flex flex-col">
        <div className="h-1 flex-shrink-0" style={{ background: accent }} />

        <div className="p-4 flex flex-col gap-3 flex-1">
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
            <AlertDialogTitle>Send email now?</AlertDialogTitle>
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

// ── Emails tab ─────────────────────────────────────────────────────────────────
function EmailsTab({ onCreate, onEdit, onStats, onBrowseTemplates }) {
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-campaigns"] }); toast.success("Email deleted"); },
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

  const hasActiveFilters = !!statusFilter;

  const GROUPS = [
    { key: "sending",  label: "Sending",  filter: c => c.status === "sending" },
    { key: "draft",    label: "Drafts",   filter: c => ["draft","scheduled"].includes(c.status) },
    { key: "sent",     label: "Sent",     filter: c => c.status === "sent" },
    { key: "archived", label: "Archived", filter: c => c.status === "cancelled" },
  ].filter(g => filtered.some(g.filter));

  return (
    <div className="px-8 py-6">
      {/* Search + filter row */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search emails…"
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
            <Filter className="w-3.5 h-3.5" /> Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
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
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {statusFilter && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                Status: <strong>{statusFilter}</strong>
                <button onClick={() => setStatusFilter("")} className="hover:text-foreground text-muted-foreground ml-0.5">
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            )}
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
          <p className="font-medium text-foreground mb-1">No emails yet</p>
          <p className="text-xs mb-4">Create your first email, or start from a template.</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
              <Plus className="w-3.5 h-3.5" /> New Email
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={onBrowseTemplates}>
              <Layout className="w-3.5 h-3.5" /> Browse Templates
            </Button>
          </div>
        </div>
      )}

      {GROUPS.map(group => (
        <div key={group.key} className="mb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {group.label}
          </p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {filtered.filter(group.filter).map(c => (
              <EmailCard
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

function TemplatesTab({ onCreate, onEdit, onImport }) {
  const qc = useQueryClient();
  const fileInputRef = useRef(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["edm-templates"],
    queryFn: () => appClient.edm.listTemplates(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-templates"] }); toast.success("Template deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onImport({ name: file.name.replace(/\.html?$/, ""), html_body: ev.target.result, variables: { _html_mode: true } });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="px-8 py-6">
      {/* Toolbar — only shown when templates exist */}
      {!isLoading && templates.length > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 ml-auto" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> Import HTML
          </Button>
          <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImportFile} />
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && templates.length === 0 && (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Layout className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No templates yet</p>
          <p className="text-xs mb-4">Create reusable email templates to quickly start new emails.</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
              <Plus className="w-3.5 h-3.5" /> New Template
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Import HTML
            </Button>
          </div>
          <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImportFile} />
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

// ── Analytics tab ─────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["edm-campaigns"],
    queryFn: () => appClient.edm.listCampaigns(),
  });

  const sent = campaigns.filter(c => c.status === "sent");
  const totalSent = sent.reduce((s, c) => s + (c.total_recipients || 0), 0);
  const totalOpens = sent.reduce((s, c) => s + (c.open_count || 0), 0);
  const totalClicks = sent.reduce((s, c) => s + (c.click_count || 0), 0);
  const avgOpenRate = totalSent > 0 ? Math.round((totalOpens / totalSent) * 100) : 0;
  const avgClickRate = totalSent > 0 ? Math.round((totalClicks / totalSent) * 100) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-8 py-6 space-y-8">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Emails Sent", value: sent.length, sub: "campaigns" },
          { label: "Total Recipients", value: totalSent.toLocaleString(), sub: "across all sends" },
          { label: "Avg Open Rate", value: `${avgOpenRate}%`, sub: `${totalOpens.toLocaleString()} opens` },
          { label: "Avg Click Rate", value: `${avgClickRate}%`, sub: `${totalClicks.toLocaleString()} clicks` },
        ].map(tile => (
          <div key={tile.label} className="border border-border rounded-lg p-4 space-y-1">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="text-2xl font-bold">{tile.value}</p>
            <p className="text-[11px] text-muted-foreground">{tile.sub}</p>
          </div>
        ))}
      </div>

      {/* Per-email breakdown */}
      {sent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Sent Emails - Performance
          </p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Email</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Recipients</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Open Rate</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Click Rate</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Sent</th>
                </tr>
              </thead>
              <tbody>
                {sent.map(c => {
                  const openRate = c.total_recipients > 0 ? Math.round((c.open_count / c.total_recipients) * 100) : 0;
                  const clickRate = c.total_recipients > 0 ? Math.round((c.click_count / c.total_recipients) * 100) : 0;
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/10">
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[200px]">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{c.subject}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{(c.total_recipients || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">{openRate}%</td>
                      <td className="px-4 py-3 text-right font-semibold">{clickRate}%</td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                        {c.sent_at ? format(new Date(c.sent_at), "MMM d, yyyy") : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sent.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No data yet</p>
          <p className="text-xs">Send your first email to start seeing analytics.</p>
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
    <div className="px-8 py-6">
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
        {suppressed.length.toLocaleString()} suppressed emails - bounces, unsubscribes, and complaints are added automatically.
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EDM() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("emails");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [statsTarget, setStatsTarget] = useState(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateEditTarget, setTemplateEditTarget] = useState(null);

  const createMutation = useMutation({
    mutationFn: (data) => appClient.edm.createCampaign(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      setEditorOpen(false);
      toast.success("Email saved as draft");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.edm.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      setEditTarget(null);
      setEditorOpen(false);
      toast.success("Email updated");
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
    if (templateEditTarget?.id) templateUpdateMutation.mutate({ id: templateEditTarget.id, data });
    else templateCreateMutation.mutate(data);
  };

  const openCreate = () => { setEditTarget(null); setEditorOpen(true); };
  const openEdit   = (c)  => { setEditTarget(c);    setEditorOpen(true); };
  const openTemplateCreate = () => { setTemplateEditTarget(null); setTemplateEditorOpen(true); };
  const openTemplateEdit   = (t)  => { setTemplateEditTarget(t);    setTemplateEditorOpen(true); };
  const openTemplateImport = (initialData) => { setTemplateEditTarget(initialData); setTemplateEditorOpen(true); };

  const { canUseFeatures } = usePlan();

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Email</h1>
            <p className="text-sm text-muted-foreground mt-1">Build, send, and track marketing emails.</p>
          </div>
          {tab === "emails" && canUseFeatures && (
            <Button size="sm" className="gap-1.5 h-9" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5" /> New Email
            </Button>
          )}
        </div>

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

      <div className="flex-1 overflow-auto min-h-0">
        {tab === "emails" && (
          <EmailsTab
            onCreate={openCreate}
            onEdit={openEdit}
            onStats={setStatsTarget}
            onBrowseTemplates={() => setTab("templates")}
          />
        )}
        {tab === "templates" && (
          <TemplatesTab
            onCreate={openTemplateCreate}
            onEdit={openTemplateEdit}
            onImport={openTemplateImport}
          />
        )}
        {tab === "analytics"  && <AnalyticsTab />}
        {tab === "suppression" && <SuppressionTab />}
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
