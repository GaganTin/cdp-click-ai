import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// chart_config is a JSONB column, so the API returns it as an already-parsed
// object. But freshly-pinned charts (and some callers) still hold it as a JSON
// string. Normalize both shapes to a plain object.
export function parseChartConfig(chartConfig) {
  if (!chartConfig) return {};
  if (typeof chartConfig === "object") return chartConfig;
  try { return JSON.parse(chartConfig); } catch { return {}; }
}
