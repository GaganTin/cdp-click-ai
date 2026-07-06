import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Plus, Trash2, GripVertical, Edit2, Check, Pencil, ArrowUp, ArrowDown, Sparkles, Lock, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appClient } from "@/api/appClient";
import { parseChartConfig } from "@/lib/utils";
import { CHART_SIZES, normalizeSize, sizeMeta } from "@/lib/chartSizes";
import { useDashboardLayout } from "@/lib/useDashboardLayout";
import MiniChart from "./MiniChart";

// Pixel heights for this (narrow) preview panel; the column span comes from the
// shared size model so "S"/"L" behave the same as on the full Dashboard.
const PREVIEW_HEIGHTS = { small: "h-48", large: "h-72" };

export default function DashboardPreviewPanel({ onClose, pinnedChart, pinnedCharts = [], onEditRequest }) {
  // Tabs / assignments / sizes live in the DB (company-scoped app.settings) and
  // are shared with the Dashboard page - nothing is persisted in localStorage.
  const { tabs, setTabs, tabAssignments, setTabAssignments, chartSizes, setChartSizes, isLoading, userId } = useDashboardLayout();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("main");
  const [editingTab, setEditingTab] = useState(null);
  const [editingName, setEditingName] = useState("");

  // Inline chart editor (title + position) - no AI round-trip needed.
  const [editingChart, setEditingChart] = useState(null); // chart id being edited
  const [chartTitleDraft, setChartTitleDraft] = useState("");

  // Persist a chart title change to the DB and refresh the shared pinned-charts cache.
  const renameMutation = useMutation({
    mutationFn: ({ id, title }) => appClient.entities.PinnedChart.update(id, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pinnedCharts"] }),
  });

  // Keep the active tab valid once the persisted tabs load.
  useEffect(() => {
    if (tabs.length && !tabs.some(t => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  // When a new chart is pinned, add it only to the currently active tab. Wait until
  // the layout has loaded so we merge into the real saved layout (tabs + existing
  // assignments) rather than a default - otherwise the assignment could be written
  // against an empty default and never show up on the Dashboard.
  const lastPinnedRef = useRef(null);
  useEffect(() => {
    if (!pinnedChart || isLoading || pinnedChart === lastPinnedRef.current) return;
    lastPinnedRef.current = pinnedChart;
    const chartId = pinnedChart.id;
    setTabAssignments(prev => {
      const current = prev[activeTab] || [];
      if (current.includes(chartId)) return prev;
      return { ...prev, [activeTab]: [...current, chartId] };
    });
  }, [pinnedChart, activeTab, isLoading]);

  // Order by the tab's assignment array so position edits (move up/down) take effect.
  const activeCharts = (tabAssignments[activeTab] || [])
    .map(id => pinnedCharts.find(c => c.id === id))
    .filter(Boolean);

  const isDuplicateName = (name, ignoreId) =>
    tabs.some(t => t.id !== ignoreId && t.name.trim().toLowerCase() === name.trim().toLowerCase());

  const addTab = () => {
    const id = `tab-${Date.now()}`;
    let n = tabs.length + 1;
    while (isDuplicateName(`Tab ${n}`)) n++;
    // Owned by the creator, public by default; the owner can flip to private.
    setTabs(prev => [...prev, { id, name: `Tab ${n}`, created_by: userId, visibility: "public" }]);
    setTabAssignments(prev => ({ ...prev, [id]: [] }));
    setActiveTab(id);
  };

  // Owner-only: flip a tab between public (all members) and private (only me).
  const toggleTabVisibility = (tabId) => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, visibility: t.visibility === "private" ? "public" : "private" } : t
    ));
  };

  const removeTab = (tabId) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    setTabAssignments(prev => { const n = { ...prev }; delete n[tabId]; return n; });
    if (activeTab === tabId) setActiveTab(newTabs[0].id);
  };

  const startEditTab = (tab) => { setEditingTab(tab.id); setEditingName(tab.name); };
  const finishEditTab = () => {
    if (!editingTab) return;
    const name = editingName.trim();
    if (name && isDuplicateName(name, editingTab)) {
      toast.error(`A tab named "${name}" already exists`);
      return; // keep editing so the user can pick another name
    }
    setTabs(prev => prev.map(t => t.id === editingTab ? { ...t, name: name || t.name } : t));
    setEditingTab(null);
  };

  const removeChartFromTab = (chartId) => {
    setTabAssignments(prev => ({
      ...prev,
      [activeTab]: (prev[activeTab] || []).filter(id => id !== chartId),
    }));
  };

  const setChartSize = (chartId, size) => {
    setChartSizes(prev => ({ ...prev, [chartId]: size }));
  };

  const moveChartToTab = (chartId, toTabId) => {
    setTabAssignments(prev => {
      const from = prev[activeTab] || [];
      const to = prev[toTabId] || [];
      return {
        ...prev,
        [activeTab]: from.filter(id => id !== chartId),
        [toTabId]: to.includes(chartId) ? to : [...to, chartId],
      };
    });
  };

  // Reorder a chart within the current tab (its position on the dashboard).
  const moveChartWithinTab = (chartId, dir) => {
    setTabAssignments(prev => {
      const arr = [...(prev[activeTab] || [])];
      const i = arr.indexOf(chartId);
      if (i < 0) return prev;
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...prev, [activeTab]: arr };
    });
  };

  // Move a chart to another tab and follow it there so editing can continue.
  const changeChartTab = (chartId, toTabId) => {
    if (!toTabId || toTabId === activeTab) return;
    moveChartToTab(chartId, toTabId);
    setActiveTab(toTabId);
  };

  const startEditChart = (chart) => { setEditingChart(chart.id); setChartTitleDraft(chart.title || ""); };
  const saveChartEdit = (chart) => {
    const title = chartTitleDraft.trim();
    if (title && title !== chart.title) renameMutation.mutate({ id: chart.id, title });
    setEditingChart(null);
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
        <p className="text-sm font-semibold">Dashboard Preview</p>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs row */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-secondary/30 flex-shrink-0 flex-wrap">
        {tabs.map(tab => (
          <div key={tab.id} className="flex items-center group">
            {editingTab === tab.id ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") finishEditTab(); if (e.key === "Escape") setEditingTab(null); }}
                  className="h-6 text-xs w-28 px-2"
                  autoFocus
                />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={finishEditTab}>
                  <Check className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <button
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${
                  activeTab === tab.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={() => startEditTab(tab)}
              >
                {tab.visibility === "private" && (
                  <span title="Private tab - only you can see it" className="flex-shrink-0">
                    <Lock className="w-2.5 h-2.5 opacity-70" />
                  </span>
                )}
                {tab.name}
                {tab.created_by === userId && (
                  <span
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-0.5"
                    onClick={e => { e.stopPropagation(); toggleTabVisibility(tab.id); }}
                    title={tab.visibility === "private"
                      ? "Make public (visible to all members)"
                      : "Make private (only you can see it)"}
                  >
                    {tab.visibility === "private"
                      ? <Globe className="w-2.5 h-2.5" />
                      : <Lock className="w-2.5 h-2.5" />}
                  </span>
                )}
                {activeTab === tab.id && (
                  <span
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-0.5"
                    onClick={e => { e.stopPropagation(); startEditTab(tab); }}
                    title="Rename tab"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </span>
                )}
                {tabs.length > 1 && (
                  <span
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-0.5"
                    onClick={e => { e.stopPropagation(); removeTab(tab.id); }}
                    title="Remove tab"
                  >
                    <X className="w-2.5 h-2.5" />
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addTab} title="New tab">
          <Plus className="w-3 h-3" />
        </Button>
      </div>

      {/* Hint */}
      <div className="px-4 pt-1.5 pb-1 flex-shrink-0">
        <p className="text-[10px] text-muted-foreground">
          Double-click or ✎ to rename a tab · ✎ on a chart to edit its title & position · Tabs sync with Dashboard
        </p>
      </div>

      {/* Charts grid */}
      <div className="flex-1 overflow-auto p-4">
        {activeCharts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
            <GripVertical className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm font-medium">No charts in this tab</p>
            <p className="text-xs mt-1 opacity-70">Pin a chart from the AI chat to add it here</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {activeCharts.map(chart => {
              const config = parseChartConfig(chart.chart_config);
              const size = normalizeSize(chartSizes[chart.id]);
              const sizeH = PREVIEW_HEIGHTS[size];
              const otherTabs = tabs.filter(t => t.id !== activeTab);
              return (
                <div
                  key={chart.id}
                  className={`border border-border rounded-lg bg-card p-4 group relative hover:shadow-md transition-shadow ${sizeMeta(size).span}`}
                >
                  {editingChart === chart.id ? (
                    /* Inline editor - rename + reposition directly, no AI needed */
                    <div className="mb-2 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edit chart</p>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Title</label>
                        <Input
                          value={chartTitleDraft}
                          onChange={e => setChartTitleDraft(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveChartEdit(chart); if (e.key === "Escape") setEditingChart(null); }}
                          className="h-6 text-[11px] md:text-[11px]"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Tab</label>
                        <select
                          className="w-full max-w-full min-w-0 h-6 text-[11px] px-1.5 border border-border rounded bg-background text-foreground cursor-pointer"
                          value={activeTab}
                          onChange={e => changeChartTab(chart.id, e.target.value)}
                        >
                          {tabs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Position</label>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="h-6 w-6"
                            title="Move up" disabled={activeCharts[0]?.id === chart.id}
                            onClick={() => moveChartWithinTab(chart.id, "up")}>
                            <ArrowUp className="w-3 h-3" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-6 w-6"
                            title="Move down" disabled={activeCharts[activeCharts.length - 1]?.id === chart.id}
                            onClick={() => moveChartWithinTab(chart.id, "down")}>
                            <ArrowDown className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Button size="sm" className="h-6 text-[11px] px-2" onClick={() => saveChartEdit(chart)}>Done</Button>
                        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => setEditingChart(null)}>Cancel</Button>
                        {onEditRequest && (
                          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 gap-1 ml-auto text-muted-foreground"
                            title="Refine this chart with the AI Analyst"
                            onClick={() => onEditRequest(chart)}>
                            <Sparkles className="w-3 h-3" /> AI
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Hover actions */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit title & position"
                          onClick={() => startEditChart(chart)}>
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                          title="Remove from tab"
                          onClick={() => removeChartFromTab(chart.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>

                      <div className="mb-2 pr-16">
                        <p className="text-xs font-semibold truncate">{chart.title}</p>
                        {chart.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{chart.description}</p>
                        )}
                      </div>

                      {/* Size + move controls */}
                      <div className="flex items-center gap-1 mb-2 flex-wrap">
                        {CHART_SIZES.map(s => (
                          <button
                            key={s.value}
                            title={`${s.name} size`}
                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                              size === s.value
                                ? "border-foreground bg-foreground text-background"
                                : "border-border text-muted-foreground hover:border-foreground/40"
                            }`}
                            onClick={() => setChartSize(chart.id, s.value)}
                          >
                            {s.label}
                          </button>
                        ))}
                        {otherTabs.length > 0 && (
                          <select
                            className="text-[9px] h-5 px-1 border border-border rounded bg-background text-muted-foreground ml-auto cursor-pointer max-w-full min-w-0 w-auto"
                            value=""
                            onChange={e => { if (e.target.value) moveChartToTab(chart.id, e.target.value); }}
                            title="Move to another tab"
                          >
                            <option value="" disabled>Move to…</option>
                            {otherTabs.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </>
                  )}

                  <div className={sizeH}>
                    <MiniChart type={chart.chart_type || config.chart_type || "bar"} config={config} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
