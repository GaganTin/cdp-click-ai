import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Link as LinkIcon, BarChart2,
  Lock, Search, Filter, X,
  ArrowUp, ArrowDown, ArrowUpDown, Info, Upload,
  ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { useStickyState } from "@/lib/useStickyState";
import { usePlan } from "@/lib/usePlan";
import { usePreferences } from "@/lib/PreferencesContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import UTMForm, { buildUTMUrl } from "../components/campaigns/UTMForm";
import UTMAnalyticsPanel, { GAUtmLinksSection, GA_PERIODS } from "../components/campaigns/UTMAnalyticsPanel";
import UTMImportDialog from "../components/import/UTMImportDialog";

// Portal-rendered tooltip so it escapes the table's overflow-auto clipping (the
// in-flow absolute version got cut off / overlapped by adjacent header cells).
function ColInfo({ text }) {
  const iconRef = useRef(null);
  const [coords, setCoords] = useState(null);

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect();
    if (r) setCoords({ left: r.left + r.width / 2, top: r.top });
  };
  const hide = () => setCoords(null);

  return (
    <span
      ref={iconRef}
      className="ml-0.5 inline-flex items-center cursor-default"
      onClick={e => e.stopPropagation()}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <Info className="w-3 h-3 opacity-40 hover:opacity-80 transition-opacity" />
      {coords && createPortal(
        <span
          style={{ position: "fixed", left: coords.left, top: coords.top - 8, transform: "translate(-50%, -100%)" }}
          className="pointer-events-none z-[100] w-56 p-2.5 text-[11px] leading-relaxed bg-popover border border-border rounded-lg shadow-lg text-foreground font-normal normal-case tracking-normal text-left whitespace-normal"
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}

const GROUPS = [
  { key: "active",    label: "Active",    filter: c => c.status === "active" },
  { key: "draft",     label: "Draft",     filter: c => c.status === "draft" },
  { key: "paused",    label: "Paused",    filter: c => c.status === "paused" },
  { key: "completed", label: "Completed", filter: c => c.status === "completed" },
  { key: "archived",  label: "Archived",  filter: c => c.status === "archived" },
];

const STATUS_OPTIONS = ["active", "paused", "completed", "archived"];

export default function Campaigns() {
  const { t } = usePreferences();
  const [tab, setTab] = useState("utm");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: [], source: [], medium: [], campaign: [], content: [], term: [] });
  const [gaAnalytics, setGaAnalytics] = useState({});
  const [gaLoading, setGaLoading] = useState(false);
  // Time period for the "GA Traffic Performance" table (all time by default).
  const [gaPeriod, setGaPeriod] = useStickyState("all", "utm.gaPeriod");

  // Row selection
  const [selected, setSelected] = useState(new Set());
  const [batchStatusOpen, setBatchStatusOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // Import (UI lives in the shared UTMImportDialog)
  const [importOpen, setImportOpen] = useState(false);

  // Group by status (toggle); when off, show one flat sorted table.
  const [groupByStatus, setGroupByStatus] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  // Column sort. The "Sort by" dropdown sets a global default (persisted); clicking a
  // column header sorts ONLY that status table, so re-ordering one group leaves the
  // others untouched. Per-group overrides live in groupSort, keyed by group.key.
  const [sortKey, setSortKey] = useStickyState("created_date", "utm.sortKey");
  const [sortDir, setSortDir] = useStickyState("desc", "utm.sortDir");
  const [groupSort, setGroupSort] = useState({}); // groupKey -> { key, dir }
  const effSort = (gk) => groupSort[gk] || { key: sortKey, dir: sortDir };
  // Changing the global "Sort by" reapplies to every table (clears per-group overrides).
  const setGlobalSortKey = (k) => { setSortKey(k); setGroupSort({}); };
  const setGlobalSortDir = (updater) => { setSortDir(updater); setGroupSort({}); };
  const handleSort = (gk, key) => {
    setGroupSort(prev => {
      const cur = prev[gk] || { key: sortKey, dir: sortDir };
      const next = cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
      return { ...prev, [gk]: next };
    });
  };
  const sortItems = (gk, items) => {
    const { key, dir } = effSort(gk);
    if (!key) return items;
    return [...items].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return - 1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : - cmp;
    });
  };

  const filterRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => appClient.entities.Campaign.list("-created_date"),
  });

  // Load GA analytics for all CDP campaigns
  useEffect(() => {
    if (!campaigns.length) return;
    const names = [...new Set(campaigns.map(c => c.utm_campaign || c.name).filter(Boolean))];
    if (!names.length) return;
    setGaLoading(true);
    appClient.utm.campaignPerformance(names, 30).then(rows => {
      const map = {};
      (rows || []).forEach(r => { map[`${r.session_source}|${r.session_medium}|${r.session_campaign_name}`] = r; });
      setGaAnalytics(map);
      setGaLoading(false);
    }).catch(() => setGaLoading(false));
  }, [campaigns]);

  const getGaData = (c) => {
    const campaign = c.utm_campaign || c.name;
    return gaAnalytics[`${c.utm_source || ""}|${c.utm_medium || ""}|${campaign}`] || null;
  };

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.Campaign.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["campaigns"] }); setCreateOpen(false); toast.success(t("Campaign created")); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.Campaign.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["campaigns"] }); setEditTarget(null); toast.success(t("Campaign updated")); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.Campaign.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const handleCreate = async (form) => {
    const nameTaken = campaigns.some(c => c.name.toLowerCase() === form.name.trim().toLowerCase());
    if (nameTaken) { toast.error(t("A campaign with this name already exists.")); return; }
    const full_utm_url = buildUTMUrl(form);
    const urlTaken = full_utm_url && campaigns.some(c => c.full_utm_url === full_utm_url);
    if (urlTaken) { toast.error(t("An identical UTM link already exists in CDP.")); return; }
    const utmCampaign = form.utm_campaign || form.name;
    if (form.utm_source && form.utm_medium && utmCampaign) {
      try {
        const { exists } = await appClient.utm.exists(form.utm_source, form.utm_medium, utmCampaign);
        if (exists) { toast.error(t("This UTM combination") + ` (${form.utm_source} / ${form.utm_medium} / ${utmCampaign}) ` + t("already exists in Google Analytics.")); return; }
      } catch { toast.warning(t("Could not verify against GA. Proceeding.")); }
    }
    createMutation.mutate({ ...form, full_utm_url, utm_campaign: utmCampaign });
  };

  const handleEdit = (form) => {
    const nameTaken = campaigns.some(c => c.id !== editTarget.id && c.name.toLowerCase() === form.name.trim().toLowerCase());
    if (nameTaken) { toast.error(t("A campaign with this name already exists.")); return; }
    const full_utm_url = buildUTMUrl(form);
    const urlTaken = full_utm_url && campaigns.some(c => c.id !== editTarget.id && c.full_utm_url === full_utm_url);
    if (urlTaken) { toast.error(t("An identical UTM link already exists.")); return; }
    updateMutation.mutate({ id: editTarget.id, data: { ...form, full_utm_url, utm_campaign: form.utm_campaign || form.name } });
  };

  const handleClone = (c) => {
    const { id, created_date, updated_date, created_by, ...rest } = c;
    createMutation.mutate({ ...rest, name: `${c.name} (copy)`, status: "draft", is_used: false });
  };

  // ── Batch actions ────────────────────────────────────────────────────────────
  const selectedCampaigns = campaigns.filter(c => selected.has(c.id));
  const selectedDrafts    = selectedCampaigns.filter(c => c.status === "draft");
  const canBatchDelete    = selectedDrafts.length > 0 && selectedDrafts.length === selectedCampaigns.length;
  const handleBatchClone = async () => {
    await Promise.all(selectedCampaigns.map(c => {
      const { id, created_date, updated_date, created_by, ...rest } = c;
      return appClient.entities.Campaign.create({ ...rest, name: `${c.name} (copy)`, status: "draft", is_used: false });
    }));
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    setSelected(new Set());
    toast.success(`${selectedCampaigns.length} ` + (selectedCampaigns.length > 1 ? t("campaigns cloned") : t("campaign cloned")));
  };

  const handleBatchStatus = async (newStatus) => {
    await Promise.all(selectedCampaigns.map(c => appClient.entities.Campaign.update(c.id, { status: newStatus })));
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    setSelected(new Set());
    setBatchStatusOpen(false);
    toast.success(`${selectedCampaigns.length} ` + (selectedCampaigns.length > 1 ? t("campaigns updated to") : t("campaign updated to")) + ` ${newStatus}`);
  };

  const handleBatchDelete = async () => {
    await Promise.all(selectedDrafts.map(c => appClient.entities.Campaign.delete(c.id)));
    queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    setSelected(new Set());
    setBatchDeleteOpen(false);
    toast.success(`${selectedDrafts.length} ` + (selectedDrafts.length > 1 ? t("drafts deleted") : t("draft deleted")));
  };

  const handleCopyLinks = () => {
    const urls = selectedCampaigns.map(c => ensureHttps(c.full_utm_url || buildUTMUrl(c))).filter(Boolean);
    if (!urls.length) { toast.error(t("No URLs to copy.")); return; }
    navigator.clipboard.writeText(urls.join("\n"));
    toast.success(`${urls.length} ` + (urls.length > 1 ? t("URLs copied") : t("URL copied")));
  };

  const handleExportSelected = () => {
    if (!selectedCampaigns.length) return;
    const COLS = ["name", "status", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "base_url", "full_utm_url", "created_date"];
    const header = COLS.join(",");
    const body = selectedCampaigns.map(c =>
      COLS.map(k => { const v = String(c[k] || ""); return v.includes(",") ? `"${v}"` : v; }).join(",")
    ).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "utm-links-selected.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };


  // ── Filters ──────────────────────────────────────────────────────────────────
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = Object.values(filters).some(a => a.length > 0);
  const uniqueSources   = [...new Set(campaigns.map(c => c.utm_source).filter(Boolean))].sort();
  const uniqueMediums   = [...new Set(campaigns.map(c => c.utm_medium).filter(Boolean))].sort();
  const uniqueCampaigns = [...new Set(campaigns.map(c => c.utm_campaign).filter(Boolean))].sort();
  const uniqueContents  = [...new Set(campaigns.map(c => c.utm_content).filter(Boolean))].sort();
  const uniqueTerms     = [...new Set(campaigns.map(c => c.utm_term).filter(Boolean))].sort();

  const filteredCampaigns = campaigns.filter(c => {
    const q = search.toLowerCase();
    if (q && !c.name?.toLowerCase().includes(q) && !c.utm_source?.toLowerCase().includes(q) && !c.utm_medium?.toLowerCase().includes(q) && !c.full_utm_url?.toLowerCase().includes(q) && !c.utm_campaign?.toLowerCase().includes(q)) return false;
    if (filters.status.length   && !filters.status.includes(c.status))         return false;
    if (filters.source.length   && !filters.source.includes(c.utm_source))     return false;
    if (filters.medium.length   && !filters.medium.includes(c.utm_medium))     return false;
    if (filters.campaign.length && !filters.campaign.includes(c.utm_campaign)) return false;
    if (filters.content.length  && !filters.content.includes(c.utm_content))   return false;
    if (filters.term.length     && !filters.term.includes(c.utm_term))         return false;
    return true;
  });

  // ── Group collapse helpers ───────────────────────────────────────────────────
  const activeGroups = groupByStatus ? GROUPS.filter(g => filteredCampaigns.some(g.filter)) : [];
  const allGroupsCollapsed = activeGroups.length > 0 && activeGroups.every(g => collapsedGroups.has(g.key));
  const toggleAllGroups = () => setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(activeGroups.map(g => g.key)));
  const toggleGroupCollapse = (k) => setCollapsedGroups(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleRow = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const fmt       = (v) => v != null ? Number(v).toLocaleString() : null;
  const fmtPct    = (v) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : null;
  const ensureHttps = (url) => !url ? "" : /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const GaCell = ({ value }) => (
    <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap">
      {value != null ? value : <span className="text-muted-foreground/30">-</span>}
    </td>
  );

  const TABS = [
    { key: "utm",       label: t("UTM Links"), icon: <LinkIcon className="w-3.5 h-3.5" /> },
    { key: "analytics", label: t("Analytics"), icon: <BarChart2 className="w-3.5 h-3.5" /> },
  ];

  const { canUseFeatures } = usePlan();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("UTM")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("Create, manage, and analyse your UTM tracking links.")}</p>
          </div>
          {tab === "utm" && canUseFeatures && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> {t("New UTM")}
            </Button>
          )}
        </div>
        <div className="flex border-b border-border gap-6">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">

        {/* ── UTM Links Tab ────────────────────────────────────────────── */}
        {tab === "utm" && (
          <div className="px-8 py-6 space-y-6">

            {/* Search + Filter */}
            <div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input value={search} onChange={e => { setSearch(e.target.value); setSelected(new Set()); }}
                    placeholder={t("Search UTM links...")}
                    className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring" />
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
                          <button onClick={() => setFilters({ status: [], source: [], medium: [], campaign: [], content: [], term: [] })} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                          <MultiSelect value={filters.status} onChange={v => setFilter("status", v)}
                            options={["active","draft","paused","completed","archived"]} placeholder={t("All")} />
                        </div>
                        {uniqueSources.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">{t("Source")}</p>
                            <MultiSelect value={filters.source} onChange={v => setFilter("source", v)} options={uniqueSources} placeholder={t("All")} />
                          </div>
                        )}
                        {uniqueMediums.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">{t("Medium")}</p>
                            <MultiSelect value={filters.medium} onChange={v => setFilter("medium", v)} options={uniqueMediums} placeholder={t("All")} />
                          </div>
                        )}
                        {uniqueCampaigns.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">{t("Campaign")}</p>
                            <MultiSelect value={filters.campaign} onChange={v => setFilter("campaign", v)} options={uniqueCampaigns} placeholder={t("All")} />
                          </div>
                        )}
                        {uniqueContents.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">{t("Content")}</p>
                            <MultiSelect value={filters.content} onChange={v => setFilter("content", v)} options={uniqueContents} placeholder={t("All")} />
                          </div>
                        )}
                        {uniqueTerms.length > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-1">{t("Term")}</p>
                            <MultiSelect value={filters.term} onChange={v => setFilter("term", v)} options={uniqueTerms} placeholder={t("All")} />
                          </div>
                        )}
                      </div>

                      {/* Sort */}
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Sort by")}</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={["created_date", "name", "status"].includes(sortKey) ? sortKey : "created_date"}
                            onChange={e => setGlobalSortKey(e.target.value)}
                            className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                            <option value="created_date">{t("Date")}</option>
                            <option value="name">{t("Name")}</option>
                            <option value="status">{t("Status")}</option>
                          </select>
                          <button type="button" onClick={() => setGlobalSortDir(d => d === "asc" ? "desc" : "asc")}
                            className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                            {sortDir === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> {t("Asc")}</> : <><ArrowDown className="w-3.5 h-3.5" /> {t("Desc")}</>}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Group by")}</p>
                        <label className="flex items-center justify-between cursor-pointer">
                          <span className="text-xs text-muted-foreground">{t("Status")}</span>
                          <input type="checkbox" checked={groupByStatus} onChange={e => setGroupByStatus(e.target.checked)}
                            className="rounded border-border cursor-pointer" />
                        </label>
                      </div>

                      {/* Time period for the GA Traffic Performance table */}
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("GA traffic period")}</p>
                        <select value={gaPeriod} onChange={e => setGaPeriod(e.target.value)}
                          className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                          {GA_PERIODS.map(p => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" className="h-9 gap-1.5"
                  onClick={() => setImportOpen(true)}>
                  <Upload className="w-3.5 h-3.5" /> {t("Import UTM")}
                </Button>
              </div>
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(filters).flatMap(([k, vals]) => vals.map(v => (
                    <span key={`${k}:${v}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      {t(k)}: <strong>{v}</strong>
                      <button onClick={() => setFilter(k, filters[k].filter(x => x !== v))} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  )))}
                </div>
              )}
            </div>

            {gaLoading && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span className="w-3 h-3 border border-border border-t-foreground rounded-full animate-spin inline-block" />
                {t("Loading GA performance data…")}
              </p>
            )}

            {/* ── Selection toolbar ─────────────────────────────────────── */}
            {selected.size > 0 && (() => {
              const single    = selected.size === 1 ? selectedCampaigns[0] : null;
              const canEdit   = single && single.status === "draft";
              const canDelete = single ? single.status === "draft" : canBatchDelete;
              return (
                <div className="flex items-center gap-2 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
                  <span className="font-medium text-sm flex-shrink-0">{selected.size} {t("selected")}</span>
                  <div className="flex items-center gap-1 ml-2 flex-wrap">
                    {canEdit && (
                      <Button size="sm" variant="secondary"
                        className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                        onClick={() => { setEditTarget(single); setSelected(new Set()); }}>
                        {t("Edit")}
                      </Button>
                    )}
                    <Button size="sm" variant="secondary"
                      className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                      onClick={single ? () => { handleClone(single); setSelected(new Set()); } : handleBatchClone}>
                      {t("Clone")}
                    </Button>
                    <Button size="sm" variant="secondary"
                      className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                      onClick={handleCopyLinks}>
                      {selected.size > 1 ? t("Copy URLs") : t("Copy URL")}
                    </Button>
                    <Button size="sm" variant="secondary"
                      className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                      onClick={handleExportSelected}>
                      {t("Export CSV")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="secondary"
                          className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0">
                          {t("Change Status")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {STATUS_OPTIONS.map(s => (
                          <DropdownMenuItem key={s} onClick={() => handleBatchStatus(s)} className="capitalize">{t(s)}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {canDelete && (
                      <Button size="sm" variant="secondary"
                        className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0 text-red-300 hover:text-red-200"
                        onClick={() => setBatchDeleteOpen(true)}>
                        {t("Delete")}
                      </Button>
                    )}
                  </div>
                  <button onClick={() => setSelected(new Set())}
                    className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0">
                    {t("Clear")}
                  </button>
                </div>
              );
            })()}

            {/* Campaign groups as tables */}
            {isLoading ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-secondary animate-pulse rounded-lg" />)}</div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-12 text-center">
                <LinkIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">{campaigns.length === 0 ? t("No UTM links yet") : t("No results found")}</p>
                <p className="text-xs text-muted-foreground">{campaigns.length === 0 ? t("Create your first UTM tracking link.") : t("Try adjusting your search or filter.")}</p>
              </div>
            ) : (
              <>
              {groupByStatus && activeGroups.length > 1 && (
                <div className="flex justify-end">
                  <button onClick={toggleAllGroups} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    {allGroupsCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
                    {allGroupsCollapsed ? t("Expand all") : t("Collapse all")}
                  </button>
                </div>
              )}
              {(groupByStatus ? GROUPS : [{ key: "all", label: "All", filter: () => true }]).map(group => {
                const items = sortItems(group.key, filteredCampaigns.filter(group.filter));
                if (!items.length) return null;
                const groupIds = items.map(c => c.id);
                const groupAllSelected = groupIds.every(id => selected.has(id));
                const groupSomeSelected = groupIds.some(id => selected.has(id));
                const toggleGroup = () => {
                  if (groupAllSelected) { setSelected(prev => { const n = new Set(prev); groupIds.forEach(id => n.delete(id)); return n; }); }
                  else { setSelected(prev => { const n = new Set(prev); groupIds.forEach(id => n.add(id)); return n; }); }
                };
                return (
                  <div key={group.key}>
                    {groupByStatus && (
                      <button onClick={() => toggleGroupCollapse(group.key)} className="flex items-center gap-1.5 mb-2 group/h">
                        {collapsedGroups.has(group.key) ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover/h:text-foreground">{t(group.label)} · {items.length}</span>
                      </button>
                    )}
                    {!(groupByStatus && collapsedGroups.has(group.key)) && (
                    <div className={`border border-border rounded-lg overflow-auto ${group.key === "archived" ? "opacity-60" : ""}`}>
                      <table className="w-full text-xs">
                        <thead className="bg-secondary/50">
                          <tr>
                            <th className="w-10 px-3 py-2.5">
                              <input type="checkbox" className="rounded border-border cursor-pointer"
                                checked={groupAllSelected}
                                ref={el => { if (el) el.indeterminate = groupSomeSelected && !groupAllSelected; }}
                                onChange={toggleGroup} />
                            </th>
                            {[
                              { key: "name",         label: t("Name"),         align: "left" },
                              { key: "status",       label: t("Status"),       align: "left" },
                              { key: "utm_source",   label: t("Source"),       align: "left" },
                              { key: "utm_medium",   label: t("Medium"),       align: "left" },
                              { key: "utm_campaign", label: t("Campaign"),     align: "left" },
                              { key: "base_url",     label: t("Base URL"),     align: "left" },
                              { key: "full_utm_url", label: t("Full UTM URL"), align: "left" },
                              { key: "_ga_sessions",   label: t("Sessions"),    align: "right", info: t("Total sessions in the last 30 days from GA where this campaign's UTM parameters were detected.") },
                              { key: "_ga_users",      label: t("Active Users"), align: "right", info: t("Users who had at least one session in the last 30 days.") },
                              { key: "_ga_new_users",  label: t("New Users"),   align: "right", info: t("First-time visitors to the site in the last 30 days.") },
                              { key: "_ga_bounce",     label: t("Bounce"),      align: "right", info: t("Avg. bounce rate - percentage of sessions where users left without any meaningful interaction.") },
                              { key: "_ga_engagement", label: t("Engagement"),  align: "right", info: t("Avg. engagement rate - sessions that lasted 10+ seconds, had a conversion event, or included 2+ page views.") },
                              { key: "created_date", label: t("Created"),      align: "left" },
                            ].map(col => (
                              <th
                                key={col.key}
                                onClick={() => handleSort(group.key, col.key)}
                                className={`px-3 py-2.5 font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}
                              >
                                <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
                                  {col.label}
                                  {col.info && <ColInfo text={col.info} />}
                                  {effSort(group.key).key === col.key
                                    ? (effSort(group.key).dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                                    : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(c => {
                            const ga = getGaData(c);
                            const isSelected = selected.has(c.id);
                            return (
                              <tr key={c.id}
                                className={`border-t border-border cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/20"}`}
                                onClick={() => toggleRow(c.id)}>
                                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                                  <input type="checkbox" className="rounded border-border cursor-pointer"
                                    checked={isSelected} onChange={() => toggleRow(c.id)} />
                                </td>
                                <td className="px-3 py-2.5 max-w-[160px]" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="font-medium truncate">{c.name}</span>
                                    {c.is_used && <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <span className="text-muted-foreground capitalize">{c.status || "-"}</span>
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{c.utm_source || "-"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{c.utm_medium || "-"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground max-w-[120px] truncate whitespace-nowrap">{c.utm_campaign || "-"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground max-w-[180px] truncate whitespace-nowrap">{c.base_url || "-"}</td>
                                <td className="px-3 py-2.5 text-muted-foreground max-w-[220px] truncate whitespace-nowrap">{ensureHttps(c.full_utm_url || buildUTMUrl(c)) || "-"}</td>
                                <GaCell value={ga ? fmt(ga.total_sessions) : null} />
                                <GaCell value={ga ? fmt(ga.total_users) : null} />
                                <GaCell value={ga ? fmt(ga.total_new_users) : null} />
                                <GaCell value={ga ? fmtPct(ga.avg_bounce_rate) : null} />
                                <GaCell value={ga ? fmtPct(ga.avg_engagement_rate) : null} />
                                <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                                  {format(new Date(c.created_date), "MMM d, yyyy")}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>
                );
              })}
              </>
            )}

            {/* GA distinct UTM links */}
            <GAUtmLinksSection days={gaPeriod} />
          </div>
        )}

        {/* ── Analytics Tab ────────────────────────────────────────────── */}
        {tab === "analytics" && <UTMAnalyticsPanel />}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{t("Create UTM Link")}</DialogTitle></DialogHeader>
          <UTMForm onSubmit={handleCreate} isPending={createMutation.isPending} submitLabel={t("Create UTM Link")} sourceOptions={uniqueSources} mediumOptions={uniqueMediums} />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">{t("Edit UTM Link")}</DialogTitle></DialogHeader>
          {editTarget && <UTMForm initialValues={editTarget} onSubmit={handleEdit} isPending={updateMutation.isPending} submitLabel={t("Save Changes")} sourceOptions={uniqueSources} mediumOptions={uniqueMediums} />}
        </DialogContent>
      </Dialog>

      {/* Batch delete confirm */}
      <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">{t("Delete")} {selectedDrafts.length} {selectedDrafts.length > 1 ? t("Drafts?") : t("Draft?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t("This action cannot be undone. Only draft campaigns will be deleted.")}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setBatchDeleteOpen(false)}>{t("Cancel")}</Button>
            <Button variant="destructive" size="sm" onClick={handleBatchDelete}>{t("Delete")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import dialog (shared component, also used on the Import Data page) */}
      <UTMImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingCampaigns={campaigns}
      />
    </div>
  );
}
