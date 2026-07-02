import { useState, useRef, useEffect } from "react";
import TableToolbar from "@/components/ui/TableToolbar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { usePlan } from "@/lib/usePlan";
import { useStickyState } from "@/lib/useStickyState";
import { DateRangeBar, KpiTile } from "@/components/analytics/AnalyticsKit";
import { toast } from "sonner";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, isSameMonth, isToday,
} from "date-fns";
import {
  Plus, BarChart2, Send, Pencil, Trash2, Archive,
  Mail, Clock, CheckCircle2, XCircle, RefreshCw,
  ShieldOff, Search, Filter, Layout, Upload, Info,
  ArrowUp, ArrowDown, ArrowUpDown, Eye, Copy,
  FileText, FileDown, X, Calendar, LayoutGrid, ChevronLeft, ChevronRight,
  ChevronDown, ChevronsDownUp, ChevronsUpDown,
  Users, MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { DevicePreviewToggle, DevicePreviewFrame } from "@/components/ui/device-preview";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { usePreferences } from "@/lib/PreferencesContext";
import CampaignEditor from "@/components/edm/CampaignEditor";
import CampaignStats from "@/components/edm/CampaignStats";
import TemplateEditor from "@/components/edm/TemplateEditor";
import { blocksToHtml } from "@/components/edm/emailHtml";

// Render a template the same way the editor (and the actual send) does: from its
// saved blocks via blocksToHtml. Falls back to the stored html_body for raw-HTML
// templates or legacy ones without block data, so the card preview always matches
// what you see when you open the template to edit it.
function templatePreviewHtml(template) {
  const blocks = template?.variables?._blocks;
  if (!template?.variables?._html_mode && Array.isArray(blocks) && blocks.length) {
    return blocksToHtml(blocks, true, template?.variables?._container || null);
  }
  return template?.html_body || "";
}

const TABS = [
  { key: "emails",      label: "Emails",      icon: Mail },
  { key: "templates",   label: "Templates",   icon: Layout },
  { key: "analytics",   label: "Analytics",   icon: BarChart2 },
  { key: "suppression", label: "Email Suppression", icon: ShieldOff },
];

const STATUS_STYLES = {
  draft:     "bg-yellow-500/10 text-yellow-700 border border-yellow-500/40",
  scheduled: "bg-secondary text-foreground border border-border",
  sending:   "bg-secondary text-foreground border border-border",
  sent:      "bg-foreground text-background",
  cancelled: "bg-muted text-muted-foreground opacity-60",
  archived:  "bg-muted text-muted-foreground opacity-60",
};

const STATUS_ICONS = {
  draft:     Clock,
  scheduled: Clock,
  sending:   RefreshCw,
  sent:      CheckCircle2,
  cancelled: XCircle,
  archived:  Archive,
};

const REASON_STYLES = {
  bounced:      "bg-secondary text-foreground border border-border",
  complained:   "bg-secondary text-foreground border border-border",
  unsubscribed: "bg-secondary text-muted-foreground border border-border",
  manual:       "bg-secondary text-muted-foreground",
};

const STATUS_ACCENT = {
  draft:     "#eab308",
  scheduled: "#6b7280",
  sending:   "#374151",
  sent:      "#111827",
  cancelled: "#e5e7eb",
  archived:  "#e5e7eb",
};

// ── Email / template preview dialog ───────────────────────────────────────────
function PreviewDialog({ open, onClose, html, title, subject }) {
  const { t } = usePreferences();
  const [device, setDevice] = useState("desktop");
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[96vw] max-w-3xl h-[90vh] p-0 flex flex-col gap-0" aria-describedby={undefined}>
        <DialogHeader className="px-5 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold truncate">{title || t("Preview")}</DialogTitle>
              {subject && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t("Subject")}: {subject}</p>}
            </div>
            <DevicePreviewToggle device={device} onChange={setDevice} className="flex-shrink-0 mr-6" />
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-secondary/10 p-6">
          <DevicePreviewFrame html={html} device={device} title="Email preview" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sorting ────────────────────────────────────────────────────────────────────
// Shared by the Emails, Pop-up and UTM lists: sort by date / name / status.
const SORT_GETTERS = {
  date:   x => x.created_date || "",
  name:   x => (x.name || "").toLowerCase(),
  status: x => x.status || "",
};
function sortRecords(items, sortBy, sortDir) {
  const get = SORT_GETTERS[sortBy];
  if (!get) return items;
  const arr = [...items].sort((a, b) => {
    const av = get(a), bv = get(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return sortDir === "asc" ? arr : arr.reverse();
}

// ── Email card ─────────────────────────────────────────────────────────────────
function EmailCard({ campaign, onEdit, onStats, onSend, onDelete, onArchive }) {
  const [confirmSend, setConfirmSend] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { canUseFeatures } = usePlan();
  const { t } = usePreferences();
  const Icon = STATUS_ICONS[campaign.status] || Clock;
  const canSend = ["draft", "scheduled"].includes(campaign.status) && canUseFeatures;
  const canEdit = ["draft", "scheduled"].includes(campaign.status);
  const accent = STATUS_ACCENT[campaign.status] || "#94a3b8";
  // Only drafts can be deleted; everything else (except in-flight or already
  // archived) is archived instead so its record/analytics are kept.
  const canDelete  = campaign.status === "draft";
  const canArchive = !["draft", "sending", "archived", "cancelled"].includes(campaign.status);

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
              {t(campaign.status)}
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
                  <p className="text-[10px] text-muted-foreground">{t("Opens")}</p>
                  <p className="text-sm font-semibold">{Math.round((campaign.open_count / campaign.total_recipients) * 100)}%</p>
                </div>
              )}
              {campaign.total_recipients > 0 && campaign.click_count > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground">{t("Clicks")}</p>
                  <p className="text-sm font-semibold">{Math.round((campaign.click_count / campaign.total_recipients) * 100)}%</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setPreviewOpen(true)}>
            <Eye className="w-3 h-3" /> {t("Preview")}
          </Button>
          {canSend && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setConfirmSend(true)}>
              <Send className="w-3 h-3" /> {t("Send")}
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onEdit(campaign)}>
              <Pencil className="w-3 h-3" /> {t("Edit")}
            </Button>
          )}
          {["sent", "archived"].includes(campaign.status) && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onStats(campaign)}>
              <BarChart2 className="w-3 h-3" /> {t("Stats")}
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive" title={t("Delete draft")} onClick={() => onDelete(campaign.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
          {canArchive && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 ml-auto text-muted-foreground hover:text-foreground" title={t("Archive email")} onClick={() => onArchive(campaign.id)}>
              <Archive className="w-3 h-3" /> {t("Archive")}
            </Button>
          )}
        </div>
      </div>

      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        html={campaign.html_body}
        title={campaign.name}
        subject={campaign.subject}
      />

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Send email now?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This will send")} <strong>"{campaign.name}"</strong> {t("to all opted-in recipients in the selected segment. Suppressed emails are automatically excluded. This cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmSend(false); onSend(campaign.id); }}>
              {t("Send")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Calendar view ────────────────────────────────────────────────────────────
// Maps each campaign onto the day it sends/sent so you can see the sending
// schedule at a glance. Sent → sent_at, scheduled → scheduled_at, otherwise the
// created date so drafts still appear.
function campaignDate(c) {
  const raw = c.status === "sent"      ? c.sent_at
            : c.status === "scheduled" ? c.scheduled_at
            : (c.scheduled_at || c.sent_at || c.created_date);
  return raw ? new Date(raw) : null;
}

const CAL_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"];

function EmailCalendar({ campaigns, onEdit, onStats }) {
  const { t } = usePreferences();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const dated = campaigns
    .map(c => ({ c, date: campaignDate(c) }))
    .filter(x => x.date && !isNaN(x.date));

  const byDay = new Map();
  dated.forEach(({ c, date }) => {
    const key = format(date, "yyyy-MM-dd");
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(c);
  });

  const monthStart = startOfMonth(cursor);
  const monthEnd   = endOfMonth(cursor);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end:   endOfWeek(monthEnd, { weekStartsOn: 0 }),
  });
  const monthCount = dated.filter(x => isSameMonth(x.date, cursor)).length;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const openCampaign = (c) => { if (c.status === "sent") onStats(c); else onEdit(c); };

  return (
    <div className="space-y-4">
      {/* Month navigation + legend */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center border border-input rounded-md overflow-hidden h-8">
          <button type="button" onClick={() => setCursor(c => addMonths(c, -1))} title={t("Previous month")} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setCursor(startOfMonth(new Date()))} title={t("Jump to current month")} className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors border-x border-input">
            {t("Today")}
          </button>
          <button type="button" onClick={() => setCursor(c => addMonths(c, 1))} title={t("Next month")} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-sm font-semibold">{format(cursor, "MMMM yyyy")}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ml-auto">
          {CAL_STATUSES.map(s => (
            <span key={s} className="flex items-center gap-1.5 capitalize">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_ACCENT[s] }} /> {t(s)}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/70 -mt-2">
        {monthCount} {monthCount !== 1 ? t("emails this month · click an email to open it") : t("email this month · click an email to open it")}
      </p>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/20">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center">{t(d)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd");
            const items = byDay.get(key) || [];
            const inMonth = isSameMonth(day, cursor);
            const today = isToday(day);
            return (
              <div
                key={key}
                className={`min-h-[96px] border-b border-border p-1.5 flex flex-col gap-1 ${i % 7 !== 6 ? "border-r" : ""} ${inMonth ? "" : "bg-secondary/20"}`}
              >
                <span className={`text-[11px] self-start ${today ? "bg-foreground text-background rounded-full w-5 h-5 flex items-center justify-center font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground/40"}`}>
                  {format(day, "d")}
                </span>
                <div className="flex flex-col gap-1 overflow-hidden">
                  {items.slice(0, 3).map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openCampaign(c)}
                      title={`${c.name}${c.subject ? `\n${c.subject}` : ""}\n${t("Status")}: ${t(c.status)}`}
                      className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] bg-secondary border border-border hover:border-foreground/40 transition-colors min-w-0"
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_ACCENT[c.status] || "#94a3b8" }} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                  {items.length > 3 && (
                    <span className="text-[10px] text-muted-foreground pl-1">+{items.length - 3} {t("more")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Emails tab ─────────────────────────────────────────────────────────────────
function EmailsTab({ onCreate, onEdit, onStats, onBrowseTemplates }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState("grid"); // "grid" | "calendar"
  const [groupByStatus, setGroupByStatus] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [sortBy, setSortBy] = useStickyState("date", "edm.sortBy");   // "date" | "name" | "status"
  const [sortDir, setSortDir] = useStickyState("desc", "edm.sortDir");
  const [filters, setFilters] = useState({ status: [], segment_name: [], from_name: [], from_email: [] });
  const filterRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["edm-campaigns"],
    queryFn: () => appClient.edm.listCampaigns(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-campaigns"] }); toast.success(t("Email deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => appClient.edm.archiveCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-campaigns"] }); toast.success(t("Email archived")); },
    onError: (e) => toast.error(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: (id) => appClient.edm.sendCampaign(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      toast.success(t("Sending to") + ` ${data.total_recipients?.toLocaleString()} ` + t("recipients…"));
    },
    onError: (e) => toast.error(e.message),
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = Object.values(filters).some(a => a.length > 0);

  const uniqueSegments = [...new Set(campaigns.map(c => c.segment_name).filter(Boolean))].sort();
  const uniqueFromNames = [...new Set(campaigns.map(c => c.from_name).filter(Boolean))].sort();
  const uniqueFromEmails = [...new Set(campaigns.map(c => c.from_email).filter(Boolean))].sort();

  const filtered = campaigns.filter(c => {
    const q = search.toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !c.subject?.toLowerCase().includes(q) && !c.from_email?.toLowerCase().includes(q)) return false;
    if (filters.status.length && !filters.status.includes(c.status)) return false;
    if (filters.segment_name.length && !filters.segment_name.includes(c.segment_name)) return false;
    if (filters.from_name.length && !filters.from_name.includes(c.from_name)) return false;
    if (filters.from_email.length && !filters.from_email.includes(c.from_email)) return false;
    return true;
  });

  const GROUPS = [
    { key: "sending",  label: t("Sending"),  filter: c => c.status === "sending" },
    { key: "draft",    label: t("Drafts"),   filter: c => ["draft","scheduled"].includes(c.status) },
    { key: "sent",     label: t("Sent"),     filter: c => c.status === "sent" },
    { key: "archived", label: t("Archived"), filter: c => ["archived", "cancelled"].includes(c.status) },
  ].filter(g => filtered.some(g.filter));

  // Apply the chosen sort, then group (or show one flat list when grouping is off).
  const sorted = sortRecords(filtered, sortBy, sortDir);
  const displayGroups = groupByStatus ? GROUPS : [{ key: "all", label: t("All"), filter: () => true }];
  const allGroupsCollapsed = groupByStatus && GROUPS.length > 0 && GROUPS.every(g => collapsedGroups.has(g.key));
  const toggleAllGroups = () => setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(GROUPS.map(g => g.key)));
  const toggleGroupCollapse = (k) => setCollapsedGroups(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });


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
              placeholder={t("Search name, subject, from email...")}
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div ref={filterRef} className="relative">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> {t("Filters")}
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
            </Button>
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-80 md:w-[480px]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                  {hasActiveFilters && (
                    <button onClick={() => setFilters({ status: [], segment_name: [], from_name: [], from_email: [] })} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                    <MultiSelect value={filters.status} onChange={v => setFilter("status", v)}
                      options={["draft","scheduled","sending","sent","cancelled","archived"]} placeholder={t("All")} />
                  </div>
                  {uniqueSegments.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("Segment")}</p>
                      <MultiSelect value={filters.segment_name} onChange={v => setFilter("segment_name", v)} options={uniqueSegments} placeholder={t("All")} />
                    </div>
                  )}
                  {uniqueFromNames.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("From Name")}</p>
                      <MultiSelect value={filters.from_name} onChange={v => setFilter("from_name", v)} options={uniqueFromNames} placeholder={t("All")} />
                    </div>
                  )}
                  {uniqueFromEmails.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">{t("From Email")}</p>
                      <MultiSelect value={filters.from_email} onChange={v => setFilter("from_email", v)} options={uniqueFromEmails} placeholder={t("All")} />
                    </div>
                  )}
                </div>

                {/* Sort */}
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Sort by")}</p>
                  <div className="flex items-center gap-2">
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                      className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      <option value="date">{t("Date")}</option>
                      <option value="name">{t("Name")}</option>
                      <option value="status">{t("Status")}</option>
                    </select>
                    <button type="button" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                      className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                      {sortDir === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> {t("Asc")}</> : <><ArrowDown className="w-3.5 h-3.5" /> {t("Desc")}</>}
                    </button>
                  </div>
                </div>
                {view === "grid" && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Group by")}</p>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-xs text-muted-foreground">{t("Status")}</span>
                      <input type="checkbox" checked={groupByStatus} onChange={e => setGroupByStatus(e.target.checked)}
                        className="rounded border-border cursor-pointer" />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* View toggle: grid / calendar */}
          <div className="flex items-center border border-input rounded-md overflow-hidden h-9">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`h-9 px-2.5 flex items-center gap-1.5 text-xs transition-colors ${view === "grid" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> {t("Grid")}
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={`h-9 px-2.5 flex items-center gap-1.5 text-xs border-l border-input transition-colors ${view === "calendar" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Calendar className="w-3.5 h-3.5" /> {t("Calendar")}
            </button>
          </div>
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(filters).flatMap(([k, vals]) => vals.map(v => (
              <span key={`${k}:${v}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                {t(k.replace(/_/g, " "))}: <strong>{v}</strong>
                <button onClick={() => setFilter(k, filters[k].filter(x => x !== v))} className="hover:text-foreground text-muted-foreground ml-0.5">
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            )))}
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
          <p className="font-medium text-foreground mb-1">{t("No emails yet")}</p>
          <p className="text-xs mb-4">{t("Create your first email, or start from a template.")}</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
              <Plus className="w-3.5 h-3.5" /> {t("New Email")}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={onBrowseTemplates}>
              <Layout className="w-3.5 h-3.5" /> {t("Browse Templates")}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && filtered.length > 0 && view === "calendar" && (
        <EmailCalendar campaigns={filtered} onEdit={onEdit} onStats={onStats} />
      )}

      {view === "grid" && groupByStatus && GROUPS.length > 1 && (
        <div className="flex justify-end mb-3">
          <button onClick={toggleAllGroups} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            {allGroupsCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
            {allGroupsCollapsed ? t("Expand all") : t("Collapse all")}
          </button>
        </div>
      )}

      {view === "grid" && displayGroups.map(group => (
        <div key={group.key} className="mb-8">
          {groupByStatus && (
            <button onClick={() => toggleGroupCollapse(group.key)} className="flex items-center gap-1.5 mb-3 group/h">
              {collapsedGroups.has(group.key) ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide group-hover/h:text-foreground">{group.label}</span>
            </button>
          )}
          {!(groupByStatus && collapsedGroups.has(group.key)) && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {sorted.filter(group.filter).map(c => (
              <EmailCard
                key={c.id}
                campaign={c}
                onEdit={onEdit}
                onStats={onStats}
                onSend={(id) => sendMutation.mutate(id)}
                onDelete={(id) => deleteMutation.mutate(id)}
                onArchive={(id) => archiveMutation.mutate(id)}
              />
            ))}
          </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────
function TemplateCard({ template, onUse, onEdit, onDelete, onDuplicate }) {
  const { t } = usePreferences();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
        <div className="h-1 flex-shrink-0 bg-gradient-to-r from-border to-muted-foreground/30" />
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
          {template.preview_text && (
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{template.preview_text}</p>
          )}
          <p className={`text-[10px] uppercase tracking-wide capitalize ${
            template.status === "published" ? "text-foreground font-medium" : "text-muted-foreground/60"
          }`}>
            {t(template.status || "draft")}
          </p>
        </div>
        <div className="border-t border-border bg-secondary/20">
          {/* Secondary actions */}
          <div className="px-3 pt-2 pb-1 flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setPreviewOpen(true)}>
              <Eye className="w-3 h-3" /> {t("Preview")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onDuplicate(template.id)}>
              <Copy className="w-3 h-3" /> {t("Clone")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => onEdit(template)}>
              <Pencil className="w-3 h-3" /> {t("Edit")}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive" onClick={() => onDelete(template.id)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
          {/* Primary action */}
          <div className="px-3 pb-2.5">
            <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={() => onUse(template)}>
              <Plus className="w-3 h-3" /> {t("Use Template")}
            </Button>
          </div>
        </div>
      </div>

      <PreviewDialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        html={templatePreviewHtml(template)}
        title={template.name}
        subject={template.subject}
      />
    </>
  );
}

function TemplatesTab({ onCreate, onUse, onEdit, onImport }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const fileInputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["edm-templates"],
    queryFn: () => appClient.edm.listTemplates(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.edm.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-templates"] }); toast.success(t("Template deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id) => appClient.edm.duplicateTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["edm-templates"] }); toast.success(t("Template duplicated")); },
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

  const visible = templates.filter(t => {
    const q = search.toLowerCase();
    if (q && !t.name.toLowerCase().includes(q) && !t.subject?.toLowerCase().includes(q) && !t.preview_text?.toLowerCase().includes(q)) return false;
    if (statusFilter.length && !statusFilter.includes(t.status)) return false;
    return true;
  });

  const hasActiveFilters = statusFilter.length > 0;

  const GROUPS = [
    { key: "published", label: t("Published"), filter: tpl => tpl.status === "published" },
    { key: "draft",     label: t("Drafts"),    filter: tpl => (tpl.status || "draft") !== "published" },
  ].filter(g => visible.some(g.filter));

  return (
    <div className="px-8 py-6">
      {/* Toolbar */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("Search templates...")}
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div ref={filterRef} className="relative">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> {t("Filters")}
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
            </Button>
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-56">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                  {hasActiveFilters && (
                    <button onClick={() => setStatusFilter([])} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                  <MultiSelect value={statusFilter} onChange={setStatusFilter}
                    options={["draft","published"]} placeholder={t("All")} />
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> {t("Import HTML")}
          </Button>
          <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImportFile} />
          <span className="text-xs text-muted-foreground ml-auto">
            {visible.length !== templates.length ? `${visible.length} ${t("of")} ${templates.length}` : `${templates.length}`} {t("templates")}
          </span>
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5">
            {statusFilter.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                {t("Status")}: <strong>{v}</strong>
                <button onClick={() => setStatusFilter(statusFilter.filter(x => x !== v))} className="hover:text-foreground text-muted-foreground ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && templates.length === 0 && (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Layout className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">{t("No templates yet")}</p>
          <p className="text-xs mb-4">{t("Create reusable email templates to quickly start new emails.")}</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" className="gap-1.5 h-9" onClick={onCreate}>
              <Plus className="w-3.5 h-3.5" /> {t("New Template")}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => fileInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> {t("Import HTML")}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && templates.length > 0 && visible.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Layout className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>{t("No templates match your search.")}</p>
        </div>
      )}

      {!isLoading && visible.length > 0 && GROUPS.map(group => (
        <div key={group.key} className="mb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {group.label}
          </p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {visible.filter(group.filter).map(t => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={onUse}
                onEdit={onEdit}
                onDelete={(id) => deleteMutation.mutate(id)}
                onDuplicate={(id) => duplicateMutation.mutate(id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────────

const EDM_ANALYTICS_COLS = [
  { key: "name",             label: "Campaign Name",   defaultVisible: true,  filterable: true,  type: "text" },
  { key: "subject",          label: "Subject",         defaultVisible: true,  filterable: true,  type: "text" },
  { key: "segment_name",     label: "Segment",         defaultVisible: true,  filterable: true,  type: "text" },
  { key: "total_recipients", label: "Recipients",      defaultVisible: true,  filterable: false, description: "Total number of email addresses this campaign was sent to, after opt-in and suppression filtering." },
  { key: "open_count",       label: "Opens",           defaultVisible: true,  filterable: false, description: "Number of unique recipients who opened the email at least once." },
  { key: "open_rate",        label: "Open Rate",       defaultVisible: true,  filterable: false, description: "Opens ÷ Total Recipients × 100. Measures how many people opened your email." },
  { key: "click_count",      label: "Clicks",          defaultVisible: false, filterable: false, description: "Number of unique recipients who clicked any link in the email." },
  { key: "click_rate",       label: "Click Rate",      defaultVisible: true,  filterable: false, description: "Clicks ÷ Total Recipients × 100. Measures how many recipients clicked a link, regardless of whether they opened first." },
  { key: "ctor",             label: "CTOR",            defaultVisible: false, filterable: false, description: "Click-to-Open Rate: Clicks ÷ Opens × 100. Measures email content effectiveness among openers." },
  { key: "bounce_count",     label: "Bounces",         defaultVisible: false, filterable: false, description: "Emails that could not be delivered. Bounced addresses are automatically added to the suppression list." },
  { key: "bounce_rate",      label: "Bounce Rate",     defaultVisible: true,  filterable: false, description: "Bounces ÷ Total Recipients × 100. A high bounce rate damages sender reputation." },
  { key: "unsubscribe_count",label: "Unsubscribes",    defaultVisible: false, filterable: false, description: "Recipients who clicked the unsubscribe link. These are automatically suppressed from future sends." },
  { key: "unsubscribe_rate", label: "Unsub Rate",      defaultVisible: true,  filterable: false, description: "Unsubscribes ÷ Delivered × 100. Tracks opt-out rate per campaign." },
  { key: "delivered_count",  label: "Delivered",       defaultVisible: false, filterable: false, description: "Emails confirmed as delivered to the recipient's inbox by the email service provider." },
  { key: "sent_at",          label: "Sent Date",       defaultVisible: true,  filterable: false },
];

function AnalyticsTab() {
  const { t } = usePreferences();
  const [search, setSearch]   = useState("");
  const [filters, setFilters] = useState({});
  const [colOrder, setColOrder]   = useState(() => EDM_ANALYTICS_COLS.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(EDM_ANALYTICS_COLS.filter(c => !c.defaultVisible).map(c => c.key)));
  // Period + compare selections persist across refresh (localStorage).
  const [dateFrom, setDateFrom] = useStickyState("", "edmAnalytics.dateFrom");
  const [dateTo, setDateTo]     = useStickyState("", "edmAnalytics.dateTo");
  const [compare, setCompare]   = useStickyState(false, "edmAnalytics.compare");
  const [cmpFrom, setCmpFrom]   = useStickyState("", "edmAnalytics.cmpFrom");
  const [cmpTo, setCmpTo]       = useStickyState("", "edmAnalytics.cmpTo");
  const [sortKey, setSortKey]   = useState("sent_at");
  const [sortDir, setSortDir]   = useState("desc");
  const [selected, setSelected] = useState(new Set());

  const setFilter = (k, v) => { setFilters(p => ({ ...p, [k]: v })); setSelected(new Set()); };
  const toggleCol = (k) => setHiddenCols(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else if (colOrder.filter(x => !n.has(x)).length > 1) n.add(k); return n; });
  const moveCol   = (k, d) => setColOrder(p => { const i = p.indexOf(k); if (i<0) return p; const n=[...p]; if(d==="up"&&i>0)[n[i-1],n[i]]=[n[i],n[i-1]]; else if(d==="down"&&i<p.length-1)[n[i],n[i+1]]=[n[i+1],n[i]]; return n; });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["edm-campaigns"],
    queryFn: () => appClient.edm.listCampaigns(),
  });

  const inRange = (c, f, t) => {
    if (f && c.sent_at && new Date(c.sent_at) < new Date(f)) return false;
    if (t && c.sent_at && new Date(c.sent_at) > new Date(t + "T23:59:59")) return false;
    return true;
  };
  const sent = campaigns.filter(c => c.status === "sent" && inRange(c, dateFrom, dateTo));

  const totalSent   = sent.reduce((s, c) => s + (c.total_recipients || 0), 0);
  const totalOpens  = sent.reduce((s, c) => s + (c.open_count || 0), 0);
  const totalClicks = sent.reduce((s, c) => s + (c.click_count || 0), 0);
  const avgOpenRate  = totalSent > 0 ? Math.round((totalOpens  / totalSent) * 100) : 0;
  const avgClickRate = totalSent > 0 ? Math.round((totalClicks / totalSent) * 100) : 0;

  // Comparison period (client-side, same campaign list filtered to the prev range).
  const prevSent    = compare ? campaigns.filter(c => c.status === "sent" && inRange(c, cmpFrom, cmpTo)) : [];
  const pTotalSent  = prevSent.reduce((s, c) => s + (c.total_recipients || 0), 0);
  const pOpens      = prevSent.reduce((s, c) => s + (c.open_count || 0), 0);
  const pClicks     = prevSent.reduce((s, c) => s + (c.click_count || 0), 0);
  const pAvgOpen    = pTotalSent > 0 ? Math.round((pOpens  / pTotalSent) * 100) : 0;
  const pAvgClick   = pTotalSent > 0 ? Math.round((pClicks / pTotalSent) * 100) : 0;

  const enriched = sent.map(c => ({
    ...c,
    open_rate:        c.total_recipients > 0 ? `${Math.round((c.open_count  / c.total_recipients) * 100)}%` : "0%",
    click_rate:       c.total_recipients > 0 ? `${Math.round((c.click_count / c.total_recipients) * 100)}%` : "0%",
    bounce_rate:      c.total_recipients > 0 ? `${((c.bounce_count||0)      / c.total_recipients * 100).toFixed(1)}%` : "0%",
    unsubscribe_rate: (c.delivered_count||c.total_recipients) > 0 ? `${((c.unsubscribe_count||0) / (c.delivered_count||c.total_recipients) * 100).toFixed(1)}%` : "0%",
    ctor:             (c.open_count||0) > 0 ? `${((c.click_count||0) / c.open_count * 100).toFixed(1)}%` : "0%",
  }));

  const filtered = enriched.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.subject?.toLowerCase().includes(search.toLowerCase())) return false;
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      if (!String(c[key] ?? "").toLowerCase().includes(val.toLowerCase())) return false;
    }
    return true;
  });

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === "string" && av.endsWith("%")) av = parseFloat(av) || 0;
    if (typeof bv === "string" && bv.endsWith("%")) bv = parseFloat(bv) || 0;
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return - 1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : - cmp;
  });

  // Column definitions with translated labels/descriptions for on-screen display.
  const localizedCols = EDM_ANALYTICS_COLS.map(c => ({
    ...c,
    label: t(c.label),
    ...(c.description ? { description: t(c.description) } : {}),
  }));
  const visibleCols = colOrder.filter(k => !hiddenCols.has(k)).map(k => localizedCols.find(c => c.key === k)).filter(Boolean);

  // Selection helpers
  const allIds       = sortedFiltered.map(c => c.id);
  const allSelected  = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = allIds.some(id => selected.has(id));
  const toggleRow    = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll    = () => {
    if (allSelected) setSelected(prev => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n; });
    else             setSelected(prev => { const n = new Set(prev); allIds.forEach(id => n.add(id)); return n; });
  };

  const exportCsv = (onlySelected = false) => {
    const rows = onlySelected ? sortedFiltered.filter(c => selected.has(c.id)) : sortedFiltered;
    if (!rows.length) return;
    const header = visibleCols.map(c => c.label).join(",");
    const body = rows.map(row => visibleCols.map(c => {
      const v = c.key === "sent_at" ? (row.sent_at ? format(new Date(row.sent_at), "MMM d, yyyy") : "") : String(row[c.key] ?? "");
      return v.includes(",") ? `"${v}"` : v;
    }).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = onlySelected ? "email-analytics-selected.csv" : "email-analytics.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>;
  }

  return (
    <TooltipProvider>
      <div className="px-8 py-6 space-y-6">

        {/* ── Date period + compare bar (shared AnalyticsKit) ── */}
        <DateRangeBar
          t={t}
          from={dateFrom} to={dateTo}
          onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
          compare={compare} setCompare={setCompare}
          compareRange={{ from: cmpFrom, to: cmpTo }}
          onCompareChange={({ from, to }) => { setCmpFrom(from); setCmpTo(to); }}
          note={(dateFrom || dateTo)
            ? `${sent.length} ${sent.length !== 1 ? t("campaigns in range") : t("campaign in range")}`
            : undefined}
        />

        {/* ── KPI tiles (shared AnalyticsKit) ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile label={t("Emails Sent")} value={sent.length} sub={t("campaigns")} icon={Send}
            curr={compare ? sent.length : undefined} prev={compare ? prevSent.length : undefined} prevDisplay={prevSent.length} />
          <KpiTile label={t("Total Recipients")} value={totalSent.toLocaleString()} sub={t("across all sends")} icon={Users}
            curr={compare ? totalSent : undefined} prev={compare ? pTotalSent : undefined} prevDisplay={pTotalSent.toLocaleString()} />
          <KpiTile label={t("Avg Open Rate")} value={`${avgOpenRate}%`} sub={`${totalOpens.toLocaleString()} ${t("opens")}`} icon={Eye}
            curr={compare ? avgOpenRate : undefined} prev={compare ? pAvgOpen : undefined} prevDisplay={`${pAvgOpen}%`} isRate />
          <KpiTile label={t("Avg Click Rate")} value={`${avgClickRate}%`} sub={`${totalClicks.toLocaleString()} ${t("clicks")}`} icon={MousePointerClick}
            curr={compare ? avgClickRate : undefined} prev={compare ? pAvgClick : undefined} prevDisplay={`${pAvgClick}%`} isRate />
        </div>

        {sent.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-foreground mb-1">{t("No data yet")}</p>
            <p className="text-xs">{t("Send your first email to start seeing analytics.")}</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("Sent Emails - Performance")}</p>
              <TableToolbar
                search={search} onSearch={v => { setSearch(v); setSelected(new Set()); }}
                columns={localizedCols} colOrder={colOrder} hiddenCols={hiddenCols}
                onToggleCol={toggleCol} onMoveCol={moveCol}
                filters={filters} onFilter={setFilter}
                resultCount={sortedFiltered.length} totalCount={sent.length}
                placeholder={t("Search campaign name or subject...")}
              />

              {/* Selection toolbar */}
              {selected.size > 0 && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
                  <span className="font-medium text-sm flex-shrink-0">{selected.size} {t("selected")}</span>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      size="sm" variant="secondary"
                      className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                      onClick={() => exportCsv(true)}
                    >
                      {t("Export CSV")}
                    </Button>
                  </div>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0"
                  >
                    {t("Clear")}
                  </button>
                </div>
              )}

              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/20">
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={toggleAll}
                        />
                      </th>
                      {visibleCols.map(col => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                        >
                          {col.description ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1">
                                  {col.label}
                                  <Info className="w-3 h-3 opacity-40" />
                                  {sortKey === col.key
                                    ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                                    : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-52 text-center leading-relaxed">
                                {col.description}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {sortKey === col.key
                                ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                                : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiltered.map(c => {
                      const isSelected = selected.has(c.id);
                      return (
                      <tr
                        key={c.id}
                        className={`border-b border-border last:border-0 cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/10"}`}
                        onClick={() => toggleRow(c.id)}
                      >
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded border-border"
                            checked={isSelected}
                            onChange={() => toggleRow(c.id)}
                          />
                        </td>
                        {visibleCols.map(col => {
                          switch (col.key) {
                            case "name":             return <td key={col.key} className="px-4 py-2"><p className="font-medium truncate max-w-[220px]">{c.name}</p></td>;
                            case "subject":          return <td key={col.key} className="px-4 py-2 text-xs text-muted-foreground max-w-[200px] truncate">{c.subject}</td>;
                            case "segment_name":     return <td key={col.key} className="px-4 py-2 text-xs text-muted-foreground">{c.segment_name || "-"}</td>;
                            case "total_recipients": return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.total_recipients||0).toLocaleString()}</td>;
                            case "open_count":       return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.open_count||0).toLocaleString()}</td>;
                            case "open_rate":        return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{c.open_rate}</td>;
                            case "click_count":      return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.click_count||0).toLocaleString()}</td>;
                            case "click_rate":       return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{c.click_rate}</td>;
                            case "ctor":             return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{c.ctor}</td>;
                            case "bounce_count":     return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.bounce_count||0).toLocaleString()}</td>;
                            case "bounce_rate":      return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{c.bounce_rate}</td>;
                            case "unsubscribe_count":return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.unsubscribe_count||0).toLocaleString()}</td>;
                            case "unsubscribe_rate": return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{c.unsubscribe_rate}</td>;
                            case "delivered_count":  return <td key={col.key} className="px-4 py-2 text-right tabular-nums text-sm text-muted-foreground">{(c.delivered_count||0).toLocaleString()}</td>;
                            case "sent_at":          return <td key={col.key} className="px-4 py-2 text-right text-muted-foreground text-xs whitespace-nowrap">{c.sent_at ? format(new Date(c.sent_at), "MMM d, yyyy") : "-"}</td>;
                            default:                 return <td key={col.key} className="px-4 py-2 text-xs text-muted-foreground">{String(c[col.key] ?? "-")}</td>;
                          }
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Segment comparison */}
            {(() => {
              const segments = {};
              sortedFiltered.forEach(c => {
                const seg = c.segment_name || t("All Customers");
                if (!segments[seg]) segments[seg] = { opens: [], clicks: [], count: 0 };
                segments[seg].opens.push(parseFloat(c.open_rate)||0);
                segments[seg].clicks.push(parseFloat(c.click_rate)||0);
                segments[seg].count++;
              });
              const segEntries = Object.entries(segments).map(([name, d]) => ({
                name,
                count: d.count,
                avgOpen: (d.opens.reduce((a,b)=>a+b,0)/d.opens.length).toFixed(1),
                avgClick: (d.clicks.reduce((a,b)=>a+b,0)/d.clicks.length).toFixed(1),
              })).sort((a,b) => b.avgOpen - a.avgOpen);
              if (segEntries.length < 2) return null;
              return (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("Segment Comparison")}</p>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-secondary/20">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">{t("Segment")}</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">{t("Campaigns")}</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">{t("Avg Open Rate")}</th>
                          <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">{t("Avg Click Rate")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {segEntries.map(s => (
                          <tr key={s.name} className="border-b border-border last:border-0 hover:bg-secondary/10">
                            <td className="px-4 py-2 text-sm font-medium">{s.name}</td>
                            <td className="px-4 py-2 text-right text-sm text-muted-foreground">{s.count}</td>
                            <td className="px-4 py-2 text-right text-sm text-muted-foreground">{s.avgOpen}%</td>
                            <td className="px-4 py-2 text-right text-sm text-muted-foreground">{s.avgClick}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ── Suppression tab ───────────────────────────────────────────────────────────

const SUPP_COLS = [
  { key: "email",    label: "Email",      defaultVisible: true,  filterable: true,  type: "text" },
  { key: "reason",   label: "Reason",     defaultVisible: true,  filterable: true,  type: "select", options: ["bounced","complained","unsubscribed","manual"] },
  { key: "added_at", label: "Added Date", defaultVisible: true,  filterable: false },
];

function SuppressionTab({ onRegisterOpen }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [search, setSearch]     = useState("");
  const [filters, setFilters]   = useState({});
  const [colOrder, setColOrder]   = useState(() => SUPP_COLS.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(SUPP_COLS.filter(c => !c.defaultVisible).map(c => c.key)));
  const [addOpen, setAddOpen]   = useState(false);
  const [addMode, setAddMode]   = useState("single"); // "single" | "import"
  const [addEmail, setAddEmail] = useState("");
  const [addReason, setAddReason] = useState("manual");
  const [customReason, setCustomReason] = useState("");
  const [importRows, setImportRows]     = useState(null); // { valid, duplicates, invalid }
  const [importFileName, setImportFileName] = useState("");
  const [importResults, setImportResults] = useState(null); // { added, duplicates, invalid }
  const importInputRef = useRef(null);
  const [selected, setSelected] = useState(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);

  const effectiveReason = addReason === "__custom__" ? customReason.trim() : addReason;

  useEffect(() => { onRegisterOpen?.(() => setAddOpen(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetAdd = () => {
    setAddOpen(false);
    setAddMode("single");
    setAddEmail(""); setAddReason("manual"); setCustomReason("");
    setImportRows(null); setImportFileName(""); setImportResults(null);
  };

  const [sortKey, setSortKey] = useState("added_at");
  const [sortDir, setSortDir] = useState("desc");
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (k, v) => { setFilters(p => ({ ...p, [k]: v })); setSelected(new Set()); };
  const toggleCol = (k) => setHiddenCols(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else if (colOrder.filter(x => !n.has(x)).length > 1) n.add(k); return n; });
  const moveCol   = (k, d) => setColOrder(p => { const i = p.indexOf(k); if (i<0) return p; const n=[...p]; if(d==="up"&&i>0)[n[i-1],n[i]]=[n[i],n[i-1]]; else if(d==="down"&&i<p.length-1)[n[i],n[i+1]]=[n[i+1],n[i]]; return n; });

  const { data: suppressed = [], isLoading } = useQuery({
    queryKey: ["edm-suppression"],
    queryFn: () => appClient.edm.listSuppression(),
  });

  // Column definitions with translated labels for on-screen display.
  const localizedSuppCols = SUPP_COLS.map(c => ({ ...c, label: t(c.label) }));

  const addMutation = useMutation({
    mutationFn: ({ email, reason }) => appClient.edm.addSuppression(email, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-suppression"] });
      resetAdd();
      toast.success(t("Added to suppression list"));
    },
    onError: (e) => toast.error(e.message),
  });

  const importMutation = useMutation({
    mutationFn: (entries) => appClient.edm.importSuppression(entries),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["edm-suppression"] });
      setImportResults({
        added: res?.added ?? (importRows?.valid.length ?? 0),
        duplicates: importRows?.duplicates.length ?? 0,
        invalid: importRows?.invalid.length ?? 0,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkRemoveMutation = useMutation({
    mutationFn: (emails) => appClient.edm.bulkRemoveSuppression(emails),
    onSuccess: (_, emails) => {
      qc.invalidateQueries({ queryKey: ["edm-suppression"] });
      setSelected(new Set());
      setConfirmRemove(false);
      toast.success(`${emails.length} ` + (emails.length !== 1 ? t("emails removed from suppression list") : t("email removed from suppression list")));
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = suppressed.filter(s => {
    if (search && !s.email.toLowerCase().includes(search.toLowerCase())) return false;
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      if (String(s[key] ?? "").toLowerCase() !== val.toLowerCase()) return false;
    }
    return true;
  });

  const visibleCols = colOrder.filter(k => !hiddenCols.has(k)).map(k => localizedSuppCols.find(c => c.key === k)).filter(Boolean);

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return - 1;
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : - cmp;
  });

  // Selection helpers
  const allSelected  = sortedFiltered.length > 0 && sortedFiltered.every(s => selected.has(s.email));
  const someSelected = sortedFiltered.some(s => selected.has(s.email));
  const toggleRow    = (email) => setSelected(p => { const n = new Set(p); n.has(email) ? n.delete(email) : n.add(email); return n; });
  const toggleAll    = () => {
    if (allSelected) setSelected(p => { const n = new Set(p); sortedFiltered.forEach(s => n.delete(s.email)); return n; });
    else setSelected(p => { const n = new Set(p); sortedFiltered.forEach(s => n.add(s.email)); return n; });
  };

  const buildCsv = (rows) => {
    const header = visibleCols.map(c => c.label).join(",");
    const body = rows.map(s => visibleCols.map(c => {
      const v = c.key === "added_at" ? (s.added_at ? format(new Date(s.added_at), "MMM d, yyyy") : "") : String(s[c.key] ?? "");
      return v.includes(",") ? `"${v}"` : v;
    }).join(",")).join("\n");
    return `${header}\n${body}`;
  };

  const exportCsv = (onlySelected = false) => {
    const rows = onlySelected ? filtered.filter(s => selected.has(s.email)) : filtered;
    if (!rows.length) return;
    const blob = new Blob([buildCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = onlySelected ? "suppression-selected.csv" : "email-suppression.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── Import-from-file helpers ──────────────────────────────────────────────
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Parse a CSV/TXT file into { valid, duplicates, invalid }.
  // Accepts "email,reason" rows or one email per line. Skips a leading header
  // row, dedups within the file, and skips emails already on the list.
  const parseEmailFile = (text) => {
    const existing = new Set(suppressed.map(s => String(s.email).toLowerCase()));
    const seen = new Set();
    const valid = [], duplicates = [], invalid = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim();
      if (!raw) return;
      const cols = raw.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const email = cols[0].toLowerCase();
      if (i === 0 && (email === "email" || email === "email address")) return; // header
      if (!EMAIL_RE.test(email)) { invalid.push(cols[0]); return; }
      if (existing.has(email) || seen.has(email)) { duplicates.push(email); return; }
      seen.add(email);
      valid.push({ email, reason: (cols[1] || "manual").toLowerCase() });
    });
    return { valid, duplicates, invalid };
  };

  const processImportFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportFileName(file.name);
      setImportRows(parseEmailFile(text));
    } catch {
      toast.error(t("Could not read that file"));
    }
  };

  const clearImportFile = () => { setImportFileName(""); setImportRows(null); };

  const downloadTemplate = () => {
    const csv = "email,reason\njohn@example.com,manual\njane@example.com,unsubscribed\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "suppression-import-template.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="px-8 py-6">
      <TableToolbar
        search={search} onSearch={v => { setSearch(v); setSelected(new Set()); }}
        columns={localizedSuppCols} colOrder={colOrder} hiddenCols={hiddenCols}
        onToggleCol={toggleCol} onMoveCol={moveCol}
        filters={filters} onFilter={setFilter}
        resultCount={filtered.length} totalCount={suppressed.length}
        placeholder={t("Search suppressed emails...")}
      />

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
          <span className="font-medium text-sm flex-shrink-0">{selected.size} {t("selected")}</span>
          <div className="flex items-center gap-1 ml-2">
            <Button
              size="sm" variant="secondary"
              className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
              onClick={() => setConfirmRemove(true)}
              disabled={bulkRemoveMutation.isPending}
            >
              {t("Delete")}
            </Button>
            <Button
              size="sm" variant="secondary"
              className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
              onClick={() => exportCsv(true)}
            >
              {t("Export CSV")}
            </Button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0"
          >
            {t("Clear")}
          </button>
        </div>
      )}

      {/* Add to suppression modal */}
      <Dialog open={addOpen} onOpenChange={(v) => { if (!v) resetAdd(); else setAddOpen(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Add to Suppression List")}</DialogTitle>
          </DialogHeader>

          {/* Mode toggle */}
          {!importResults && (
            <div className="flex gap-0.5 p-0.5 bg-secondary/40 rounded-lg">
              {[["single", t("Single email")], ["import", t("Import file")]].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setAddMode(k)}
                  className={`flex-1 h-8 text-xs font-medium rounded-md transition-colors ${
                    addMode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {addMode === "single" ? (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Email address")} <span className="text-destructive">*</span></Label>
                <Input
                  value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="h-9 text-sm"
                  onKeyDown={e => e.key === "Enter" && addEmail && effectiveReason && addMutation.mutate({ email: addEmail.trim(), reason: effectiveReason })}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Reason")}</Label>
                <select
                  value={addReason}
                  onChange={e => setAddReason(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="manual">{t("Manual")}</option>
                  <option value="bounced">{t("Bounced")}</option>
                  <option value="complained">{t("Complained")}</option>
                  <option value="unsubscribed">{t("Unsubscribed")}</option>
                  <option value="__custom__">{t("Other (custom)...")}</option>
                </select>
                {addReason === "__custom__" && (
                  <Input
                    value={customReason}
                    onChange={e => setCustomReason(e.target.value)}
                    placeholder={t("Enter custom reason...")}
                    className="mt-2 h-9 text-sm"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4 mt-1">
              {!importResults ? (
                <>
                  {/* Step 1 - Download the template */}
                  <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {t("Step 1 - Download the template")}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("Fill in the emails to suppress using the CSV template.")} <strong>email</strong> {t("is required;")} <strong>reason</strong> {t("is optional. Duplicate and already-suppressed emails are skipped automatically.")}
                    </p>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
                      <FileDown className="w-3.5 h-3.5" /> {t("Download Template CSV")}
                    </Button>
                  </div>

                  {/* Step 2 - Upload your filled CSV */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> {t("Step 2 - Upload your filled CSV")}</p>
                    <div
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                      onClick={() => importInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); processImportFile(e.dataTransfer.files[0]); }}
                    >
                      <input ref={importInputRef} type="file" accept=".csv,.txt" className="hidden"
                        onChange={e => { processImportFile(e.target.files[0]); e.target.value = ""; }} />
                      {importFileName ? (
                        <div className="flex items-center justify-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-foreground" />
                          <span className="font-medium">{importFileName}</span>
                          <button onClick={e => { e.stopPropagation(); clearImportFile(); }} className="text-muted-foreground hover:text-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          <Upload className="w-5 h-5 mx-auto mb-1 opacity-40" />
                          {t("Click to select CSV or drag and drop")}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Live preview of parsed file */}
                  {importRows && (
                    <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1 text-[11px]">
                      <div className="flex items-center gap-1.5 text-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="font-medium">{importRows.valid.length}</span> {importRows.valid.length !== 1 ? t("new emails ready to import") : t("new email ready to import")}
                      </div>
                      {importRows.duplicates.length > 0 && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Info className="w-3.5 h-3.5" /> {importRows.duplicates.length} {importRows.duplicates.length !== 1 ? t("duplicates skipped (already on list or repeated)") : t("duplicate skipped (already on list or repeated)")}
                        </div>
                      )}
                      {importRows.invalid.length > 0 && (
                        <div className="flex items-center gap-1.5 text-destructive">
                          <XCircle className="w-3.5 h-3.5" /> {importRows.invalid.length} {importRows.invalid.length !== 1 ? t("invalid emails skipped") : t("invalid email skipped")}
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full gap-1.5"
                    disabled={!importRows?.valid.length || importMutation.isPending}
                    onClick={() => importRows?.valid.length && importMutation.mutate(importRows.valid)}
                  >
                    {importMutation.isPending
                      ? t("Importing…")
                      : <><Upload className="w-3.5 h-3.5" /> {t("Import")}{importRows?.valid.length ? ` ${importRows.valid.length}` : ""} {importRows?.valid.length !== 1 ? t("Emails") : t("Email")}</>}
                  </Button>
                </>
              ) : (
                /* Import complete */
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-foreground" />
                    <span className="font-medium text-sm">{t("Import complete")}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                      <p className="text-2xl font-bold">{importResults.added}</p>
                      <p className="text-[11px] text-muted-foreground">{t("Imported")}</p>
                    </div>
                    <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                      <p className="text-2xl font-bold">{importResults.duplicates}</p>
                      <p className="text-[11px] text-muted-foreground">{t("Duplicates")}</p>
                    </div>
                    <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                      <p className="text-2xl font-bold">{importResults.invalid}</p>
                      <p className="text-[11px] text-muted-foreground">{t("Invalid")}</p>
                    </div>
                  </div>
                  <Button className="w-full" onClick={resetAdd}>{t("Done")}</Button>
                </div>
              )}
            </div>
          )}

          {addMode === "single" && (
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={resetAdd}>{t("Cancel")}</Button>
              <Button
                size="sm"
                onClick={() => addEmail && effectiveReason && addMutation.mutate({ email: addEmail.trim(), reason: effectiveReason })}
                disabled={!addEmail.trim() || !effectiveReason || addMutation.isPending}
              >
                {addMutation.isPending ? t("Adding...") : t("Add to List")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm bulk remove */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove")} {selected.size} {selected.size !== 1 ? t("emails from suppression list?") : t("email from suppression list?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("These emails will be eligible to receive future campaigns again. This cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkRemoveMutation.mutate([...selected])}
              disabled={bulkRemoveMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkRemoveMutation.isPending ? t("Removing…") : t("Remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading && <div className="flex items-center justify-center py-10"><div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>}

      {!isLoading && filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground border border-border rounded-lg">
          <ShieldOff className="w-8 h-8 mx-auto mb-2 opacity-20" />
          {t("No suppressed emails")}
        </div>
      )}

      {!isLoading && sortedFiltered.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                  />
                </th>
                {visibleCols.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key
                        ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                        : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(s => {
                const isSelected = selected.has(s.email);
                return (
                  <tr
                    key={s.email}
                    className={`border-b border-border last:border-0 cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/10"}`}
                    onClick={() => toggleRow(s.email)}
                  >
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={isSelected}
                        onChange={() => toggleRow(s.email)}
                      />
                    </td>
                    {visibleCols.map(col => {
                      switch (col.key) {
                        case "email":    return <td key={col.key} className="px-4 py-2.5 text-sm font-mono">{s.email}</td>;
                        case "reason":   return <td key={col.key} className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{s.reason}</td>;
                        case "added_at": return <td key={col.key} className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{s.added_at ? format(new Date(s.added_at), "MMM d, yyyy") : "-"}</td>;
                        default: return <td key={col.key} className="px-4 py-2.5 text-xs text-muted-foreground">{String(s[col.key] ?? "-")}</td>;
                      }
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function EDM() {
  const { t } = usePreferences();
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
      toast.success(t("Email saved as draft"));
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.edm.updateCampaign(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-campaigns"] });
      setEditTarget(null);
      setEditorOpen(false);
      toast.success(t("Email updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (formData) => {
    if (editTarget?.id) updateMutation.mutate({ id: editTarget.id, data: formData });
    else createMutation.mutate(formData);
  };

  const templateCreateMutation = useMutation({
    mutationFn: (data) => appClient.edm.createTemplate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-templates"] });
      setTemplateEditorOpen(false);
      setTemplateEditTarget(null);
      toast.success(t("Template saved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const templateUpdateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.edm.updateTemplate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edm-templates"] });
      setTemplateEditorOpen(false);
      setTemplateEditTarget(null);
      toast.success(t("Template updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const handleTemplateSave = (data) => {
    if (templateEditTarget?.id) templateUpdateMutation.mutate({ id: templateEditTarget.id, data });
    else templateCreateMutation.mutate(data);
  };

  // "Use Template" from a saved template card - pre-fill a new email from it
  const handleUseTemplateCard = (t) => handleUseTemplate({
    name: t.name,
    subject: t.subject || "",
    html_body: t.html_body || "",
    blocks: t.variables?._blocks,
    container: t.variables?._container,
    htmlMode: t.variables?._html_mode || false,
  });

  // "Use Template" - close template editor, switch to Emails tab, open campaign editor pre-filled
  const handleUseTemplate = ({ name, subject, html_body, blocks, container, htmlMode }) => {
    setTemplateEditorOpen(false);
    setTemplateEditTarget(null);
    setTab("emails");
    setEditorOpen(true);
    setEditTarget({
      name: `Email from ${name}`,
      subject,
      html_body,
      ab_test_config: { _blocks: blocks, _container: container, _html_mode: htmlMode },
    });
  };

  const openCreate = () => { setEditTarget(null); setEditorOpen(true); };
  const openEdit   = (c)  => { setEditTarget(c);    setEditorOpen(true); };
  const openTemplateCreate = () => { setTemplateEditTarget(null); setTemplateEditorOpen(true); };

  const suppressionOpenerRef = useRef(null);
  const openTemplateEdit   = (t)  => { setTemplateEditTarget(t);    setTemplateEditorOpen(true); };
  const openTemplateImport = (initialData) => { setTemplateEditTarget(initialData); setTemplateEditorOpen(true); };

  const { canUseFeatures } = usePlan();

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Email")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("Build, send, and track marketing emails.")}</p>
          </div>
          {tab === "emails" && canUseFeatures && (
            <Button size="sm" className="gap-1.5 h-9" onClick={openCreate}>
              <Plus className="w-3.5 h-3.5" /> {t("New Email")}
            </Button>
          )}
          {tab === "templates" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={openTemplateCreate}>
              <Plus className="w-3.5 h-3.5" /> {t("New Template")}
            </Button>
          )}
          {tab === "suppression" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => suppressionOpenerRef.current?.()}>
              <Plus className="w-3.5 h-3.5" /> {t("Add Email")}
            </Button>
          )}
        </div>

        <div className="flex border-b border-border gap-6">
          {TABS.map(tabItem => {
            const Icon = tabItem.icon;
            return (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === tabItem.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tabItem.label)}
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
            onUse={handleUseTemplateCard}
            onEdit={openTemplateEdit}
            onImport={openTemplateImport}
          />
        )}
        {tab === "analytics"  && <AnalyticsTab />}
        {tab === "suppression" && <SuppressionTab onRegisterOpen={fn => { suppressionOpenerRef.current = fn; }} />}
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
        onUseTemplate={handleUseTemplate}
        initial={templateEditTarget}
      />
    </div>
  );
}
