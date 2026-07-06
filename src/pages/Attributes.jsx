import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Tag, Globe, SlidersHorizontal, UserCog, MoreHorizontal, Trash2, Pencil,
  RefreshCw, Check, GitMerge, AlertCircle, Loader2, ExternalLink, Play,
  Search, RotateCcw, Ban, FlaskConical, ChevronLeft, ListChecks, X, Layers,
  FileText, Upload, ArrowRight, Download,
  Filter, ArrowUp, ArrowDown, ChevronDown, ChevronUp, ChevronRight, ChevronsUpDown, ChevronsDownUp, History, Sparkles, Undo2, BarChart2, Clock,
  Copy, Lock, RotateCw, CheckCheck,
  Users, Mail, MousePointer2, Lightbulb,
} from "lucide-react";
import { useStickyState } from "@/lib/useStickyState";
import { usePreferences } from "@/lib/PreferencesContext";
import { useRole } from "@/lib/useRole";
import AttributesAnalyticsPanel from "@/components/attributes/AttributesAnalyticsPanel";
import AttributeImportDialog from "@/components/attributes/AttributeImportDialog";
import PageGuide from "@/components/PageGuide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { replenishmentStatusOptions } from "@/lib/predictionLabels";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

const SOURCES = {
  web_content: { label: "Content", icon: Globe, desc: "The AI reads your website and tags each page; visitors inherit those tags from the pages they viewed - including anonymous visitors." },
  manual:      { label: "Manual",  icon: UserCog, desc: "Assign attribute values to specific people by hand or via CSV upload." },
  rule:        { label: "Rule",    icon: SlidersHorizontal, desc: "Compute attribute values from a condition over profile fields (age, location, activity…)." },
  analytics:   { label: "Analytics", icon: BarChart2, desc: "Coverage & health across your targeting dimensions." },
};
const TABS = ["web_content", "manual", "rule", "analytics"];
const ACTIVE_JOB = (j) => j && (j.status === "queued" || j.status === "running");
// Percent-decode URLs for display so Chinese (and any non-ASCII) reads naturally.
const decodeUrl = (u) => { try { return decodeURIComponent(u || ""); } catch { return u || ""; } };

// Status groups for the card grid (mirrors the EDM / Pop-up pages).
const STATUS_GROUPS = [
  { key: "active",   label: "Active",   filter: (a) => a.status === "active" },
  { key: "draft",    label: "Drafts",   filter: (a) => a.status === "draft" },
  { key: "archived", label: "Archived", filter: (a) => a.status === "archived" },
];

// Lightweight normalized edit-distance similarity (0..1) used to flag near-duplicate
// values in the review queue ("Britain" ≈ "Britian"/"Great Britain").
function similarity(a, b) {
  a = (a || "").toLowerCase().trim(); b = (b || "").toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[m][n] / Math.max(m, n);
}
// Closest approved sibling to a pending value, above a confidence threshold.
function closestMatch(value, candidates, threshold = 0.72) {
  let best = null, bestScore = threshold;
  for (const c of candidates) {
    const label = c.display_label || c.value || "";
    const s = similarity(value, label);
    if (s > bestScore && s < 1) { bestScore = s; best = c; }
  }
  return best;
}

// ── Live job status banner ────────────────────────────────────
function JobStatus({ job, onCancel, compact }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!job) return null;
  const p = job.progress || {};
  const phaseLabel = {
    queued: t("Queued…"), discovering: t("Discovering pages…"),
    scraping: t("Crawling pages…"), crawling: t("Crawling pages…"),
    tagging: t("Tagging with AI…"), propagating: t("Updating profiles…"), done: t("Done"),
  }[job.phase] || job.phase || job.status;

  if (job.status === "failed") {
    return <div className="text-[11px] text-destructive flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {t("Last run failed:")} {job.error_message}</div>;
  }
  // Completed but the run left a note (e.g. nothing to crawl / no active attributes) - surface why.
  if (job.status === "completed" && p.note) {
    return <div className="text-[11px] text-muted-foreground flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {p.note}</div>;
  }
  if (!ACTIVE_JOB(job)) return null;

  const counts = [
    p.pages_total != null && `${p.pages_crawled || 0}/${p.pages_total} ${t("crawled")}`,
    p.pages_tagged ? `${p.pages_tagged} ${t("tagged")}` : null,
    p.values_found ? `${p.values_found} ${t("values")}` : null,
    p.profiles_tagged ? `${p.profiles_tagged} ${t("profiles")}` : null,
  ].filter(Boolean).join(" · ");

  const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
  const start = job.started_at || job.created_date;
  const elapsed = start ? Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000)) : null;
  let eta = null;
  if (job.phase === "scraping" && p.pages_total && (p.pages_crawled || 0) >= 5 && elapsed > 0) {
    const rate = p.pages_crawled / elapsed;
    const remaining = Math.max(0, p.pages_total - p.pages_crawled);
    if (rate > 0) { const s = Math.round(remaining / rate); eta = s >= 60 ? `~${Math.ceil(s / 60)}${t("m left")}` : `~${s}${t("s left")}`; }
  }

  return (
    <>
      <div className={`flex items-center gap-2 ${compact ? "text-[11px]" : "text-xs"} text-muted-foreground`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground" />
        <span className="font-medium text-foreground">{phaseLabel}</span>
        {counts && <span>· {counts}</span>}
        {elapsed != null && <span>· {fmt(elapsed)} {t("elapsed")}</span>}
        {eta && <span className="text-foreground">· {eta}</span>}
        {onCancel && <button onClick={() => setConfirmCancel(true)} disabled={!canWrite} className={`ml-1 hover:text-foreground underline ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>{t("cancel")}</button>}
      </div>

      {/* Cancelling stops the run mid-flight: AI tagging + profile updates for this
          run won't be applied, and the progress shown here resets to a fresh run. */}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><AlertCircle className="w-4 h-4 text-foreground" /> {t("Cancel this run?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("This will stop this run right away. The AI tagging and profile updates for this run won't be applied, and you'll have to start a brand-new run to finish - the progress shown here resets to zero.")}
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(false)}>{t("Keep running")}</Button>
            <Button variant="default" size="sm" disabled={!canWrite} onClick={() => { setConfirmCancel(false); onCancel?.(); }}>{t("Cancel run")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Reminder shown in a detail view while the attribute isn't Active - its values
// aren't applied to customers (in segments, pop-ups, or on profiles) until then.
function StatusReminder({ status }) {
  const { t } = usePreferences();
  if (status === "active") return null;
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 mt-3 flex items-start gap-2 text-xs">
      <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <span>{t("This attribute is")} <strong>{status === "archived" ? t("Archived") : t("Draft")}</strong> - {t("set the status to")} <strong>{t("Active")}</strong> {t("to apply its values to customers (in Segments, Pop-ups, and on Profiles).")}</span>
    </div>
  );
}

// Standard action bar shared by the Manual & Rule detail views so both pages
// behave identically: a Status select (Draft/Active/Archived) on the left and a
// Save button on the right. The status select stages a pending value - nothing is
// persisted until Save. Save is enabled only when something actually changed
// (status, details, or tags) via `dirty`. Save persists everything at once; the
// parent applies (recomputes tags onto profiles) only when the status is Active.
function AttributeActionBar({ status, onStatusChange, lastRun, onSave, dirty, saving, saveTitle }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  return (
    <div className="flex items-center justify-between gap-3 mt-3 pb-3 border-b border-border">
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={onStatusChange} disabled={saving}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{t("Draft")}</SelectItem>
            <SelectItem value="active">{t("Active")}</SelectItem>
            <SelectItem value="archived">{t("Archived")}</SelectItem>
          </SelectContent>
        </Select>
        {lastRun && <span className="text-[11px] text-muted-foreground">{t("Updated")} {formatDistanceToNow(new Date(lastRun), { addSuffix: true })}</span>}
      </div>
      <Button size="sm" className="h-8 gap-1.5" disabled={!dirty || saving || !canWrite} onClick={onSave} title={!canWrite ? t("Viewers can't make changes") : saveTitle}>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {t("Save")}
      </Button>
    </div>
  );
}

// ── Create / edit attribute form ──────────────────────────────
const EMPTY = { name: "", description: "", source: "web_content", value_type: "multi", scope: "both", extract_from: "both", status: "draft" };

// Default extraction prompt generated from the attribute name.
const defaultPrompt = (name) =>
  name.trim() ? `If any ${name.trim()} is found in the text, extract it. The value can be in English or Chinese.` : "";

const parseValues = (text) =>
  text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);

function AttributeForm({ initial, onSubmit, isPending, submitLabel, defaultSource }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [form, setForm] = useState(initial || {
    ...EMPTY,
    source: defaultSource || "web_content",
    value_type: defaultSource === "rule" ? "single" : "multi",
    scope: defaultSource === "rule" ? "customer" : "both",
  });
  // Once the user edits the instruction by hand, stop auto-deriving it from the name.
  const [descTouched, setDescTouched] = useState(!!initial);
  const [valuesText, setValuesText] = useState("");
  const isBehavioral = form.source === "web_content";
  const isRule = form.source === "rule";
  const isManual = form.source === "manual";

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setName = (name) =>
    setForm((f) => ({ ...f, name, description: !descTouched && isBehavioral ? defaultPrompt(name) : f.description }));
  const setDescription = (description) => { setDescTouched(true); setForm((f) => ({ ...f, description })); };

  const submit = () => onSubmit({
    ...form,
    name: form.name.trim(),
    description: form.description.trim() || (isBehavioral ? defaultPrompt(form.name) : ""),
    ...((isBehavioral || isManual) && !initial ? { values: parseValues(valuesText) } : {}),
  });

  return (
    <div className="space-y-4 mt-2">
      <div>
        <Label className="text-xs">{t("Attribute name")}</Label>
        <Input value={form.name} onChange={(e) => setName(e.target.value)}
          placeholder={t("e.g. Country")} className="mt-1" />
      </div>

      <div>
        <Label className="text-xs">{isBehavioral ? t("AI instruction") : t("Description")}</Label>
        <Textarea value={form.description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1"
          placeholder={isBehavioral ? defaultPrompt(form.name) || t("If any … is found in the text, extract it.") : t("Describe what this attribute represents.")} />
        {isBehavioral && <p className="text-[11px] text-muted-foreground mt-1">{t("Auto-filled from the name - edit if you need to. After saving, use")} <strong>{t("Test")}</strong> {t("to preview results before a full run.")}</p>}
      </div>

      {isManual && (
        <div>
          <Label className="text-xs">{t("Values per person")}</Label>
          <Select value={form.value_type} onValueChange={(v) => set("value_type", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">{t("Single")}</SelectItem>
              <SelectItem value="multi">{t("Multiple")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {isRule && (
        <div>
          <Label className="text-xs">{t("Applies to")}</Label>
          <Select value={form.scope === "anonymous" ? "anonymous" : "customer"} onValueChange={(v) => set("scope", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">{t("Customers")}</SelectItem>
              <SelectItem value="anonymous">{t("Anonymous visitors")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">{t("Which profiles this rule evaluates and tags.")}</p>
        </div>
      )}

      {isRule && <p className="text-[11px] text-muted-foreground">{t("You'll build the rules after creating.")}</p>}

      {isBehavioral && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">{t("Extract from")}</Label>
            <Select value={form.extract_from} onValueChange={(v) => set("extract_from", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{t("Title & content")}</SelectItem>
                <SelectItem value="title">{t("Title only")}</SelectItem>
                <SelectItem value="content">{t("Content only")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Values per page")}</Label>
            <Select value={form.value_type} onValueChange={(v) => set("value_type", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="multi">{t("Multiple")}</SelectItem>
                <SelectItem value="single">{t("Single")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isBehavioral && !initial && (
        <div>
          <Label className="text-xs">{t("Expected values")} <span className="text-muted-foreground font-normal">{t("(optional)")}</span></Label>
          <Textarea value={valuesText} onChange={(e) => setValuesText(e.target.value)} rows={3} className="mt-1"
            placeholder={t("One per line or comma-separated, e.g.") + "\nEngland\nAustralia\nCanada"} />
          <p className="text-[11px] text-muted-foreground mt-1">{t("Your known vocabulary. The AI prefers these; anything it finds")} <strong>{t("outside")}</strong> {t("this list goes to")} <strong>{t("Review")}</strong> {t("for you to keep or reject.")}</p>
        </div>
      )}

      {isManual && !initial && (
        <div>
          <Label className="text-xs">{t("Values")} <span className="text-muted-foreground font-normal">{t("(optional)")}</span></Label>
          <Textarea value={valuesText} onChange={(e) => setValuesText(e.target.value)} rows={3} className="mt-1"
            placeholder={t("One per line or comma-separated, e.g.") + "\nVIP\nStandard"} />
          <p className="text-[11px] text-muted-foreground mt-1">{t("The set of values you'll assign. You can add more later, then assign people from a segment, search, or a list.")}</p>
        </div>
      )}

      <Button className="w-full" disabled={!form.name.trim() || isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={submit}>
        {submitLabel}
      </Button>
    </div>
  );
}

// ── Value → pages drill-down (why does this value exist?) ─────
function ValuePages({ valueId }) {
  const { t } = usePreferences();
  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["value-pages", valueId],
    queryFn: () => appClient.attributes.valuePages(valueId),
  });
  if (isLoading) return <p className="text-[11px] text-muted-foreground py-1">{t("Loading pages…")}</p>;
  if (!pages.length) return <p className="text-[11px] text-muted-foreground py-1">{t("No pages carry this value (it may be curated or merged).")}</p>;
  return (
    <div className="space-y-0.5 py-1">
      <p className="text-[10px] text-muted-foreground">{t("Found on")} {pages.length} {pages.length === 1 ? t("page") : t("pages")}:</p>
      {pages.slice(0, 15).map((pg) => (
        <a key={pg.id} href={pg.url} target="_blank" rel="noreferrer"
          className="block text-[11px] text-muted-foreground hover:text-foreground truncate">
          · {pg.title || decodeUrl(pg.url)}
        </a>
      ))}
      {pages.length > 15 && <p className="text-[10px] text-muted-foreground">+ {pages.length - 15} {t("more")}</p>}
    </div>
  );
}

// ── Value row in the detail dialog ────────────────────────────
function ValueRow({
  value, siblings, onApprove, onMerge, onDelete, canDelete = true, canMerge = true,
  groupDimensions = [], groupsByDim = {}, onSetGroup,
  selectable, selected, onToggleSelect, suggestion, onAcceptSuggestion,
}) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [showPages, setShowPages] = useState(false);
  const pending = value.is_exception && !value.is_approved;
  const mergeTargets = canMerge ? siblings.filter((s) => s.id !== value.id && s.is_approved && !s.merged_into) : [];
  return (
    <div>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/40 group">
        {selectable && (
          <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect?.(value)} className="accent-foreground flex-shrink-0" />
        )}
        <button onClick={() => setShowPages((s) => !s)} title={t("Show the pages this value came from")}
          className="text-sm flex-1 truncate text-left flex items-center gap-1 hover:underline min-w-0">
          <ChevronDown className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform ${showPages ? "" : "-rotate-90"}`} />
          <span className="truncate">{value.display_label || value.value}</span>
        </button>
        {pending && <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-yellow-500/50 text-yellow-600">{t("review")}</Badge>}
        {value.is_approved && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{t("approved")}</Badge>}
        <span className="text-[10px] text-muted-foreground tabular-nums w-20 text-right flex-shrink-0">
          {value.page_count || 0} {t("pg")} · {value.profile_count || 0} {t("ppl")}
        </span>
        {suggestion && onAcceptSuggestion && (
          <button title={t("Looks like") + ` "${suggestion.display_label || suggestion.value}" - ` + t("merge into it")}
            onClick={() => onAcceptSuggestion(value, suggestion)} disabled={!canWrite}
            className={`text-[10px] px-1.5 py-0.5 rounded-full border border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/10 whitespace-nowrap flex items-center gap-1 flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
            <GitMerge className="w-3 h-3" /> {suggestion.display_label || suggestion.value}?
          </button>
        )}
        {value.is_approved && groupDimensions.map((dim) => {
          const cur = value.group_map?.[dim];
          const single = groupDimensions.length === 1;
          return (
            <DropdownMenu key={dim}>
              <DropdownMenuTrigger asChild>
                <button disabled={!canWrite} className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${cur ? "border-border text-foreground" : "border-dashed border-border text-muted-foreground"} hover:text-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
                  {cur ? (single ? cur : `${dim}: ${cur}`) : `+ ${dim}`}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
                {(groupsByDim[dim] || []).map((g) => (
                  <DropdownMenuItem key={g} onClick={() => onSetGroup(value, dim, g)}>{g}</DropdownMenuItem>
                ))}
                {(groupsByDim[dim] || []).length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => { const g = window.prompt(`${t("New")} ${dim} ${t("group")}`); if (g && g.trim()) onSetGroup(value, dim, g.trim()); }}>{t("New group…")}</DropdownMenuItem>
                {cur && <DropdownMenuItem onClick={() => onSetGroup(value, dim, null)}>{t("Clear")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {pending && (
            <button title={t("Approve")} onClick={() => onApprove(value)} disabled={!canWrite} className={`p-1 hover:text-foreground text-muted-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Check className="w-3.5 h-3.5" /></button>
          )}
          {mergeTargets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button title={t("Merge into…")} disabled={!canWrite} className={`p-1 hover:text-foreground text-muted-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><GitMerge className="w-3.5 h-3.5" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
                <p className="text-[10px] text-muted-foreground px-2 py-1">{t("Merge into")}</p>
                {mergeTargets.map((t) => (
                  <DropdownMenuItem key={t.id} onClick={() => onMerge(value, t.id)}>{t.display_label || t.value}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canDelete && (
            <button title={t("Delete")} onClick={() => onDelete(value)} disabled={!canWrite} className={`p-1 hover:text-destructive text-muted-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>
      {showPages && <div className="pl-7 pr-2 pb-1.5"><ValuePages valueId={value.id} /></div>}
    </div>
  );
}

// ── Merged value row (folded into a canonical value) ──────────
function MergedValueRow({ value, target, targets, onUnmerge, onChangeTarget }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/40 group">
      <span className="text-sm truncate text-muted-foreground line-through max-w-[40%]">{value.display_label || value.value}</span>
      <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-sm flex-1 truncate font-medium">{target ? (target.display_label || target.value) : <span className="text-muted-foreground italic">{t("unknown")}</span>}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {targets.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title={t("Change merge target")} disabled={!canWrite} className={`p-1 hover:text-foreground text-muted-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><GitMerge className="w-3.5 h-3.5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
              <p className="text-[10px] text-muted-foreground px-2 py-1">{t("Merge into instead")}</p>
              {targets.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => onChangeTarget(value, t.id)}>{t.display_label || t.value}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button title={t("Un-merge (restore as its own value)")} onClick={() => onUnmerge(value)} disabled={!canWrite} className={`p-1 hover:text-foreground text-muted-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Undo2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

// ── Run history list ──────────────────────────────────────────
function JobHistory({ jobs }) {
  const { t } = usePreferences();
  if (!jobs.length) return <p className="text-[11px] text-muted-foreground py-2">{t("No runs yet.")}</p>;
  const statusColor = { completed: "text-foreground", failed: "text-destructive", cancelled: "text-muted-foreground", running: "text-foreground", queued: "text-muted-foreground" };
  return (
    <div className="space-y-1">
      {jobs.map((j) => {
        const p = j.progress || {};
        const counts = [
          p.pages_crawled != null && `${p.pages_crawled} ${t("crawled")}`,
          p.pages_tagged ? `${p.pages_tagged} ${t("tagged")}` : null,
          p.values_found ? `${p.values_found} ${t("values")}` : null,
          p.profiles_tagged ? `${p.profiles_tagged} ${t("profiles")}` : null,
        ].filter(Boolean).join(" · ");
        const when = j.completed_at || j.started_at || j.created_date;
        return (
          <div key={j.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-border/60 last:border-0">
            <span className={`font-medium capitalize w-16 flex-shrink-0 ${statusColor[j.status] || "text-muted-foreground"}`}>{j.status}</span>
            <span className="text-muted-foreground flex-1 truncate">{counts || (j.error_message ? j.error_message : "-")}</span>
            {when && <span className="text-muted-foreground flex-shrink-0">{formatDistanceToNow(new Date(when), { addSuffix: true })}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Add-group modal (create an empty group under the dimension) ──
function AddGroupDialog({ open, onClose, dimension, existing = [], onAdd }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [name, setName] = useState("");
  const dim = dimension || "group";
  const trimmed = name.trim();
  const dupe = existing.some((g) => g.toLowerCase() === trimmed.toLowerCase());
  const submit = () => { if (trimmed && !dupe) { onAdd(trimmed); setName(""); onClose(); } };
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setName(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="font-heading">{t("New")} {dim}</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div>
            <Label className="text-xs">{dim} {t("name")}</Label>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. ${dim === "Continent" ? "Europe" : dim}`} className="mt-1"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            {dupe && <p className="text-[11px] text-destructive mt-1">{t("A group called")} “{trimmed}” {t("already exists.")}</p>}
            <p className="text-[11px] text-muted-foreground mt-1">{t("Creates an empty")} {dim.toLowerCase()} - {t("assign values to it from each value's group menu.")}</p>
          </div>
          <Button className="w-full" disabled={!trimmed || dupe || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={submit}>{t("Add")} {dim.toLowerCase()}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Attribute detail (inline panel) ───────────────────────────
// Dry-run Test tab: manage a sample link pool (GA top-50 or manual upload) and
// run the AI extraction against a selection, a one-off URL, or top crawled pages.
function TestTab({
  testLinks, testResults, testUrl, setTestUrl,
  testMut, linkModeMut, selectLinkMut, delLinkMut,
}) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const links = testLinks?.links || [];
  const max = testLinks?.max || 50;
  const refreshMode = testLinks?.refresh_mode || "static";
  const selectedCount = links.filter((l) => l.is_selected).length;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        {t("Dry-run - see what the AI would extract; nothing is saved. Test one specific URL, or pick from your crawled pages below and run on them.")}
      </p>

      {/* One-off URL + run buttons */}
      <div className="flex flex-wrap gap-2">
        <Input value={testUrl} onChange={(e) => setTestUrl(decodeUrl(e.target.value))}
          placeholder={t("Optional: https://… a specific page")} className="h-8 text-sm flex-1 min-w-[14rem]" />
        <Button size="sm" variant="outline" className="h-8" disabled={testMut.isPending || !testUrl.trim()}
          onClick={() => testMut.mutate({ url: testUrl.trim() })}>
          {testMut.isPending && !testMut.variables?.use_test_links ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Test page")}
        </Button>
        <Button size="sm" className="h-8 gap-1.5" disabled={testMut.isPending || selectedCount === 0}
          onClick={() => testMut.mutate({ use_test_links: true })} title={selectedCount === 0 ? t("Select some pages first") : ""}>
          {testMut.isPending && testMut.variables?.use_test_links ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {t("Run on")} {selectedCount} {t("selected")}
        </Button>
      </div>

      {/* Pages to test against - top GA pages, topped up with random crawled pages */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Test pages")} · {links.length}/{max}</p>
          <button onClick={() => linkModeMut.mutate(refreshMode === "daily" ? "static" : "daily")} disabled={!canWrite}
            className={`text-[11px] px-2 py-1 rounded-md border ${refreshMode === "daily" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"} ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}
            title={t("Re-pull the GA top pages automatically each day")}>
            {t("Refresh daily:")} {refreshMode === "daily" ? t("on") : t("off")}
          </button>
        </div>

        {/* Select-all / clear */}
        {links.length > 0 && (
          <div className="flex items-center gap-3 text-[11px]">
            <button disabled={!canWrite} className={`text-muted-foreground hover:text-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`} onClick={() => selectLinkMut.mutate({ ids: null, is_selected: true })}>{t("Select all")}</button>
            <button disabled={!canWrite} className={`text-muted-foreground hover:text-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`} onClick={() => selectLinkMut.mutate({ ids: null, is_selected: false })}>{t("Clear")}</button>
            <span className="text-muted-foreground ml-auto">{selectedCount} {t("selected for the dry-run")}</span>
          </div>
        )}

        {/* Link list */}
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            {t("No pages yet. Click")} <strong>{t("Crawl pages")}</strong> {t("to load pages to test against.")}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-2 py-1.5 group">
                <input type="checkbox" checked={l.is_selected} disabled={!canWrite} className="accent-foreground flex-shrink-0"
                  onChange={() => selectLinkMut.mutate({ ids: [l.id], is_selected: !l.is_selected })} />
                <div className="min-w-0 flex-1">
                  {l.title && <p className="text-xs font-medium truncate" title={l.title}>{l.title}</p>}
                  <p className={`truncate ${l.title ? "text-[10px] text-muted-foreground" : "text-xs"}`} title={decodeUrl(l.url)}>{decodeUrl(l.url)}</p>
                </div>
                <button onClick={() => delLinkMut.mutate(l.id)} disabled={!canWrite} title={t("Remove from the set")} className={`opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive flex-shrink-0 ${!canWrite ? "pointer-events-none" : ""}`}><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {testResults?.note && <p className="text-[11px] text-muted-foreground">{testResults.note}</p>}
      {testResults?.samples?.length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Results")} · {testResults.samples.length}</p>
          {testResults.samples.map((s, i) => (
            <div key={i} className="text-[11px] border-t border-border pt-2 first:border-0 first:pt-0">
              <p className="font-medium truncate">{s.title || decodeUrl(s.url)}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {s.error
                  ? <span className="text-destructive italic">{s.error}</span>
                  : s.values?.length
                    ? s.values.map((v) => <span key={v} className="px-2 py-0.5 rounded-full bg-background border border-border">{v}</span>)
                    : <span className="text-muted-foreground italic">{t("no values")}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttributeDetail({ attributeId, onBack, onEdit, onClone }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState("values");
  const [newValue, setNewValue] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [valueSearch, setValueSearch] = useState("");
  const [pageSearch, setPageSearch] = useState("");       // Tagged-pages tab search
  const [pageValueSel, setPageValueSel] = useState([]);   // Tagged-pages tab value filter (multi)
  const [newDimension, setNewDimension] = useState("");   // add-dimension input
  const [extraGroups, setExtraGroups] = useState({});     // manually-created empty groups, keyed by dimension
  const [addGroupDim, setAddGroupDim] = useState(null);   // which dimension the Add-group dialog targets
  const [reviewSel, setReviewSel] = useState(() => new Set()); // selected review-queue values for bulk actions
  const [approvedSel, setApprovedSel] = useState(() => new Set()); // selected approved values for bulk merge/group
  const [showHistory, setShowHistory] = useState(false);

  const { data: attr } = useQuery({
    queryKey: ["attribute", attributeId],
    queryFn: () => appClient.attributes.get(attributeId),
    enabled: !!attributeId,
  });
  const { data: job } = useQuery({
    queryKey: ["attribute-job", attributeId],
    queryFn: () => appClient.attributes.latestJob(attributeId),
    enabled: !!attributeId,
    refetchInterval: (q) => (ACTIVE_JOB(q.state.data) ? 2000 : false),
  });
  const { data: pages = [] } = useQuery({
    queryKey: ["attribute-pages", attributeId],
    queryFn: () => appClient.attributes.pages(attributeId),
    enabled: !!attributeId && tab === "pages",
  });
  const { data: history = [] } = useQuery({
    queryKey: ["attribute-jobs", attributeId],
    queryFn: () => appClient.attributes.jobs(attributeId, 8),
    enabled: !!attributeId && showHistory,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["attribute", attributeId] });
    qc.invalidateQueries({ queryKey: ["attributes"] });
  };
  const refetchJob = () => qc.invalidateQueries({ queryKey: ["attribute-job", attributeId] });

  const runMut = useMutation({
    mutationFn: () => appClient.attributes.run(attributeId),
    onSuccess: () => { toast.success(t("Reconstruct started")); refetchJob(); },
    onError: (e) => toast.error(e.message),
  });
  const statusMut = useMutation({
    mutationFn: (status) => appClient.attributes.update(attributeId, { status }),
    onSuccess: invalidate,
  });
  const addValueMut = useMutation({
    mutationFn: (v) => appClient.attributes.addValue(attributeId, v),
    onSuccess: () => {
      setNewValue(""); invalidate();
      if (attr?.group_dimensions?.length) toast.warning(t("Assign this value to a group in the Groups tab."));
    },
    onError: (e) => toast.error(e.message),
  });
  const approveMut = useMutation({ mutationFn: (id) => appClient.attributes.updateValue(id, { is_approved: true }), onSuccess: invalidate });
  const mergeMut = useMutation({ mutationFn: ({ id, target }) => appClient.attributes.mergeValue(id, target), onSuccess: () => { toast.success(t("Merged")); invalidate(); } });
  const unmergeMut = useMutation({ mutationFn: (id) => appClient.attributes.unmergeValue(id), onSuccess: () => { toast.success(t("Un-merged")); invalidate(); }, onError: (e) => toast.error(e.message) });
  const delValueMut = useMutation({ mutationFn: (id) => appClient.attributes.deleteValue(id), onSuccess: invalidate });
  const BULK_VERB = { approve: t("approved"), reject: t("rejected"), merge: t("merged"), set_group: t("grouped") };
  const bulkMut = useMutation({
    mutationFn: ({ ids, action, extra }) => appClient.attributes.bulkValues(ids, action, extra),
    onSuccess: (r, { ids, action }) => {
      setReviewSel(new Set()); setApprovedSel(new Set()); invalidate();
      const n = r?.updated ?? ids.length;
      toast.success(`${n} ${n === 1 ? t("value") : t("values")} ${BULK_VERB[action] || t("updated")}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const untagMut = useMutation({
    mutationFn: ({ pageId, valueId }) => appClient.attributes.deletePageTag(pageId, valueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attribute-pages", attributeId] }); invalidate(); },
  });
  const addDimensionMut = useMutation({
    mutationFn: (name) => appClient.attributes.addDimension(attributeId, name),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const renameDimensionMut = useMutation({
    mutationFn: ({ oldName, newName }) => appClient.attributes.renameDimension(attributeId, oldName, newName),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const removeDimensionMut = useMutation({
    mutationFn: (name) => appClient.attributes.removeDimension(attributeId, name),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const autogroupMut = useMutation({
    mutationFn: (dimension) => appClient.attributes.autogroup(attributeId, dimension),
    onSuccess: (r) => { toast.success(`${t("Grouped")} ${r.grouped} ${r.grouped === 1 ? t("value") : t("values")}`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const setGroupMut = useMutation({
    mutationFn: ({ id, dimension, group_value }) => appClient.attributes.updateValue(id, { dimension, group_value }),
    onSuccess: invalidate,
  });
  const testMut = useMutation({
    mutationFn: (body) => appClient.attributes.test(attributeId, body),
    onSuccess: (data) => setTestResults(data),
    onError: (e) => toast.error(e.message),
  });
  const cloneMut = useMutation({
    mutationFn: () => appClient.attributes.clone(attributeId),
    onSuccess: (clone) => { toast.success(t("Cloned to a new draft")); qc.invalidateQueries({ queryKey: ["attributes"] }); onClone?.(clone); },
    onError: (e) => toast.error(e.message),
  });

  // ── Test-link set (managed dry-run pool) ──
  const { data: testLinks } = useQuery({
    queryKey: ["attribute-test-links"],
    queryFn: () => appClient.attributes.testLinks(),
    enabled: tab === "test",
  });
  const invalidateTestLinks = () => qc.invalidateQueries({ queryKey: ["attribute-test-links"] });
  const linkModeMut = useMutation({
    mutationFn: (mode) => appClient.attributes.testLinkSettings(mode),
    onSuccess: invalidateTestLinks,
  });
  const selectLinkMut = useMutation({
    mutationFn: ({ ids, is_selected }) => appClient.attributes.selectTestLinks(ids, is_selected),
    onSuccess: invalidateTestLinks,
  });
  const delLinkMut = useMutation({
    mutationFn: (id) => appClient.attributes.deleteTestLink(id),
    onSuccess: invalidateTestLinks,
  });

  const values = attr?.values || [];
  const pending = values.filter((v) => v.is_exception && !v.is_approved && !v.merged_into && !v.is_blocked);
  const approved = values.filter((v) => v.is_approved && !v.merged_into);
  const merged = values.filter((v) => v.merged_into);
  const valueById = Object.fromEntries(values.map((v) => [v.id, v]));
  const dimensions = attr?.group_dimensions || [];
  const groupingEnabled = dimensions.length > 0;
  // Groups present per dimension, unioned with any manually-added empty groups.
  const groupsByDim = Object.fromEntries(dimensions.map((dim) => {
    const present = approved.map((v) => v.group_map?.[dim]).filter(Boolean);
    const extra = extraGroups[dim] || [];
    return [dim, [...new Set([...present, ...extra])].sort()];
  }));
  const setGroup = (v, dim, g) => setGroupMut.mutate({ id: v.id, dimension: dim, group_value: g });
  const toggleReview = (v) => setReviewSel((s) => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; });
  const toggleApproved = (v) => setApprovedSel((s) => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; });
  // Near-duplicate suggestion per pending value: closest approved sibling.
  const dupSuggestion = (v) => closestMatch(v.display_label || v.value, approved);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 w-fit">
        <ChevronLeft className="w-3.5 h-3.5" /> {t("All attributes")}
      </button>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading text-lg font-semibold">{attr?.name || t("Attribute")}</h2>
        {attr && onEdit && <button onClick={() => onEdit(attr)} title={t("Edit settings")} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>}
        {attr && onClone && (
          <button onClick={() => cloneMut.mutate()} disabled={cloneMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : t("Clone into a new draft")} className={`text-muted-foreground hover:text-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Copy className="w-3.5 h-3.5" /></button>
        )}
      </div>

      {attr && (
        <div>
          <p className="text-xs text-muted-foreground">{attr.description}</p>

          {/* Settings summary: extract source + values-per-page + dates (+ lock) */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
            <span>{t("Extract from")}: <strong className="text-foreground">{t(EXTRACT_LABEL[attr.extract_from] || attr.extract_from)}</strong></span>
            <span>{t("Values per page")}: <strong className="text-foreground">{attr.value_type === "single" ? t("Single") : t("Multiple")}</strong></span>
            {attr.content_applied && (
              <span className="inline-flex items-center gap-1 text-yellow-600" title={t("Values are applied to content. Clone to change Extract from / Values per page.")}>
                <Lock className="w-3 h-3" /> {t("locked")}
              </span>
            )}
            {attr.created_date && <span>{t("Created")} {format(new Date(attr.created_date), "MMM d, yyyy")}</span>}
            {attr.updated_date && attr.updated_date !== attr.created_date && (
              <span>{t("Updated")} {formatDistanceToNow(new Date(attr.updated_date), { addSuffix: true })}</span>
            )}
          </div>

            {/* Action bar */}
            <div className="flex items-center justify-between gap-3 mt-3 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Select value={attr.status} onValueChange={(v) => statusMut.mutate(v)} disabled={!canWrite}>
                  <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t("Draft")}</SelectItem>
                    <SelectItem value="active">{t("Active")}</SelectItem>
                    <SelectItem value="archived">{t("Archived")}</SelectItem>
                  </SelectContent>
                </Select>
                {attr.last_run_date && <span className="text-[11px] text-muted-foreground">{t("Last run")} {formatDistanceToNow(new Date(attr.last_run_date), { addSuffix: true })}</span>}
              </div>
              {attr.source === "web_content" && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowHistory((s) => !s)} title={t("Run history")}>
                    <History className="w-3.5 h-3.5" /> {t("History")}
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5" disabled={ACTIVE_JOB(job) || runMut.isPending || !canWrite}
                    title={!canWrite ? t("Viewers can't make changes") : attr.status === "active"
                      ? t("Re-tag your crawled pages and update targeting.")
                      : t("Tag your crawled pages so you can preview and verify results. Values only reach profiles once this attribute is Active.")}
                    onClick={() => runMut.mutate()}>
                    <RefreshCw className="w-3.5 h-3.5" /> {t("Reconstruct")}
                  </Button>
                </div>
              )}
            </div>

            <StatusReminder status={attr.status} />

            {/* Run history */}
            {showHistory && attr.source === "web_content" && (
              <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Recent runs")}</p>
                <JobHistory jobs={history} />
              </div>
            )}

            <div className="py-2"><JobStatus job={job} onCancel={() => appClient.attributes.cancelJob(job.id).then(refetchJob)} compact /></div>

            {/* Tabs (Test sits between Values and Groups) */}
            <div className="flex gap-4 border-b border-border text-sm">
              {[["values", `${t("Values")} (${approved.length})`], ...(attr.source === "web_content" ? [["test", t("Test")]] : []), ["groups", dimensions.length ? `${t("Groups")} (${dimensions.length})` : t("Groups")], ["pages", t("Tagged pages")]].map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`pb-2 border-b-2 transition-colors ${tab === k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto pt-3">
              {tab === "values" ? (
                <div className="space-y-4">
                  {/* Add curated value */}
                  <div className="flex gap-2">
                    <Input value={newValue} onChange={(e) => setNewValue(e.target.value)}
                      placeholder={t("Add a known value (e.g. England)")} className="h-8 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter" && newValue.trim()) addValueMut.mutate(newValue.trim()); }} />
                    <Button size="sm" variant="outline" className="h-8" disabled={!newValue.trim() || addValueMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                      onClick={() => addValueMut.mutate(newValue.trim())}>{t("Add")}</Button>
                  </div>

                  {/* Review queue */}
                  {pending.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-yellow-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> {t("Review queue")} · {pending.length}
                        </p>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setReviewSel((s) => s.size === pending.length ? new Set() : new Set(pending.map((v) => v.id)))}
                            className="text-[11px] text-muted-foreground hover:text-foreground">
                            {reviewSel.size === pending.length ? t("Clear") : t("Select all")}
                          </button>
                          {reviewSel.size > 0 && (
                            <>
                              <span className="text-[11px] text-muted-foreground">{reviewSel.size} {t("selected")}</span>
                              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={bulkMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                                onClick={() => bulkMut.mutate({ ids: [...reviewSel], action: "approve" })}>
                                <Check className="w-3 h-3" /> {t("Approve")}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" disabled={bulkMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                                onClick={() => bulkMut.mutate({ ids: [...reviewSel], action: "reject" })}>
                                <Ban className="w-3 h-3" /> {t("Reject")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-1">{t("AI-discovered values. They don't affect targeting until approved. Amber chips suggest a likely duplicate to merge into.")}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-6">
                        {pending.map((v) => (
                          <ValueRow key={v.id} value={v} siblings={values}
                            selectable selected={reviewSel.has(v.id)} onToggleSelect={toggleReview}
                            suggestion={dupSuggestion(v)} onAcceptSuggestion={(x, t) => mergeMut.mutate({ id: x.id, target: t.id })}
                            onApprove={(x) => approveMut.mutate(x.id)}
                            onMerge={(x, t) => mergeMut.mutate({ id: x.id, target: t })}
                            onDelete={(x) => delValueMut.mutate(x.id)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Approved values - flat, searchable, bulk merge/group */}
                  {(() => {
                    const shown = approved.filter((v) => !valueSearch || (v.display_label || v.value).toLowerCase().includes(valueSearch.toLowerCase()));
                    const mergeTargets = approved.filter((v) => !approvedSel.has(v.id));
                    const allShownSel = shown.length > 0 && shown.every((v) => approvedSel.has(v.id));
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Approved values")} · {approved.length}</p>
                          <div className="flex items-center gap-2">
                            {approved.length > 1 && (
                              <button onClick={() => setApprovedSel(allShownSel ? new Set() : new Set(shown.map((v) => v.id)))}
                                className="text-[11px] text-muted-foreground hover:text-foreground">
                                {allShownSel ? t("Clear") : t("Select all")}
                              </button>
                            )}
                            {approved.length > 8 && (
                              <div className="relative w-44">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                                <input value={valueSearch} onChange={(e) => setValueSearch(e.target.value)} placeholder={t("Search values…")}
                                  className="w-full h-7 pl-7 pr-2 text-xs bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bulk action bar */}
                        {approvedSel.size > 0 && (
                          <div className="flex items-center gap-2 flex-wrap mb-2 px-2 py-1.5 rounded-md border border-border bg-secondary/30">
                            <span className="text-[11px] text-muted-foreground">{approvedSel.size} {t("selected")}</span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={bulkMut.isPending || !mergeTargets.length || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}>
                                  <GitMerge className="w-3 h-3" /> {t("Merge into…")}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                                <p className="text-[10px] text-muted-foreground px-2 py-1">{t("Fold")} {approvedSel.size} {approvedSel.size === 1 ? t("value") : t("values")} {t("into")}</p>
                                {mergeTargets.map((t) => (
                                  <DropdownMenuItem key={t.id} onClick={() => bulkMut.mutate({ ids: [...approvedSel], action: "merge", extra: { target_id: t.id } })}>
                                    {t.display_label || t.value}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            {dimensions.map((dim) => (
                              <DropdownMenu key={dim}>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={bulkMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}>
                                    <Layers className="w-3 h-3" /> {t("Set")} {dim}…
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                                  {(groupsByDim[dim] || []).map((g) => (
                                    <DropdownMenuItem key={g} onClick={() => bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { dimension: dim, group_value: g } })}>{g}</DropdownMenuItem>
                                  ))}
                                  {(groupsByDim[dim] || []).length > 0 && <DropdownMenuSeparator />}
                                  <DropdownMenuItem onClick={() => { const g = window.prompt(`${t("New")} ${dim} ${t("group")}`); if (g && g.trim()) bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { dimension: dim, group_value: g.trim() } }); }}>{t("New group…")}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { dimension: dim, group_value: null } })}>{t("Clear")} {dim}</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ))}
                            <button onClick={() => setApprovedSel(new Set())} className="text-[11px] text-muted-foreground hover:text-foreground ml-auto">{t("Cancel")}</button>
                          </div>
                        )}

                        {approved.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
                            {t("No values yet. Add known values above, or run a reconstruct to discover them from your pages.")}
                          </p>
                        ) : !shown.length ? (
                          <p className="text-xs text-muted-foreground py-4 text-center">{t("No values match that search.")}</p>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-x-6">
                            {shown.map((v) => (
                              <ValueRow key={v.id} value={v} siblings={values}
                                selectable selected={approvedSel.has(v.id)} onToggleSelect={toggleApproved}
                                groupDimensions={dimensions} groupsByDim={groupsByDim} onSetGroup={setGroup}
                                onApprove={(x) => approveMut.mutate(x.id)}
                                onMerge={(x, t) => mergeMut.mutate({ id: x.id, target: t })}
                                onDelete={(x) => delValueMut.mutate(x.id)} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Merged values - folded into a canonical value; editable here */}
                  {merged.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Merged")} · {merged.length}</p>
                      <p className="text-[11px] text-muted-foreground mb-1">{t("These values fold into a canonical value for targeting. Change the target or un-merge to restore them.")}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                        {merged.map((v) => (
                          <MergedValueRow key={v.id} value={v} target={valueById[v.merged_into]}
                            targets={approved.filter((t) => t.id !== v.merged_into)}
                            onUnmerge={(x) => unmergeMut.mutate(x.id)}
                            onChangeTarget={(x, t) => mergeMut.mutate({ id: x.id, target: t })} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : tab === "test" ? (
                <TestTab
                  testLinks={testLinks}
                  testResults={testResults}
                  testUrl={testUrl} setTestUrl={setTestUrl}
                  testMut={testMut}
                  linkModeMut={linkModeMut} selectLinkMut={selectLinkMut} delLinkMut={delLinkMut}
                />
              ) : tab === "groups" ? (
                <div className="space-y-3">
                  {/* Grouping dimensions manager */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {dimensions.map((dim) => (
                        <span key={dim} className="h-7 pl-2.5 pr-1 rounded-full bg-secondary/60 border border-border flex items-center gap-1 text-xs">
                          {dim}
                          <button title={t("Rename dimension")} disabled={!canWrite} className={`p-0.5 text-muted-foreground hover:text-foreground ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}
                            onClick={() => { const n = window.prompt(t("Rename dimension"), dim); if (n && n.trim() && n.trim() !== dim) renameDimensionMut.mutate({ oldName: dim, newName: n.trim() }); }}>
                            <Pencil className="w-2.5 h-2.5" />
                          </button>
                          <button title={t("Remove dimension")} disabled={!canWrite} className={`p-0.5 text-muted-foreground hover:text-destructive ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}
                            onClick={() => { if (window.confirm(`${t("Remove the")} "${dim}" ${t("dimension? Values keep their other groups.")}`)) removeDimensionMut.mutate(dim); }}>
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                      <div className="flex items-center gap-1">
                        <Input value={newDimension} onChange={(e) => setNewDimension(e.target.value)}
                          placeholder={t("Add a dimension… e.g. Continent")} className="h-7 text-xs w-64"
                          onKeyDown={(e) => { if (e.key === "Enter" && newDimension.trim()) { addDimensionMut.mutate(newDimension.trim()); setNewDimension(""); } }} />
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" disabled={!newDimension.trim() || addDimensionMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                          onClick={() => { addDimensionMut.mutate(newDimension.trim()); setNewDimension(""); }}>{t("Add a Group")}</Button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("Roll values up into higher-level dimensions (e.g. Country → Continent AND GDP) so you can target a whole group in Segments. Each value takes one group per dimension. To delete a value, use the")} <strong>{t("Values")}</strong> {t("tab.")}</p>
                  </div>

                  {!groupingEnabled ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center">
                      <Layers className="w-7 h-7 text-muted-foreground mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium mb-1">{t("No grouping yet")}</p>
                      <p className="text-xs text-muted-foreground">{t("Add a dimension above (e.g. “Continent”), then")} <strong>{t("Group with AI")}</strong> {t("to organise your")} {approved.length} {approved.length === 1 ? t("value") : t("values")} - {t("or add groups and assign values by hand. Add more than one dimension to group the same values several ways at once.")}</p>
                    </div>
                  ) : approved.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">{t("No values to group yet.")}</p>
                  ) : (
                    dimensions.map((dim) => {
                      const ungrouped = approved.filter((v) => !v.group_map?.[dim]);
                      return (
                        <div key={dim} className="rounded-lg border border-border p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-xs font-semibold flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-muted-foreground" /> {dim}</p>
                            <div className="flex items-center gap-1.5">
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => setAddGroupDim(dim)}>{t("Add a Sub Group")}</Button>
                              <Button size="sm" className="h-7 gap-1 text-xs" disabled={autogroupMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                                onClick={() => autogroupMut.mutate(dim)}>
                                {autogroupMut.isPending && autogroupMut.variables === dim ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("Sub Group with AI")}
                              </Button>
                            </div>
                          </div>

                          {ungrouped.length > 0 && (
                            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2 flex items-start gap-2">
                              <AlertCircle className="w-3.5 h-3.5 text-yellow-600 flex-shrink-0 mt-0.5" />
                              <p className="text-[11px] text-muted-foreground flex-1">
                                <span className="font-medium text-yellow-700">{ungrouped.length} {ungrouped.length === 1 ? t("value") : t("values")}</span> {t("not yet in a")} {dim} {t("group. Assign below, or group automatically - ungrouped values can't be targeted by this dimension.")}
                              </p>
                            </div>
                          )}

                          {[...(groupsByDim[dim] || []), null].map((gname) => {
                            const inGroup = approved.filter((v) => (v.group_map?.[dim] || null) === gname);
                            if (gname === null && !inGroup.length) return null; // hide empty "Ungrouped"
                            const reach = inGroup.reduce((s, v) => s + Number(v.profile_count || 0), 0);
                            return (
                              <div key={gname || "__ungrouped"} className="rounded-md border border-border/70 p-2.5">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-[11px] font-semibold">{gname || t("Ungrouped")}</p>
                                  <span className="text-[10px] text-muted-foreground">{inGroup.length} {inGroup.length === 1 ? t("value") : t("values")}{reach ? ` · ${reach.toLocaleString()} ${t("profile tags")}` : ""}</span>
                                </div>
                                {inGroup.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground">{t("Empty - open a value's")} “{dim}” {t("menu and choose")} “{gname}”.</p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                                    {inGroup.map((v) => (
                                      <ValueRow key={v.id} value={v} siblings={values} groupDimensions={[dim]} groupsByDim={groupsByDim} onSetGroup={setGroup}
                                        canDelete={false} canMerge={false}
                                        onApprove={(x) => approveMut.mutate(x.id)} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (() => {
                // Value filter options = every tag actually present on these pages
                // (verified or not), so users can filter by any tag. Derived from the
                // loaded pages, not just the approved value set.
                const pageValueOpts = (() => {
                  const m = new Map();
                  for (const pg of pages) for (const v of (pg.values || [])) {
                    if (!m.has(v.id)) m.set(v.id, { value: v.id, label: v.value });
                  }
                  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
                })();
                // Client-side search + multi-value filter over the tagged-pages list.
                const shownPages = pages.filter((pg) => {
                  if (pageValueSel.length && !(pg.values || []).some((v) => pageValueSel.includes(v.id))) return false;
                  if (!pageSearch) return true;
                  const q = pageSearch.toLowerCase();
                  return (pg.title || "").toLowerCase().includes(q)
                    || decodeUrl(pg.url).toLowerCase().includes(q)
                    || (pg.values || []).some((v) => (v.value || "").toLowerCase().includes(q));
                });
                return (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">{t("Pages tagged by this attribute, with the values the AI assigned. Remove any wrong tag with the ✕ - it updates targeting immediately.")}</p>
                  {pages.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative flex-1 min-w-[12rem] max-w-xs">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                        <input value={pageSearch} onChange={(e) => setPageSearch(e.target.value)} placeholder={t("Search pages or values…")}
                          className="w-full h-8 pl-7 pr-2 text-xs bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                      {pageValueOpts.length > 0 && (
                        <MultiSelect className="w-52 flex-shrink-0" value={pageValueSel} onChange={setPageValueSel} options={pageValueOpts}
                          placeholder={t("All values")} searchPlaceholder={t("Search values…")} />
                      )}
                      {pageValueSel.length > 0 && (
                        <button onClick={() => setPageValueSel([])} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0">
                          <X className="w-3 h-3" /> {t("Clear")}
                        </button>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto">{shownPages.length} {t("of")} {pages.length}</span>
                    </div>
                  )}
                  {pages.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">{t("No tagged pages yet. Run Reconstruct to tag your crawled pages.")}</p>
                  ) : shownPages.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">{t("No pages match that search.")}</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {shownPages.map((pg) => (
                    <div key={pg.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{pg.title || pg.url}</p>
                          <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate">
                            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
                          </a>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(pg.values || []).map((v) => (
                          <span key={v.id} className="text-[10px] pl-2 pr-1 py-0.5 rounded-full bg-secondary/60 border border-border flex items-center gap-1">
                            {v.value}
                            <button onClick={() => untagMut.mutate({ pageId: pg.id, valueId: v.id })} disabled={!canWrite} title={t("Remove this tag")}
                              className={`text-muted-foreground hover:text-destructive ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                        <AddTag pageId={pg.id} fixedAttr={attr} suggestions={approved.map((v) => v.display_label || v.value)}
                          onAdded={() => { qc.invalidateQueries({ queryKey: ["attribute-pages", attributeId] }); qc.invalidateQueries({ queryKey: ["attr-review-count"] }); invalidate(); }} />
                      </div>
                    </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          </div>
        )}

      <AddGroupDialog open={!!addGroupDim} onClose={() => setAddGroupDim(null)}
        dimension={addGroupDim} existing={addGroupDim ? (groupsByDim[addGroupDim] || []) : []}
        onAdd={(g) => setExtraGroups((p) => ({ ...p, [addGroupDim]: [...new Set([...(p[addGroupDim] || []), g])] }))} />
    </div>
  );
}

// ── Crawled pages sub-tab ─────────────────────────────────────
const PAGE_VIEWS = [["valid", "Valid"], ["changed", "Changed"], ["failed", "Failed"], ["excluded", "Excluded"]];

// Multi-select of attributes for the "Changed pages" re-tag picker.
function AttrPicker({ attrs, selected, onToggle, onAll, t }) {
  const all = attrs.length > 0 && selected.size === attrs.length;
  const label = attrs.length === 0 ? t("No attributes")
    : all ? t("All attributes")
    : selected.size === 0 ? t("Pick attributes")
    : `${selected.size} ${t("attributes")}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-7 px-2 text-xs border border-input rounded-md bg-background inline-flex items-center gap-1 max-w-[12rem] truncate">
          {label} <ChevronDown className="w-3 h-3 flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
        {attrs.length === 0 && <p className="text-[11px] text-muted-foreground px-2 py-1">{t("No active attributes")}</p>}
        {attrs.length > 0 && (
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onAll(); }}>
            <span className="mr-2">{all ? "☑" : "☐"}</span>{t("All attributes")}
          </DropdownMenuItem>
        )}
        {attrs.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={(e) => { e.preventDefault(); onToggle(a.id); }}>
            <span className="mr-2">{selected.has(a.id) ? "☑" : "☐"}</span>{a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Add-exclusions modal: single, paste a list, or upload a file (modeled on EDM's
// "Add to Suppression List"). Patterns are substrings or globs ("/about/*").
function ExclusionsDialog({ open, onClose, existing, onAdd }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [mode, setMode] = useState("single");
  const [single, setSingle] = useState("");
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const fileRef = useRef(null);

  const reset = () => { setMode("single"); setSingle(""); setPaste(""); setFileName(""); setFileText(""); };
  const parse = (text) => text.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const parseFile = (text) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length && /^(pattern|excluded_url_pattern|url|urls)$/i.test(lines[0])) lines.shift(); // drop header
    return lines.flatMap((l) => l.split(",")).map((x) => x.trim()).filter(Boolean);
  };
  const collected = mode === "single" ? (single.trim() ? [single.trim()] : [])
    : mode === "paste" ? parse(paste)
    : parseFile(fileText);
  const fresh = [...new Set(collected.map((p) => decodeUrl(p)))].filter((p) => !existing.includes(p));

  const readFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setFileText(String(e.target?.result || ""));
    reader.readAsText(file);
  };
  const downloadTemplate = () => {
    const csv = "pattern\n/about-company/*\n/careers\nhttps://example.com/legal\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "excluded-urls-template.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  const submit = () => { if (fresh.length) onAdd(fresh); reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">{t("Add exclusion rules")}</DialogTitle></DialogHeader>

        <div className="flex gap-0.5 p-0.5 bg-secondary/40 rounded-lg">
          {[["single", t("Single")], ["paste", t("Paste list")], ["upload", t("Upload file")]].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`flex-1 h-8 text-xs font-medium rounded-md transition-colors ${mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("Substring or glob - e.g.")} <code>/about-company/*</code> {t("excludes that whole section.")}</p>

        {mode === "single" ? (
          <Input value={single} onChange={(e) => setSingle(decodeUrl(e.target.value))} placeholder={t("/path/* or a URL substring")} className="h-9 text-sm" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        ) : mode === "paste" ? (
          <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} className="text-sm"
            placeholder={t("One per line or comma-separated, e.g.") + "\n/about-company/*\n/careers\nhttps://site.com/legal"} />
        ) : (
          <div className="space-y-4">
            {/* Step 1 - Download the template */}
            <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {t("Step 1 - Download the template")}</p>
              <p className="text-[11px] text-muted-foreground">{t("Add one pattern per row under")} <strong>pattern</strong>. {t("Use a substring or a glob like")} <code>/about-company/*</code>.</p>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
                <Download className="w-3.5 h-3.5" /> {t("Download Template CSV")}
              </Button>
            </div>

            {/* Step 2 - Upload your filled CSV */}
            <div className="space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> {t("Step 2 - Upload your filled CSV")}</p>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); }}>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { readFile(e.target.files[0]); e.target.value = ""; }} />
                {fileName ? (
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-foreground" /><span className="font-medium">{fileName}</span>
                    <button onClick={(e) => { e.stopPropagation(); setFileName(""); setFileText(""); }} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-xs"><Upload className="w-5 h-5 mx-auto mb-1 opacity-40" /> {t("Click to select CSV or drag and drop")}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {fresh.length > 0 && <p className="text-[11px] text-muted-foreground">{fresh.length} {fresh.length !== 1 ? t("new patterns ready to add.") : t("new pattern ready to add.")}</p>}
        <Button className="w-full" disabled={!fresh.length || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={submit}>
          {t("Add")}{fresh.length ? ` ${fresh.length}` : ""} {fresh.length === 1 ? t("exclusion") : t("exclusions")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function PagesPanel() {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [view, setView] = useState("valid");
  const [search, setSearch] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [exclOpen, setExclOpen] = useState(false);
  const [changedSel, setChangedSel] = useState(() => new Set());  // selected changed pages
  const [retagAttrs, setRetagAttrs] = useState(() => new Set());  // attributes to re-tag with

  const { data, isLoading } = useQuery({
    queryKey: ["web-pages", view, search],
    queryFn: () => appClient.attributes.webPages({ status: view, search, limit: 200 }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-pages"] });

  // Active behavioral attributes power the "Changed pages" re-tag picker.
  const { data: allAttrs } = useQuery({ queryKey: ["attributes"], queryFn: () => appClient.attributes.list() });
  const activeAttrs = (allAttrs || []).filter((a) => a.source === "web_content" && a.status === "active");
  // Default the picker to all attributes once they load (leave the user's choice alone after).
  useEffect(() => {
    if (activeAttrs.length && retagAttrs.size === 0) setRetagAttrs(new Set(activeAttrs.map((a) => a.id)));
  }, [activeAttrs.length]);
  const toggleSel = (id) => setChangedSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAttr = (id) => setRetagAttrs((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addMut = useMutation({
    mutationFn: (url) => appClient.attributes.addWebPage(url),
    onSuccess: (r) => { setNewUrl(""); invalidate(); r.ok ? toast.success(t("Page added")) : toast.error(t("Couldn't read that page:") + ` ${r.reason || t("no content")}`); },
    onError: (e) => toast.error(e.message),
  });
  const exclMut = useMutation({
    mutationFn: ({ id, is_excluded }) => appClient.attributes.updateWebPage(id, { is_excluded }),
    onSuccess: invalidate,
  });
  const exclFailedMut = useMutation({
    mutationFn: () => appClient.attributes.excludeFailedPages(),
    onSuccess: (r) => { invalidate(); toast.success(`${t("Excluded")} ${r.excluded} ${r.excluded === 1 ? t("page") : t("pages")}`); },
    onError: (e) => toast.error(e.message),
  });
  const rerunMut = useMutation({
    mutationFn: ({ ids, mode }) => appClient.attributes.rerunPages(ids, mode),
    onSuccess: (r) => { invalidate(); toast.success(r.mode === "scrape" ? `${t("Re-scraped")} ${r.rescraped} ${r.rescraped === 1 ? t("page") : t("pages")}` : t("Re-tag queued")); },
    onError: (e) => toast.error(e.message),
  });
  // Crawl-only run, triggered from the Pages tab. Fills this list without tagging;
  // progress shows in the job bar above. Backend 409s if a run is already going.
  const crawlMut = useMutation({
    mutationFn: () => appClient.attributes.refresh(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attribute-job", null] }); toast.success(t("Crawling pages - they'll appear here as they're read.")); },
    onError: (e) => toast.error(e.message),
  });
  // Changed-pages review: re-tag chosen pages with chosen attributes, or keep as-is.
  const retagMut = useMutation({
    mutationFn: ({ page_ids, attribute_ids }) => appClient.attributes.retagPages(page_ids, attribute_ids),
    onSuccess: (r) => {
      invalidate(); setChangedSel(new Set());
      toast.success(`${t("Re-tagged")} ${r.pages} ${r.pages === 1 ? t("page") : t("pages")}`
        + (r.remaining ? ` · ${r.remaining} ${t("still pending - run again")}` : ""));
    },
    onError: (e) => toast.error(e.message),
  });
  const keepMut = useMutation({
    mutationFn: (page_ids) => appClient.attributes.keepPages(page_ids),
    onSuccess: (r) => { invalidate(); setChangedSel(new Set()); toast.success(`${t("Kept original tags on")} ${r.kept} ${r.kept === 1 ? t("page") : t("pages")}`); },
    onError: (e) => toast.error(e.message),
  });

  // Exclusion rules (URL substring / glob patterns) - managed under the Excluded view.
  const { data: cs } = useQuery({ queryKey: ["crawl-settings"], queryFn: () => appClient.attributes.crawlSettings() });
  const patterns = cs?.excluded_url_patterns || [];
  const patternMut = useMutation({
    mutationFn: (p) => appClient.attributes.updateCrawlSettings({ excluded_url_patterns: p }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["crawl-settings"] }); invalidate();
      if (r?.excluded_now) toast.success(`${t("Excluded")} ${r.excluded_now} ${r.excluded_now === 1 ? t("matching page") : t("matching pages")}`);
    },
    onError: (e) => toast.error(e.message),
  });
  // Editable validity thresholds (min chars for title/content). Synced from settings.
  const [titleMin, setTitleMin] = useState(null);
  const [contentMin, setContentMin] = useState(null);
  useEffect(() => {
    if (!cs) return;
    setTitleMin((v) => (v === null ? String(cs.valid_title_min_length ?? 1) : v));
    setContentMin((v) => (v === null ? String(cs.valid_content_min_length ?? 60) : v));
  }, [cs]);
  const thresholdMut = useMutation({
    mutationFn: () => appClient.attributes.updateCrawlSettings({
      valid_title_min_length: Math.max(0, Math.round(Number(titleMin) || 0)),
      valid_content_min_length: Math.max(0, Math.round(Number(contentMin) || 0)),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crawl-settings"] }); invalidate(); toast.success(t("Validity thresholds saved - existing pages re-checked.")); },
    onError: (e) => toast.error(e.message),
  });
  const thresholdDirty = cs && (String(titleMin) !== String(cs.valid_title_min_length ?? 1) || String(contentMin) !== String(cs.valid_content_min_length ?? 60));

  const counts = data?.counts || {};
  const pages = data?.pages || [];

  const renderPage = (pg) => (
    <div key={pg.id} className={`py-2 px-2 rounded hover:bg-secondary/40 ${pg.is_excluded ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate">{pg.title || pg.url}</p>
          <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground truncate flex items-center gap-1">
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
          </a>
        </div>
        {view === "failed" && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {pg.is_valid_title === false ? t("invalid title") : pg.crawl_reason || t("failed")}
          </span>
        )}
        {view === "valid" && <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">{pg.word_count} {t("words")} · {pg.tag_count} {t("tags")}{pg.needs_retag ? ` · ${t("changed")}` : ""}</span>}
        {view !== "excluded" && (
          <button title={t("Re-scrape this page")} onClick={() => rerunMut.mutate({ ids: [pg.id], mode: "scrape" })} disabled={rerunMut.isPending || !canWrite}
            className={`p-1 text-muted-foreground hover:text-foreground flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        )}
        {view === "valid" && (
          <button title={t("Re-tag this page")} onClick={() => rerunMut.mutate({ ids: [pg.id], mode: "tag" })} disabled={rerunMut.isPending || !canWrite}
            className={`p-1 text-muted-foreground hover:text-foreground flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button title={pg.is_excluded ? t("Re-include in crawling") : t("Exclude from crawling")} onClick={() => exclMut.mutate({ id: pg.id, is_excluded: !pg.is_excluded })} disabled={!canWrite}
          className={`p-1 text-muted-foreground hover:text-foreground flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
          {pg.is_excluded ? <RotateCcw className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
        </button>
      </div>
      {view === "valid" && pg.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5 pl-0.5">
          {pg.tags.map((t, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border">
              <span className="text-muted-foreground">{t.attr}:</span> {t.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // Changed view: checkbox + current tags + a per-page "Keep" (dismiss the change).
  const renderChangedPage = (pg) => (
    <div key={pg.id} className="py-2 px-2 rounded hover:bg-secondary/40 flex items-start gap-2">
      <input type="checkbox" checked={changedSel.has(pg.id)} onChange={() => toggleSel(pg.id)}
        className="accent-foreground mt-1 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate">{pg.title || pg.url}</p>
        <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground truncate flex items-center gap-1">
          <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
        </a>
        {pg.tags?.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {pg.tags.map((tg, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border">
                <span className="text-muted-foreground">{tg.attr}:</span> {tg.value}
              </span>
            ))}
          </div>
        ) : <p className="text-[10px] text-muted-foreground mt-1">{t("No current tags")}</p>}
      </div>
      <button title={t("Keep the existing tags and dismiss the change")} onClick={() => keepMut.mutate([pg.id])} disabled={keepMut.isPending || !canWrite}
        className={`text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
        {t("Keep")}
      </button>
    </div>
  );

  return (
    <div>
      {cs?.url_pattern && (
        <p className="text-xs text-muted-foreground mb-3">{t("Crawled from your GA traffic & sitemap - URLs matching")} <code className="text-foreground">{cs.url_pattern}</code>.</p>
      )}

      {/* View switch + search */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1 bg-secondary/40 rounded-lg p-1 w-fit">
          {PAGE_VIEWS.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${view === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {t(label)} <span className="text-[10px] text-muted-foreground">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={crawlMut.isPending || !cs?.ga_connected || !canWrite}
          onClick={() => crawlMut.mutate()}
          title={!canWrite ? t("Viewers can't make changes") : !cs?.ga_connected
            ? t("Connect Google Analytics to crawl pages.")
            : t("Crawl your site's pages into this list without tagging - review and exclude them, then test attributes before a full Reconstruct.")}>
          {crawlMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          {t("Crawl pages")}
        </Button>
        <div className="relative flex-1 max-w-[240px] ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(decodeUrl(e.target.value))} placeholder={t("Search pages…")}
            className="w-full h-8 pl-7 pr-2 text-xs bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </div>

      {/* Valid: validity thresholds + add a missed page */}
      {view === "valid" && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-2">{t("Pages the AI crawled successfully, with the values it tagged each with.")}</p>
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-secondary/10 p-2 mb-3 text-xs">
            <span className="text-muted-foreground">{t("A page is valid when its title and content are at least:")}</span>
            <label className="flex items-center gap-1">{t("Title")}
              <input type="number" min="0" value={titleMin ?? ""} onChange={(e) => setTitleMin(e.target.value)}
                className="w-14 h-7 px-1.5 border border-input rounded-md bg-background outline-none focus:ring-1 focus:ring-ring" placeholder="1" />
              {t("chars")}
            </label>
            <label className="flex items-center gap-1">{t("Content")}
              <input type="number" min="0" value={contentMin ?? ""} onChange={(e) => setContentMin(e.target.value)}
                className="w-16 h-7 px-1.5 border border-input rounded-md bg-background outline-none focus:ring-1 focus:ring-ring" placeholder="60" />
              {t("chars")}
            </label>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!thresholdDirty || thresholdMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
              onClick={() => thresholdMut.mutate()}>
              {thresholdMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("Save")}
            </Button>
            <span className="text-muted-foreground/70">{t("Defaults: title 1, content 60.")}</span>
          </div>
          <div className="flex gap-2 max-w-md">
            <Input value={newUrl} onChange={(e) => setNewUrl(decodeUrl(e.target.value))} placeholder={t("https://… add a page the crawler missed")} className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) addMut.mutate(newUrl.trim()); }} />
            <Button size="sm" className="h-8" disabled={!newUrl.trim() || addMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => addMut.mutate(newUrl.trim())}>
              {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Add")}
            </Button>
          </div>
        </div>
      )}

      {/* Changed: intro + bulk re-tag / keep toolbar */}
      {view === "changed" && (
        <div className="mb-3 space-y-2">
          <p className="text-xs text-muted-foreground">{t("Pages whose content changed since they were last tagged. Re-tag them with the attributes you choose, or keep their existing tags.")}</p>
          {pages.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-secondary/10 p-2">
              <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setChangedSel(new Set(pages.map((p) => p.id)))}>{t("Select all")}</button>
              <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setChangedSel(new Set())}>{t("Clear")}</button>
              <span className="text-[11px] text-muted-foreground">{changedSel.size} {t("selected")}</span>
              <div className="ml-auto flex items-center gap-2">
                <AttrPicker attrs={activeAttrs} selected={retagAttrs} onToggle={toggleAttr}
                  onAll={() => setRetagAttrs(retagAttrs.size === activeAttrs.length ? new Set() : new Set(activeAttrs.map((a) => a.id)))} t={t} />
                <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={!changedSel.size || !retagAttrs.size || retagMut.isPending || !canWrite}
                  onClick={() => retagMut.mutate({ page_ids: [...changedSel], attribute_ids: [...retagAttrs] })}
                  title={!canWrite ? t("Viewers can't make changes") : !retagAttrs.size ? t("Pick at least one attribute") : ""}>
                  {retagMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {t("Re-tag selected")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!changedSel.size || keepMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                  onClick={() => keepMut.mutate([...changedSel])}>
                  {t("Keep selected")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Failed: intro + bulk-exclude */}
      {view === "failed" && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-xs text-muted-foreground">{t("Pages the crawler couldn't read - blocked, empty, or an error page. These are never tagged.")}</p>
          {(counts.failed ?? 0) > 0 && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs flex-shrink-0" disabled={exclFailedMut.isPending || !canWrite}
              onClick={() => exclFailedMut.mutate()}
              title={!canWrite ? t("Viewers can't make changes") : t("Move every failed page to the Excluded tab so the crawler skips them.")}>
              {exclFailedMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
              {t("Exclude all failed")}
            </Button>
          )}
        </div>
      )}

      {/* Excluded: rule manager */}
      {view === "excluded" && (
        <div className="rounded-lg border border-border bg-secondary/10 p-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium">{t("Exclusion rules")} · {patterns.length}</p>
            <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => setExclOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> {t("Add / Import")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">{t("URL substrings or globs (e.g.")} <code>/about-company/*</code>{t(") are skipped whenever the AI crawls and tags your site. Add a single link, paste a list, or upload a file.")}</p>
          {patterns.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("No rules yet.")}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {patterns.map((p) => (
                <span key={p} className="h-6 px-2 rounded-full bg-background border border-border flex items-center gap-1">
                  <code className="text-[10px]">{p}</code>
                  <button title={t("Remove rule")} onClick={() => patternMut.mutate(patterns.filter((x) => x !== p))} disabled={!canWrite} className={`text-muted-foreground hover:text-destructive ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Page list */}
      {view === "excluded" && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Excluded pages")} · {counts.excluded ?? 0}</p>
      )}
      <div className="space-y-0.5">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-6 text-center">{t("Loading…")}</p>
        ) : pages.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            {view === "valid" ? t("No valid pages yet. Click Crawl pages to read your site.")
              : view === "changed" ? t("No changed pages. When a re-crawl finds new content, those pages show up here to review.")
              : view === "failed" ? t("No failed pages.")
              : t("No individual pages excluded. Add a rule above, or exclude a page from the Valid view.")}
          </p>
        ) : view === "changed" ? pages.map(renderChangedPage) : pages.map(renderPage)}
      </div>

      <ExclusionsDialog
        open={exclOpen}
        onClose={() => setExclOpen(false)}
        existing={patterns}
        onAdd={(fresh) => patternMut.mutate([...new Set([...patterns, ...fresh])])}
      />
    </div>
  );
}

// ── Review sub-tab (verify AI-discovered values across attributes) ──
// Page-centric review: every tagged page with its values; new pages / new labels
// are flagged so users can verify (mark reviewed) or correct a wrong tag.
// Inline "add a tag to this page" control. In the Review tab the user picks which
// attribute; in an attribute's Tagged-pages tab the attribute is fixed.
function AddTag({ pageId, attributes = [], fixedAttr, suggestions = [], onAdded }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [open, setOpen] = useState(false);
  const [attrId, setAttrId] = useState(fixedAttr?.id || "");
  const [value, setValue] = useState("");
  const addMut = useMutation({
    mutationFn: () => appClient.attributes.addPageTag(pageId, fixedAttr?.id || attrId, value.trim()),
    onSuccess: () => { setValue(""); if (!fixedAttr) setAttrId(""); setOpen(false); onAdded?.(); },
    onError: (e) => toast.error(e.message),
  });
  const canAdd = (fixedAttr?.id || attrId) && value.trim();
  const listId = `addtag-vals-${pageId}`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={!canWrite}
        className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}>
        <Plus className="w-2.5 h-2.5" /> {t("Tag")}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 w-full mt-1">
      {!fixedAttr && (
        <Select value={attrId} onValueChange={setAttrId}>
          <SelectTrigger className="h-6 text-[10px] w-28 flex-shrink-0"><SelectValue placeholder={t("Attribute")} /></SelectTrigger>
          <SelectContent>
            {attributes.map((a) => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <input list={listId} value={value} autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && canAdd) addMut.mutate(); if (e.key === "Escape") setOpen(false); }}
        placeholder={t("Value…")}
        className="h-6 text-[10px] px-2 rounded-md border border-input bg-background flex-1 min-w-0" />
      {suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      )}
      <button disabled={!canAdd || addMut.isPending || !canWrite} onClick={() => addMut.mutate()}
        className="h-6 px-1.5 rounded-md border border-input text-muted-foreground hover:text-foreground disabled:opacity-40 flex-shrink-0" title={!canWrite ? t("Viewers can't make changes") : t("Add tag")}>
        <Check className="w-3 h-3" />
      </button>
      <button onClick={() => setOpen(false)}
        className="h-6 px-1.5 rounded-md text-muted-foreground hover:text-foreground flex-shrink-0" title={t("Cancel")}>
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function ReviewPanel() {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("new"); // new | all | untagged
  const [attrSel, setAttrSel] = useState([]);   // selected attribute ids (multi)
  const [valueSel, setValueSel] = useState([]); // selected value ids (multi)
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");      // debounced
  const [sel, setSel] = useState(() => new Set()); // selected page ids for bulk verify
  const [confirmAll, setConfirmAll] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef(null);

  const attrKey = attrSel.join(",");
  const valueKey = valueSel.join(",");
  // A filter narrowed to specific attributes/values only verifies THOSE tags, not
  // the whole page. Untagged pages have no tags, so the tag filters don't apply there.
  const filterActive = filter !== "untagged" && (attrSel.length > 0 || valueSel.length > 0);

  // Debounce the search so typing doesn't refetch every keystroke.
  useEffect(() => { const id = setTimeout(() => setSearch(searchInput.trim()), 350); return () => clearTimeout(id); }, [searchInput]);
  // Close the Filters popover on an outside click (ignore the portaled MultiSelect).
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFilters]);
  // Changing the attribute set resets the (now possibly stale) value picks.
  useEffect(() => { setValueSel([]); }, [attrKey]);
  // Any filter change invalidates the current page selection.
  useEffect(() => { setSel(new Set()); }, [filter, attrKey, valueKey, search]);

  // When a tag filter is active we fetch the whole matching slice and narrow
  // new/all client-side (the server "new" HAVING is page-level, so it would mix in
  // pages that are new for OTHER attributes).
  const serverFilter = filter === "untagged" ? "untagged" : (filterActive ? null : (filter === "new" ? "new" : null));

  const { data, isLoading } = useQuery({
    queryKey: ["attr-tagged-pages", filter, attrKey, valueKey, search],
    queryFn: () => appClient.attributes.taggedPages(serverFilter, { attribute_ids: attrSel, value_ids: valueSel, search: search || undefined }),
  });
  const pages = data?.pages || [];
  const summary = data?.summary || { new_pages: 0, new_labels: 0 };

  const { data: allAttrs = [] } = useQuery({ queryKey: ["attributes"], queryFn: () => appClient.attributes.list() });
  const contentAttrs = allAttrs.filter((a) => a.source === "web_content" && a.status !== "archived");
  const attrOpts = contentAttrs.map((a) => ({ value: a.id, label: a.name }));
  // Value options come from the tags actually present in the current scope (so they
  // include pending, not-yet-approved values); narrowed to the picked attributes.
  const valueOpts = (() => {
    const m = new Map();
    for (const pg of pages) for (const tg of (pg.tags || [])) {
      if (attrSel.length && !attrSel.includes(tg.attribute_id)) continue;
      // Just the value - no attribute-name prefix (kept short + readable).
      if (!m.has(tg.value_id)) m.set(tg.value_id, { value: tg.value_id, label: tg.label || tg.value });
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  })();
  const attrLabelById = (id) => attrOpts.find((o) => o.value === id)?.label || id;
  const valueLabelById = (id) => valueOpts.find((o) => o.value === id)?.label || id;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["attr-tagged-pages"] });
    qc.invalidateQueries({ queryKey: ["attr-review-count"] });
    qc.invalidateQueries({ queryKey: ["attributes"] });
  };
  // One verify path for per-page / selected / all. When a tag filter is active the
  // server verifies ONLY the matching tags (by approving those values); otherwise it
  // marks the whole page(s) reviewed.
  const verifyMut = useMutation({
    mutationFn: (opts) => appClient.attributes.reviewAllPages(opts),
    onSuccess: (r) => {
      setSel(new Set()); setConfirmAll(false);
      const n = r?.verified ?? 0;
      toast.success(r?.mode === "tags"
        ? `${n} ${n === 1 ? t("tag verified") : t("tags verified")}`
        : `${n} ${n === 1 ? t("page verified") : t("pages verified")}`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const verifyScope = (extra) => filterActive
    ? { attribute_ids: attrSel, value_ids: valueSel, ...extra }
    : { ...extra };
  const verifyPages = (ids) => verifyMut.mutate(verifyScope({ page_ids: ids }));
  const verifyAll = () => verifyMut.mutate(filterActive
    ? { attribute_ids: attrSel, value_ids: valueSel, search: search || undefined }
    : { filter: filter === "all" ? null : filter, search: search || undefined });
  // Verify-by-value: approving a pending value cascades to auto-verify every page
  // whose tags are now all approved (backend markFullyApprovedPagesReviewed).
  const approveValueMut = useMutation({
    mutationFn: (valueId) => appClient.attributes.updateValue(valueId, { is_approved: true }),
    onSuccess: () => { toast.success(t("Value verified - pages using only verified values are now cleared.")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const untagMut = useMutation({ mutationFn: ({ pageId, valueId }) => appClient.attributes.deletePageTag(pageId, valueId), onSuccess: invalidate });

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Decorate + filter client-side: shownTags = only the tags matching the active
  // filter; a page needs review (in filtered mode) if any shown tag is unverified.
  const matchTag = (tg) => (!attrSel.length || attrSel.includes(tg.attribute_id)) && (!valueSel.length || valueSel.includes(tg.value_id));
  const decorated = pages.map((pg) => {
    const shownTags = filterActive ? (pg.tags || []).filter(matchTag) : (pg.tags || []);
    const needsReview = filterActive ? shownTags.some((tg) => !tg.is_approved) : pg.needs_review;
    return { ...pg, shownTags, needsReview };
  });
  const visible = decorated.filter((pg) => {
    if (filter === "untagged") return true;
    if (filterActive && pg.shownTags.length === 0) return false;
    if (filter === "new") return pg.needsReview;
    return true;
  });
  const needsReviewPages = visible.filter((p) => p.needsReview);
  const allNeedsSelected = needsReviewPages.length > 0 && needsReviewPages.every((p) => sel.has(p.id));
  const activeFilterCount = attrSel.length + valueSel.length + (search ? 1 : 0);

  if (isLoading) return <p className="text-xs text-muted-foreground py-8 text-center">{t("Loading…")}</p>;

  return (
    <div>
      {/* Intro - full width */}
      <p className="text-xs text-muted-foreground mb-2">
        {filter === "untagged"
          ? t("Valid pages the AI left untagged. Verify a page to confirm it needs no tags, or add one yourself with + Tag.")
          : filterActive
            ? t("Verifying here confirms only the filtered tags on each page - other attributes on the same page stay pending. Verify a value (✓ on a pending tag) to clear it everywhere, or remove a wrong tag with the ✕.")
            : t("Pages the AI has tagged. Verify a page to confirm all its labels, or verify a value (✓ on a pending tag) to clear every page that uses it. Filter by an attribute or value to verify just those tags. Remove a wrong tag with the ✕.")}
      </p>
      {!filterActive && filter !== "untagged" && (summary.new_pages > 0 || summary.new_labels > 0) && (
        <p className="text-[11px] text-yellow-600 mb-2 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {summary.new_pages} {summary.new_pages === 1 ? t("new page") : t("new pages")} · {summary.new_labels} {summary.new_labels === 1 ? t("new label") : t("new labels")} {t("to review")}
        </p>
      )}

      {/* Controls - state dropdown + Filters popover (attribute/value) + wide search */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-36 text-xs flex-shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="new">{t("Needs review")}</SelectItem>
            <SelectItem value="all">{t("All tagged")}</SelectItem>
            <SelectItem value="untagged">{t("Untagged")}</SelectItem>
          </SelectContent>
        </Select>
        {filter !== "untagged" && (
          <div ref={filterRef} className="relative flex-shrink-0">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setShowFilters((f) => !f)}>
              <Filter className="w-3.5 h-3.5" /> {t("Filters")}
              {(attrSel.length > 0 || valueSel.length > 0) && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
            </Button>
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-72">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                  {(attrSel.length > 0 || valueSel.length > 0) && (
                    <button onClick={() => { setAttrSel([]); setValueSel([]); }} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t("Attribute")}</p>
                    <MultiSelect value={attrSel} onChange={setAttrSel} options={attrOpts}
                      placeholder={t("All attributes")} searchPlaceholder={t("Search attributes…")} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t("Value")}</p>
                    <MultiSelect value={valueSel} onChange={setValueSel} options={valueOpts}
                      placeholder={valueOpts.length === 0 ? t("No values in view") : t("All values")}
                      searchPlaceholder={t("Search values…")} disabled={valueOpts.length === 0} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={t("Search pages by title or URL…")}
            className="w-full h-8 pl-8 pr-2 text-xs bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </div>

      {/* Active filter chips */}
      {(attrSel.length > 0 || valueSel.length > 0 || search) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {attrSel.map((id) => (
            <span key={`a-${id}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
              {t("Attribute")}: <strong>{attrLabelById(id)}</strong>
              <button onClick={() => setAttrSel(attrSel.filter((x) => x !== id))} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {valueSel.map((id) => (
            <span key={`v-${id}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
              {t("Value")}: <strong>{valueLabelById(id)}</strong>
              <button onClick={() => setValueSel(valueSel.filter((x) => x !== id))} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
            </span>
          ))}
          {search && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
              {t("Search")}: <strong>{search}</strong>
              <button onClick={() => setSearchInput("")} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
            </span>
          )}
        </div>
      )}

      {/* Bulk-verify toolbar */}
      {needsReviewPages.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3 px-2 py-1.5 rounded-md border border-border bg-secondary/30">
          <button className="text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setSel(allNeedsSelected ? new Set() : new Set(needsReviewPages.map((p) => p.id)))}>
            {allNeedsSelected ? t("Clear") : t("Select all to review")}
          </button>
          {sel.size > 0 && (
            <>
              <span className="text-[11px] text-muted-foreground">{sel.size} {t("selected")}</span>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={verifyMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                onClick={() => verifyPages([...sel])}>
                <Check className="w-3 h-3" /> {filterActive ? t("Verify selected tags") : t("Verify selected")}
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs ml-auto" disabled={verifyMut.isPending || !canWrite}
            onClick={() => setConfirmAll(true)}
            title={!canWrite ? t("Viewers can't make changes") : t("Verify everything matching the current filters - not just the pages shown.")}>
            <CheckCheck className="w-3 h-3" /> {t("Mark all verified")}
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center max-w-lg mx-auto mt-6">
          <ListChecks className="w-7 h-7 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium mb-1">{activeFilterCount > 0 ? t("No pages match") : filter === "new" ? t("Nothing new to review") : filter === "untagged" ? t("No untagged pages") : t("No tagged pages yet")}</p>
          <p className="text-xs text-muted-foreground">{activeFilterCount > 0 ? t("Try different filters or a different search.") : filter === "new" ? t("New pages and labels show up here after a reconstruct.") : filter === "untagged" ? t("Every valid page has at least one tag.") : t("Run Reconstruct to tag your crawled pages.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((pg) => (
            <div key={pg.id} className={`border rounded-lg p-3 ${pg.needsReview ? "border-yellow-500/40 bg-yellow-500/5" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {pg.needsReview && (
                    <input type="checkbox" checked={sel.has(pg.id)} onChange={() => toggleSel(pg.id)}
                      className="accent-foreground mt-0.5 flex-shrink-0" title={t("Select for bulk verify")} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate flex items-center gap-1.5">
                      {pg.needsReview && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0" title={t("Needs review")} />}
                      {pg.title || decodeUrl(pg.url)}
                    </p>
                    <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate">
                      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
                    </a>
                  </div>
                </div>
                {pg.needsReview && (
                  <Button size="sm" variant="outline" className="h-6 px-2 gap-1 text-[11px] flex-shrink-0" disabled={verifyMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : filterActive ? t("Verify the filtered tags on this page") : t("Verify all tags on this page")}
                    onClick={() => verifyPages([pg.id])}>
                    <Check className="w-3 h-3" /> {t("Verify")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(pg.shownTags || []).map((tg) => (
                  <span key={tg.value_id}
                    className={`group/tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                      tg.is_approved ? "border-foreground/40 bg-secondary text-foreground"
                        : tg.is_new ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-700"
                        : "bg-background border-border"
                    }`}
                    title={`${tg.attribute}: ${tg.label || tg.value}${tg.is_approved ? ` · ${t("verified")}` : tg.is_new ? ` · ${t("new")}` : ` · ${t("pending")}`}`}>
                    {tg.is_approved
                      ? <Check className="w-2.5 h-2.5 flex-shrink-0" />
                      : (
                        <button title={!canWrite ? t("Viewers can't make changes") : t("Verify this value everywhere")} disabled={approveValueMut.isPending || !canWrite}
                          onClick={() => approveValueMut.mutate(tg.value_id)}
                          className={`hover:text-foreground text-yellow-600 flex-shrink-0 ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Check className="w-2.5 h-2.5" /></button>
                      )}
                    <span className="text-muted-foreground">{tg.attribute}:</span> {tg.label || tg.value}
                    <button onClick={() => untagMut.mutate({ pageId: pg.id, valueId: tg.value_id })} disabled={!canWrite}
                      className={`opacity-0 group-hover/tag:opacity-100 hover:text-destructive ${!canWrite ? "pointer-events-none" : ""}`}><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
                <AddTag pageId={pg.id} attributes={contentAttrs} onAdded={invalidate} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm verify-all */}
      <Dialog open={confirmAll} onOpenChange={setConfirmAll}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><CheckCheck className="w-4 h-4" /> {t("Mark all verified?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {filterActive
              ? t("This verifies ONLY the filtered tags on every page matching the current view - other attributes on those pages stay pending. It covers pages beyond the ones shown here and can't be undone in bulk.")
              : t("This verifies every page matching the current view, including pages beyond the ones shown here. It can't be undone in bulk.")}
            {search ? ` · “${search}”` : ""}
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmAll(false)}>{t("Cancel")}</Button>
            <Button size="sm" disabled={verifyMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={verifyAll}>
              {verifyMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />} {t("Verify all")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Attribute card ────────────────────────────────────────────
function AttributeCard({ attr, onOpen, onDelete, onEdit, onClone }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  return (
    <div className="border border-border rounded-lg p-5 hover:shadow-sm transition-shadow cursor-pointer" onClick={onOpen}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-semibold truncate">{attr.name}</h3>
            {attr.status !== "draft" && <Badge variant="secondary" className="text-[10px]">{attr.status === "active" ? t("active") : attr.status === "archived" ? t("archived") : attr.status}</Badge>}
            {Number(attr.pending_count) > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-yellow-500/50 text-yellow-600">{attr.pending_count} {t("to review")}</Badge>
            )}
          </div>
          {attr.description && <p className="text-xs text-muted-foreground line-clamp-2">{attr.description}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onEdit}><Pencil className="w-3.5 h-3.5 mr-2" /> {t("Edit")}</DropdownMenuItem>
            {onClone && <DropdownMenuItem onClick={onClone} disabled={!canWrite}><Copy className="w-3.5 h-3.5 mr-2" /> {t("Clone")}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} disabled={!canWrite} className="text-destructive"><Trash2 className="w-3.5 h-3.5 mr-2" /> {t("Delete")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {attr.value_count} {t("values")}</span>
        <span>{Number(attr.profile_count).toLocaleString()} {t("profiles tagged")}</span>
        {/* "Run" only applies to the crawl-based Content source; Manual/Rule apply directly. */}
        {attr.source === "web_content" && (
          attr.last_run_date
            ? <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3" /> {formatDistanceToNow(new Date(attr.last_run_date), { addSuffix: true })}</span>
            : <span>{t("Never ran")}</span>
        )}
        {/* Created / updated shown for every source. */}
        {attr.created_date && (
          <span>{t("Created")} {format(new Date(attr.created_date), "MMM d, yyyy")}</span>
        )}
        {attr.updated_date && attr.updated_date !== attr.created_date && (
          <span className="flex items-center gap-1"><History className="w-3 h-3" /> {t("Updated")} {formatDistanceToNow(new Date(attr.updated_date), { addSuffix: true })}</span>
        )}
      </div>
    </div>
  );
}


const CONTENT_SUBS = [["attributes", "Attributes"], ["pages", "Pages"], ["review", "Review"]];
const EXTRACT_LABEL = { both: "Title & content", title: "Title only", content: "Content only" };

// Shows which GA property the crawl will use; prompts to connect when none.
function GaPropertyBar() {
  const { t } = usePreferences();
  const navigate = useNavigate();
  const { data: s } = useQuery({ queryKey: ["crawl-settings"], queryFn: () => appClient.attributes.crawlSettings() });
  if (!s) return null;

  const property = s.ga_property_name || s.url_domain;
  if (s.ga_connected && property) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <Globe className="w-3.5 h-3.5 flex-shrink-0" />
        <span>{t("Pages are crawled from GA property")} <strong className="text-foreground">{property}</strong>{s.ga_property_id ? <span className="opacity-60"> · {s.ga_property_id}</span> : null}</span>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 mb-4 flex items-center justify-between gap-3">
      <div className="flex items-start gap-2 min-w-0">
        <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("No Google Analytics property connected")}</p>
          <p className="text-xs text-muted-foreground">{t("Connect Google Analytics so the AI knows which website to crawl and tag.")}</p>
        </div>
      </div>
      <Button size="sm" className="gap-1.5 flex-shrink-0" onClick={() => navigate("/integrations")}>
        {t("Connect Google Analytics")} <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

// AI proposes attributes by reading a sample of crawled pages.
function SuggestDialog({ open, onClose, onCreate, creatingName }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const [created, setCreated] = useState(() => new Set());
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["attr-suggest"],
    queryFn: () => appClient.attributes.suggest(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const suggestions = data?.suggestions || [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setCreated(new Set()); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><Sparkles className="w-4 h-4" /> {t("Suggested attributes")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("The AI read a sample of your crawled pages and proposed targeting dimensions. Create the ones that fit - you can edit them after.")}</p>

        {isFetching ? (
          <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t("Reading your site…")}</div>
        ) : data?.note ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{data.note}</div>
        ) : suggestions.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{t("No suggestions right now. Try again after a reconstruct.")}</div>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {suggestions.map((s, i) => {
              const isCreated = created.has(s.name);
              return (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{s.description}</p>
                    </div>
                    <Button size="sm" variant={isCreated ? "outline" : "default"} className="h-7 flex-shrink-0"
                      disabled={isCreated || creatingName === s.name || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
                      onClick={() => { onCreate(s); setCreated((c) => new Set([...c, s.name])); }}>
                      {creatingName === s.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isCreated ? t("Added") : t("Create")}
                    </Button>
                  </div>
                  {s.example_values?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.example_values.map((v) => (
                        <span key={v} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border">{v}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-between items-center">
          <Button variant="ghost" size="sm" className="gap-1.5" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" /> {t("Regenerate")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setCreated(new Set()); onClose(); }}>{t("Done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// First-run guided checklist shown when there are no content attributes yet.
// firstStepsOnly: show just the source-setup steps (Connect → Sync → Crawl) as a
// banner above existing attribute definitions - used after GA is disconnected, when
// the definitions are kept but their data must be re-sourced.
function FirstRunChecklist({ gaConnected, gaSynced, pagesCrawled, crawledPages, crawling, onCrawl, onCreate, onSuggest, firstStepsOnly = false }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const navigate = useNavigate();
  // The current step is the first one not yet done (steps 4 & 5 are never auto-done).
  const doneFlags = [gaConnected, gaSynced, pagesCrawled, false, false];
  const currentN = doneFlags.findIndex(d => !d) + 1; // 0 when everything is done
  const canCreate = gaConnected && gaSynced && pagesCrawled;
  const Step = ({ done, n, title, current, children }) => (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
        done ? "bg-foreground text-background"
        : current ? "bg-yellow-500/15 text-yellow-700 border border-yellow-500/50 ring-2 ring-yellow-500/20"
        : "border border-border text-muted-foreground"}`}>
        {done ? <Check className="w-3.5 h-3.5" /> : n}
      </div>
      <div className="min-w-0 pt-0.5">
        <p className={`text-sm font-medium ${current ? "text-yellow-700" : ""}`}>{title}</p>
        <div className="text-xs text-muted-foreground mt-0.5">{children}</div>
      </div>
    </div>
  );
  return (
    <div className={`border border-border rounded-lg p-6 ${firstStepsOnly ? "max-w-xl" : "max-w-2xl"} mx-auto space-y-6 ${firstStepsOnly ? "mb-6" : "mt-6"}`}>
      {firstStepsOnly ? (
        <div className="text-center">
          <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">{t("Get started with content attributes")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Google Analytics is disconnected. Your attribute definitions are kept - reconnect, sync, and re-crawl to tag your pages again.")}
          </p>
        </div>
      ) : (
        <>
          {/* What attributes are & why they matter */}
          <div className="text-center space-y-2">
            <Tag className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
            <p className="text-base font-semibold">{t("Get started with attributes")}</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-lg mx-auto">
              {t("Attributes are custom targeting dimensions you define about your audience - things like \"Interested In\", \"Life Stage\", or \"Account Tier\". They turn raw web activity and profile data into labels you can act on, so you can find the right people and reach them with the right message.")}
            </p>
          </div>

          {/* Why use them - the payoff */}
          <div className="rounded-lg bg-secondary/30 p-4 space-y-3">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" /> {t("What you can do with attributes")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                [Users, t("Build segments"), t("Group people by an attribute value to create precise, reusable audiences.")],
                [MousePointer2, t("Target pop ups"), t("Show on-site messages only to visitors who match an attribute.")],
                [Mail, t("Personalise email"), t("Send campaigns tuned to what each attribute tells you about a person.")],
              ].map(([Icon, title, desc]) => (
                <div key={title} className="space-y-1">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <p className="text-xs font-medium">{title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Which type to use */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">{t("Three ways to build an attribute")}</p>
            <ul className="space-y-1.5 text-[11px] text-muted-foreground">
              <li className="flex gap-2">
                <Globe className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span><strong className="text-foreground">{t("Content")}</strong> {t("(this tab) - the AI reads your website, tags each page, and every visitor inherits the tags of the pages they viewed. This is the only type that labels anonymous visitors automatically.")}</span>
              </li>
              <li className="flex gap-2">
                <UserCog className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span><strong className="text-foreground">{t("Manual")}</strong> - {t("assign values to specific people yourself, or in bulk from a segment, search, or CSV upload.")}</span>
              </li>
              <li className="flex gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span><strong className="text-foreground">{t("Rule")}</strong> - {t("compute a value from existing profile fields, e.g. \"Engagement Level\" from GA session counts, or \"Life Stage\" from age.")}</span>
              </li>
            </ul>
            <p className="text-[11px] text-muted-foreground">{t("Switch between them using the tabs above. The steps below set up a Content attribute.")}</p>
          </div>

          {/* How content attributes work - lead-in to the steps */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold mb-0.5">{t("Set up your first content attribute")}</p>
            <p className="text-[11px] text-muted-foreground">{t("Connect your site, let the AI crawl it, describe a dimension, then reconstruct to tag your pages.")}</p>
          </div>
        </>
      )}
      <div className="space-y-4">
        <Step done={gaConnected} n={1} current={currentN === 1} title={t("Connect Google Analytics")}>
          {gaConnected ? t("Connected - the AI knows which site to crawl.") : (
            <button onClick={() => navigate("/integrations")} className="underline hover:text-foreground inline-flex items-center gap-1">
              {t("Connect now")} <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </Step>
        <Step done={gaSynced} n={2} current={currentN === 2} title={t("Sync your Google Analytics data")}>
          {gaSynced ? t("Synced - we know which pages your visitors viewed.") : (
            <>
              {t("Page discovery reads your synced GA pages, so a connection alone isn't enough - run a sync first.")}{" "}
              <button onClick={() => navigate("/integrations")} className="underline hover:text-foreground inline-flex items-center gap-1">
                {t("Sync now")} <ArrowRight className="w-3 h-3" />
              </button>
            </>
          )}
        </Step>
        <Step done={pagesCrawled} n={3} current={currentN === 3} title={t("Crawl your website's pages")}>
          {pagesCrawled ? (
            <>{crawledPages} {t("pages crawled - review and exclude any in the")} <strong>{t("Pages")}</strong> {t("tab.")}</>
          ) : (
            <>
              {t("Read your site's pages (URL + title) so you can review them and test attributes before tagging. No AI tagging happens yet.")}
              <div className="mt-2">
                <Button size="sm" className="h-8 gap-1.5" onClick={onCrawl} disabled={!gaSynced || crawling || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}>
                  {crawling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                  {crawling ? t("Crawling…") : t("Crawl pages")}
                </Button>
              </div>
            </>
          )}
        </Step>
        {!firstStepsOnly && (
          <>
            <Step done={false} n={4} current={currentN === 4} title={t("Create your first attribute")}>
              {canCreate ? t("Name a dimension (e.g. “Country Name”) and give the AI an instruction.")
                : t("Finish the steps above first - attributes need crawled pages to tag and test against.")}
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" className="h-8 gap-1.5" onClick={onCreate} disabled={!canCreate || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onSuggest} disabled={!canCreate || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}><Sparkles className="w-3.5 h-3.5" /> {t("Suggest with AI")}</Button>
              </div>
            </Step>
            <Step done={false} n={5} current={currentN === 5} title={t("Reconstruct to tag your pages")}>
              {t("Open the attribute and hit")} <strong>{t("Reconstruct")}</strong> - {t("the AI tags your crawled pages and propagates the values to profiles.")}
            </Step>
          </>
        )}
      </div>
    </div>
  );
}

// ── Rule attribute builder ────────────────────────────────────
// Searchable single-select (a combobox). `options` are strings or {value,label}.
function SearchSelect({ options, value, onChange, placeholder = "Select…", searchPlaceholder = "Search…", className }) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const norm = (options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const label = value != null ? (norm.find((o) => o.value === value)?.label ?? String(value)) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex items-center justify-between gap-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground", className)}
        >
          <span className={cn("truncate", value == null && "text-muted-foreground")}>{label || t(placeholder)}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent data-multiselect-popover="" align="start" className="min-w-[220px] p-0">
        <Command>
          <CommandInput placeholder={t(searchPlaceholder)} className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs">{t("No matches.")}</CommandEmpty>
            <CommandGroup>
              {norm.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => { onChange(o.value); setOpen(false); }} className="gap-2 cursor-pointer text-xs">
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Attribute-value condition: pick an ATTRIBUTE first (searchable), then multi-select
// its VALUES (searchable). Stores the selected value ids in `value` (one attribute
// per condition - add another condition for a second attribute). `attributes` is the
// grouped [{ id, name, values: [{ id, value, profile_count }] }] list.
function AttributeValuePicker({ attributes, value, onChange }) {
  const { t } = usePreferences();
  const list = attributes || [];
  const sel = Array.isArray(value) ? value : [];
  // The attribute currently in play = the one owning the selected value ids, or a
  // locally-picked one (so the value list appears before any value is chosen).
  const derivedAttrId = list.find((a) => (a.values || []).some((v) => sel.includes(v.id)))?.id || null;
  const [pickedAttrId, setPickedAttrId] = useState(derivedAttrId);
  // Sync to the owning attribute once it's known (options load async; the row may
  // be reused for another condition). Only when non-null, so a freshly-picked
  // attribute with no values chosen yet doesn't collapse.
  useEffect(() => { if (derivedAttrId) setPickedAttrId(derivedAttrId); }, [derivedAttrId]);
  const attrId = pickedAttrId || derivedAttrId;
  const attr = list.find((a) => a.id === attrId) || null;
  const attrOpts = list.map((a) => ({ value: a.id, label: a.name }));
  const valueOpts = (attr?.values || []).map((v) => ({ value: v.id, label: `${v.value}${v.profile_count ? ` (${v.profile_count})` : ""}` }));
  const selectAttr = (id) => {
    setPickedAttrId(id);
    const a = list.find((x) => x.id === id);
    // Keep only value ids that belong to the newly chosen attribute (switching
    // attributes clears the old selection - one attribute per condition).
    onChange(sel.filter((vid) => (a?.values || []).some((v) => v.id === vid)));
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SearchSelect options={attrOpts} value={attrId} onChange={selectAttr}
        placeholder="Attribute…" searchPlaceholder="Search attributes…" className="min-w-[9rem] max-w-[13rem]" />
      {attr && (
        <MultiSelect options={valueOpts} value={sel} onChange={onChange}
          placeholder={t("Values…")} searchPlaceholder={t("Search values…")}
          emptyText={t("No values.")} className="w-auto min-w-[10rem] max-w-[16rem] flex-shrink-0" />
      )}
    </div>
  );
}

// Multi-select over {value,label} options (id-based) - used by relation fields
// like "Attribute value is any of …".
function RefMulti({ options, value, onChange }) {
  const { t } = usePreferences();
  const sel = Array.isArray(value) ? value : [];
  const toggle = (id) => onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const labels = options.filter((o) => sel.includes(o.value)).map((o) => o.label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 px-2 text-xs border border-input rounded-md bg-background min-w-[10rem] max-w-[18rem] text-left truncate">
          {labels.length ? labels.join(", ") : <span className="text-muted-foreground">{t("Select…")}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
        {options.length === 0 && <p className="text-[11px] text-muted-foreground px-2 py-1">{t("No options")}</p>}
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={(e) => e.preventDefault()} onClick={() => toggle(o.value)}>
            <span className="mr-2">{sel.includes(o.value) ? "☑" : "☐"}</span>{o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConditionRow({ cond, fieldDefs, optsFor, refOptionsFor, attributeOptions, onChange, onRemove, canRemove }) {
  const { t } = usePreferences();
  const def = fieldDefs.find((f) => f.field === cond.field);
  const ops = def?.operators || [];
  // Group the field picker by `group` (mirrors the segment criteria groups).
  const groups = [];
  const byGroup = {};
  fieldDefs.forEach((f) => {
    const g = f.group || "Other";
    if (!byGroup[g]) { byGroup[g] = []; groups.push([g, byGroup[g]]); }
    byGroup[g].push(f);
  });
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={cond.field} onValueChange={(v) => {
        const d = fieldDefs.find((f) => f.field === v);
        const multi = d?.type === "enum" || d?.type === "refmulti";
        onChange({ field: v, operator: d?.operators?.[0]?.[0] || "", value: multi ? [] : "" });
      }}>
        <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder={t("Field")} /></SelectTrigger>
        <SelectContent className="max-h-72">
          {groups.map(([g, items]) => (
            <SelectGroup key={g}>
              <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">{g === "Other" ? t("Other") : g}</SelectLabel>
              {items.map((f) => <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>)}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {def && (
        <Select value={cond.operator} onValueChange={(v) => onChange({ operator: v })}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{ops.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
      )}
      {def?.type === "int" && cond.operator === "between" && (
        <div className="flex items-center gap-1">
          <Input type="number" value={cond.value?.[0] ?? ""} onChange={(e) => onChange({ value: [e.target.value, cond.value?.[1] ?? ""] })} className="h-8 w-20 text-xs" />
          <span className="text-[11px] text-muted-foreground">{t("and")}</span>
          <Input type="number" value={cond.value?.[1] ?? ""} onChange={(e) => onChange({ value: [cond.value?.[0] ?? "", e.target.value] })} className="h-8 w-20 text-xs" />
        </div>
      )}
      {def?.type === "int" && cond.operator !== "between" && (
        <Input type="number" value={cond.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} className="h-8 w-24 text-xs" />
      )}
      {def?.type === "recency" && (
        <div className="flex items-center gap-1">
          <Input type="number" value={cond.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} className="h-8 w-20 text-xs" />
          <span className="text-[11px] text-muted-foreground">{t("days")}</span>
        </div>
      )}
      {def?.type === "enum" && (
        <MultiSelect
          options={def.options === "replenishment_statuses" ? replenishmentStatusOptions(optsFor(def.options)) : optsFor(def.options)}
          value={Array.isArray(cond.value) ? cond.value : []}
          onChange={(v) => onChange({ value: v })}
          placeholder={t("Select…")} searchPlaceholder={t("Search…")} emptyText={t("No values found")}
          className="w-auto min-w-[9rem] max-w-[16rem] flex-shrink-0" />
      )}
      {def?.type === "ref" && (
        <Select value={cond.value || ""} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="h-8 min-w-[12rem] max-w-[18rem] text-xs"><SelectValue placeholder={t("Select…")} /></SelectTrigger>
          <SelectContent className="max-h-64">
            {refOptionsFor(def.optionsSource).length === 0
              ? <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{t("None available")}</div>
              : refOptionsFor(def.optionsSource).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {def?.type === "refmulti" && (
        def.optionsSource === "attribute"
          ? <AttributeValuePicker attributes={attributeOptions} value={cond.value} onChange={(v) => onChange({ value: v })} />
          : <RefMulti options={refOptionsFor(def.optionsSource)} value={cond.value} onChange={(v) => onChange({ value: v })} />
      )}
      {canRemove && <button onClick={onRemove} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
}

const BLANK_COND = () => ({ field: "", operator: "", value: "" });
const BLANK_GROUP = () => ({ op: "AND", conditions: [BLANK_COND()] });
const BLANK_RULE = () => ({ value: "", match: "OR", groups: [BLANK_GROUP()] });

// Normalize a stored rule to the groups shape. Rules saved before nesting have a
// flat { op, conditions } - wrap them in a single group so they still edit.
const normalizeRule = (r) => {
  if (Array.isArray(r?.groups) && r.groups.length) {
    return {
      value: r.value || "",
      match: r.match === "AND" ? "AND" : "OR",
      groups: r.groups.map((g) => ({ op: g.op === "OR" ? "OR" : "AND", conditions: g.conditions?.length ? g.conditions : [BLANK_COND()] })),
    };
  }
  return { value: r?.value || "", match: "OR", groups: [{ op: r?.op === "OR" ? "OR" : "AND", conditions: r?.conditions?.length ? r.conditions : [BLANK_COND()] }] };
};

// One condition group: an AND/OR of conditions, removable when there's > 1 group.
function GroupBlock({ group, fieldDefs, optsFor, refOptionsFor, attributeOptions, onChange, onRemove, canRemove }) {
  const { t } = usePreferences();
  const setCond = (i, patch) => onChange({ ...group, conditions: group.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="rounded-md border border-border/70 bg-secondary/20 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Select value={group.op || "AND"} onValueChange={(v) => onChange({ ...group, op: v })}>
          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="AND">{t("match ALL")}</SelectItem><SelectItem value="OR">{t("match ANY")}</SelectItem></SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground">{t("of these conditions")}</span>
        {canRemove && <button onClick={onRemove} title={t("Remove group")} className="ml-auto text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="space-y-1.5">
        {group.conditions.map((c, i) => (
          <ConditionRow key={i} cond={c} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor} attributeOptions={attributeOptions}
            onChange={(patch) => setCond(i, patch)}
            onRemove={() => onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) })}
            canRemove={group.conditions.length > 1} />
        ))}
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => onChange({ ...group, conditions: [...group.conditions, BLANK_COND()] })}>
          <Plus className="w-3 h-3" /> {t("condition")}
        </Button>
      </div>
    </div>
  );
}

function RuleRow({ rule, idx, scope, timePeriod, fieldDefs, optsFor, refOptionsFor, attributeOptions, onChange, onRemove, canRemove }) {
  const { t } = usePreferences();
  const setGroup = (i, ng) => onChange({ ...rule, groups: rule.groups.map((g, j) => (j === i ? ng : g)) });
  const ready = (rule.groups || []).some((g) => (g.conditions || []).some((c) => c.field && c.operator));
  const { data: prev } = useQuery({
    queryKey: ["rule-preview", scope, JSON.stringify(rule.groups), rule.match, timePeriod || ""],
    queryFn: () => appClient.attributes.rulePreview(scope, { ...rule, time_period: timePeriod || null }),
    enabled: ready,
  });
  const outer = rule.match === "AND" ? "AND" : "OR";
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground w-4">{idx + 1}</span>
        <Input value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} placeholder={t("Value (e.g. High)")} className="h-8 text-sm w-44" />
        {rule.groups.length > 1 && (
          <Select value={outer} onValueChange={(v) => onChange({ ...rule, match: v })}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="AND">{t("ALL groups match")}</SelectItem><SelectItem value="OR">{t("ANY group matches")}</SelectItem></SelectContent>
          </Select>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">{ready && prev ? `${Number(prev.count).toLocaleString()} ${t("match")}` : ""}</span>
        {canRemove && <button onClick={onRemove} title={t("Remove value")} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="space-y-1.5 pl-6">
        {rule.groups.map((g, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="flex items-center gap-2 my-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1.5 py-0.5 rounded bg-secondary border border-border">{outer}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <GroupBlock group={g} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor} attributeOptions={attributeOptions}
              onChange={(ng) => setGroup(i, ng)}
              onRemove={() => onChange({ ...rule, groups: rule.groups.filter((_, j) => j !== i) })}
              canRemove={rule.groups.length > 1} />
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onChange({ ...rule, groups: [...rule.groups, BLANK_GROUP()] })}>
          <Plus className="w-3 h-3" /> {t("condition group")}
        </Button>
      </div>
    </div>
  );
}

function RuleDetail({ attributeId, onBack, onEdit }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [rules, setRules] = useState([BLANK_RULE()]);
  const [timePeriod, setTimePeriod] = useState(""); // "" = all time (lifetime)
  const [dailyRefresh, setDailyRefresh] = useState(false); // nightly add + drop
  const [defDirty, setDefDirty] = useState(false); // unsaved local edits to the rule definition
  const [pendingStatus, setPendingStatus] = useState("draft"); // staged status (persisted on Save)
  const markDirty = () => setDefDirty(true);

  const { data: attr } = useQuery({ queryKey: ["attribute", attributeId], queryFn: () => appClient.attributes.get(attributeId), enabled: !!attributeId });
  const { data: fields } = useQuery({ queryKey: ["rule-fields"], queryFn: () => appClient.attributes.ruleFields() });
  const scope = attr?.scope === "anonymous" ? "anonymous" : "customer";
  const fieldDefs = fields?.[scope] || [];
  const { data: custFilters } = useQuery({ queryKey: ["profiles-cust-filters"], queryFn: () => appClient.profiles.customerFilters(), enabled: scope === "customer" });
  const { data: anonFilters } = useQuery({ queryKey: ["profiles-anon-filters"], queryFn: () => appClient.profiles.anonymousFilters(), enabled: scope === "anonymous" });
  const optsFor = (key) => ((scope === "customer" ? custFilters : anonFilters)?.[key]) || [];

  // Option lists for relation conditions (segment / pop-up / EDM / attribute).
  const { data: segmentsList = [] } = useQuery({ queryKey: ["segments"], queryFn: () => appClient.entities.Segment.list("-created_date") });
  const { data: popupsList = [] } = useQuery({ queryKey: ["popups"], queryFn: () => appClient.popups.list() });
  const { data: edmList = [] } = useQuery({ queryKey: ["edm-campaigns"], queryFn: () => appClient.edm.listCampaigns() });
  const { data: attrOptions = [] } = useQuery({ queryKey: ["attribute-options"], queryFn: () => appClient.attributes.options() });
  const refOptionsFor = (source) => {
    if (source === "segment") {
      const segType = scope === "anonymous" ? "anonymous_profile" : "customer";
      return segmentsList.filter((s) => (s.segment_type || "customer") === segType && s.status !== "archived").map((s) => ({ value: s.id, label: s.name }));
    }
    if (source === "popup") return (popupsList || []).map((p) => ({ value: p.id, label: p.name || t("(untitled pop-up)") }));
    if (source === "edm") return (edmList || []).map((c) => ({ value: c.id, label: c.name || c.subject || t("(untitled campaign)") }));
    if (source === "attribute") return attrOptions.flatMap((a) => (a.values || []).map((v) => ({ value: v.id, label: `${a.name}: ${v.value}` })));
    return [];
  };

  useEffect(() => {
    if (attr) {
      setRules(attr.rule?.rules?.length ? attr.rule.rules.map(normalizeRule) : [BLANK_RULE()]);
      setTimePeriod(attr.rule?.time_period ? String(attr.rule.time_period) : "");
      setDailyRefresh(!!attr.rule?.daily_refresh);
      setPendingStatus(attr.status);
      setDefDirty(false); // freshly loaded definition - nothing unsaved
    }
  }, [attr?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop empty conditions / groups; keep a value-rule only if it has a value and
  // at least one usable group.
  const cleanRules = rules
    .map((r) => ({
      value: (r.value || "").trim(),
      match: r.match === "AND" ? "AND" : "OR",
      groups: (r.groups || [])
        .map((g) => ({ op: g.op === "OR" ? "OR" : "AND", conditions: (g.conditions || []).filter((c) => c.field && c.operator) }))
        .filter((g) => g.conditions.length),
    }))
    .filter((r) => r.value && r.groups.length);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); };
  const ruleConfig = () => ({ match: "first", time_period: timePeriod || null, daily_refresh: dailyRefresh, rules: cleanRules });

  // Save is enabled whenever the status, settings, or rules changed. It persists
  // everything in one shot; tags are applied (recomputed onto profiles) only when
  // the saved status is Active - saving a Draft / Archived attribute just stores it.
  const statusChanged = !!attr && pendingStatus !== attr.status;
  const dirty = (defDirty && !!cleanRules.length) || statusChanged;
  const saveMut = useMutation({
    mutationFn: async () => {
      await appClient.attributes.update(attributeId, { status: pendingStatus, rule: ruleConfig() });
      return pendingStatus === "active" ? appClient.attributes.recompute(attributeId) : null;
    },
    onSuccess: (r) => {
      setDefDirty(false); invalidate();
      toast.success(r ? `${t("Saved & applied - tagged")} ${Number(r.tagged).toLocaleString()} ${t("profiles")}` : t("Saved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const values = (attr?.values || []).filter((v) => v.is_approved && !v.merged_into);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 w-fit">
        <ChevronLeft className="w-3.5 h-3.5" /> {t("All attributes")}
      </button>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading text-lg font-semibold">{attr?.name || t("Rule attribute")}</h2>
        {attr && onEdit && <button onClick={() => onEdit(attr)} title={t("Edit settings")} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>}
      </div>
      {attr?.description && <p className="text-xs text-muted-foreground">{attr.description}</p>}

      {attr && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
            <span>{t("Applies to")}: <strong className="text-foreground">{scope === "anonymous" ? t("Anonymous visitors") : t("Customers")}</strong></span>
            {attr.created_date && <span>{t("Created")} {format(new Date(attr.created_date), "MMM d, yyyy")}</span>}
            {attr.updated_date && attr.updated_date !== attr.created_date && (
              <span>{t("Updated")} {formatDistanceToNow(new Date(attr.updated_date), { addSuffix: true })}</span>
            )}
          </div>

          <AttributeActionBar
            status={pendingStatus}
            onStatusChange={setPendingStatus}
            lastRun={attr.last_run_date}
            onSave={() => saveMut.mutate()}
            dirty={dirty}
            saving={saveMut.isPending}
          />

          <StatusReminder status={pendingStatus} />

          {/* Daily refresh: nightly cron re-derives (add + drop). Off = frozen. */}
          <div className={`mt-3 rounded-lg border p-3 transition-colors ${dailyRefresh ? "border-foreground/30 bg-secondary/40" : "border-border bg-secondary/10"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <RefreshCw className={`w-4 h-4 flex-shrink-0 mt-0.5 ${dailyRefresh ? "text-foreground" : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{t("Daily refresh")}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {dailyRefresh
                      ? t("Re-evaluated every night (~2:30 AM): newly-matching profiles are added and non-matching ones dropped.")
                      : t("Tags stay frozen between saves - nothing is added or dropped automatically. Save while Active to re-derive on demand.")}
                  </p>
                </div>
              </div>
              <Switch checked={dailyRefresh} onCheckedChange={(v) => { setDailyRefresh(v); markDirty(); }} className="flex-shrink-0 mt-0.5" />
            </div>
          </div>

          {/* Time period: re-aggregates activity & purchase metrics over a window */}
          <div className={`mt-3 rounded-lg border p-3 transition-colors ${timePeriod ? "border-foreground/30 bg-secondary/40" : "border-border bg-secondary/10"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <Clock className={`w-4 h-4 flex-shrink-0 ${timePeriod ? "text-foreground" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{t("Time period")}</span>
              <Select value={timePeriod || "all"} onValueChange={(v) => { setTimePeriod(v === "all" ? "" : v); markDirty(); }}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("All time (lifetime)")}</SelectItem>
                  <SelectItem value="7">{t("Last 7 days")}</SelectItem>
                  <SelectItem value="14">{t("Last 14 days")}</SelectItem>
                  <SelectItem value="30">{t("Last 30 days")}</SelectItem>
                  <SelectItem value="60">{t("Last 60 days")}</SelectItem>
                  <SelectItem value="90">{t("Last 90 days")}</SelectItem>
                </SelectContent>
              </Select>
              {timePeriod
                ? <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground text-background">{t("Last")} {timePeriod} {t("days")}</span>
                : <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">{t("Lifetime")}</span>}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">{t("Windows activity & purchase metrics (sessions, page views, orders, spend…) to this recent period. Demographics & relations ignore it.")}</p>
          </div>

          <p className="text-[11px] text-muted-foreground mt-3 mb-2">{t("Each profile gets the value of the")} <strong>{t("first")}</strong> {t("rule it matches (top to bottom) - put the most specific rules first. Inside a value, add")} <strong>{t("condition groups")}</strong> {t("to build logic like")} <em>{t("(A and B) or C")}</em>.</p>

          <div className="space-y-2">
            {rules.map((r, i) => (
              <RuleRow key={i} rule={r} idx={i} scope={scope} timePeriod={timePeriod} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor} attributeOptions={attrOptions}
                onChange={(nr) => { setRules((rs) => rs.map((x, j) => (j === i ? nr : x))); markDirty(); }}
                onRemove={() => { setRules((rs) => rs.filter((_, j) => j !== i)); markDirty(); }}
                canRemove={rules.length > 1} />
            ))}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => { setRules((rs) => [...rs, BLANK_RULE()]); markDirty(); }}>
              <Plus className="w-3.5 h-3.5" /> {t("Add value")}
            </Button>
          </div>

          {values.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t("Tagged profiles by value")}</p>
              <div className="flex flex-wrap gap-1.5">
                {values.map((v) => (
                  <span key={v.id} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary/60 border border-border">
                    {v.display_label || v.value} · <strong>{Number(v.profile_count || 0).toLocaleString()}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Manual attribute: assign values to specific people ────────
// Manual attributes can tag customers OR anonymous visitors - the audience
// toggle picks which, and the rest of the dialog follows it. For single
// value-per-person attributes the server returns any people already on another
// value so we can warn and offer a one-click "Move here".
function AssignDialog({ attributeId, value, onClose }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [mode, setMode] = useState("segment");
  const [audience, setAudience] = useState("customer");
  const [segmentId, setSegmentId] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [pasteText, setPasteText] = useState("");
  const [conflicts, setConflicts] = useState(null); // { list, retry }
  const entityType = audience;
  const segType = entityType === "customer" ? "customer" : "anonymous_profile";

  // Switching audience resets the picks scoped to the previous one.
  const switchAudience = (a) => { setAudience(a); setSegmentId(""); setSearch(""); setPicked(new Set()); setConflicts(null); };

  const { data: segments = [] } = useQuery({ queryKey: ["segments"], queryFn: () => appClient.entities.Segment.list("-created_date") });
  const segOptions = segments.filter((s) => (s.segment_type || "customer") === segType && s.status !== "archived");
  const { data: results } = useQuery({
    queryKey: ["assign-search", entityType, search],
    queryFn: () => (entityType === "customer" ? appClient.profiles.listCustomers({ search, limit: 20 }) : appClient.profiles.listAnonymous({ search, limit: 20 })),
    enabled: mode === "search" && search.trim().length > 0,
  });
  const rows = results?.profiles || [];
  const idOf = (r) => (entityType === "customer" ? r.member_id : r.visitor_id);
  const labelOf = (r) => (entityType === "customer" ? (r.eng_full_name || r.primary_email || r.member_id) : r.visitor_id);
  const newLabel = value.display_label || value.value;

  const after = (n) => { toast.success(`${t("Assigned")} ${Number(n).toLocaleString()} ${n === 1 ? t("person") : t("people")}`); qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); qc.invalidateQueries({ queryKey: ["assignments", attributeId, value.id] }); onClose(); };
  // For single attrs the first call may come back { pending, conflicts }; we then
  // re-issue the same call with confirm=true to move people onto this value.
  const onResult = (r, retry) => { if (r?.pending) setConflicts({ list: r.conflicts, retry }); else after(r.assigned); };
  const segMut = useMutation({ mutationFn: (confirm) => appClient.attributes.assignSegment(attributeId, value.id, segmentId, confirm), onSuccess: (r) => onResult(r, () => segMut.mutate(true)), onError: (e) => toast.error(e.message) });
  const pickMut = useMutation({ mutationFn: (confirm) => appClient.attributes.assign(attributeId, value.id, [...picked], entityType, confirm), onSuccess: (r) => onResult(r, () => pickMut.mutate(true)), onError: (e) => toast.error(e.message) });
  const importMut = useMutation({
    mutationFn: (confirm) => appClient.attributes.assignImport(attributeId, value.id, pasteText.split(/[\n,]/).map((x) => x.trim()).filter(Boolean), entityType, confirm),
    onSuccess: (r) => {
      if (r?.pending) { setConflicts({ list: r.conflicts, retry: () => importMut.mutate(true) }); return; }
      toast.success(`${t("Matched")} ${r.matched} ${t("of")} ${r.submitted} - ${t("assigned")} ${r.assigned}`);
      qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const busy = segMut.isPending || pickMut.isPending || importMut.isPending;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">{t("Assign")} “{newLabel}”</DialogTitle></DialogHeader>

        {conflicts ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{conflicts.list.length}</strong> {conflicts.list.length === 1 ? t("person") : t("people")} {t("already have a different value for this single-value attribute. Moving them replaces their current value with")} <strong className="text-foreground">“{newLabel}”</strong>.
              </p>
            </div>
            <div className="max-h-56 overflow-auto border border-border rounded-md divide-y divide-border">
              {conflicts.list.map((c) => (
                <div key={c.entity_id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="flex-1 truncate">{c.name || c.email || c.entity_id}</span>
                  <span className="text-muted-foreground line-through">{c.current_value}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <strong className="truncate max-w-[40%]">{newLabel}</strong>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setConflicts(null)}>{t("Cancel")}</Button>
              <Button className="flex-1" disabled={busy || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => conflicts.retry()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `${t("Move")} ${conflicts.list.length} ${t("& assign")}`}
              </Button>
            </div>
          </div>
        ) : (
        <>
        {/* Audience: manual attributes can tag customers or anonymous visitors */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t("Audience")}</span>
          <div className="flex gap-0.5 p-0.5 bg-secondary/40 rounded-lg">
            {[["customer", t("Customers")], ["anonymous", t("Anonymous")]].map(([k, l]) => (
              <button key={k} onClick={() => switchAudience(k)}
                className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${audience === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="flex gap-0.5 p-0.5 bg-secondary/40 rounded-lg">
          {[["segment", t("From segment")], ["search", t("Search people")], ["paste", t("Paste list")]].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`flex-1 h-8 text-xs font-medium rounded-md transition-colors ${mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>

        {mode === "segment" ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">{t("Tag everyone currently in a")} {entityType === "customer" ? t("customer") : t("anonymous")} {t("segment.")}</p>
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="w-full h-9 px-2 text-sm bg-background border border-input rounded-md text-foreground">
              <option value="">{t("Select a segment…")}</option>
              {segOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.estimated_size ? ` (${s.estimated_size.toLocaleString()})` : ""}</option>)}
            </select>
            {segOptions.length === 0 && <p className="text-[11px] text-muted-foreground">{t("No matching segments yet - create one on the Segments page.")}</p>}
            <Button className="w-full" disabled={!segmentId || segMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => segMut.mutate()}>
              {segMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("Assign everyone in segment")}
            </Button>
          </div>
        ) : mode === "search" ? (
          <div className="space-y-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={entityType === "customer" ? t("Search name / email / member no…") : t("Search visitor id…")} className="h-9" autoFocus />
            <div className="max-h-64 overflow-auto border border-border rounded-md divide-y divide-border">
              {!search.trim() ? <p className="text-[11px] text-muted-foreground p-3 text-center">{t("Type to search…")}</p>
                : rows.length === 0 ? <p className="text-[11px] text-muted-foreground p-3 text-center">{t("No matches.")}</p>
                : rows.map((r) => { const id = idOf(r); const on = picked.has(id); return (
                  <button key={id} onClick={() => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/40 text-left">
                    <span className="w-4">{on ? "☑" : "☐"}</span><span className="flex-1 truncate">{labelOf(r)}</span>
                  </button>
                ); })}
            </div>
            <Button className="w-full" disabled={!picked.size || pickMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => pickMut.mutate()}>
              {pickMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `${t("Assign")} ${picked.size || ""} ${t("selected")}`}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">{t("Paste")} {entityType === "customer" ? t("emails or member IDs") : t("visitor IDs")} - {t("one per line or comma-separated. Unknown ones are skipped.")}</p>
            <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} className="text-sm"
              placeholder={entityType === "customer" ? "john@example.com\njane@example.com" : "apid-123\napid-456"} />
            <Button className="w-full" disabled={!pasteText.trim() || importMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => importMut.mutate()}>
              {importMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("Assign list")}
            </Button>
          </div>
        )}
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManualValueRow({ attributeId, value, onAssign, onDelete }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: people = [] } = useQuery({
    queryKey: ["assignments", attributeId, value.id],
    queryFn: () => appClient.attributes.assignments(attributeId, value.id, 50),
    enabled: open,
  });
  const unassignMut = useMutation({
    mutationFn: ({ entity_id, entity_type }) => appClient.attributes.unassignProfile(attributeId, value.id, entity_id, entity_type),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assignments", attributeId, value.id] }); qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); },
  });
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-medium flex-1 text-left flex items-center gap-1">
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          {value.display_label || value.value}
        </button>
        <span className="text-[10px] text-muted-foreground">{Number(value.profile_count || 0).toLocaleString()} {t("assigned")}</span>
        <Button size="sm" variant="outline" className="h-7 gap-1" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => onAssign(value)}><Plus className="w-3 h-3" /> {t("Assign")}</Button>
        <button onClick={() => onDelete(value)} disabled={!canWrite} title={t("Delete value")} className={`text-muted-foreground hover:text-destructive ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 pl-5">
          {people.length === 0 ? <p className="text-[11px] text-muted-foreground">{t("No one assigned yet - use")} <strong>{t("Assign")}</strong>.</p>
            : people.map((p) => (
              <div key={`${p.entity_type}:${p.entity_id}`} className="flex items-center gap-2 text-xs py-0.5">
                <span className="flex-1 truncate">{p.name || p.email || p.entity_id}{p.name && p.email ? <span className="text-muted-foreground"> · {p.email}</span> : null}</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 flex-shrink-0">{p.entity_type === "anonymous" ? t("anon") : t("customer")}</Badge>
                <button onClick={() => unassignMut.mutate({ entity_id: p.entity_id, entity_type: p.entity_type })} disabled={!canWrite} className={`text-muted-foreground hover:text-destructive ${!canWrite ? "opacity-50 pointer-events-none" : ""}`}><X className="w-3 h-3" /></button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ManualDetail({ attributeId, onBack, onEdit }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [newValue, setNewValue] = useState("");
  const [assignFor, setAssignFor] = useState(null);
  const [pendingStatus, setPendingStatus] = useState("draft"); // staged status (persisted on Save)

  const { data: attr } = useQuery({ queryKey: ["attribute", attributeId], queryFn: () => appClient.attributes.get(attributeId), enabled: !!attributeId });
  useEffect(() => { if (attr) setPendingStatus(attr.status); }, [attr?.id, attr?.status]);
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); };
  // Manual values/assignments persist immediately (a value must exist before people
  // can be assigned to it). The only thing the Save button stages is the status -
  // assignments simply go live on profiles once the saved status is Active.
  const statusChanged = !!attr && pendingStatus !== attr.status;
  const saveMut = useMutation({ mutationFn: () => appClient.attributes.update(attributeId, { status: pendingStatus }), onSuccess: () => { toast.success(t("Saved")); invalidate(); }, onError: (e) => toast.error(e.message) });
  const addValueMut = useMutation({ mutationFn: (v) => appClient.attributes.addValue(attributeId, v), onSuccess: () => { setNewValue(""); invalidate(); }, onError: (e) => toast.error(e.message) });
  const delValueMut = useMutation({ mutationFn: (id) => appClient.attributes.deleteValue(id), onSuccess: invalidate });

  const values = (attr?.values || []).filter((v) => !v.merged_into);

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3 w-fit">
        <ChevronLeft className="w-3.5 h-3.5" /> {t("All attributes")}
      </button>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading text-lg font-semibold">{attr?.name || t("Manual attribute")}</h2>
        {attr && onEdit && <button onClick={() => onEdit(attr)} title={t("Edit settings")} className="text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>}
      </div>
      {attr?.description && <p className="text-xs text-muted-foreground">{attr.description}</p>}

      {attr && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-muted-foreground">
            <span>{t("Values per person")}: <strong className="text-foreground">{attr.value_type === "single" ? t("Single") : t("Multiple")}</strong></span>
            {attr.created_date && <span>{t("Created")} {format(new Date(attr.created_date), "MMM d, yyyy")}</span>}
            {attr.updated_date && attr.updated_date !== attr.created_date && (
              <span>{t("Updated")} {formatDistanceToNow(new Date(attr.updated_date), { addSuffix: true })}</span>
            )}
          </div>

          {/* Same action bar as Rule. Manual values & assignments persist immediately
              as you add them (a value must exist before people can be assigned to it),
              so the only thing Save stages is the status. Setting it Active is what
              makes the assignments live on profiles (Segments, Pop-ups, Profiles). */}
          <AttributeActionBar
            status={pendingStatus}
            onStatusChange={setPendingStatus}
            lastRun={attr.last_run_date}
            onSave={() => saveMut.mutate()}
            dirty={statusChanged}
            saving={saveMut.isPending}
            saveTitle={t("Manual values and assignments save automatically; Save applies the status change")}
          />

          <StatusReminder status={pendingStatus} />

          <div className="flex gap-2 mt-4">
            <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={t("Add a value (e.g. VIP)")} className="h-8 text-sm flex-1"
              onKeyDown={(e) => { if (e.key === "Enter" && newValue.trim()) addValueMut.mutate(newValue.trim()); }} />
            <Button size="sm" variant="outline" className="h-8 flex-shrink-0" disabled={!newValue.trim() || addValueMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => addValueMut.mutate(newValue.trim())}>{t("Add value")}</Button>
          </div>

          <div className="mt-3">
            {values.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">{t("Add a value above, then assign people to it.")}</p>
            ) : (
              <div className="space-y-2">
                {values.map((v) => (
                  <ManualValueRow key={v.id} attributeId={attributeId} value={v} onAssign={setAssignFor} onDelete={(x) => delValueMut.mutate(x.id)} />
                ))}
              </div>
            )}
          </div>

          {assignFor && <AssignDialog attributeId={attributeId} value={assignFor} onClose={() => setAssignFor(null)} />}
        </>
      )}
    </div>
  );
}

// ── Resolve duplicates (multiple → single guard) ──────────────
// Switching a manual attribute to one-value-per-person is blocked while anyone
// holds more than one value. This lists those people and lets you keep exactly
// one each (others removed), then the switch proceeds.
function ResolveDuplicatesDialog({ attributeId, conflicts, onClose, onResolved }) {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  // Values arrive oldest-first; default to keeping the most recent per person.
  const [keep, setKeep] = useState(() => {
    const m = {};
    for (const c of conflicts) {
      const vals = c.values || [];
      m[`${c.entity_type}:${c.entity_id}`] = vals[vals.length - 1]?.value_id || vals[0]?.value_id;
    }
    return m;
  });
  const keyOf = (c) => `${c.entity_type}:${c.entity_id}`;
  const keepMostRecent = () => {
    const m = {};
    for (const c of conflicts) { const vals = c.values || []; m[keyOf(c)] = vals[vals.length - 1]?.value_id; }
    setKeep(m);
  };
  const resolveMut = useMutation({
    mutationFn: () => appClient.attributes.resolveDuplicates(
      attributeId,
      conflicts.map((c) => ({ entity_type: c.entity_type, entity_id: c.entity_id, value_id: keep[keyOf(c)] }))
    ),
    onSuccess: () => onResolved(),
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">{t("Resolve duplicate values")}</DialogTitle></DialogHeader>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{conflicts.length}</strong> {conflicts.length === 1 ? t("person has") : t("people have")} {t("more than one value. Keep one each to switch to single value-per-person - the rest are removed.")}
          </p>
        </div>
        <div className="flex justify-end">
          <button onClick={keepMostRecent} className="text-[11px] text-muted-foreground hover:text-foreground underline">{t("Keep most recent for everyone")}</button>
        </div>
        <div className="max-h-[50vh] overflow-auto space-y-2 -mx-1 px-1">
          {conflicts.map((c) => (
            <div key={keyOf(c)} className="border border-border rounded-md p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium truncate">{c.name || c.email || c.entity_id}</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{c.entity_type === "anonymous" ? t("anon") : t("customer")}</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {(c.values || []).map((v) => {
                  const on = keep[keyOf(c)] === v.value_id;
                  return (
                    <button key={v.value_id} onClick={() => setKeep((m) => ({ ...m, [keyOf(c)]: v.value_id }))}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${on ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
                      {on ? "✓ " : ""}{v.value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={resolveMut.isPending} onClick={onClose}>{t("Cancel")}</Button>
          <Button className="flex-1" disabled={resolveMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => resolveMut.mutate()}>
            {resolveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("Keep selected & switch to single")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Reusable card grid: search + filters + sort + group-by-status (shared by all
// three source tabs). All toolbar state is owned by the parent so the choice is
// consistent across tabs; only one instance mounts at a time.
function CardGrid({
  intro, tabAttrs, sortedAttrs, gridGroups,
  search, setSearch, showFilters, setShowFilters, filterRef,
  filters, setFilter, clearFilters, hasActiveFilters,
  sortBy, setSortBy, sortDir, setSortDir, groupByStatus, setGroupByStatus,
  onOpen, onEdit, onDelete, onClone, onImportExport,
}) {
  const { t } = usePreferences();
  // Collapsible status groups (mirrors the Segments page). View-only state, kept
  // local to this grid so each source tab remembers its own collapsed groups.
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggleGroup = (k) => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const groupKeys = gridGroups.map((g) => g.key);
  const allCollapsed = groupByStatus && groupKeys.length > 0 && groupKeys.every((k) => collapsed.has(k));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groupKeys));
  return (
    <>
      {intro && <p className="text-xs text-muted-foreground mb-4 max-w-2xl">{intro}</p>}

      {/* Search + filters + sort + group toggle (mirrors EDM / Pop-up) */}
      <div className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search attributes…")}
              className="w-full h-9 pl-9 pr-8 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
            {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <div ref={filterRef} className="relative">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters((f) => !f)}>
              <Filter className="w-3.5 h-3.5" /> {t("Filters")}
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
            </Button>
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-80">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                  {hasActiveFilters && <button onClick={clearFilters} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                  <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)}
                    className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                    <option value="">{t("All")}</option>
                    <option value="active">{t("Active")}</option>
                    <option value="draft">{t("Draft")}</option>
                    <option value="archived">{t("Archived")}</option>
                  </select>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Sort by")}</p>
                  <div className="flex items-center gap-2">
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                      className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                      <option value="date">{t("Last run")}</option>
                      <option value="name">{t("Name")}</option>
                      <option value="status">{t("Status")}</option>
                    </select>
                    <button type="button" onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}
                      className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                      {sortDir === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> {t("Asc")}</> : <><ArrowDown className="w-3.5 h-3.5" /> {t("Desc")}</>}
                    </button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Group by")}</p>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-muted-foreground">{t("Status")}</span>
                    <input type="checkbox" checked={groupByStatus} onChange={(e) => setGroupByStatus(e.target.checked)} className="rounded border-border cursor-pointer" />
                  </label>
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onImportExport}>
            <Upload className="w-3.5 h-3.5" /> {t("Import / Export")}
          </Button>
          {groupByStatus && gridGroups.length > 1 && (
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={toggleAll}>
              {allCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
              {allCollapsed ? t("Expand all") : t("Collapse all")}
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {sortedAttrs.length !== tabAttrs.length ? `${sortedAttrs.length} ${t("of")} ${tabAttrs.length}` : `${tabAttrs.length}`} {tabAttrs.length === 1 ? t("attribute") : t("attributes")}
          </span>
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {Object.entries(filters).filter(([, v]) => v).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                {k}: <strong>{v}</strong>
                <button onClick={() => setFilter(k, "")} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {sortedAttrs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-16">{t("No attributes match your search or filters.")}</p>
      ) : gridGroups.map((group) => {
        const items = sortedAttrs.filter(group.filter);
        if (!items.length) return null;
        const isCollapsed = groupByStatus && collapsed.has(group.key);
        return (
          <div key={group.key} className="mb-8">
            {groupByStatus && (
              <button onClick={() => toggleGroup(group.key)} className="flex items-center gap-1.5 mb-3 group/h">
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide group-hover/h:text-foreground">{t(group.label)} · {items.length}</span>
              </button>
            )}
            {!isCollapsed && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((attr) => (
                  <AttributeCard key={attr.id} attr={attr}
                    onOpen={() => onOpen(attr)} onEdit={() => onEdit(attr)} onDelete={() => onDelete(attr)}
                    onClone={onClone ? () => onClone(attr) : undefined} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// Detailed, type-specific "How it works" guide content. Each attribute source
// gets its own full walkthrough: how to create one end-to-end, what every tab on
// the detail page does, and how to verify / fix / organise its values.
function attributeGuide(t, source) {
  if (source === "manual") {
    return {
      storageKey: "guide.attributes.manual",
      title: t("How manual attributes work"),
      intro: t("Manual attributes are dimensions you assign by hand - perfect for facts only you know, like \"Account Tier\" (VIP / Standard) or \"Territory\". You define the values, then choose exactly who gets each one. They work for both customers and anonymous visitors."),
      stepsTitle: t("Creating a manual attribute, step by step"),
      steps: [
        { title: t("Create the attribute"), desc: t("On the Manual tab click New Attribute. Name it, pick the audience (customers or anonymous visitors), and choose whether a person can hold one value or multiple.") },
        { title: t("Add your values"), desc: t("Type each value (e.g. VIP) and click Add value. Values save immediately - no reconstruct needed.") },
        { title: t("Assign people"), desc: t("On a value's row click Assign, then pick people from a segment, a search, or a pasted list of IDs/emails.") },
        { title: t("Activate & save"), desc: t("Set the status to Active and click Save - that's what makes the assignments live on Profiles, Segments, and Pop-ups.") },
      ],
      sections: [{
        title: t("What you can do on the detail page"),
        items: [
          { icon: Plus, label: t("Add values"), desc: t("- create as many values as you need; each becomes something you can assign people to.") },
          { icon: Users, label: t("Assign / re-assign"), desc: t("- assign people to a value from a segment, search, or list; the assignment count shows on each row.") },
          { icon: Trash2, label: t("Remove"), desc: t("- delete a value to remove it and its assignments, or unassign individual people from a value.") },
          { icon: UserCog, label: t("Single vs multiple"), desc: t("- control whether a person can hold one value or several; switching to single asks you to resolve anyone with duplicates.") },
        ],
      }],
      footer: t("Values and assignments persist as you make them; only the status change is applied when you click Save."),
    };
  }
  if (source === "rule") {
    return {
      storageKey: "guide.attributes.rule",
      title: t("How rule attributes work"),
      intro: t("Rule attributes are computed automatically from data you already have - no manual tagging or AI. You define conditions over profile fields (and segments, pop-ups, campaigns, or other attributes), and every matching person gets the value."),
      stepsTitle: t("Creating a rule attribute, step by step"),
      steps: [
        { title: t("Create the attribute"), desc: t("On the Rule tab click New Attribute. Name it and choose who it applies to - Customers or Anonymous visitors. You'll build the rules next.") },
        { title: t("Build your rules"), desc: t("For each value, add condition groups over profile fields (age, location, GA sessions, orders…) or relations to a segment, pop-up, campaign, or attribute. Combine conditions with AND/OR; the first matching rule wins.") },
        { title: t("Set the window (optional)"), desc: t("Choose a Time period to aggregate activity and purchase metrics over a rolling window, or leave it as lifetime.") },
        { title: t("Choose refresh"), desc: t("Turn on Daily refresh to re-evaluate nightly (adding and dropping profiles as their data changes), or leave it off to freeze tags between saves.") },
        { title: t("Activate & save"), desc: t("Set Active and click Save - saving while Active recomputes the rule and tags matching profiles instantly, reporting how many were tagged.") },
      ],
      sections: [{
        title: t("What's on the detail page"),
        items: [
          { icon: SlidersHorizontal, label: t("Rules"), desc: t("- each rule is a value plus condition groups; stack multiple rules in priority order and the first match wins.") },
          { icon: Clock, label: t("Time period"), desc: t("- aggregate metrics like sessions or spend over a rolling window instead of all-time.") },
          { icon: RefreshCw, label: t("Daily refresh"), desc: t("- nightly re-evaluation keeps values current as people's data changes; off keeps them frozen.") },
          { icon: Check, label: t("Save & apply"), desc: t("- Save stores the definition; while Active it also recomputes and reports how many profiles were tagged.") },
        ],
      }],
      footer: t("No approval or crawling needed - rule values are derived directly from your data each time you save (or nightly with Daily refresh)."),
    };
  }
  // web_content (default)
  return {
    storageKey: "guide.attributes.content",
    title: t("How content attributes work"),
    intro: t("Content attributes are targeting dimensions the AI fills in by reading your website. You describe a dimension (e.g. \"Interested In\"), the AI tags each crawled page, and every visitor - even anonymous ones - inherits the tags of the pages they viewed."),
    stepsTitle: t("Creating a content attribute, step by step"),
    steps: [
      { title: t("Connect & sync Google Analytics"), desc: t("In Integrations, connect GA and run a sync so Meritma knows which pages your visitors view.") },
      { title: t("Crawl your pages"), desc: t("Open the Pages sub-tab and click Crawl - this reads each page's URL and title so the AI has something to tag. Exclude any pages you don't want tagged.") },
      { title: t("Create the attribute"), desc: t("Click New Attribute (or Suggest with AI). Name the dimension, write a short instruction for the AI, and choose Extract from and Values per page (single or multiple).") },
      { title: t("Reconstruct"), desc: t("Set it Active and hit Reconstruct (or Activate & Reconstruct). The AI tags your crawled pages and propagates the values onto profiles.") },
      { title: t("Review the results"), desc: t("Approve, reject, or merge the AI-discovered values in the Review queue - only approved values affect targeting - then group and test as needed.") },
    ],
    sections: [
      {
        title: t("What each tab on the attribute does"),
        items: [
          { icon: ListChecks, label: t("Values"), desc: t("- every value for this dimension. Add known values yourself, and approve / reject / merge AI-discovered ones in the Review queue. Only approved values are used for targeting.") },
          { icon: FlaskConical, label: t("Test"), desc: t("- dry-run the AI on sample URLs (your GA top pages or an uploaded list) to preview what it would tag, without touching live data.") },
          { icon: Layers, label: t("Groups"), desc: t("- roll related values up into groups (e.g. England, Scotland → UK). Set a group label, auto-group with AI, or assign groups by hand.") },
          { icon: FileText, label: t("Tagged pages"), desc: t("- see which page received which value, and untag any that were tagged wrongly.") },
        ],
      },
      {
        title: t("Verifying, fixing & organising tags"),
        items: [
          { icon: Search, label: t("Verify"), desc: t("- use Test to preview tagging on sample URLs, and Tagged pages to confirm real pages got the right values.") },
          { icon: Trash2, label: t("Remove a tag"), desc: t("- in Tagged pages remove an incorrect page tag; in Values, reject or delete a value to stop it targeting.") },
          { icon: Plus, label: t("Add manually"), desc: t("- in Values, type a known value to add it yourself instead of waiting for the AI to discover it.") },
          { icon: GitMerge, label: t("Merge duplicates"), desc: t("- in the Review queue, merge near-duplicate values (amber chips suggest likely matches) so they count as one.") },
          { icon: RefreshCw, label: t("Re-run"), desc: t("- after crawling new pages or editing the instruction, Reconstruct again to re-tag; use History to see past runs.") },
        ],
      },
    ],
    footer: t("The Pages and Review sub-tabs at the top apply across all your content attributes - Pages manages what gets crawled, Review gathers every value waiting for approval."),
  };
}

export default function Attributes() {
  const { t } = usePreferences();
  const { canWrite } = useRole();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("web_content");
  const [contentSub, setContentSub] = useState("attributes");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [selectedAttrId, setSelectedAttrId] = useState(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resolveDupes, setResolveDupes] = useState(null); // { attrId, conflicts, retryData }

  // Card grid: search + filters + sort + group-by-status (mirrors EDM / Pop-up).
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: "" });
  const [sortBy, setSortBy] = useStickyState("date", "attr.sortBy");
  const [sortDir, setSortDir] = useStickyState("desc", "attr.sortDir");
  const [groupByStatus, setGroupByStatus] = useStickyState(true, "attr.groupByStatus");
  const filterRef = useRef(null);
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    const handler = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: attributes = [], isLoading } = useQuery({
    queryKey: ["attributes"],
    queryFn: () => appClient.attributes.list(),
  });
  const { data: crawlSettings } = useQuery({
    queryKey: ["crawl-settings"],
    queryFn: () => appClient.attributes.crawlSettings(),
  });
  const { data: globalJob } = useQuery({
    queryKey: ["attribute-job", null],
    queryFn: () => appClient.attributes.latestJob(),
    refetchInterval: (q) => (ACTIVE_JOB(q.state.data) ? 2500 : false),
  });

  // When a run finishes, refresh the crawled-page count (and inventory) so the setup
  // gate / first-run checklist advance from "Crawl pages" to "Create attribute".
  const prevJobActive = useRef(false);
  useEffect(() => {
    const active = ACTIVE_JOB(globalJob);
    if (prevJobActive.current && !active) {
      qc.invalidateQueries({ queryKey: ["crawl-settings"] });
      qc.invalidateQueries({ queryKey: ["web-pages"] });
      qc.invalidateQueries({ queryKey: ["attr-review-count"] });
      qc.invalidateQueries({ queryKey: ["attr-tagged-pages"] });
    }
    prevJobActive.current = active;
  }, [globalJob, qc]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["attributes"] });

  const createMut = useMutation({
    mutationFn: (data) => appClient.attributes.create(data),
    onSuccess: (created) => { invalidate(); setCreateOpen(false); toast.success(t("Attribute created")); if (created?.source !== "web_content") setSelectedAttrId(created.id); },
    onError: (e) => toast.error(e.message),
  });
  const editMut = useMutation({
    mutationFn: ({ id, data }) => appClient.attributes.update(id, data),
    onSuccess: (_d, vars) => { invalidate(); qc.invalidateQueries({ queryKey: ["attribute", vars.id] }); setEditTarget(null); toast.success(t("Attribute updated")); },
    onError: (e, vars) => {
      // Blocked from switching to single because duplicates exist - open the resolver.
      if (e.status === 409 && e.payload?.conflicts?.length) {
        setEditTarget(null);
        setResolveDupes({ attrId: vars.id, conflicts: e.payload.conflicts, retryData: vars.data });
      } else {
        toast.error(e.message);
      }
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id) => appClient.attributes.remove(id),
    onSuccess: () => { invalidate(); toast.success(t("Attribute deleted")); },
    onError: (e) => toast.error(e.message),
  });
  const runAllMut = useMutation({
    mutationFn: () => appClient.attributes.runAll(),
    onSuccess: () => { toast.success(t("Reconstruct started for all behavioral attributes")); qc.invalidateQueries({ queryKey: ["attribute-job", null] }); },
    onError: (e) => toast.error(e.message),
  });
  // Crawl-only: scrape pages (URL + title) into the Pages tab WITHOUT AI tagging, so
  // the user can review/exclude pages and dry-run attributes before a full reconstruct.
  const crawlMut = useMutation({
    mutationFn: () => appClient.attributes.refresh(),
    onSuccess: () => { toast.success(t("Crawling pages - review and exclude them in the Pages tab, then test your attributes before Reconstruct.")); qc.invalidateQueries({ queryKey: ["attribute-job", null] }); },
    onError: (e) => toast.error(e.message),
  });

  const createSuggestion = (s) => createMut.mutate({
    name: s.name, description: s.description, source: "web_content",
    value_type: s.value_type || "multi", status: "active", values: s.example_values || [],
  });

  const isContent = activeTab === "web_content";
  const tabAttrs = attributes.filter((a) => a.source === activeTab);
  // Pages needing review across the whole feed (tagged + untagged), matching the
  // Review tab's own counts rather than pending values per attribute.
  const { data: reviewCountData } = useQuery({
    queryKey: ["attr-review-count"],
    queryFn: () => appClient.attributes.reviewCount(),
    enabled: isContent,
  });
  const reviewCount = reviewCountData?.count || 0;
  const showHeaderActions = isContent && contentSub === "attributes" && !selectedAttrId;
  const gaConnected = !!crawlSettings?.ga_connected;
  const gaSynced = !!crawlSettings?.ga_synced;
  const crawledPages = crawlSettings?.crawled_pages || 0;
  const pagesCrawled = crawledPages > 0;
  // Behavioral attributes can only be created once the source is set up end-to-end:
  // GA connected -> synced -> pages crawled. This also re-gates creation if GA is
  // later disconnected (which purges crawled pages), since there's nothing to tag.
  const canCreate = gaConnected && gaSynced && pagesCrawled;
  const createGateMsg = canCreate ? ""
    : !gaConnected ? t("Connect Google Analytics first.")
    : !gaSynced ? t("Sync your Google Analytics data first.")
    : t("Crawl your pages first.");

  // Filter + sort + group the cards for the grid.
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const filteredAttrs = tabAttrs.filter((a) => {
    const q = search.trim().toLowerCase();
    if (q && !(a.name || "").toLowerCase().includes(q) && !(a.description || "").toLowerCase().includes(q)) return false;
    if (filters.status && a.status !== filters.status) return false;
    return true;
  });
  const sortGet = { date: (a) => a.last_run_date || a.created_date || "", name: (a) => (a.name || "").toLowerCase(), status: (a) => a.status || "" }[sortBy];
  const sortedAttrs = (() => {
    const asc = sortGet ? [...filteredAttrs].sort((a, b) => { const av = sortGet(a), bv = sortGet(b); return av < bv ? -1 : av > bv ? 1 : 0; }) : filteredAttrs;
    return sortDir === "asc" ? asc : [...asc].reverse();
  })();
  const gridGroups = (groupByStatus ? STATUS_GROUPS : [{ key: "all", label: "All", filter: () => true }]).filter((g) => sortedAttrs.some(g.filter));

  // Shared toolbar + grid props passed to <CardGrid> on every source tab.
  const gridProps = {
    tabAttrs, sortedAttrs, gridGroups,
    search, setSearch, showFilters, setShowFilters, filterRef,
    filters, setFilter, clearFilters: () => setFilters({ status: "" }), hasActiveFilters,
    sortBy, setSortBy, sortDir, setSortDir, groupByStatus, setGroupByStatus,
    onOpen: (a) => setSelectedAttrId(a.id),
    onEdit: (a) => setEditTarget(a),
    onDelete: (a) => setDeleteTarget(a),
    onClone: (a) => cloneAttr(a),
    onImportExport: () => setImportOpen(true),
  };

  // Clone an attribute into a fresh draft and open it.
  const cloneAttr = async (a) => {
    try {
      const clone = await appClient.attributes.clone(a.id);
      qc.invalidateQueries({ queryKey: ["attributes"] });
      setActiveTab(clone.source);
      if (clone.source === "web_content") setContentSub("attributes");
      setSelectedAttrId(clone.id);
      toast.success(t("Cloned to a new draft"));
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Attributes")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("Custom targeting dimensions you can segment, pop-up, and email on.")}</p>
          </div>
          {showHeaderActions && (() => {
            const running = ACTIVE_JOB(globalJob) || runAllMut.isPending || crawlMut.isPending;
            const activeCount = tabAttrs.filter((a) => a.status === "active").length;
            return (
            <div className="flex items-center gap-2">
              {tabAttrs.length > 0 && (
                <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={running || !pagesCrawled || !canWrite}
                  title={!canWrite ? t("Viewers can't make changes") : !pagesCrawled ? createGateMsg : ""}
                  onClick={() => {
                    if (activeCount === 0) { toast.error(t("No active attributes - set at least one attribute to Active first.")); return; }
                    runAllMut.mutate();
                  }}>
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {running ? t("Running…") : t("Reconstruct all")}
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!canCreate || !canWrite} title={!canWrite ? t("Viewers can't make changes") : createGateMsg}
                onClick={() => setSuggestOpen(true)}><Sparkles className="w-3.5 h-3.5" /> {t("Suggest with AI")}</Button>
              <Button size="sm" className="h-9 gap-1.5" disabled={!canCreate || !canWrite} title={!canWrite ? t("Viewers can't make changes") : createGateMsg}
                onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
            </div>
            );
          })()}
          {(activeTab === "rule" || activeTab === "manual") && !selectedAttrId && (
            <Button size="sm" className="h-9 gap-1.5" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
          )}
        </div>

        {/* Source tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map((key) => {
            const meta = SOURCES[key];
            const Icon = meta.icon;
            const count = attributes.filter((a) => a.source === key).length;
            return (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setSelectedAttrId(null); setContentSub("attributes"); }}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  activeTab === key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(meta.label)}
                {count > 0 && <span className="text-[10px] text-muted-foreground">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "analytics" ? (
          <AttributesAnalyticsPanel onOpenAttribute={(r) => {
            setActiveTab(r.source);
            if (r.source === "web_content") setContentSub("attributes");
            setSelectedAttrId(r.id);
          }} />
        ) : (
        <div className="px-8 py-6">
        {/* Always-available, type-specific guide so teammates who join later can
            learn the full workflow. Shown once a tab has attributes; before that
            the empty-state guidance covers it. */}
        {!selectedAttrId && tabAttrs.length > 0 && (activeTab !== "web_content" || contentSub === "attributes") && (
          <PageGuide {...attributeGuide(t, activeTab)} />
        )}
        {activeTab === "rule" ? (
          selectedAttrId ? (
            <RuleDetail attributeId={selectedAttrId} onBack={() => setSelectedAttrId(null)} onEdit={(a) => setEditTarget(a)} />
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-secondary animate-pulse rounded-lg" />)}
            </div>
          ) : tabAttrs.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-12 text-center max-w-xl mx-auto mt-8">
              <SlidersHorizontal className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium mb-1">{t("No rule attributes yet")}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {t("Compute a value from profile fields - e.g. \"Engagement Level\" (High/Medium/Low) from GA sessions, or \"Life Stage\" from age. Works for customers and anonymous visitors.")}
              </p>
              <Button size="sm" className="gap-1.5" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
            </div>
          ) : (
            <CardGrid intro={t(SOURCES.rule.desc)} {...gridProps} />
          )
        ) : activeTab === "manual" ? (
          selectedAttrId ? (
            <ManualDetail attributeId={selectedAttrId} onBack={() => setSelectedAttrId(null)} onEdit={(a) => setEditTarget(a)} />
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-secondary animate-pulse rounded-lg" />)}
            </div>
          ) : tabAttrs.length === 0 ? (
            <div className="border border-dashed border-border rounded-lg p-12 text-center max-w-xl mx-auto mt-8">
              <UserCog className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium mb-1">{t("No manual attributes yet")}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {t("Define values (e.g. \"Account Tier\" → VIP / Standard) and assign people from a segment, a search, or a pasted list.")}
              </p>
              <Button size="sm" className="gap-1.5" disabled={!canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined} onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
            </div>
          ) : (
            <CardGrid intro={t(SOURCES.manual.desc)} {...gridProps} />
          )
        ) : (
          <>
            <GaPropertyBar />

            {/* Content sub-tabs */}
            <div className="flex items-center gap-1 mb-5 bg-secondary/40 rounded-lg p-1 w-fit">
              {CONTENT_SUBS.map(([k, label]) => (
                <button key={k} onClick={() => { setContentSub(k); setSelectedAttrId(null); }}
                  className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
                    contentSub === k ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {t(label)}
                  {k === "review" && reviewCount > 0 && (
                    <span className="text-[10px] h-4 min-w-4 px-1 rounded-full bg-yellow-500 text-white flex items-center justify-center">{reviewCount}</span>
                  )}
                </button>
              ))}
            </div>

            {ACTIVE_JOB(globalJob) && (
              <div className="mb-5 rounded-md border border-border bg-secondary/20 px-3 py-2">
                <JobStatus job={globalJob} onCancel={() => appClient.attributes.cancelJob(globalJob.id).then(() => qc.invalidateQueries({ queryKey: ["attribute-job", null] }))} />
              </div>
            )}

            {contentSub === "pages" ? (
              <PagesPanel />
            ) : contentSub === "review" ? (
              <ReviewPanel />
            ) : selectedAttrId ? (
              <AttributeDetail attributeId={selectedAttrId} onBack={() => setSelectedAttrId(null)} onEdit={(a) => setEditTarget(a)} onClone={(c) => { setContentSub("attributes"); setSelectedAttrId(c.id); }} />
            ) : isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-secondary animate-pulse rounded-lg" />)}
              </div>
            ) : tabAttrs.length === 0 ? (
              <FirstRunChecklist gaConnected={gaConnected} gaSynced={gaSynced} pagesCrawled={pagesCrawled} crawledPages={crawledPages}
                crawling={ACTIVE_JOB(globalJob) || crawlMut.isPending} onCrawl={() => crawlMut.mutate()}
                onCreate={() => setCreateOpen(true)} onSuggest={() => setSuggestOpen(true)} />
            ) : (
              <>
                {/* GA was disconnected (or never finished setup) but definitions are
                    kept - show the source-setup steps above the existing cards. */}
                {!canCreate && (
                  <FirstRunChecklist firstStepsOnly gaConnected={gaConnected} gaSynced={gaSynced} pagesCrawled={pagesCrawled} crawledPages={crawledPages}
                    crawling={ACTIVE_JOB(globalJob) || crawlMut.isPending} onCrawl={() => crawlMut.mutate()} />
                )}
                <CardGrid {...gridProps} />
              </>
            )}
          </>
        )}
        </div>
        )}
      </div>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{t("New")} {activeTab === "rule" ? t("Rule") + " " : activeTab === "manual" ? t("Manual") + " " : ""}{t("Attribute")}</DialogTitle></DialogHeader>
          <AttributeForm defaultSource={activeTab} onSubmit={(d) => createMut.mutate(d)} isPending={createMut.isPending} submitLabel={t("Create Attribute")} />
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{t("Edit Attribute")}</DialogTitle></DialogHeader>
          {editTarget && (
            <AttributeForm initial={editTarget} submitLabel={t("Save Changes")} isPending={editMut.isPending}
              onSubmit={(d) => editMut.mutate({ id: editTarget.id, data: { name: d.name, description: d.description, value_type: d.value_type, scope: d.scope, extract_from: d.extract_from } })} />
          )}
        </DialogContent>
      </Dialog>

      {/* AI suggestions */}
      <SuggestDialog open={suggestOpen} onClose={() => setSuggestOpen(false)}
        onCreate={createSuggestion} creatingName={createMut.isPending ? createMut.variables?.name : null} />

      {/* Import attributes (Content / Manual / Rule) from a CSV template */}
      <AttributeImportDialog open={importOpen} source={activeTab} attrs={tabAttrs}
        onClose={() => setImportOpen(false)} onImported={invalidate} />

      {/* Delete confirmation - removing an attribute also drops its values and tags */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">{t("Delete attribute?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{deleteTarget?.name}</strong> {t("and all its values, page tags, and profile tags will be permanently removed. This can't be undone.")}
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>{t("Cancel")}</Button>
            <Button variant="destructive" size="sm" disabled={deleteMut.isPending || !canWrite} title={!canWrite ? t("Viewers can't make changes") : undefined}
              onClick={() => {
                const id = deleteTarget.id;
                deleteMut.mutate(id);
                if (selectedAttrId === id) setSelectedAttrId(null);
                setDeleteTarget(null);
              }}>
              {deleteMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve duplicates before switching value_type to single */}
      {resolveDupes && (
        <ResolveDuplicatesDialog
          attributeId={resolveDupes.attrId}
          conflicts={resolveDupes.conflicts}
          onClose={() => setResolveDupes(null)}
          onResolved={() => {
            const { attrId, retryData } = resolveDupes;
            setResolveDupes(null);
            qc.invalidateQueries({ queryKey: ["attribute", attrId] });
            editMut.mutate({ id: attrId, data: retryData });
          }}
        />
      )}
    </div>
  );
}
