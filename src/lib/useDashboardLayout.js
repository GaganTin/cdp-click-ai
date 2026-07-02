import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";

// The dashboard layout (tabs, per-tab chart assignments, per-chart sizes) is
// persisted server-side in the company-scoped key/value store (app.settings),
// NOT in localStorage - so it follows the workspace across browsers/devices and
// is shared by every member, the same way pinned charts already are.
const LAYOUT_KEY = "dashboard_layout";
const LAYOUT_LABEL = "Dashboard layout";

export const DEFAULT_LAYOUT = {
  tabs: [{ id: "main", name: "Overview" }],
  tabAssignments: { main: [] },
  chartSizes: {},
};

// Coerce whatever the server returns into a well-formed layout. Legacy values
// used `null` for an "all charts" tab; we normalise those away so a chart only
// ever shows on tabs it's explicitly assigned to.
function normalizeLayout(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") return DEFAULT_LAYOUT;

  const tabs = Array.isArray(parsed.tabs) && parsed.tabs.length
    ? parsed.tabs
    : DEFAULT_LAYOUT.tabs;

  const rawAssignments = parsed.tabAssignments && typeof parsed.tabAssignments === "object"
    ? parsed.tabAssignments
    : {};
  const tabAssignments = {};
  for (const tab of tabs) {
    const v = rawAssignments[tab.id];
    tabAssignments[tab.id] = Array.isArray(v) ? v : [];
  }

  const chartSizes = parsed.chartSizes && typeof parsed.chartSizes === "object"
    ? parsed.chartSizes
    : {};

  return { tabs, tabAssignments, chartSizes };
}

/**
 * Loads the dashboard layout from the DB and exposes setters that mirror the
 * `useState` updater API (`setTabs`, `setTabAssignments`, `setChartSizes`).
 * Every change updates the React Query cache immediately and is persisted to
 * the server (debounced so rapid edits coalesce into one write).
 */
export function useDashboardLayout() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboardLayout"],
    queryFn: async () => normalizeLayout(await appClient.settings.get(LAYOUT_KEY)),
    // Keep the layout fresh in-cache for a while so navigating from the Analyst
    // (where a chart was just pinned + assigned to a tab) to the Dashboard reads
    // the optimistic cache rather than immediately refetching stale server data
    // and dropping the just-made assignment.
    staleTime: 60_000,
  });

  // Local working copy, seeded once from the server so edits are instant.
  const [layout, setLayout] = useState(null);
  useEffect(() => {
    if (data && layout === null) setLayout(data);
  }, [data, layout]);

  const saveMutation = useMutation({
    mutationFn: (next) =>
      appClient.settings.set(LAYOUT_KEY, JSON.stringify(next), LAYOUT_LABEL),
  });

  // Debounce persistence so a burst of edits (e.g. toggling several charts)
  // results in a single PUT with the final state.
  const saveRef = useRef(saveMutation);
  saveRef.current = saveMutation;
  const timerRef = useRef(null);
  // Holds the latest un-persisted layout so we can flush it if the component
  // unmounts before the debounce fires (e.g. pin a chart, then immediately
  // navigate to the Dashboard) - otherwise the assignment would be lost.
  const pendingRef = useRef(null);
  const schedulePersist = useCallback((next) => {
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { saveRef.current.mutate(next); pendingRef.current = null; }, 400);
  }, []);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Flush any pending write on unmount so a debounced change isn't dropped.
    if (pendingRef.current) { saveRef.current.mutate(pendingRef.current); pendingRef.current = null; }
  }, []);

  const update = useCallback((patch) => {
    setLayout((prev) => {
      // Fall back to the cached server layout (not DEFAULT) if our local copy
      // hasn't seeded yet, so an early edit can't wipe existing tabs/assignments.
      const base = prev || queryClient.getQueryData(["dashboardLayout"]) || DEFAULT_LAYOUT;
      const next = typeof patch === "function" ? patch(base) : { ...base, ...patch };
      queryClient.setQueryData(["dashboardLayout"], next);
      schedulePersist(next);
      return next;
    });
  }, [queryClient, schedulePersist]);

  const makeSetter = useCallback((field) => (updater) => {
    update((l) => ({
      ...l,
      [field]: typeof updater === "function" ? updater(l[field]) : updater,
    }));
  }, [update]);

  const current = layout || data || DEFAULT_LAYOUT;

  return {
    tabs: current.tabs,
    tabAssignments: current.tabAssignments,
    chartSizes: current.chartSizes,
    setTabs: makeSetter("tabs"),
    setTabAssignments: makeSetter("tabAssignments"),
    setChartSizes: makeSetter("chartSizes"),
    isLoading: isLoading || layout === null,
  };
}
