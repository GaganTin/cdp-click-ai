// Single source of truth for pinned-chart sizing, shared by the Dashboard
// (src/pages/Dashboard.jsx) and the AI Analyst "Dashboard Preview" panel
// (src/components/dashboard/DashboardPreviewPanel.jsx) so the two can't drift.
//
// Two sizes only - Small (single column) and Large (full width) - matching the
// 2-column dashboard grid. Each surface keeps its own pixel heights (the preview
// panel is narrower than the dashboard), but the size identity and column span
// are shared so "S"/"L" mean the same thing everywhere.

export const CHART_SIZES = [
  { value: "small", label: "S", name: "Small", span: "col-span-1" },
  { value: "large", label: "L", name: "Large", span: "col-span-2" },
];

export const DEFAULT_CHART_SIZE = "small";

// Map legacy stored values (from before the size model was simplified to two)
// onto the current sizes, so existing pinned charts keep rendering sensibly.
const LEGACY = { medium: "small", wide: "large", normal: "small" };

export function normalizeSize(size) {
  const v = LEGACY[size] || size;
  return CHART_SIZES.some((s) => s.value === v) ? v : DEFAULT_CHART_SIZE;
}

export function sizeMeta(size) {
  const v = normalizeSize(size);
  return CHART_SIZES.find((s) => s.value === v);
}

// Toggle used by the single resize button on a dashboard card (Small <-> Large).
export function nextSize(size) {
  return normalizeSize(size) === "large" ? "small" : "large";
}
