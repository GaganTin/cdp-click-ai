import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

const COLORS = [
  "hsl(30, 10%, 12%)",
  "hsl(30, 5%, 45%)",
  "hsl(30, 5%, 65%)",
  "hsl(30, 5%, 78%)",
  "hsl(30, 5%, 88%)",
];

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
    <div className="bg-foreground text-background px-3 py-2 rounded-md text-xs shadow-lg space-y-0.5">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || "#fff" }} className="opacity-90">
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
  const xAxisProps = {
    dataKey: xKey,
    tick: { fontSize: 10 },
    tickLine: false,
    axisLine: false,
    tickFormatter: (v) => truncate(String(v)),
  };
  const yAxisProps = {
    tick: { fontSize: 10 },
    tickLine: false,
    axisLine: false,
    width: 52,
    tickFormatter: fmtNum,
  };
  const gridProps = { strokeDasharray: "3 3", stroke: "hsl(30, 10%, 92%)" };
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
              stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
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
              fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
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
              stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.08} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === "pie") {
    const dataKey = series[0]?.dataKey || "value";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Pie data={data} dataKey={dataKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={75} strokeWidth={1}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}