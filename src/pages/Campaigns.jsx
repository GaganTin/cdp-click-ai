import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Copy, MoreHorizontal, Trash2, Link as LinkIcon, BarChart2, Pencil, Copy as CloneIcon, Archive, Lock, Search, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/lib/usePlan";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { format } from "date-fns";
import UTMForm, { buildUTMUrl } from "../components/campaigns/UTMForm";
import UTMAnalyticsPanel, { GAUtmLinksSection } from "../components/campaigns/UTMAnalyticsPanel";

const statusStyles = {
  draft: "bg-secondary text-secondary-foreground",
  active: "bg-foreground text-background",
  archived: "bg-muted text-muted-foreground opacity-60",
};

const GROUPS = [
  { key: "active", label: "Active", filter: c => c.status === "active" },
  { key: "draft", label: "Draft", filter: c => c.status === "draft" },
  { key: "archived", label: "Archived", filter: c => c.status === "archived" },
];

export default function Campaigns() {
  const [tab, setTab] = useState("utm");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ status: "", source: "", medium: "" });
  const queryClient = useQueryClient();

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => appClient.entities.Campaign.list("-created_date"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.Campaign.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setCreateOpen(false);
      toast.success("Campaign created");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.Campaign.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setEditTarget(null);
      toast.success("Campaign updated");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.Campaign.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const handleCreate = (form) => {
    const nameTaken = campaigns.some(c => c.name.toLowerCase() === form.name.trim().toLowerCase());
    if (nameTaken) { toast.error("A campaign with this name already exists."); return; }
    const full_utm_url = buildUTMUrl(form);
    const urlTaken = full_utm_url && campaigns.some(c => c.full_utm_url === full_utm_url);
    if (urlTaken) { toast.error("An identical UTM link already exists."); return; }
    createMutation.mutate({ ...form, full_utm_url, utm_campaign: form.utm_campaign || form.name });
  };

  const handleEdit = (form) => {
    const nameTaken = campaigns.some(c => c.id !== editTarget.id && c.name.toLowerCase() === form.name.trim().toLowerCase());
    if (nameTaken) { toast.error("A campaign with this name already exists."); return; }
    const full_utm_url = buildUTMUrl(form);
    const urlTaken = full_utm_url && campaigns.some(c => c.id !== editTarget.id && c.full_utm_url === full_utm_url);
    if (urlTaken) { toast.error("An identical UTM link already exists."); return; }
    updateMutation.mutate({ id: editTarget.id, data: { ...form, full_utm_url, utm_campaign: form.utm_campaign || form.name } });
  };

  const handleClone = (c) => {
    const { id, created_date, updated_date, created_by, ...rest } = c;
    createMutation.mutate({ ...rest, name: `${c.name} (copy)`, status: "draft", is_used: false });
  };

  const handleArchive = (c) => {
    updateMutation.mutate({ id: c.id, data: { status: "archived" } });
  };

  const filteredCampaigns = campaigns.filter(c => {
    const q = search.toLowerCase();
    const matchesSearch = !q || c.name?.toLowerCase().includes(q) || c.utm_source?.toLowerCase().includes(q) || c.utm_medium?.toLowerCase().includes(q) || c.full_utm_url?.toLowerCase().includes(q);
    const matchesStatus = !filters.status || c.status === filters.status;
    const matchesSource = !filters.source || c.utm_source === filters.source;
    const matchesMedium = !filters.medium || c.utm_medium === filters.medium;
    return matchesSearch && matchesStatus && matchesSource && matchesMedium;
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const uniqueSources = [...new Set(campaigns.map(c => c.utm_source).filter(Boolean))].sort();
  const uniqueMediums = [...new Set(campaigns.map(c => c.utm_medium).filter(Boolean))].sort();

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copied");
  };

  const TABS = [
    { key: "utm", label: "UTM Links", icon: <LinkIcon className="w-3.5 h-3.5" /> },
    { key: "analytics", label: "Analytics", icon: <BarChart2 className="w-3.5 h-3.5" /> },
  ];

  const { canUseFeatures } = usePlan();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">UTM</h1>
            <p className="text-sm text-muted-foreground mt-1">Create, manage, and analyse your UTM tracking links.</p>
          </div>
          {tab === "utm" && canUseFeatures && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New UTM
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto min-h-0">

        {/* UTM Links Tab */}
        {tab === "utm" && (
          <div className="px-8 py-6 space-y-8">
            {/* Search + Filter */}
            <div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search UTM links..."
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
                      <option value="active">Active</option>
                      <option value="draft">Draft</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  {uniqueSources.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Source</p>
                      <select value={filters.source} onChange={e => setFilter("source", e.target.value)}
                        className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        <option value="">All</option>
                        {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {uniqueMediums.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Medium</p>
                      <select value={filters.medium} onChange={e => setFilter("medium", e.target.value)}
                        className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                        <option value="">All</option>
                        {uniqueMediums.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {filters.status && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      Status: <strong>{filters.status}</strong>
                      <button onClick={() => setFilter("status", "")} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                  {filters.source && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      Source: <strong>{filters.source}</strong>
                      <button onClick={() => setFilter("source", "")} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                  {filters.medium && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      Medium: <strong>{filters.medium}</strong>
                      <button onClick={() => setFilter("medium", "")} className="hover:text-foreground text-muted-foreground ml-0.5"><X className="w-3 h-3" /></button>
                    </span>
                  )}
                </div>
              )}
            </div>
            {isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-secondary animate-pulse rounded-lg" />)}</div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="border border-dashed border-border rounded-lg p-12 text-center">
                <LinkIcon className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">{campaigns.length === 0 ? "No UTM links yet" : "No results found"}</p>
                <p className="text-xs text-muted-foreground">{campaigns.length === 0 ? "Create your first optimized UTM tracking link." : "Try adjusting your search or filter."}</p>
              </div>
            ) : (
              GROUPS.map(group => {
                const items = filteredCampaigns.filter(group.filter);
                if (!items.length) return null;
                return (
                  <div key={group.key}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">{group.label} · {items.length}</p>
                    <div className="space-y-2">
                      {items.map(c => (
                        <div key={c.id} className={`border border-border rounded-lg p-5 transition-shadow ${c.status === "archived" ? "opacity-60" : "hover:shadow-sm"}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-sm font-semibold">{c.name}</h3>
                                <Badge variant="secondary" className={statusStyles[c.status] + " text-[10px]"}>{c.status}</Badge>
                                {c.is_used && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                                    <Lock className="w-2.5 h-2.5" /> locked
                                  </span>
                                )}
                              </div>
                              {c.full_utm_url && <p className="text-xs text-muted-foreground font-mono truncate">{c.full_utm_url}</p>}
                              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                                {c.utm_source && <span>Source: {c.utm_source}</span>}
                                {c.utm_medium && <span>Medium: {c.utm_medium}</span>}
                                <span>Created {format(new Date(c.created_date), "MMM d, yyyy")}</span>
                                {c.updated_date && c.updated_date !== c.created_date && (
                                  <span>Updated {format(new Date(c.updated_date), "MMM d, yyyy")}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {c.full_utm_url && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyUrl(c.full_utm_url)}>
                                  <Copy className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {!c.is_used && c.status !== "archived" && (
                                    <DropdownMenuItem onClick={() => setEditTarget(c)}>
                                      <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => handleClone(c)}>
                                    <CloneIcon className="w-3.5 h-3.5 mr-2" /> Clone
                                  </DropdownMenuItem>
                                  {c.status !== "archived" && (
                                    <DropdownMenuItem onClick={() => handleArchive(c)}>
                                      <Archive className="w-3.5 h-3.5 mr-2" /> Archive
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => deleteMutation.mutate(c.id)} className="text-destructive">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <GAUtmLinksSection />
          </div>
        )}

        {/* Analytics Tab */}
        {tab === "analytics" && (
          <UTMAnalyticsPanel />
        )}


      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">Create UTM Link</DialogTitle></DialogHeader>
          <UTMForm onSubmit={handleCreate} isPending={createMutation.isPending} submitLabel="Create UTM Link" />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={v => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-heading">Edit UTM Link</DialogTitle></DialogHeader>
          {editTarget && (
            <UTMForm
              initialValues={editTarget}
              onSubmit={handleEdit}
              isPending={updateMutation.isPending}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
