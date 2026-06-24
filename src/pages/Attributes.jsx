import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Tag, Globe, SlidersHorizontal, UserCog, MoreHorizontal, Trash2, Pencil,
  RefreshCw, Check, GitMerge, AlertCircle, Loader2, ExternalLink, Play,
  Search, RotateCcw, Ban, FlaskConical, ChevronLeft, ListChecks, X, Layers,
  FileText, Upload, ArrowRight, Download,
  Filter, ArrowUp, ArrowDown, ChevronDown, ChevronUp, History, Sparkles, Undo2, BarChart2, Clock,
  Copy, Lock, RotateCw, CheckCheck,
} from "lucide-react";
import { useStickyState } from "@/lib/useStickyState";
import { usePreferences } from "@/lib/PreferencesContext";
import AttributesAnalyticsPanel from "@/components/attributes/AttributesAnalyticsPanel";
import AttributeImportDialog from "@/components/attributes/AttributeImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        {onCancel && <button onClick={() => setConfirmCancel(true)} className="ml-1 hover:text-foreground underline">{t("cancel")}</button>}
      </div>

      {/* Cancelling stops the run mid-flight: AI tagging + profile updates for this
          run won't be applied, and the progress shown here resets to a fresh run. */}
      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-heading flex items-center gap-2"><AlertCircle className="w-4 h-4 text-foreground" /> {t("Cancel this run?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("This will stop the crawl right away. The AI tagging and profile updates for this run won't be applied, and you'll have to start a brand-new run to finish - the progress shown here resets to zero.")}
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(false)}>{t("Keep running")}</Button>
            <Button variant="default" size="sm" onClick={() => { setConfirmCancel(false); onCancel?.(); }}>{t("Cancel run")}</Button>
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

// ── Create / edit attribute form ──────────────────────────────
const EMPTY = { name: "", description: "", source: "web_content", value_type: "multi", scope: "both", extract_from: "both", status: "draft" };

// Default extraction prompt generated from the attribute name.
const defaultPrompt = (name) =>
  name.trim() ? `If any ${name.trim()} is found in the text, extract it. The value can be in English or Chinese.` : "";

const parseValues = (text) =>
  text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);

function AttributeForm({ initial, onSubmit, isPending, submitLabel, defaultSource }) {
  const { t } = usePreferences();
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

      <Button className="w-full" disabled={!form.name.trim() || isPending} onClick={submit}>
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
  groupingEnabled, groups = [], onSetGroup,
  selectable, selected, onToggleSelect, suggestion, onAcceptSuggestion,
}) {
  const { t } = usePreferences();
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
            onClick={() => onAcceptSuggestion(value, suggestion)}
            className="text-[10px] px-1.5 py-0.5 rounded-full border border-yellow-500/40 text-yellow-600 hover:bg-yellow-500/10 whitespace-nowrap flex items-center gap-1 flex-shrink-0">
            <GitMerge className="w-3 h-3" /> {suggestion.display_label || suggestion.value}?
          </button>
        )}
        {groupingEnabled && value.is_approved && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground whitespace-nowrap">
                {value.group_name || t("+ group")}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
              {groups.map((g) => (
                <DropdownMenuItem key={g} onClick={() => onSetGroup(value, g)}>{g}</DropdownMenuItem>
              ))}
              {groups.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onClick={() => { const g = window.prompt(t("New group name")); if (g && g.trim()) onSetGroup(value, g.trim()); }}>{t("New group…")}</DropdownMenuItem>
              {value.group_name && <DropdownMenuItem onClick={() => onSetGroup(value, null)}>{t("Clear group")}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {pending && (
            <button title={t("Approve")} onClick={() => onApprove(value)} className="p-1 hover:text-foreground text-muted-foreground"><Check className="w-3.5 h-3.5" /></button>
          )}
          {mergeTargets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button title={t("Merge into…")} className="p-1 hover:text-foreground text-muted-foreground"><GitMerge className="w-3.5 h-3.5" /></button>
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
            <button title={t("Delete")} onClick={() => onDelete(value)} className="p-1 hover:text-destructive text-muted-foreground"><Trash2 className="w-3.5 h-3.5" /></button>
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
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-secondary/40 group">
      <span className="text-sm truncate text-muted-foreground line-through max-w-[40%]">{value.display_label || value.value}</span>
      <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-sm flex-1 truncate font-medium">{target ? (target.display_label || target.value) : <span className="text-muted-foreground italic">{t("unknown")}</span>}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {targets.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title={t("Change merge target")} className="p-1 hover:text-foreground text-muted-foreground"><GitMerge className="w-3.5 h-3.5" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
              <p className="text-[10px] text-muted-foreground px-2 py-1">{t("Merge into instead")}</p>
              {targets.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => onChangeTarget(value, t.id)}>{t.display_label || t.value}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button title={t("Un-merge (restore as its own value)")} onClick={() => onUnmerge(value)} className="p-1 hover:text-foreground text-muted-foreground"><Undo2 className="w-3.5 h-3.5" /></button>
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
          <Button className="w-full" disabled={!trimmed || dupe} onClick={submit}>{t("Add")} {dim.toLowerCase()}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Attribute detail (inline panel) ───────────────────────────
// Dry-run Test tab: manage a sample link pool (GA top-50 or manual upload) and
// run the AI extraction against a selection, a one-off URL, or top crawled pages.
function TestTab({
  testLinks, testResults, testUrl, setTestUrl, linkPaste, setLinkPaste,
  testMut, uploadLinksMut, refreshLinksMut, linkModeMut, selectLinkMut, delLinkMut,
}) {
  const { t } = usePreferences();
  const links = testLinks?.links || [];
  const max = testLinks?.max || 50;
  const refreshMode = testLinks?.refresh_mode || "static";
  const manualCount = links.filter((l) => l.source === "manual").length;
  const selectedCount = links.filter((l) => l.is_selected).length;
  const upload = () => {
    const urls = linkPaste.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (urls.length) uploadLinksMut.mutate(urls);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        {t("Dry-run - see what the AI would extract; nothing is saved. Leave the URL blank to test your 50 most-visited valid pages (ranked by Google Analytics traffic).")}
      </p>

      {/* One-off URL + run buttons */}
      <div className="flex flex-wrap gap-2">
        <Input value={testUrl} onChange={(e) => setTestUrl(decodeUrl(e.target.value))}
          placeholder={t("Optional: https://… a specific page")} className="h-8 text-sm flex-1 min-w-[14rem]" />
        <Button size="sm" variant="outline" className="h-8" disabled={testMut.isPending}
          onClick={() => testMut.mutate(testUrl.trim() ? { url: testUrl.trim() } : {})}>
          {testMut.isPending && !testMut.variables?.use_test_links ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (testUrl.trim() ? t("Test this URL") : t("Test top pages"))}
        </Button>
        <Button size="sm" className="h-8 gap-1.5" disabled={testMut.isPending || selectedCount === 0}
          onClick={() => testMut.mutate({ use_test_links: true })} title={selectedCount === 0 ? t("Select some test links first") : ""}>
          {testMut.isPending && testMut.variables?.use_test_links ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          {t("Run on")} {selectedCount} {t("selected")}
        </Button>
      </div>

      {/* Test-link pool management */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Test links")} · {links.length}/{max * 2}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={refreshLinksMut.isPending}
              onClick={() => refreshLinksMut.mutate()}>
              {refreshLinksMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} {t("Load top")} {max} {t("from GA")}
            </Button>
            <button onClick={() => linkModeMut.mutate(refreshMode === "daily" ? "static" : "daily")}
              className={`text-[11px] px-2 py-1 rounded-md border ${refreshMode === "daily" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"}`}
              title={t("Re-pull the GA top pages automatically each day")}>
              {t("Refresh daily:")} {refreshMode === "daily" ? t("on") : t("off")}
            </button>
          </div>
        </div>

        {/* Manual upload */}
        <div className="flex gap-2 items-start">
          <Textarea value={linkPaste} onChange={(e) => setLinkPaste(e.target.value)} rows={2}
            placeholder={t("Paste URLs to add (one per line, up to") + ` ${max} ` + t("manual)…")} className="text-xs flex-1" />
          <Button size="sm" variant="outline" className="h-8" disabled={!linkPaste.trim() || uploadLinksMut.isPending || manualCount >= max}
            onClick={upload}>{t("Add")}</Button>
        </div>

        {/* Select-all / clear */}
        {links.length > 0 && (
          <div className="flex items-center gap-3 text-[11px]">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => selectLinkMut.mutate({ ids: null, is_selected: true })}>{t("Select all")}</button>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => selectLinkMut.mutate({ ids: null, is_selected: false })}>{t("Clear")}</button>
            <span className="text-muted-foreground ml-auto">{selectedCount} {t("selected for the dry-run")}</span>
          </div>
        )}

        {/* Link list */}
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">
            {t("No test links yet. Load the top")} {max} {t("pages from Google Analytics, or paste your own above.")}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-border/60">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-2 py-1.5 group">
                <input type="checkbox" checked={l.is_selected} className="accent-foreground flex-shrink-0"
                  onChange={() => selectLinkMut.mutate({ ids: [l.id], is_selected: !l.is_selected })} />
                <span className="text-xs truncate flex-1" title={decodeUrl(l.url)}>{decodeUrl(l.url)}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1">{l.source === "ga" ? "GA" : t("manual")}</Badge>
                <button onClick={() => delLinkMut.mutate(l.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
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
  const qc = useQueryClient();
  const [tab, setTab] = useState("values");
  const [newValue, setNewValue] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [groupLabel, setGroupLabel] = useState("");
  const [valueSearch, setValueSearch] = useState("");
  const [extraGroups, setExtraGroups] = useState([]); // manually-created groups not yet assigned a value
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [reviewSel, setReviewSel] = useState(() => new Set()); // selected review-queue values for bulk actions
  const [approvedSel, setApprovedSel] = useState(() => new Set()); // selected approved values for bulk merge/group
  const [showHistory, setShowHistory] = useState(false);
  const [linkPaste, setLinkPaste] = useState("");

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
      if (attr?.group_label) toast.warning(t("Assign this value a") + ` ${attr.group_label} ` + t("group in the Groups tab."));
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
  const groupLabelMut = useMutation({
    mutationFn: (label) => appClient.attributes.update(attributeId, { group_label: label || null }),
    onSuccess: invalidate,
  });
  const autogroupMut = useMutation({
    mutationFn: (label) => appClient.attributes.autogroup(attributeId, label),
    onSuccess: (r) => { toast.success(`${t("Grouped")} ${r.grouped} ${r.grouped === 1 ? t("value") : t("values")}`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const setGroupMut = useMutation({
    mutationFn: ({ id, group_name }) => appClient.attributes.updateValue(id, { group_name }),
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
  const uploadLinksMut = useMutation({
    mutationFn: (urls) => appClient.attributes.uploadTestLinks(urls),
    onSuccess: (r) => { toast.success(`${t("Added")} ${r.added} ${r.added === 1 ? t("link") : t("links")}`); setLinkPaste(""); invalidateTestLinks(); },
    onError: (e) => toast.error(e.message),
  });
  const refreshLinksMut = useMutation({
    mutationFn: () => appClient.attributes.refreshTestLinks(),
    onSuccess: (r) => { toast.success(`${t("Loaded")} ${r.count} ${r.count === 1 ? t("top page from GA") : t("top pages from GA")}`); invalidateTestLinks(); },
    onError: (e) => toast.error(e.message),
  });
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

  useEffect(() => { setGroupLabel(attr?.group_label || ""); }, [attr?.group_label]);

  const values = attr?.values || [];
  const pending = values.filter((v) => v.is_exception && !v.is_approved && !v.merged_into && !v.is_blocked);
  const approved = values.filter((v) => v.is_approved && !v.merged_into);
  const merged = values.filter((v) => v.merged_into);
  const valueById = Object.fromEntries(values.map((v) => [v.id, v]));
  const groupingEnabled = !!attr?.group_label;
  const groupNames = [...new Set(approved.map((v) => v.group_name).filter(Boolean))].sort();
  const allGroups = [...new Set([...groupNames, ...extraGroups])].sort();
  const setGroup = (v, g) => setGroupMut.mutate({ id: v.id, group_name: g });
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
          <button onClick={() => cloneMut.mutate()} disabled={cloneMut.isPending} title={t("Clone into a new draft")} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
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
                <Select value={attr.status} onValueChange={(v) => statusMut.mutate(v)}>
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
                  {attr.status === "active" ? (
                    <Button size="sm" className="h-8 gap-1.5" disabled={ACTIVE_JOB(job) || runMut.isPending}
                      onClick={() => runMut.mutate()}>
                      <RefreshCw className="w-3.5 h-3.5" /> {t("Reconstruct")}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-8 gap-1.5" disabled={ACTIVE_JOB(job) || runMut.isPending || statusMut.isPending}
                      title={t("Activates this attribute, then runs a reconstruct")}
                      onClick={() => statusMut.mutate("active", { onSuccess: () => runMut.mutate() })}>
                      <Play className="w-3.5 h-3.5" /> {t("Activate & Reconstruct")}
                    </Button>
                  )}
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
              {[["values", `${t("Values")} (${approved.length})`], ...(attr.source === "web_content" ? [["test", t("Test")]] : []), ["groups", attr.group_label ? `${t("Groups")} (${groupNames.length})` : t("Groups")], ["pages", t("Tagged pages")]].map(([k, label]) => (
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
                    <Button size="sm" variant="outline" className="h-8" disabled={!newValue.trim() || addValueMut.isPending}
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
                              <Button size="sm" variant="outline" className="h-7 gap-1" disabled={bulkMut.isPending}
                                onClick={() => bulkMut.mutate({ ids: [...reviewSel], action: "approve" })}>
                                <Check className="w-3 h-3" /> {t("Approve")}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" disabled={bulkMut.isPending}
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
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={bulkMut.isPending || !mergeTargets.length}>
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
                            {groupingEnabled && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={bulkMut.isPending}>
                                    <Layers className="w-3 h-3" /> {t("Set")} {attr.group_label}…
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                                  {allGroups.map((g) => (
                                    <DropdownMenuItem key={g} onClick={() => bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { group_name: g } })}>{g}</DropdownMenuItem>
                                  ))}
                                  {allGroups.length > 0 && <DropdownMenuSeparator />}
                                  <DropdownMenuItem onClick={() => { const g = window.prompt(`${t("New")} ${attr.group_label} ${t("group")}`); if (g && g.trim()) bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { group_name: g.trim() } }); }}>{t("New group…")}</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => bulkMut.mutate({ ids: [...approvedSel], action: "set_group", extra: { group_name: null } })}>{t("Clear group")}</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
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
                                groupingEnabled={groupingEnabled} groups={allGroups} onSetGroup={setGroup}
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
                  linkPaste={linkPaste} setLinkPaste={setLinkPaste}
                  testMut={testMut} uploadLinksMut={uploadLinksMut} refreshLinksMut={refreshLinksMut}
                  linkModeMut={linkModeMut} selectLinkMut={selectLinkMut} delLinkMut={delLinkMut}
                />
              ) : tab === "groups" ? (
                <div className="space-y-3">
                  {/* Grouping dimension */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <Input value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)}
                        placeholder={t("Group values by… e.g. Continent, Faculty")} className="h-8 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") groupLabelMut.mutate(groupLabel.trim()); }} />
                      {groupLabel.trim() !== (attr.group_label || "") && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => groupLabelMut.mutate(groupLabel.trim())}>{t("Save")}</Button>
                      )}
                      <Button size="sm" variant="outline" className="h-8 flex-shrink-0" disabled={!groupingEnabled}
                        onClick={() => setAddGroupOpen(true)}>
                        {t("Add group")}
                      </Button>
                      <Button size="sm" className="h-8 flex-shrink-0" disabled={!groupLabel.trim() || autogroupMut.isPending || approved.length === 0}
                        onClick={() => autogroupMut.mutate(groupLabel.trim())}>
                        {autogroupMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Group with AI")}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("Roll values up into a higher-level dimension (e.g. Country → Continent) so you can target a whole group in Segments. Set a dimension, then group with AI - or add groups and assign values yourself. To delete a value, use the")} <strong>{t("Values")}</strong> {t("tab.")}</p>
                  </div>

                  {/* No ungrouped values allowed once a dimension exists. */}
                  {groupingEnabled && (() => {
                    const ungrouped = approved.filter((v) => !v.group_name);
                    if (!ungrouped.length) return null;
                    return (
                      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-yellow-700">{ungrouped.length} {ungrouped.length === 1 ? t("value") : t("values")} {t("not yet in a")} {attr.group_label} {t("group")}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {t("Every value must belong to a group so it can be targeted. Assign")} {ungrouped.length === 1 ? t("it") : t("them")} {t("below, or group automatically.")}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs flex-shrink-0" disabled={autogroupMut.isPending}
                          onClick={() => autogroupMut.mutate(attr.group_label)}>
                          {autogroupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {t("Group with AI")}
                        </Button>
                      </div>
                    );
                  })()}

                  {!groupingEnabled ? (
                    <div className="border border-dashed border-border rounded-lg p-8 text-center">
                      <Layers className="w-7 h-7 text-muted-foreground mx-auto mb-2 opacity-40" />
                      <p className="text-sm font-medium mb-1">{t("No grouping yet")}</p>
                      <p className="text-xs text-muted-foreground">{t("Name a dimension above (e.g. “Continent”), then")} <strong>{t("Group with AI")}</strong> {t("to organise your")} {approved.length} {approved.length === 1 ? t("value") : t("values")} - {t("or add groups and assign values by hand.")}</p>
                    </div>
                  ) : approved.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded">{t("No values to group yet.")}</p>
                  ) : (
                    [...allGroups, null].map((gname) => {
                      const inGroup = approved.filter((v) => (v.group_name || null) === gname);
                      if (gname === null && !inGroup.length) return null; // hide empty "Ungrouped"
                      const reach = inGroup.reduce((s, v) => s + Number(v.profile_count || 0), 0);
                      return (
                        <div key={gname || "__ungrouped"} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-semibold">{gname || t("Ungrouped")}</p>
                            <span className="text-[10px] text-muted-foreground">{inGroup.length} {inGroup.length === 1 ? t("value") : t("values")}{reach ? ` · ${reach.toLocaleString()} ${t("profile tags")}` : ""}</span>
                          </div>
                          {inGroup.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground">{t("Empty - open a value's group menu and choose")} “{gname}”.</p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                              {inGroup.map((v) => (
                                <ValueRow key={v.id} value={v} siblings={values} groupingEnabled groups={allGroups} onSetGroup={setGroup}
                                  canDelete={false} canMerge={false}
                                  onApprove={(x) => approveMut.mutate(x.id)} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">{t("Pages tagged by this attribute, with the values the AI assigned. Remove any wrong tag with the ✕ - it updates targeting immediately.")}</p>
                  {pages.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">{t("No tagged pages yet. Run a reconstruct to crawl and tag pages.")}</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {pages.map((pg) => (
                    <div key={pg.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{pg.title || pg.url}</p>
                          <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate">
                            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
                          </a>
                        </div>
                        {pg.fetch_method && pg.fetch_method !== "http" && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 flex-shrink-0" title={t("Scraped with a headless browser")}>{pg.fetch_method}</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(pg.values || []).map((v) => (
                          <span key={v.id} className="text-[10px] pl-2 pr-1 py-0.5 rounded-full bg-secondary/60 border border-border flex items-center gap-1">
                            {v.value}
                            <button onClick={() => untagMut.mutate({ pageId: pg.id, valueId: v.id })} title={t("Remove this tag")}
                              className="text-muted-foreground hover:text-destructive">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      <AddGroupDialog open={addGroupOpen} onClose={() => setAddGroupOpen(false)}
        dimension={attr?.group_label} existing={allGroups}
        onAdd={(g) => setExtraGroups((p) => [...new Set([...p, g])])} />
    </div>
  );
}

// ── Crawled pages sub-tab ─────────────────────────────────────
const PAGE_VIEWS = [["valid", "Valid"], ["failed", "Failed"], ["excluded", "Excluded"]];

// Add-exclusions modal: single, paste a list, or upload a file (modeled on EDM's
// "Add to Suppression List"). Patterns are substrings or globs ("/about/*").
function ExclusionsDialog({ open, onClose, existing, onAdd }) {
  const { t } = usePreferences();
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
        <Button className="w-full" disabled={!fresh.length} onClick={submit}>
          {t("Add")}{fresh.length ? ` ${fresh.length}` : ""} {fresh.length === 1 ? t("exclusion") : t("exclusions")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function PagesPanel() {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [view, setView] = useState("valid");
  const [search, setSearch] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [exclOpen, setExclOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["web-pages", view, search],
    queryFn: () => appClient.attributes.webPages({ status: view, search, limit: 200 }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["web-pages"] });
  const addMut = useMutation({
    mutationFn: (url) => appClient.attributes.addWebPage(url),
    onSuccess: (r) => { setNewUrl(""); invalidate(); r.ok ? toast.success(t("Page added")) : toast.error(t("Couldn't read that page:") + ` ${r.reason || t("no content")}`); },
    onError: (e) => toast.error(e.message),
  });
  const exclMut = useMutation({
    mutationFn: ({ id, is_excluded }) => appClient.attributes.updateWebPage(id, { is_excluded }),
    onSuccess: invalidate,
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
          <button title={t("Re-scrape this page")} onClick={() => rerunMut.mutate({ ids: [pg.id], mode: "scrape" })} disabled={rerunMut.isPending}
            className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0">
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        )}
        {view === "valid" && (
          <button title={t("Re-tag this page")} onClick={() => rerunMut.mutate({ ids: [pg.id], mode: "tag" })} disabled={rerunMut.isPending}
            className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button title={pg.is_excluded ? t("Re-include in crawling") : t("Exclude from crawling")} onClick={() => exclMut.mutate({ id: pg.id, is_excluded: !pg.is_excluded })}
          className="p-1 text-muted-foreground hover:text-foreground flex-shrink-0">
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
        <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={crawlMut.isPending || !cs?.ga_connected}
          onClick={() => crawlMut.mutate()}
          title={!cs?.ga_connected
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

      {/* Valid: add a missed page */}
      {view === "valid" && (
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-2">{t("Pages the AI crawled successfully, with the values it tagged each with.")}</p>
          <div className="flex gap-2 max-w-md">
            <Input value={newUrl} onChange={(e) => setNewUrl(decodeUrl(e.target.value))} placeholder={t("https://… add a page the crawler missed")} className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) addMut.mutate(newUrl.trim()); }} />
            <Button size="sm" className="h-8" disabled={!newUrl.trim() || addMut.isPending} onClick={() => addMut.mutate(newUrl.trim())}>
              {addMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("Add")}
            </Button>
          </div>
        </div>
      )}

      {/* Failed: intro */}
      {view === "failed" && (
        <p className="text-xs text-muted-foreground mb-3">{t("Pages the crawler couldn't read - blocked, empty, or an error page. These are never tagged.")}</p>
      )}

      {/* Excluded: rule manager */}
      {view === "excluded" && (
        <div className="rounded-lg border border-border bg-secondary/10 p-3 mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium">{t("Exclusion rules")} · {patterns.length}</p>
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setExclOpen(true)}>
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
                  <button title={t("Remove rule")} onClick={() => patternMut.mutate(patterns.filter((x) => x !== p))} className="text-muted-foreground hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
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
            {view === "valid" ? t("No valid pages yet. Run a reconstruct to crawl and tag your site.")
              : view === "failed" ? t("No failed pages.")
              : t("No individual pages excluded. Add a rule above, or exclude a page from the Valid view.")}
          </p>
        ) : pages.map(renderPage)}
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
function ReviewPanel() {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("new"); // new | all

  const { data, isLoading } = useQuery({
    queryKey: ["attr-tagged-pages", filter],
    queryFn: () => appClient.attributes.taggedPages(filter === "new" ? "new" : null),
  });
  const pages = data?.pages || [];
  const summary = data?.summary || { new_pages: 0, new_labels: 0 };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["attr-tagged-pages"] });
    qc.invalidateQueries({ queryKey: ["attributes"] });
  };
  const reviewMut = useMutation({ mutationFn: (pageId) => appClient.attributes.reviewPage(pageId), onSuccess: invalidate });
  const reviewAllMut = useMutation({ mutationFn: () => appClient.attributes.reviewAllPages(), onSuccess: () => { toast.success(t("All pages marked reviewed")); invalidate(); } });
  const untagMut = useMutation({ mutationFn: ({ pageId, valueId }) => appClient.attributes.deletePageTag(pageId, valueId), onSuccess: invalidate });

  if (isLoading) return <p className="text-xs text-muted-foreground py-8 text-center">{t("Loading…")}</p>;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground max-w-xl">
            {t("Pages the AI has tagged. Verify a page to confirm its labels; remove any wrong tag with the ✕ - it updates targeting immediately.")}
          </p>
          {(summary.new_pages > 0 || summary.new_labels > 0) && (
            <p className="text-[11px] text-yellow-600 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {summary.new_pages} {summary.new_pages === 1 ? t("new page") : t("new pages")} · {summary.new_labels} {summary.new_labels === 1 ? t("new label") : t("new labels")} {t("to review")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1">
            {[["new", t("New to review")], ["all", t("All tagged")]].map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`text-[11px] px-2 py-1 rounded-md border ${filter === k ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
          {pages.some((p) => p.needs_review) && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={reviewAllMut.isPending}
              onClick={() => reviewAllMut.mutate()}>
              <CheckCheck className="w-3 h-3" /> {t("Mark all reviewed")}
            </Button>
          )}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center max-w-lg mx-auto mt-6">
          <ListChecks className="w-7 h-7 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium mb-1">{filter === "new" ? t("Nothing new to review") : t("No tagged pages yet")}</p>
          <p className="text-xs text-muted-foreground">{filter === "new" ? t("New pages and labels show up here after a reconstruct.") : t("Run a reconstruct to crawl and tag your pages.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pages.map((pg) => (
            <div key={pg.id} className={`border rounded-lg p-3 ${pg.needs_review ? "border-yellow-500/40 bg-yellow-500/5" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate flex items-center gap-1.5">
                    {pg.needs_review && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0" title={t("Needs review")} />}
                    {pg.title || decodeUrl(pg.url)}
                  </p>
                  <a href={pg.url} target="_blank" rel="noreferrer" className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 truncate">
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> {decodeUrl(pg.url)}
                  </a>
                </div>
                {pg.needs_review && (
                  <Button size="sm" variant="outline" className="h-6 px-2 gap-1 text-[11px] flex-shrink-0" disabled={reviewMut.isPending}
                    onClick={() => reviewMut.mutate(pg.id)}>
                    <Check className="w-3 h-3" /> {t("Verify")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(pg.tags || []).map((tg) => (
                  <span key={tg.value_id}
                    className={`group/tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                      tg.is_approved ? "border-foreground/40 bg-secondary text-foreground"
                        : tg.is_new ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-700"
                        : "bg-background border-border"
                    }`}
                    title={`${tg.attribute}: ${tg.label || tg.value}${tg.is_approved ? ` · ${t("verified")}` : tg.is_new ? ` · ${t("new")}` : ` · ${t("pending")}`}`}>
                    {tg.is_approved && <Check className="w-2.5 h-2.5 flex-shrink-0" />}
                    <span className="text-muted-foreground">{tg.attribute}:</span> {tg.label || tg.value}
                    <button onClick={() => untagMut.mutate({ pageId: pg.id, valueId: tg.value_id })}
                      className="opacity-0 group-hover/tag:opacity-100 hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attribute card ────────────────────────────────────────────
function AttributeCard({ attr, onOpen, onDelete, onEdit, onClone }) {
  const { t } = usePreferences();
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
            {onClone && <DropdownMenuItem onClick={onClone}><Copy className="w-3.5 h-3.5 mr-2" /> {t("Clone")}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive"><Trash2 className="w-3.5 h-3.5 mr-2" /> {t("Delete")}</DropdownMenuItem>
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
                      disabled={isCreated || creatingName === s.name}
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
    <div className={`border border-border rounded-lg p-6 max-w-xl mx-auto space-y-5 ${firstStepsOnly ? "mb-6" : "mt-6"}`}>
      <div className="text-center">
        <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium">{t("Get started with content attributes")}</p>
        <p className="text-xs text-muted-foreground">
          {firstStepsOnly
            ? t("Google Analytics is disconnected. Your attribute definitions are kept - reconnect, sync, and re-crawl to tag your pages again.")
            : t("The AI reads your website, tags each page, and visitors inherit those tags - even anonymous ones.")}
        </p>
      </div>
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
                <Button size="sm" className="h-8 gap-1.5" onClick={onCrawl} disabled={!gaSynced || crawling}>
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
                <Button size="sm" className="h-8 gap-1.5" onClick={onCreate} disabled={!canCreate}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onSuggest} disabled={!canCreate}><Sparkles className="w-3.5 h-3.5" /> {t("Suggest with AI")}</Button>
              </div>
            </Step>
            <Step done={false} n={5} current={currentN === 5} title={t("Reconstruct to tag your pages")}>
              {t("Open the attribute and hit")} <strong>{t("Reconstruct")}</strong> - {t("the AI crawls, tags, and propagates to profiles.")}
            </Step>
          </>
        )}
      </div>
    </div>
  );
}

// ── Rule attribute builder ────────────────────────────────────
function EnumMulti({ options, value, onChange }) {
  const { t } = usePreferences();
  const sel = Array.isArray(value) ? value : [];
  const toggle = (o) => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="h-8 px-2 text-xs border border-input rounded-md bg-background min-w-[8rem] max-w-[16rem] text-left truncate">
          {sel.length ? sel.join(", ") : <span className="text-muted-foreground">{t("Select…")}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
        {options.length === 0 && <p className="text-[11px] text-muted-foreground px-2 py-1">{t("No values found")}</p>}
        {options.map((o) => (
          <DropdownMenuItem key={o} onSelect={(e) => e.preventDefault()} onClick={() => toggle(o)}>
            <span className="mr-2">{sel.includes(o) ? "☑" : "☐"}</span>{o}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

function ConditionRow({ cond, fieldDefs, optsFor, refOptionsFor, onChange, onRemove, canRemove }) {
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
      {def?.type === "enum" && <EnumMulti options={optsFor(def.options)} value={cond.value} onChange={(v) => onChange({ value: v })} />}
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
      {def?.type === "refmulti" && <RefMulti options={refOptionsFor(def.optionsSource)} value={cond.value} onChange={(v) => onChange({ value: v })} />}
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
function GroupBlock({ group, fieldDefs, optsFor, refOptionsFor, onChange, onRemove, canRemove }) {
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
          <ConditionRow key={i} cond={c} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor}
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

function RuleRow({ rule, idx, scope, timePeriod, fieldDefs, optsFor, refOptionsFor, onChange, onRemove, canRemove }) {
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
            <GroupBlock group={g} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor}
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
  const statusMut = useMutation({ mutationFn: (status) => appClient.attributes.update(attributeId, { status }), onSuccess: invalidate });
  const recomputeMut = useMutation({
    mutationFn: async () => { await appClient.attributes.update(attributeId, { rule: { match: "first", time_period: timePeriod || null, daily_refresh: dailyRefresh, rules: cleanRules } }); return appClient.attributes.recompute(attributeId); },
    onSuccess: (r) => { toast.success(`${t("Saved - tagged")} ${Number(r.tagged).toLocaleString()} ${t("profiles")}`); invalidate(); },
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

          <div className="flex items-center justify-between gap-3 mt-3 pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Select value={attr.status} onValueChange={(v) => statusMut.mutate(v)}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t("Draft")}</SelectItem>
                  <SelectItem value="active">{t("Active")}</SelectItem>
                  <SelectItem value="archived">{t("Archived")}</SelectItem>
                </SelectContent>
              </Select>
              {attr.last_run_date && <span className="text-[11px] text-muted-foreground">{t("Updated")} {formatDistanceToNow(new Date(attr.last_run_date), { addSuffix: true })}</span>}
            </div>
            <Button size="sm" className="h-8 gap-1.5" disabled={recomputeMut.isPending || !cleanRules.length} onClick={() => recomputeMut.mutate()}>
              {recomputeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("Save & apply")}
            </Button>
          </div>

          <StatusReminder status={attr.status} />

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
                      : t("Tags stay frozen between manual reapplies - nothing is added or dropped automatically. Use Save & apply to re-derive on demand.")}
                  </p>
                </div>
              </div>
              <Switch checked={dailyRefresh} onCheckedChange={setDailyRefresh} className="flex-shrink-0 mt-0.5" />
            </div>
          </div>

          {/* Time period: re-aggregates activity & purchase metrics over a window */}
          <div className={`mt-3 rounded-lg border p-3 transition-colors ${timePeriod ? "border-foreground/30 bg-secondary/40" : "border-border bg-secondary/10"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <Clock className={`w-4 h-4 flex-shrink-0 ${timePeriod ? "text-foreground" : "text-muted-foreground"}`} />
              <span className="text-xs font-medium">{t("Time period")}</span>
              <Select value={timePeriod || "all"} onValueChange={(v) => setTimePeriod(v === "all" ? "" : v)}>
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
              <RuleRow key={i} rule={r} idx={i} scope={scope} timePeriod={timePeriod} fieldDefs={fieldDefs} optsFor={optsFor} refOptionsFor={refOptionsFor}
                onChange={(nr) => setRules((rs) => rs.map((x, j) => (j === i ? nr : x)))}
                onRemove={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                canRemove={rules.length > 1} />
            ))}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setRules((rs) => [...rs, BLANK_RULE()])}>
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
              <Button className="flex-1" disabled={busy} onClick={() => conflicts.retry()}>
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
            <Button className="w-full" disabled={!segmentId || segMut.isPending} onClick={() => segMut.mutate()}>
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
            <Button className="w-full" disabled={!picked.size || pickMut.isPending} onClick={() => pickMut.mutate()}>
              {pickMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `${t("Assign")} ${picked.size || ""} ${t("selected")}`}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">{t("Paste")} {entityType === "customer" ? t("emails or member IDs") : t("visitor IDs")} - {t("one per line or comma-separated. Unknown ones are skipped.")}</p>
            <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} className="text-sm"
              placeholder={entityType === "customer" ? "john@example.com\njane@example.com" : "apid-123\napid-456"} />
            <Button className="w-full" disabled={!pasteText.trim() || importMut.isPending} onClick={() => importMut.mutate()}>
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
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onAssign(value)}><Plus className="w-3 h-3" /> {t("Assign")}</Button>
        <button onClick={() => onDelete(value)} title={t("Delete value")} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 pl-5">
          {people.length === 0 ? <p className="text-[11px] text-muted-foreground">{t("No one assigned yet - use")} <strong>{t("Assign")}</strong>.</p>
            : people.map((p) => (
              <div key={`${p.entity_type}:${p.entity_id}`} className="flex items-center gap-2 text-xs py-0.5">
                <span className="flex-1 truncate">{p.name || p.email || p.entity_id}{p.name && p.email ? <span className="text-muted-foreground"> · {p.email}</span> : null}</span>
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 flex-shrink-0">{p.entity_type === "anonymous" ? t("anon") : t("customer")}</Badge>
                <button onClick={() => unassignMut.mutate({ entity_id: p.entity_id, entity_type: p.entity_type })} className="text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ManualDetail({ attributeId, onBack, onEdit }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [newValue, setNewValue] = useState("");
  const [assignFor, setAssignFor] = useState(null);

  const { data: attr } = useQuery({ queryKey: ["attribute", attributeId], queryFn: () => appClient.attributes.get(attributeId), enabled: !!attributeId });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["attribute", attributeId] }); qc.invalidateQueries({ queryKey: ["attributes"] }); };
  const statusMut = useMutation({ mutationFn: (status) => appClient.attributes.update(attributeId, { status }), onSuccess: invalidate });
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

          <div className="flex items-center gap-2 mt-3 pb-3 border-b border-border">
            <Select value={attr.status} onValueChange={(v) => statusMut.mutate(v)}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("Draft")}</SelectItem>
                <SelectItem value="active">{t("Active")}</SelectItem>
                <SelectItem value="archived">{t("Archived")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <StatusReminder status={attr.status} />

          <div className="flex gap-2 mt-4">
            <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={t("Add a value (e.g. VIP)")} className="h-8 text-sm flex-1"
              onKeyDown={(e) => { if (e.key === "Enter" && newValue.trim()) addValueMut.mutate(newValue.trim()); }} />
            <Button size="sm" variant="outline" className="h-8 flex-shrink-0" disabled={!newValue.trim() || addValueMut.isPending} onClick={() => addValueMut.mutate(newValue.trim())}>{t("Add value")}</Button>
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
          <Button className="flex-1" disabled={resolveMut.isPending} onClick={() => resolveMut.mutate()}>
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
      ) : gridGroups.map((group) => (
        <div key={group.key} className="mb-8">
          {groupByStatus && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t(group.label)}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedAttrs.filter(group.filter).map((attr) => (
              <AttributeCard key={attr.id} attr={attr}
                onOpen={() => onOpen(attr)} onEdit={() => onEdit(attr)} onDelete={() => onDelete(attr)}
                onClone={onClone ? () => onClone(attr) : undefined} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function Attributes() {
  const { t } = usePreferences();
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
  const reviewCount = attributes
    .filter((a) => a.source === "web_content")
    .reduce((n, a) => n + Number(a.pending_count || 0), 0);
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
                <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={running}
                  onClick={() => {
                    if (activeCount === 0) { toast.error(t("No active attributes - set at least one attribute to Active first.")); return; }
                    runAllMut.mutate();
                  }}>
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {running ? t("Running…") : t("Reconstruct all")}
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!canCreate} title={createGateMsg}
                onClick={() => setSuggestOpen(true)}><Sparkles className="w-3.5 h-3.5" /> {t("Suggest with AI")}</Button>
              <Button size="sm" className="h-9 gap-1.5" disabled={!canCreate} title={createGateMsg}
                onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
            </div>
            );
          })()}
          {(activeTab === "rule" || activeTab === "manual") && !selectedAttrId && (
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
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
              <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
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
              <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> {t("New Attribute")}</Button>
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
            <Button variant="destructive" size="sm" disabled={deleteMut.isPending}
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
