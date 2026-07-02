import { useEffect, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

// Monochrome, theme-aware palette. Charts render in the foreground color - near-black
// in light mode, near-white in dark mode - instead of the multi-hue --chart-* palette.
// The CSS vars (defined in index.css) flip between light and dark mode, but recharts
// writes colors as SVG *presentation attributes* (e.g. fill="hsl(var(--foreground))"),
// and browsers do NOT resolve CSS var() inside SVG attributes - it silently falls back
// to black. So we resolve the vars to concrete colors at render time and re-resolve
// whenever the theme (`.dark` class on <html>) toggles.
const AXIS_VARS = ["--foreground", "--muted-foreground", "--border", "--card"];

// Fallbacks used before getComputedStyle is available (SSR / first paint).
const FALLBACK = {
  "--foreground": "30 10% 12%",
  "--muted-foreground": "30 5% 50%", "--border": "30 10% 90%", "--card": "40 20% 99%",
};

// Opacity steps let multiple series / pie slices stay distinguishable while remaining
// a single (foreground) hue. Series 0 is fully opaque; later ones fade progressively.
const OPACITY_STEPS = [1, 0.72, 0.5, 0.34, 0.22, 0.14];

function useThemeColors() {
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

const fmtNum = (v) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return v.toLocaleString();
  return Number(v).toFixed(1);
};

const truncate = (str, max = 14) =>
  typeof str === "string" && str.length > max ? str.slice(0, max - 1) + "…" : str;

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-black text-white border border-white px-3 py-2 rounded-md text-xs shadow-lg space-y-0.5">
      {label && <p className="font-medium mb-1 text-white">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-white opacity-90">
          {p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
          {typeof p.value === "number" && p.value >= 1000 && (
            <span className="opacity-60 ml-1">({fmtNum(p.value)})</span>
          )}
        </p>
      ))}
    </div>
  );
};

export default function MiniChart({ type, config }) {
  const themeColors = useThemeColors();
  const FG = themeColors["--foreground"];
  const opacityFor = (i) => OPACITY_STEPS[i % OPACITY_STEPS.length];
  const data = config?.data || [];
  const xKey = config?.xKey || "name";

  // Support multiple series via config.series, or fall back to single dataKey
  const series = config?.series || [{ dataKey: config?.dataKey || "value", name: config?.dataKey || "value" }];

  if (!data.length) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  const commonProps = { data, margin: { top: 5, right: 10, left: 0, bottom: 5 } };
  const tick = { fontSize: 10, fill: themeColors["--muted-foreground"] };
  const xAxisProps = {
    dataKey: xKey,
    tick,
    tickLine: false,
    axisLine: false,
    tickFormatter: (v) => truncate(String(v)),
  };
  const yAxisProps = {
    tick,
    tickLine: false,
    axisLine: false,
    width: 52,
    tickFormatter: fmtNum,
  };
  const gridProps = { strokeDasharray: "3 3", stroke: themeColors["--border"] };
  const showLegend = series.length > 1;

  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map((s, i) => (
            <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name || s.dataKey}
              stroke={FG} strokeOpacity={opacityFor(i)} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (type === "bar") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map((s, i) => (
            <Bar key={s.dataKey} dataKey={s.dataKey} name={s.name || s.dataKey}
              fill={FG} fillOpacity={opacityFor(i)} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...commonProps}>
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map((s, i) => (
            <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name || s.dataKey}
              stroke={FG} strokeOpacity={opacityFor(i)} fill={FG} fillOpacity={0.08} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === "pie") {
    const dataKey = series[0]?.dataKey || "value";
    // Cap slices so the chart stays legible; fold the smallest into "Other".
    const MAX_SLICES = 6;
    let pieData = data;
    if (data.length > MAX_SLICES) {
      const sorted = [...data].sort((a, b) => (Number(b[dataKey]) || 0) - (Number(a[dataKey]) || 0));
      const rest = sorted.slice(MAX_SLICES - 1);
      const otherVal = rest.reduce((s, r) => s + (Number(r[dataKey]) || 0), 0);
      pieData = [...sorted.slice(0, MAX_SLICES - 1), { [xKey]: "Other", [dataKey]: otherVal }];
    }
    return (
      <ResponsiveContainer width="100%" height="100%">
        {/* Donut with a vertical legend to its right so labels never overlap the
            slices (the old fixed-radius pie + bottom legend collided on short cards). */}
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            layout="vertical" align="right" verticalAlign="middle"
            iconType="circle" iconSize={8}
            wrapperStyle={{ fontSize: 10, lineHeight: "15px", paddingLeft: 8, maxWidth: "42%", overflow: "hidden" }}
          />
          <Pie
            data={pieData} dataKey={dataKey} nameKey={xKey}
            cx="42%" cy="50%" innerRadius="46%" outerRadius="74%"
            paddingAngle={1.5} stroke={themeColors["--card"]} strokeWidth={2}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={FG} fillOpacity={opacityFor(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}