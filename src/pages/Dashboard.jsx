import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MessageSquare, Target, Users, Plus, X, Check, GripVertical, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PinnedChartCard from "../components/dashboard/PinnedChartCard";

const TABS_STORAGE_KEY = "dashboard_tabs_v1";

function loadTabState() {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const SIZE_CLASSES = {
  small: "col-span-1 h-48",
  medium: "col-span-1 h-64",
  large: "col-span-2 h-80",
  wide: "col-span-2 h-64",
};

export default function Dashboard() {
  const queryClient = useQueryClient();

  const [tabs, setTabs] = useState(() => {
    const s = loadTabState();
    return s?.tabs?.length ? s.tabs : [{ id: "main", name: "Overview" }];
  });
  const [activeTab, setActiveTab] = useState(() => {
    const s = loadTabState();
    return s?.tabs?.[0]?.id || "main";
  });
  const [editingTab, setEditingTab] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [tabAssignments, setTabAssignments] = useState(() => {
    const s = loadTabState();
    return s?.tabAssignments || { main: null };
  });
  const [chartSizes, setChartSizes] = useState(() => {
    const s = loadTabState();
    return s?.chartSizes || {};
  });

  useEffect(() => {
    try {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ tabs, tabAssignments, chartSizes }));
    } catch {}
  }, [tabs, tabAssignments, chartSizes]);

  const { data: pinnedCharts = [], isLoading } = useQuery({
    queryKey: ["pinnedCharts"],
    queryFn: () => appClient.entities.PinnedChart.list("-created_date"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.PinnedChart.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pinnedCharts"] }),
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

  const cycleSize = (chartId) => {
    setChartSizes(prev => {
      const current = prev[chartId] || "medium";
      const next = current === "large" ? "medium" : "large";
      return { ...prev, [chartId]: next };
    });
  };

  // Get charts visible in active tab
  const visibleCharts = (() => {
    const assignment = tabAssignments[activeTab];
    if (assignment === null || assignment === undefined) return pinnedCharts; // "all" tab
    if (assignment.length === 0) return [];
    return pinnedCharts.filter(c => assignment.includes(c.id));
  })();

  // Is this the "all" tab?
  const isAllTab = tabAssignments[activeTab] === null || tabAssignments[activeTab] === undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Pin charts from the AI Analyst to build your dashboard.
            </p>
          </div>
          <Link to="/">
            <Button size="sm" className="gap-1.5 h-9">
              <MessageSquare className="w-3.5 h-3.5" /> AI Analyst
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
                      title="Rename tab"
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
            <Plus className="w-3.5 h-3.5" /> New tab
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Tab management - assign charts to tab */}
        {!isAllTab && pinnedCharts.length > 0 && (
          <div className="mb-4 p-3 bg-secondary/40 rounded-lg">
            <p className="text-xs font-medium mb-2 text-muted-foreground">Add charts to this tab:</p>
            <div className="flex flex-wrap gap-2">
              {pinnedCharts.map(c => {
                const assigned = (tabAssignments[activeTab] || []).includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleChartInTab(activeTab, c.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      assigned ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>
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
                <p className="text-sm font-medium mb-1">No pinned charts yet</p>
                <p className="text-xs text-muted-foreground mb-4">Ask the AI Analyst to generate charts, then pin them here.</p>
                <Link to="/"
                  className="inline-flex items-center gap-2 text-xs font-medium px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity">
                  <MessageSquare className="w-3.5 h-3.5" /> Open AI Analyst
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm font-medium mb-1">No charts in this tab</p>
                <p className="text-xs text-muted-foreground">Use the selector above to add charts to this tab.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {visibleCharts.map(chart => {
              const size = chartSizes[chart.id] || "medium";
              return (
                <div key={chart.id} className={SIZE_CLASSES[size]}>
                  <PinnedChartCard
                    chart={chart}
                    size={size}
                    onRemove={(c) => deleteMutation.mutate(c.id)}
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
          <h2 className="font-heading text-xl font-semibold tracking-tight mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link to="/" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <MessageSquare className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">Ask the Analyst</p>
              <p className="text-xs text-muted-foreground mt-0.5">Query data, generate insights</p>
            </Link>
            <Link to="/campaigns" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <Target className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">Create UTM Link</p>
              <p className="text-xs text-muted-foreground mt-0.5">UTM links, targeting</p>
            </Link>
            <Link to="/segments" className="group border border-border rounded-lg p-5 hover:border-foreground/20 transition-colors">
              <Users className="w-5 h-5 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
              <p className="text-sm font-medium">Build Segment</p>
              <p className="text-xs text-muted-foreground mt-0.5">Audience segmentation</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
