import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MessageSquare, Target, Users, Plus, X, Check, GripVertical, Pencil, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { usePreferences } from "@/lib/PreferencesContext";
import { useDashboardLayout } from "@/lib/useDashboardLayout";
import PinnedChartCard from "../components/dashboard/PinnedChartCard";
import { normalizeSize, sizeMeta, nextSize } from "@/lib/chartSizes";

// Pixel heights for the full-width dashboard grid; column span comes from the
// shared size model (src/lib/chartSizes.js) so it matches the Dashboard Preview.
const DASHBOARD_HEIGHTS = { small: "h-64", large: "h-80" };

export default function Dashboard() {
  const { t } = usePreferences();
  const queryClient = useQueryClient();

  // Tabs, per-tab chart assignments and chart sizes are persisted in the DB
  // (company-scoped app.settings) via this hook — nothing is stored locally.
  const { tabs, setTabs, tabAssignments, setTabAssignments, chartSizes, setChartSizes } = useDashboardLayout();

  const [activeTab, setActiveTab] = useState("main");
  const [editingTab, setEditingTab] = useState(null);
  const [editingName, setEditingName] = useState("");

  // Keep the active tab valid once the persisted tabs load (e.g. if "main" was
  // renamed/removed in a previous session).
  useEffect(() => {
    if (tabs.length && !tabs.some(tab => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  const { data: pinnedCharts = [], isLoading } = useQuery({
    queryKey: ["pinnedCharts"],
    queryFn: () => appClient.entities.PinnedChart.list("-created_date"),
  });

  // Permanently delete a chart from the list (DB) and drop it from every tab.
  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.PinnedChart.delete(id),
    onSuccess: (_data, id) => {
      setTabAssignments(prev => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          next[k] = Array.isArray(v) ? v.filter(cid => cid !== id) : v;
        }
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["pinnedCharts"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.entities.PinnedChart.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pinnedCharts"] }),
  });

  const addTab = () => {
    const id = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id, name: `Tab ${prev.length + 1}` }]);
    setTabAssignments(prev => ({ ...prev, [id]: [] }));
    setActiveTab(id);
  };

  const removeTab = (tabId) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    const newAssignments = { ...tabAssignments };
    delete newAssignments[tabId];
    setTabAssignments(newAssignments);
    if (activeTab === tabId) setActiveTab(newTabs[0].id);
  };

  const startEdit = (tab) => { setEditingTab(tab.id); setEditingName(tab.name); };
  const finishEdit = () => {
    if (editingTab) {
      setTabs(prev => prev.map(t => t.id === editingTab ? { ...t, name: editingName || t.name } : t));
      setEditingTab(null);
    }
  };

  const toggleChartInTab = (tabId, chartId) => {
    setTabAssignments(prev => {
      const current = prev[tabId] || [];
      const updated = current.includes(chartId)
        ? current.filter(id => id !== chartId)
        : [...current, chartId];
      return { ...prev, [tabId]: updated };
    });
  };

  // Remove a chart from the current tab's display only — keeps it in the chart
  // list (DB) and on any other tabs it's assigned to.
  const removeChartFromTab = (tabId, chartId) => {
    setTabAssignments(prev => ({
      ...prev,
      [tabId]: (prev[tabId] || []).filter(id => id !== chartId),
    }));
  };

  const cycleSize = (chartId) => {
    setChartSizes(prev => ({ ...prev, [chartId]: nextSize(prev[chartId]) }));
  };

  // Charts visible in the active tab — only those explicitly assigned to it.
  const assignment = tabAssignments[activeTab] || [];
  const visibleCharts = assignment.length === 0
    ? []
    : pinnedCharts.filter(c => assignment.includes(c.id));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Dashboard")}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {t("Pin charts from the AI Analyst to build your dashboard.")}
            </p>
          </div>
          <Link to="/">
            <Button size="sm" className="gap-1.5 h-9">
              <MessageSquare className="w-3.5 h-3.5" /> {t("AI Analyst")}
            </Button>
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {tabs.map(tab => (
            <div key={tab.id} className="flex items-center group relative">
              {editingTab === tab.id ? (
                <div className="flex items-center gap-1 pb-3">
                  <Input value={editingName} onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && finishEdit()}
                    className="h-6 text-xs w-28 px-2" autoFocus />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={finishEdit}>
                    <Check className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <button
                  className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                  onDoubleClick={() => startEdit(tab)}
                >
                  {tab.name}
                  {activeTab === tab.id && (
                    <span
                      className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
                      title={t("Rename tab")}
                      onClick={e => { e.stopPropagation(); startEdit(tab); }}
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </span>
                  )}
                  {tabs.length > 1 && (
                    <span
                      className="opacity-0 group-hover:opacity-50 hover:!opacity-100"
                      onClick={e => { e.stopPropagation(); removeTab(tab.id); }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addTab}
            className="flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> {t("New tab")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Tab management - assign charts to this tab (dropdown, shown on every tab) */}
        {pinnedCharts.length > 0 && (
          <div className="mb-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <Plus className="w-3.5 h-3.5" />
                  {t("Add charts to this tab:")}
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {t("Toggle charts on this tab")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-72 overflow-auto">
                  {pinnedCharts.map(c => {
                    const assigned = assignment.includes(c.id);
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-accent"
                      >
                        <button
                          type="button"
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                          onClick={() => toggleChartInTab(activeTab, c.id)}
                        >
                          <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            assigned ? "bg-foreground border-foreground text-background" : "border-border"
                          }`}>
                            {assigned && <Check className="h-3 w-3" />}
                          </span>
                          <span className="truncate">{c.title}</span>
                        </button>
                        <button
                          type="button"
                          className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                          title={t("Delete chart from list")}
                          onClick={() => deleteMutation.mutate(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-secondary animate-pulse rounded-lg h-64" />
            ))}
          </div>
        ) : visibleCharts.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            <GripVertical className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-40" />
            {pinnedCharts.length === 0 ? (
              <>
                <p className="text-sm font-medium mb-1">{t("No pinned charts yet")}</p>
                <p className="text-xs text-muted-foreground mb-4">{t("Ask the AI Analyst to generate charts, then pin them here.")}</p>
                <Link to="/"
                  className="inline-flex items-center gap-2 text-xs font-medium px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity">
                  <MessageSquare className="w-3.5 h-3.5" /> {t("Open AI Analyst")}
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm font-medium mb-1">{t("No charts in this tab")}</p>
                <p className="text-xs text-muted-foreground">{t("Use the selector above to add charts to this tab.")}</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {visibleCharts.map(chart => {
              const size = normalizeSize(chartSizes[chart.id]);
              return (
                <div key={chart.id} className={`${sizeMeta(size).span} ${DASHBOARD_HEIGHTS[size]}`}>
                  <PinnedChartCard
                    chart={chart}
                    size={size}
                    onRemove={(c) => removeChartFromTab(activeTab, c.id)}
                    onCycleSize={() => cycleSize(chart.id)}
                    onUpdate={(updated) => updateMutation.mutate({ id: updated.id, data: { title: updated.title, description: updated.description, chart_type: updated.chart_type, chart_config: updated.chart_config } })}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-10 mb-6">
          <h2 className="font-heading text-xl font-semibold tracking-tight mb-4">{t("Quick Actions")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link to="/" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <MessageSquare className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">{t("Ask the Analyst")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("Query data, generate insights")}</p>
            </Link>
            <Link to="/campaigns" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <Target className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">{t("Create UTM Link")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("UTM links, targeting")}</p>
            </Link>
            <Link to="/segments" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <Users className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">{t("Build Segment")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("Audience segmentation")}</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
