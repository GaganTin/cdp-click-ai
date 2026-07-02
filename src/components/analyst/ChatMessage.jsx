import { useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Copy, Pin, Download, Check, Zap, Loader2, CheckCircle2, AlertCircle, Clock, ChevronRight, TrendingUp, Link as LinkIcon, Users, PlusCircle, Mail, Pencil, Calendar, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtCredits } from "@/lib/credits";
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
      : { icon: CheckCircle2, color: "text-foreground", text: "Done" },
    success: { icon: CheckCircle2, color: "text-foreground", text: "Done" },
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
          <StateIcon className={cn("h-3 w-3", isActive && "animate-spin", isFailed && "text-destructive", !isActive && !isFailed && "text-foreground")} />
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
        <span className="text-xs font-semibold flex-1">Suggested UTM Link - {data.name}</span>
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
  const criteria = data.metadata?.criteria || [];

  const handleAdd = async () => {
    await onAdd?.(data);
    setAdded(true);
  };

  return (
    <div className="my-3 border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-secondary/40 border-b border-border">
        <div className="w-6 h-6 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold">{data.name}</span>
          <span className="text-[10px] text-muted-foreground ml-2">AI-suggested segment</span>
        </div>
        {data.estimated_size != null && (
          <span className="text-sm font-bold tabular-nums flex-shrink-0 mr-2">
            {Number(data.estimated_size).toLocaleString()}
            <span className="text-[10px] font-normal ml-0.5 text-muted-foreground">members</span>
          </span>
        )}
        <Button
          size="sm"
          variant={added ? "secondary" : "default"}
          className="h-7 text-xs gap-1.5 flex-shrink-0"
          onClick={handleAdd}
          disabled={added}
        >
          {added ? <><Check className="w-3 h-3" /> Saved</> : <><PlusCircle className="w-3 h-3" /> Save Segment</>}
        </Button>
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-2.5">
        {data.description && (
          <p className="text-xs text-muted-foreground leading-relaxed">{data.description}</p>
        )}

        {/* Criteria tags */}
        {criteria.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {criteria.map((c, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                {c}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-4 text-[11px] text-muted-foreground">
          <span>Type: <strong className="text-foreground capitalize">{data.segment_type === "anonymous_profile" ? "Anonymous Visitors" : "Customer Members"}</strong></span>
          {data.status && <span>Status: <strong className="text-foreground capitalize">{data.status}</strong></span>}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border bg-secondary/20">
        <p className="text-[10px] text-muted-foreground">
          Click "Save Segment" to add this to your Segments page - it can then be linked to email campaigns
        </p>
      </div>
    </div>
  );
}

const TRIGGER_LABELS = {
  manual: "Manual Send", scheduled: "Scheduled",
  new_member: "New Member", member_upgraded: "Member Upgraded",
  member_expired: "Membership Expired", member_anniversary: "Anniversary",
  seminar_attended: "Seminar Attended", webinar_attended: "Webinar Attended",
  form_submitted: "Form Submitted", event_registered: "Event Registered",
  high_activity: "Highly Active", page_viewed: "Page View",
  file_downloaded: "File Download", whatsapp_clicked: "WhatsApp Click",
  inactivity_30d: "30-day Inactive", inactivity_60d: "60-day Inactive",
  inactivity_90d: "90-day Inactive", inactivity_180d: "6-month Inactive",
  birthday: "Birthday", join_anniversary: "Join Anniversary",
};

function SegmentPanel({ seg, choice, onChoice }) {
  if (!seg) return null;
  const isExisting = seg.action === "use_existing";
  const displayName = isExisting ? seg.existing_segment_name : seg.name;

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden transition-all",
      choice === "none" ? "opacity-60 border-border" : "border-border"
    )}>
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border">
        <div className="w-5 h-5 rounded bg-secondary flex items-center justify-center flex-shrink-0">
          <Users className="w-3 h-3 text-muted-foreground" />
        </div>
        <span className="text-[11px] font-semibold flex-1">
          {isExisting ? "Existing Segment" : "Recommended Segment"}
        </span>
        {seg.estimated_size != null && (
          <span className="text-[11px] font-bold tabular-nums">
            {Number(seg.estimated_size).toLocaleString()} members
          </span>
        )}
      </div>

      {/* Segment details */}
      <div className="px-3 py-2.5 bg-background space-y-1.5">
        <p className="text-xs font-semibold">{displayName}</p>
        {seg.description && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">{seg.description}</p>
        )}
        {/* Criteria tags */}
        {seg.metadata?.criteria && (
          <div className="flex flex-wrap gap-1 mt-1">
            {(Array.isArray(seg.metadata.criteria) ? seg.metadata.criteria : [seg.metadata.criteria]).map((c, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
                {c}
              </span>
            ))}
          </div>
        )}
        {seg.rationale && (
          <p className="text-[10px] text-muted-foreground/70 italic">{seg.rationale}</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-secondary/10 border-t border-border">
        {!isExisting && (
          <button
            onClick={() => onChoice("create_new")}
            className={cn(
              "flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all flex-1 justify-center",
              choice === "create_new"
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            )}
          >
            {choice === "create_new" ? <><Check className="w-3 h-3" /> Creating Segment</> : <><PlusCircle className="w-3 h-3" /> Create Segment</>}
          </button>
        )}
        {isExisting && (
          <button
            onClick={() => onChoice("use_existing")}
            className={cn(
              "flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all flex-1 justify-center",
              choice === "use_existing"
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            )}
          >
            {choice === "use_existing" ? <><Check className="w-3 h-3" /> Using Segment</> : "Use This Segment"}
          </button>
        )}
        {seg.existing_segment_id && !isExisting && (
          <button
            onClick={() => onChoice("use_existing")}
            className={cn(
              "flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-all",
              choice === "use_existing"
                ? "bg-secondary text-foreground border-border"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            Use Existing
          </button>
        )}
        <button
          onClick={() => onChoice("none")}
          className={cn(
            "text-[11px] px-2 py-1 rounded-md border transition-all",
            choice === "none"
              ? "bg-secondary text-foreground border-border"
              : "border-dashed border-border text-muted-foreground hover:border-foreground/30"
          )}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function UTMPanel({ utm, choice, onChoice }) {
  if (!utm) return null;
  const isExisting = utm.action === "use_existing";
  const isPending = utm.action === "pending";
  const slug = utm.utm_campaign || utm.name || "";
  const isDecided = choice === "create_new" || choice === "use_existing" || choice === "none";

  return (
    <div className={cn(
      "rounded-lg border overflow-hidden transition-all",
      choice === "none" ? "opacity-60 border-border" : "border-border"
    )}>
      {/* Panel header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border">
        <div className="w-5 h-5 rounded bg-secondary flex items-center justify-center flex-shrink-0">
          <LinkIcon className="w-3 h-3 text-muted-foreground" />
        </div>
        <span className="text-[11px] font-semibold flex-1">
          {isExisting ? "Existing UTM Link" : isPending && !isDecided ? "UTM Tracking - Your choice" : "Recommended UTM Tracking"}
        </span>
        {isPending && !isDecided && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
            Decide below
          </span>
        )}
      </div>

      {/* UTM details */}
      <div className="px-3 py-2.5 bg-background space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {(utm.utm_source || "email") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
              source: {utm.utm_source || "email"}
            </span>
          )}
          {(utm.utm_medium || "email") && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
              medium: {utm.utm_medium || "email"}
            </span>
          )}
          {slug && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border font-mono">
              campaign: {slug}
            </span>
          )}
        </div>
        {isExisting && utm.existing_utm_name && (
          <p className="text-[11px] text-muted-foreground">Reusing: <span className="font-medium">{utm.existing_utm_name}</span></p>
        )}
        {utm.rationale && (
          <p className="text-[10px] text-muted-foreground/70 italic">{utm.rationale}</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-secondary/10 border-t border-border">
        <button
          onClick={() => onChoice(isExisting ? "use_existing" : "create_new")}
          className={cn(
            "flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border font-medium transition-all flex-1 justify-center",
            (choice === "create_new" || choice === "use_existing")
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          )}
        >
          {choice === "create_new"
            ? <><Check className="w-3 h-3" /> Creating UTM</>
            : choice === "use_existing"
              ? <><Check className="w-3 h-3" /> Using UTM</>
              : <><LinkIcon className="w-3 h-3" /> {isExisting ? "Use UTM Link" : "Yes, create UTM link"}</>}
        </button>
        <button
          onClick={() => onChoice("none")}
          className={cn(
            "text-[11px] px-2.5 py-1 rounded-md border transition-all font-medium",
            choice === "none"
              ? "bg-secondary text-foreground border-border"
              : "border-dashed border-border text-muted-foreground hover:border-foreground/30"
          )}
        >
          {choice === "none" ? "Skipped" : "No thanks"}
        </button>
      </div>
    </div>
  );
}

function EDMCard({ data, onAdd, onOpenInEditor }) {
  const [saved, setSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const seg = data._suggested_segment;
  const utm = data._suggested_utm;

  const [segmentChoice, setSegmentChoice] = useState(
    seg ? (seg.action === "use_existing" ? "use_existing" : "create_new") : "none"
  );
  const [utmChoice, setUtmChoice] = useState(
    !utm ? "none"
    : utm.action === "use_existing" ? "use_existing"
    : utm.action === "pending" ? "pending"
    : "create_new"
  );

  const handleSave = async () => {
    await onAdd?.({ ...data, _segment_choice: segmentChoice, _utm_choice: utmChoice });
    setSaved(true);
  };

  const handleOpenEditor = () => {
    onOpenInEditor?.({ ...data, _segment_choice: segmentChoice, _utm_choice: utmChoice });
  };

  const triggerLabel = data.trigger_event
    ? TRIGGER_LABELS[data.trigger_event] || data.trigger_event
    : data.trigger_type === "scheduled"
      ? "Scheduled"
      : "Manual";

  return (
    <div className="my-3 border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-secondary/40 border-b border-border">
        <div className="w-6 h-6 rounded-md bg-foreground/10 flex items-center justify-center flex-shrink-0">
          <Mail className="w-3.5 h-3.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold">{data.name}</span>
          <span className="text-[10px] text-muted-foreground ml-2">AI-suggested campaign</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleOpenEditor}>
            <Pencil className="w-3 h-3" /> Open in Editor
          </Button>
          <Button
            size="sm"
            variant={saved ? "secondary" : "default"}
            className="h-7 text-xs gap-1.5"
            onClick={handleSave}
            disabled={saved}
          >
            {saved ? <><Check className="w-3 h-3" /> Saved</> : <><PlusCircle className="w-3 h-3" /> Save as Draft</>}
          </Button>
        </div>
      </div>

      {/* Rationale */}
      {data.rationale && (
        <div className="px-4 py-2.5 bg-secondary/30 border-b border-border/50">
          <p className="text-xs text-muted-foreground leading-relaxed">{data.rationale}</p>
        </div>
      )}

      {/* Campaign details */}
      <div className="px-4 py-3 space-y-3">
        {/* Subject + Preview */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Subject</p>
          <p className="text-sm font-medium">{data.subject}</p>
          {data.preview_text && (
            <p className="text-xs text-muted-foreground mt-0.5 italic">{data.preview_text}</p>
          )}
        </div>

        {/* Metadata chips */}
        <div className="flex flex-wrap gap-2">
          {data.estimated_recipients != null && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">
              <Users className="w-3 h-3 text-muted-foreground" />
              {Number(data.estimated_recipients).toLocaleString()} recipients
            </span>
          )}
          {(data.trigger_event || data.trigger_type) && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">
              <Zap className="w-3 h-3 text-muted-foreground" />
              {triggerLabel}
            </span>
          )}
          {data.suggested_send_time && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              {data.suggested_send_time}
            </span>
          )}
        </div>

        {/* Segment panel */}
        <SegmentPanel seg={seg} choice={segmentChoice} onChoice={setSegmentChoice} />

        {/* UTM panel */}
        <UTMPanel utm={utm} choice={utmChoice} onChoice={setUtmChoice} />

        {/* Email preview toggle */}
        {data.html_body && (
          <div>
            <button
              onClick={() => setPreviewOpen(v => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ChevronRight className={cn("w-3 h-3 transition-transform", previewOpen && "rotate-90")} />
              {previewOpen ? "Hide preview" : "Preview email"}
            </button>
            {previewOpen && (
              <div className="mt-2 border border-border rounded-lg overflow-hidden bg-white">
                <iframe
                  srcDoc={data.html_body}
                  title="Email preview"
                  className="w-full border-0"
                  style={{ height: 320 }}
                  sandbox="allow-same-origin"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border bg-secondary/20">
        <p className="text-[10px] text-muted-foreground">
          Segment &amp; UTM are created automatically when you save · "Open in Editor" lets you refine the email first
        </p>
      </div>
    </div>
  );
}

export default function ChatMessage({ message, onPinChart, onDownloadCSV, onAddUTMLink, onAddSegment, onAddEDM, onOpenEDMInEditor }) {
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

  // Render a single ```chart block as a chart card. Shared by assistant message
  // rendering and by user messages that carry a chart handed over from a page.
  const renderChartCard = (jsonStr, key) => {
    try {
      const chartConfig = JSON.parse(jsonStr);
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

      // Guard against empty / all-zero chart data - never render a chart on non-data.
      const hasRealData = Array.isArray(sortedData)
        && sortedData.length > 0
        && sortedData.some(d => { const v = Number(d?.[primaryKey]); return Number.isFinite(v) && v !== 0; });

      if (!hasRealData) {
        return (
          <div key={key} className="my-4 border border-dashed border-border rounded-lg px-4 py-6 text-center bg-background">
            <p className="text-xs font-medium text-muted-foreground">No data available for “{chartConfig.title || "this chart"}”</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">There aren't any matching records in your database yet, so there's nothing to chart.</p>
            <Link
              to="/integrations"
              className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-medium text-foreground border border-border rounded-md px-2.5 py-1 hover:bg-secondary/50 transition-colors"
            >
              <Plug className="w-3 h-3" /> Connect a data source
            </Link>
          </div>
        );
      }

      return (
        <div key={key} className="my-4 border border-border rounded-lg overflow-hidden bg-background">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div>
              <p className="text-xs font-semibold text-foreground">{chartConfig.title || "Chart"}</p>
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
      return <pre key={key} className="text-xs text-destructive">Invalid chart data</pre>;
    }
  };

  // Render a ```table block (a data table handed over from a page) as a table card.
  const renderTableCard = (jsonStr, key) => {
    try {
      const cfg = JSON.parse(jsonStr);
      const rows = Array.isArray(cfg.rows) ? cfg.rows : (Array.isArray(cfg.data) ? cfg.data : []);
      if (!rows.length) {
        return (
          <div key={key} className="my-4 border border-dashed border-border rounded-lg px-4 py-6 text-center bg-background">
            <p className="text-xs font-medium text-muted-foreground">No rows for “{cfg.title || "this table"}”</p>
          </div>
        );
      }
      const columns = (Array.isArray(cfg.columns) && cfg.columns.length)
        ? cfg.columns
        : Object.keys(rows[0]).map(k => ({ key: k, label: k }));
      const fmt = (v) => typeof v === "number" ? v.toLocaleString() : (v ?? "");
      return (
        <div key={key} className="my-4 border border-border rounded-lg overflow-hidden bg-background">
          <div className="px-4 pt-4 pb-2">
            <p className="text-xs font-semibold text-foreground">{cfg.title || "Table"}</p>
            {cfg.description && <p className="text-[11px] text-muted-foreground mt-0.5">{cfg.description}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-secondary/60">
                <tr>
                  {columns.map((c, ci) => (
                    <th key={ci} className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">{c.label ?? c.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0 hover:bg-secondary/30">
                    {columns.map((c, ci) => (
                      <td key={ci} className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmt(row[c.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    } catch {
      return <pre key={key} className="text-xs text-destructive">Invalid table data</pre>;
    }
  };

  // Split a user message into ordered text / chart / table segments so a chart or table
  // handed over from a page renders as a real card instead of a raw code fence.
  const splitUserContent = (content) => {
    const blockRegex = /```(chart|table)\n([\s\S]*?)```/g;
    const segments = [];
    let lastIndex = 0;
    let match;
    let i = 0;
    while ((match = blockRegex.exec(content)) !== null) {
      const before = content.slice(lastIndex, match.index);
      if (before.trim()) segments.push({ type: "text", value: before.trim(), key: `ut-${i}` });
      segments.push({ type: match[1], json: match[2], key: `ub-${i}` });
      lastIndex = match.index + match[0].length;
      i++;
    }
    const rest = content.slice(lastIndex);
    if (rest.trim()) segments.push({ type: "text", value: rest.trim(), key: "ut-end" });
    if (segments.length === 0) segments.push({ type: "text", value: content, key: "ut-only" });
    return segments;
  };

  // Extract chart blocks from content
  const renderContent = (content) => {
    if (!content) return null;
    
    const chartRegex = /```chart\n([\s\S]*?)```/g;
    const tableCardRegex = /```table\n([\s\S]*?)```/g;
    const csvRegex = /```csv\n([\s\S]*?)```/g;
    const utmRegex = /```utm_link\n([\s\S]*?)```/g;
    const segmentRegex = /```segment\n([\s\S]*?)```/g;
    const edmRegex = /```edm\n([\s\S]*?)```/g;
    const tableRegex = /(\|.+\|\n\|[-| :]+\|\n(?:\|.+\|\n?)+)/g;

    let parts = [];
    let lastIndex = 0;
    let match;

    const charts = [];
    while ((match = chartRegex.exec(content)) !== null) {
      charts.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
    }
    const tableCards = [];
    while ((match = tableCardRegex.exec(content)) !== null) {
      tableCards.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
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
    const edmBlocks = [];
    while ((match = edmRegex.exec(content)) !== null) {
      edmBlocks.push({ index: match.index, end: match.index + match[0].length, json: match[1] });
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
      ...tableCards.map(c => ({ ...c, type: "table_card" })),
      ...csvBlocks.map(c => ({ ...c, type: "csv" })),
      ...utmBlocks.map(c => ({ ...c, type: "utm_link" })),
      ...segmentBlocks.map(c => ({ ...c, type: "segment" })),
      ...edmBlocks.map(c => ({ ...c, type: "edm" })),
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
        parts.push(renderChartCard(block.json, `chart-${i}`));
      }

      if (block.type === "table_card") {
        parts.push(renderTableCard(block.json, `tablecard-${i}`));
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

      if (block.type === "edm") {
        try {
          const data = JSON.parse(block.json);
          parts.push(<EDMCard key={`edm-${i}`} data={data} onAdd={onAddEDM} onOpenInEditor={onOpenEDMInEditor} />);
        } catch {
          parts.push(<p key={`edm-err-${i}`} className="text-xs text-destructive">Invalid EDM data</p>);
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
      <div className={cn("max-w-[85%]", isUser && "flex flex-col items-end gap-1.5 w-full")}>
        {message.content && (
          isUser ? (
            splitUserContent(message.content).map((seg) =>
              seg.type === "chart" ? (
                <div key={seg.key} className="w-full">{renderChartCard(seg.json, seg.key)}</div>
              ) : seg.type === "table" ? (
                <div key={seg.key} className="w-full">{renderTableCard(seg.json, seg.key)}</div>
              ) : (
                <div key={seg.key} className="rounded-2xl px-4 py-3 bg-foreground text-background max-w-full">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{seg.value}</p>
                </div>
              )
            )
          ) : (
            <div className="rounded-2xl px-4 py-3 bg-secondary">
              {renderContent(message.content)}
            </div>
          )
        )}

        {message.tool_calls?.length > 0 && (
          <div className="space-y-1">
            {message.tool_calls.map((tc, i) => (
              <FunctionDisplay key={i} toolCall={tc} />
            ))}
          </div>
        )}

        {!isUser && message.content && (
          <div className="flex items-center gap-2 mt-1.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </Button>
            {message.token_usage?.total > 0 && (
              <span className="text-[10px] text-muted-foreground/60 font-mono select-none">
                {fmtCredits(message.token_usage.total)} credits
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}