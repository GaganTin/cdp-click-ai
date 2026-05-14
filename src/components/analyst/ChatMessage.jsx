import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Pin, Download, Check, Zap, Loader2, CheckCircle2, AlertCircle, Clock, ChevronRight, TrendingUp, Link as LinkIcon, Users, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import MiniChart from "../dashboard/MiniChart";

const FunctionDisplay = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || "Function";
  const status = toolCall?.status || "pending";
  const results = toolCall?.results;
  const displayProjection = toolCall?.display_projection;
  const hideDetails = !!displayProjection?.hide_details && !!displayProjection?.details_redacted;

  const parsedResults = (() => {
    if (!results) return null;
    try { return typeof results === "string" ? JSON.parse(results) : results; } catch { return results; }
  })();
  const isError = results && ((typeof results === "string" && /error|failed/i.test(results)) || parsedResults?.success === false);

  const statusConfig = {
    pending: { icon: Clock, color: "text-muted-foreground", text: "Pending" },
    running: { icon: Loader2, color: "text-muted-foreground", text: "Running...", spin: true },
    in_progress: { icon: Loader2, color: "text-muted-foreground", text: "Running...", spin: true },
    completed: isError
      ? { icon: AlertCircle, color: "text-destructive", text: "Failed" }
      : { icon: CheckCircle2, color: "text-green-600", text: "Done" },
    success: { icon: CheckCircle2, color: "text-green-600", text: "Done" },
    failed: { icon: AlertCircle, color: "text-destructive", text: "Failed" },
    error: { icon: AlertCircle, color: "text-destructive", text: "Failed" },
  }[status] || { icon: Zap, color: "text-muted-foreground", text: "" };

  const Icon = statusConfig.icon;
  const formattedName = name.split(".").reverse().join(" ").toLowerCase();

  if (hideDetails) {
    const isActive = status === "running" || status === "pending" || status === "in_progress";
    const isFailed = status === "failed" || status === "error" || isError;
    const StateIcon = isActive ? Loader2 : isFailed ? AlertCircle : CheckCircle2;
    const label = isActive ? displayProjection.active_label : isFailed ? displayProjection.error_label : displayProjection.label;
    return (
      <div className="mt-2 text-xs">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary/50 text-muted-foreground">
          <span>{label || statusConfig.text || formattedName}</span>
          <StateIcon className={cn("h-3 w-3", isActive && "animate-spin", isFailed && "text-destructive", !isActive && !isFailed && "text-green-600")} />
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 text-xs">
      <button onClick={() => setExpanded(!expanded)} className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all hover:bg-secondary/50", expanded ? "bg-secondary/50 border-border" : "bg-transparent border-border")}>
        <Icon className={cn("h-3 w-3", statusConfig.color, statusConfig.spin && "animate-spin")} />
        <span className="text-muted-foreground">{formattedName}</span>
        {statusConfig.text && <span className={cn("text-muted-foreground", isError && "text-destructive")}>· {statusConfig.text}</span>}
        {!statusConfig.spin && (toolCall.arguments_string || results) && <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform ml-auto", expanded && "rotate-90")} />}
      </button>
      {expanded && !statusConfig.spin && (
        <div className="mt-1.5 ml-3 pl-3 border-l border-border space-y-2">
          {toolCall.arguments_string && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Parameters:</div>
              <pre className="bg-secondary rounded-md p-2 text-[10px] text-muted-foreground whitespace-pre-wrap">{(() => { try { return JSON.stringify(JSON.parse(toolCall.arguments_string), null, 2); } catch { return toolCall.arguments_string; } })()}</pre>
            </div>
          )}
          {parsedResults && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Result:</div>
              <pre className="bg-secondary rounded-md p-2 text-[10px] text-muted-foreground whitespace-pre-wrap max-h-48 overflow-auto">{typeof parsedResults === "object" ? JSON.stringify(parsedResults, null, 2) : parsedResults}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function UTMLinkCard({ data, onAdd }) {
  const [added, setAdded] = useState(false);
  const url = (() => {
    if (!data.base_url) return "";
    const p = new URLSearchParams();
    if (data.utm_source) p.set("utm_source", data.utm_source);
    if (data.utm_medium) p.set("utm_medium", data.utm_medium);
    if (data.utm_campaign) p.set("utm_campaign", data.utm_campaign);
    if (data.utm_term) p.set("utm_term", data.utm_term);
    if (data.utm_content) p.set("utm_content", data.utm_content);
    return `${data.base_url}${data.base_url.includes("?") ? "&" : "?"}${p.toString()}`;
  })();

  const handleAdd = async () => {
    await onAdd?.({ ...data, full_utm_url: url });
    setAdded(true);
  };

  return (
    <div className="my-3 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-secondary/40 border-b border-border">
        <LinkIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-semibold flex-1">Suggested UTM Link — {data.name}</span>
        <Button size="sm" variant={added ? "secondary" : "default"} className="h-7 text-xs gap-1.5" onClick={handleAdd} disabled={added}>
          {added ? <><Check className="w-3 h-3" /> Added</> : <><PlusCircle className="w-3 h-3" /> Add to UTM</>}
        </Button>
      </div>
      <div className="px-4 py-3 space-y-1.5 text-xs">
        <div className="flex flex-wrap gap-3 text-muted-foreground">
          {data.utm_source && <span>Source: <strong className="text-foreground">{data.utm_source}</strong></span>}
          {data.utm_medium && <span>Medium: <strong className="text-foreground">{data.utm_medium}</strong></span>}
          {data.utm_campaign && <span>Campaign: <strong className="text-foreground">{data.utm_campaign}</strong></span>}
          {data.utm_term && <span>Term: <strong className="text-foreground">{data.utm_term}</strong></span>}
          {data.utm_content && <span>Content: <strong className="text-foreground">{data.utm_content}</strong></span>}
        </div>
        {url && <p className="font-mono text-[10px] text-muted-foreground break-all mt-1">{url}</p>}
      </div>
    </div>
  );
}

function SegmentCard({ data, onAdd }) {
  const [added, setAdded] = useState(false);
  const handleAdd = async () => {
    await onAdd?.(data);
    setAdded(true);
  };
  return (
    <div className="my-3 border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-secondary/40 border-b border-border">
        <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-semibold flex-1">Suggested Segment — {data.name}</span>
        <Button size="sm" variant={added ? "secondary" : "default"} className="h-7 text-xs gap-1.5" onClick={handleAdd} disabled={added}>
          {added ? <><Check className="w-3 h-3" /> Added</> : <><PlusCircle className="w-3 h-3" /> Add to Segments</>}
        </Button>
      </div>
      <div className="px-4 py-3 space-y-1 text-xs">
        {data.description && <p className="text-muted-foreground leading-relaxed">{data.description}</p>}
        <div className="flex gap-4 mt-2 text-muted-foreground">
          <span>Type: <strong className="text-foreground">{data.segment_type === "anonymous_profile" ? "Anonymous" : "Customer"}</strong></span>
          {data.estimated_size && <span>Est. size: <strong className="text-foreground">{Number(data.estimated_size).toLocaleString()} users</strong></span>}
        </div>
      </div>
    </div>
  );
}

export default function ChatMessage({ message, onPinChart, onDownloadCSV, onAddUTMLink, onAddSegment }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse and render a markdown table string into a JSX table
  const renderMarkdownTable = (tableStr, key) => {
    const lines = tableStr.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) return null;
    const parseRow = (line) => line.split("|").map(c => c.trim()).filter((c, i, arr) => i !== 0 || c !== "").filter((c, i, arr) => i !== arr.length - 1 || c !== "");
    const headers = parseRow(lines[0]);
    const rows = lines.slice(2).map(parseRow);
    return (
      <div key={key} className="overflow-x-auto my-3">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-secondary/60">
            <tr>{headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap border-b border-border">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border last:border-0 hover:bg-secondary/30">
                {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-muted-foreground">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Extract chart blocks from content
  const renderContent = (content) => {
    if (!content) return null;
    
    const chartRegex = /```chart\n([\s\S]*?)```/g;
    const csvRegex = /```csv\n([\s\S]*?)```/g;
    const utmRegex = /```utm_link\n([\s\S]*?)```/g;
    const segmentRegex = /```segment\n([\s\S]*?)```/g;
    const tableRegex = /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g;

    let parts = [];
    let lastIndex = 0;
    let match;

    const charts = [];
    while ((match = chartRegex.exec(content)) !== null) {
      charts.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
    }
    const csvBlocks = [];
    while ((match = csvRegex.exec(content)) !== null) {
      csvBlocks.push({ index: match.index, end: match.index + match[0].length, data: match[1] });
    }
    const utmBlocks = [];
    while ((match = utmRegex.exec(content)) !== null) {
      utmBlocks.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
    }
    const segmentBlocks = [];
    while ((match = segmentRegex.exec(content)) !== null) {
      segmentBlocks.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
    }
    const tables = [];
    while ((match = tableRegex.exec(content)) !== null) {
      const before = content.slice(0, match.index);
      const codeBlockCount = (before.match(/```/g) || []).length;
      if (codeBlockCount % 2 === 0) {
        tables.push({ index: match.index, end: match.index + match[0].length, raw: match[0] });
      }
    }

    const allBlocks = [
      ...charts.map(c => ({ ...c, type: "chart" })),
      ...csvBlocks.map(c => ({ ...c, type: "csv" })),
      ...utmBlocks.map(c => ({ ...c, type: "utm_link" })),
      ...segmentBlocks.map(c => ({ ...c, type: "segment" })),
      ...tables.map(c => ({ ...c, type: "table" })),
    ].sort((a, b) => a.index - b.index);

    const mdComponents = {
      table: ({ children }) => (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-xs border-collapse">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-secondary/60">{children}</thead>,
      tbody: ({ children }) => <tbody>{children}</tbody>,
      tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
      th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">{children}</th>,
      td: ({ children }) => <td className="px-3 py-2 text-muted-foreground">{children}</td>,
      pre: ({ children }) => <>{children}</>,
      code: ({ children, className }) => {
        const isBlock = className?.startsWith('language-') || String(children || '').includes('\n');
        return isBlock
          ? <pre className="bg-secondary rounded-md p-3 text-xs font-mono overflow-x-auto my-2 whitespace-pre-wrap"><code>{children}</code></pre>
          : <code className="px-1 py-0.5 rounded bg-secondary text-xs font-mono">{children}</code>;
      },
      p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
      ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
      li: ({ children }) => <li className="text-sm">{children}</li>,
      h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
      h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1">{children}</h2>,
      h3: ({ children }) => <h3 className="text-xs font-semibold mt-2 mb-1 uppercase tracking-wide text-muted-foreground">{children}</h3>,
      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
      blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground italic">{children}</blockquote>,
    };

    if (allBlocks.length === 0) {
      return (
        <ReactMarkdown className="text-sm prose prose-sm prose-neutral max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" components={mdComponents}>
          {content}
        </ReactMarkdown>
      );
    }

    allBlocks.forEach((block, i) => {
      const textBefore = content.slice(lastIndex, block.index);
      if (textBefore.trim()) {
        parts.push(
          <ReactMarkdown key={`text-${i}`} className="text-sm prose prose-sm prose-neutral max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" components={mdComponents}>
            {textBefore}
          </ReactMarkdown>
        );
      }

      if (block.type === "chart") {
        try {
          const chartConfig = JSON.parse(block.json);
          const chartType = chartConfig.chart_type || "bar";
          const primaryKey = chartConfig.series?.[0]?.dataKey || chartConfig.dataKey || "value";
          const isTimeSeries = chartType === "line" || chartType === "area";

          // Coerce string values to numbers; sort descending for categorical charts
          const sortedData = (() => {
            if (!chartConfig.data?.length) return chartConfig.data;
            const coerced = chartConfig.data.map(d => ({ ...d, [primaryKey]: Number(d[primaryKey]) || 0 }));
            if (isTimeSeries) return coerced;
            return [...coerced].sort((a, b) => b[primaryKey] - a[primaryKey]);
          })();

          const displayConfig = { ...chartConfig, data: sortedData };

          parts.push(
            <div key={`chart-${i}`} className="my-4 border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <div>
                  <p className="text-xs font-semibold">{chartConfig.title || "Chart"}</p>
                  {chartConfig.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{chartConfig.description}</p>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 flex-shrink-0" onClick={() => onPinChart?.(displayConfig)}>
                  <Pin className="w-3 h-3" /> Pin
                </Button>
              </div>
              <div className="h-64 px-2 pb-3">
                <MiniChart type={chartType} config={displayConfig} />
              </div>
              {chartConfig.trend && (
                <div className="flex items-start gap-2 px-4 py-2.5 bg-secondary/40 border-t border-border">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{chartConfig.trend}</p>
                </div>
              )}
            </div>
          );
        } catch {
          parts.push(<pre key={`chart-err-${i}`} className="text-xs text-destructive">Invalid chart data</pre>);
        }
      }

      if (block.type === "table") {
        parts.push(renderMarkdownTable(block.raw, `table-${i}`));
      }

      if (block.type === "csv") {
        parts.push(
          <div key={`csv-${i}`} className="my-4">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => onDownloadCSV?.(block.data)}>
              <Download className="w-3 h-3" /> Download CSV
            </Button>
          </div>
        );
      }

      if (block.type === "utm_link") {
        try {
          const data = JSON.parse(block.json);
          parts.push(<UTMLinkCard key={`utm-${i}`} data={data} onAdd={onAddUTMLink} />);
        } catch {
          parts.push(<p key={`utm-err-${i}`} className="text-xs text-destructive">Invalid UTM link data</p>);
        }
      }

      if (block.type === "segment") {
        try {
          const data = JSON.parse(block.json);
          parts.push(<SegmentCard key={`seg-${i}`} data={data} onAdd={onAddSegment} />);
        } catch {
          parts.push(<p key={`seg-err-${i}`} className="text-xs text-destructive">Invalid segment data</p>);
        }
      }

      lastIndex = block.end;
    });

    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      parts.push(
        <ReactMarkdown key="text-end" className="text-sm prose prose-sm prose-neutral max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" components={mdComponents}>
          {remaining}
        </ReactMarkdown>
      );
    }

    return parts;
  };

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-[9px] font-semibold text-background">AI</span>
        </div>
      )}
      <div className={cn("max-w-[85%]", isUser && "flex flex-col items-end")}>
        {message.content && (
          <div className={cn(
            "rounded-2xl px-4 py-3",
            isUser ? "bg-foreground text-background" : "bg-secondary"
          )}>
            {isUser ? (
              <p className="text-sm leading-relaxed">{message.content}</p>
            ) : (
              renderContent(message.content)
            )}
          </div>
        )}

        {message.tool_calls?.length > 0 && (
          <div className="space-y-1">
            {message.tool_calls.map((tc, i) => (
              <FunctionDisplay key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {!isUser && message.content && (
          <div className="flex items-center gap-1 mt-1.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}