import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { useAuth } from "@/lib/AuthContext";

// The dashboard layout (tabs, per-tab chart assignments, per-chart sizes) is
// persisted server-side in the company-scoped key/value store (app.settings),
// NOT in localStorage - so it follows the workspace across browsers/devices.
//
// Tabs carry per-user visibility: a tab is `public` (every member sees it) or
// `private` (only its creator sees it). Because the whole layout is ONE shared
// document, private tabs still live in that document but are filtered out for
// everyone except their creator on read, and preserved on write (see
// mergeVisibleTabs) so one member's save never drops another's private tabs.
const LAYOUT_KEY = "dashboard_layout";
const LAYOUT_LABEL = "Dashboard layout";

export const DEFAULT_LAYOUT = {
  tabs: [{ id: "main", name: "Overview" }],
  tabAssignments: { main: [] },
  chartSizes: {},
};

// A tab is visible to a user if it's public (default when unset) or the user
// created it. Legacy tabs (no visibility/created_by) are treated as public.
function tabVisibleTo(tab, userId) {
  return tab?.visibility !== "private" || tab?.created_by === userId;
}

// Merge the user's next *visible* tab list back into the full tab list,
// preserving tabs the user can't see (other members' private tabs) so a save
// from one member never drops another member's private tabs. Hidden tabs are
// re-anchored immediately after the visible tab that preceded them in the old
// order, keeping their position as stable as possible across edits.
function mergeVisibleTabs(fullPrev, visibleNext, canSee) {
  const hidden = (fullPrev || []).filter((t) => !canSee(t));
  if (!hidden.length) return visibleNext; // nothing hidden to preserve

  // anchor = id of the nearest preceding visible tab (null => front of list).
  const anchorOf = new Map();
  let lastVisibleId = null;
  for (const t of fullPrev) {
    if (canSee(t)) lastVisibleId = t.id;
    else anchorOf.set(t.id, lastVisibleId);
  }
  const byAnchor = new Map(); // anchorId|null -> [hidden tabs] (order preserved)
  for (const h of hidden) {
    const a = anchorOf.get(h.id) ?? null;
    if (!byAnchor.has(a)) byAnchor.set(a, []);
    byAnchor.get(a).push(h);
  }

  const result = [];
  for (const h of byAnchor.get(null) || []) result.push(h); // front-anchored
  for (const vt of visibleNext) {
    result.push(vt);
    for (const h of byAnchor.get(vt.id) || []) result.push(h);
  }
  // Hidden tabs whose anchor was removed from the visible set would be orphaned
  // - append them so they always survive the round-trip.
  const emitted = new Set(result.map((t) => t.id));
  for (const h of hidden) if (!emitted.has(h.id)) result.push(h);
  return result;
}

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
 *
 * `tabs` returned here is already filtered to what the current user may see;
 * `setTabs` accepts that visible list (updater or value) and merges it back
 * into the full stored layout, preserving other members' private tabs.
 */
export function useDashboardLayout() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboardLayout"],
    queryFn: async () => normalizeLayout(await appClient.settings.get(LAYOUT_KEY)),
    // Keep the layout fresh in-cache for a while so navigating from the Analyst
    // (where a chart was just pinned + assigned to a tab) to the Dashboard reads
    // the optimistic cache rather than immediately refetching stale server data
    // and dropping the just-made assignment.
    staleTime: 60_000,
  });

  // Local working copy, seeded once from the server so edits are instant. This
  // holds the FULL layout (all members' tabs); filtering happens on the way out.
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

  // setTabs is visibility-aware: the caller works with the *visible* tab list,
  // and we merge that back into the full stored list (see mergeVisibleTabs).
  const setTabs = useCallback((updater) => {
    update((full) => {
      const canSee = (t) => tabVisibleTo(t, userId);
      const visiblePrev = (full.tabs || []).filter(canSee);
      const visibleNext = typeof updater === "function" ? updater(visiblePrev) : updater;
      return { ...full, tabs: mergeVisibleTabs(full.tabs || [], visibleNext, canSee) };
    });
  }, [update, userId]);

  const current = layout || data || DEFAULT_LAYOUT;
  const visibleTabs = (current.tabs || []).filter((t) => tabVisibleTo(t, userId));

  return {
    tabs: visibleTabs,
    tabAssignments: current.tabAssignments,
    chartSizes: current.chartSizes,
    userId,
    setTabs,
    setTabAssignments: makeSetter("tabAssignments"),
    setChartSizes: makeSetter("chartSizes"),
    isLoading: isLoading || layout === null,
  };
}
