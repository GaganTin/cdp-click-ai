// Shared "Discuss this chart with the AI Analyst" plumbing.
//
// Mirrors the Dashboard flow (PinnedChartCard.handleDiscuss): build a payload the
// Analyst page understands and navigate to it with the chart in router state. The
// Analyst page (src/pages/Analyst.jsx) reads `location.state.discussChart`, so any
// analytics page can reuse this to hand a chart — already filtered to whatever the
// page is showing — over to the chat.
import { useNavigate } from "react-router-dom";

// Normalize an AnalyticsKit / panel chart type to a MiniChart-renderable type, so a
// chart the AI decides to pin back to the dashboard is valid.
export function normDiscussType(t) {
  if (t === "horizontal-bar" || t === "hbar") return "bar";
  if (t === "bar" || t === "line" || t === "area" || t === "pie") return t;
  return "bar";
}

// Build the payload consumed by Analyst.buildDiscussPrompt. `data` should already be
// filtered to the period/filters the user is looking at (the caller passes the same
// rows it renders). `delta`, when supplied, is { pct, current, previous }.
export function buildDiscussPayload({
  title,
  description = "",
  type,
  data = [],
  xKey = "name",
  series,
  dataKey = "value",
  period = "All time",
  delta = null,
  source = "analytics",
}) {
  const chartType = normDiscussType(type);
  const config = { title, data, xKey, chart_type: chartType };
  if (series) config.series = series;
  else config.dataKey = dataKey;
  return {
    title,
    description,
    chart_type: chartType,
    chart_config: JSON.stringify(config),
    period,
    delta,
    source,
  };
}

// Hook returning a `discuss(payload)` function that opens the AI Analyst with the
// chart loaded. Use with buildDiscussPayload:
//   const discuss = useDiscussChart();
//   discuss(buildDiscussPayload({ title, type, data, period }));
export function useDiscussChart() {
  const navigate = useNavigate();
  return (payload) => navigate("/", { state: { discussChart: payload } });
}
