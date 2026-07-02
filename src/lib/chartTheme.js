// Theme-aware, monochrome chart palette shared by EVERY chart in the app (the dashboard
// MiniChart and all analytics panels). Charts render in the foreground color - near-black
// in light mode, near-white in dark mode - with opacity steps distinguishing series and
// pie slices, instead of fixed dark-gray hex values that vanish against a dark background.
//
// Why resolve the vars in JS: recharts writes colors as SVG *presentation attributes*
// (e.g. fill="hsl(var(--foreground))"), and browsers do NOT resolve CSS var() inside SVG
// attributes - it silently falls back to black. So we resolve the vars to concrete colors
// at render time and re-resolve whenever the theme (`.dark` class on <html>) toggles.
import { useEffect, useState } from "react";

const AXIS_VARS = ["--foreground", "--muted-foreground", "--border", "--card"];

// Fallbacks used before getComputedStyle is available (SSR / first paint).
const FALLBACK = {
  "--foreground": "30 10% 12%",
  "--muted-foreground": "30 5% 50%",
  "--border": "30 10% 90%",
  "--card": "40 20% 99%",
};

// Series 0 is fully opaque; later series / slices fade progressively so they stay
// distinguishable while remaining a single (foreground) hue.
export const OPACITY_STEPS = [1, 0.72, 0.5, 0.34, 0.22, 0.14];
export const opacityFor = (i) => OPACITY_STEPS[i % OPACITY_STEPS.length];

export function useChartTheme() {
  const read = () => {
    const out = {};
    const cs = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
    for (const v of AXIS_VARS) {
      const raw = cs?.getPropertyValue(v).trim();
      out[v] = `hsl(${raw || FALLBACK[v]})`;
    }
    return out;
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    setColors(read());
    const obs = new MutationObserver(() => setColors(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return colors;
}
