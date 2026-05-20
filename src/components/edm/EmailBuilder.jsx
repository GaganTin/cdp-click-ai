import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronUp, ChevronDown, Trash2, Copy, Eye, Code2,
  AlignCenter, AlignLeft, AlignRight, Monitor, Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Block definitions ──────────────────────────────────────────────────────────
const BLOCK_DEFS = {
  header: {
    label: "Heading",
    defaults: { title: "Hi {{first_name}},", subtitle: "", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", align: "left", fontSize: 26, padding: 24 },
  },
  text: {
    label: "Text",
    defaults: { content: "Your message here. Keep it concise and focused on one clear action.", color: "#374151", fontSize: 15, lineHeight: 1.6, padding: 16 },
  },
  button: {
    label: "Button",
    defaults: { text: "Click here", url: "https://", bgColor: "#2563eb", color: "#ffffff", align: "center", fontSize: 14, paddingV: 12, paddingH: 28, radius: 6, padding: 16 },
  },
  image: {
    label: "Image",
    defaults: { url: "", alt: "", link: "", width: 100, radius: 0, align: "center", padding: 0 },
  },
  divider: {
    label: "Divider",
    defaults: { color: "#e5e7eb", thickness: 1, margin: 16 },
  },
  spacer: {
    label: "Spacer",
    defaults: { height: 32 },
  },
  columns: {
    label: "2 Columns",
    defaults: { leftContent: "Left column text here.", rightContent: "Right column text here.", color: "#374151", fontSize: 14, padding: 16 },
  },
};

const TOKENS = ["{{first_name}}", "{{last_name}}", "{{email}}", "{{member_type}}", "{{member_no}}"];

const TEMPLATES = [
  {
    id: "welcome", name: "Welcome", description: "Greet new members", accent: "#2563eb",
    blocks: [
      { id: "tw1", type: "header", config: { ...BLOCK_DEFS.header.defaults, title: "Welcome, {{first_name}}!", subtitle: "We're so glad you joined us.", bgColor: "#eff6ff", color: "#1d4ed8" } },
      { id: "tw2", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "Thank you for becoming a member. We're excited to have you with us. Here's what you can do next to get started..." } },
      { id: "tw3", type: "button", config: { ...BLOCK_DEFS.button.defaults, text: "Get Started →", align: "center", bgColor: "#2563eb" } },
      { id: "tw4", type: "spacer", config: { height: 24 } },
    ],
  },
  {
    id: "newsletter", name: "Newsletter", description: "Monthly digest", accent: "#7c3aed",
    blocks: [
      { id: "tn1", type: "header", config: { ...BLOCK_DEFS.header.defaults, title: "Monthly Update", subtitle: "Here's what's happening this month", bgColor: "#f5f3ff", color: "#5b21b6" } },
      { id: "tn2", type: "image", config: { ...BLOCK_DEFS.image.defaults } },
      { id: "tn3", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "Welcome to our monthly digest. This month we've got exciting updates to share with you..." } },
      { id: "tn4", type: "divider", config: { ...BLOCK_DEFS.divider.defaults } },
      { id: "tn5", type: "button", config: { ...BLOCK_DEFS.button.defaults, text: "Read the Full Story", align: "center", bgColor: "#7c3aed" } },
    ],
  },
  {
    id: "promo", name: "Promotion", description: "Special offer / sale", accent: "#dc2626",
    blocks: [
      { id: "tp1", type: "header", config: { ...BLOCK_DEFS.header.defaults, title: "Special Offer Just for You", subtitle: "Limited time — don't miss out", bgColor: "#fef2f2", color: "#991b1b", align: "center" } },
      { id: "tp2", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "As a valued member, you get exclusive access to our biggest offer. Use your member benefits today." } },
      { id: "tp3", type: "button", config: { ...BLOCK_DEFS.button.defaults, text: "Claim Your Offer", align: "center", bgColor: "#dc2626", paddingH: 36, paddingV: 14 } },
      { id: "tp4", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "Offer expires soon. Terms apply.", color: "#9ca3af", fontSize: 12 } },
    ],
  },
  {
    id: "reengagement", name: "Re-engagement", description: "Win back inactive members", accent: "#059669",
    blocks: [
      { id: "tr1", type: "header", config: { ...BLOCK_DEFS.header.defaults, title: "We miss you, {{first_name}}", subtitle: "It's been a while — here's what's new", bgColor: "#f0fdf4", color: "#065f46", align: "center" } },
      { id: "tr2", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "We noticed you haven't visited us recently. A lot has changed! Here's what's new since your last visit..." } },
      { id: "tr3", type: "button", config: { ...BLOCK_DEFS.button.defaults, text: "Come Back & Explore", align: "center", bgColor: "#059669" } },
      { id: "tr4", type: "divider", config: { ...BLOCK_DEFS.divider.defaults } },
      { id: "tr5", type: "text", config: { ...BLOCK_DEFS.text.defaults, content: "Not interested? You can unsubscribe at any time.", color: "#9ca3af", fontSize: 12 } },
    ],
  },
];

// ── HTML Export ────────────────────────────────────────────────────────────────
export function blocksToHtml(blocks, wrapEmail = true) {
  const inner = blocks.map(b => renderBlockHtml(b)).join("\n");
  if (!wrapEmail) return inner;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:sans-serif">
<div style="max-width:600px;margin:0 auto;background:#ffffff">
${inner}
</div></body></html>`;
}

function renderBlockHtml(block) {
  const c = block.config;
  switch (block.type) {
    case "header":
      return `<div style="background:${c.bgColor};padding:${c.padding}px;text-align:${c.align}">
  <h1 style="font-family:sans-serif;font-size:${c.fontSize}px;font-weight:700;color:${c.color};margin:0;line-height:1.2">${c.title}</h1>
  ${c.subtitle ? `<p style="font-family:sans-serif;font-size:15px;color:${c.subtitleColor};margin:8px 0 0;line-height:1.5">${c.subtitle}</p>` : ""}
</div>`;
    case "text":
      return `<div style="padding:${c.padding}px">
  <p style="font-family:sans-serif;font-size:${c.fontSize}px;line-height:${c.lineHeight};color:${c.color};margin:0">${c.content.replace(/\n/g, "<br>")}</p>
</div>`;
    case "button":
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  <a href="${c.url}" style="display:inline-block;background:${c.bgColor};color:${c.color};padding:${c.paddingV}px ${c.paddingH}px;text-decoration:none;border-radius:${c.radius}px;font-family:sans-serif;font-size:${c.fontSize}px;font-weight:600">${c.text}</a>
</div>`;
    case "image":
      if (!c.url) return `<div style="padding:16px;text-align:center;background:#f8fafc;color:#94a3b8;font-family:sans-serif;font-size:13px">[ Image ]</div>`;
      return `<div style="padding:${c.padding}px;text-align:${c.align}">
  ${c.link ? `<a href="${c.link}">` : ""}
  <img src="${c.url}" alt="${c.alt}" style="max-width:${c.width}%;border-radius:${c.radius}px;display:block;${c.align === "center" ? "margin:0 auto" : ""}"/>
  ${c.link ? "</a>" : ""}
</div>`;
    case "divider":
      return `<hr style="border:none;border-top:${c.thickness}px solid ${c.color};margin:${c.margin}px 24px"/>`;
    case "spacer":
      return `<div style="height:${c.height}px"></div>`;
    case "columns":
      return `<div style="padding:${c.padding}px">
  <div style="display:inline-block;width:48%;vertical-align:top;padding-right:8px">
    <p style="font-family:sans-serif;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.leftContent.replace(/\n/g, "<br>")}</p>
  </div>
  <div style="display:inline-block;width:48%;vertical-align:top;padding-left:8px">
    <p style="font-family:sans-serif;font-size:${c.fontSize}px;color:${c.color};margin:0;line-height:1.6">${c.rightContent.replace(/\n/g, "<br>")}</p>
  </div>
</div>`;
    default: return "";
  }
}

// ── Inline-editable canvas blocks ──────────────────────────────────────────────
function TokenBar({ value, onAppend }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {TOKENS.map(t => (
        <button key={t} onClick={e => { e.stopPropagation(); onAppend(t); }}
          style={{ fontSize: 10, fontFamily: "monospace", background: "rgba(255,255,255,0.9)", border: "1px solid #cbd5e1", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569" }}>
          {t}
        </button>
      ))}
    </div>
  );
}

function CanvasBlock({ block, isEditing, onUpdate }) {
  const c = block.config;
  const set = (k, v) => onUpdate({ ...block, config: { ...c, [k]: v } });

  switch (block.type) {
    case "header":
      if (isEditing) {
        return (
          <div style={{ background: c.bgColor, padding: `${c.padding}px`, textAlign: c.align }}>
            <input autoFocus value={c.title} onChange={e => set("title", e.target.value)}
              placeholder="Heading text..."
              style={{ display: "block", width: "100%", fontSize: c.fontSize, fontWeight: 700, color: c.color, border: "none", background: "transparent", outline: "2px dashed #60a5fa", outlineOffset: 2, borderRadius: 3, padding: "2px 6px", fontFamily: "sans-serif", lineHeight: 1.2, boxSizing: "border-box" }} />
            <TokenBar value={c.title} onAppend={t => set("title", c.title + t)} />
            <input value={c.subtitle || ""} onChange={e => set("subtitle", e.target.value)}
              placeholder="Subtitle (optional)"
              style={{ display: "block", width: "100%", fontSize: 15, color: c.subtitleColor, border: "none", background: "transparent", outline: "2px dashed #bfdbfe", outlineOffset: 2, borderRadius: 3, padding: "2px 6px", marginTop: 8, fontFamily: "sans-serif", boxSizing: "border-box" }} />
          </div>
        );
      }
      return (
        <div style={{ background: c.bgColor, padding: `${c.padding}px`, textAlign: c.align, cursor: "text" }}>
          <h1 style={{ fontSize: c.fontSize, fontWeight: 700, color: c.color, margin: 0, lineHeight: 1.2, fontFamily: "sans-serif" }}>{c.title || "Click to edit heading"}</h1>
          {c.subtitle && <p style={{ fontSize: 15, color: c.subtitleColor, margin: "8px 0 0", fontFamily: "sans-serif", lineHeight: 1.5 }}>{c.subtitle}</p>}
        </div>
      );

    case "text":
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px` }}>
            <textarea autoFocus value={c.content} onChange={e => set("content", e.target.value)}
              placeholder="Enter your text..."
              style={{ display: "block", width: "100%", minHeight: 80, fontSize: c.fontSize, lineHeight: c.lineHeight, color: c.color, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "sans-serif", resize: "vertical", outline: "none", background: "transparent", boxSizing: "border-box" }} />
            <TokenBar value={c.content} onAppend={t => set("content", c.content + t)} />
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, cursor: "text" }}>
          <p style={{ fontSize: c.fontSize, lineHeight: c.lineHeight, color: c.color, margin: 0, fontFamily: "sans-serif", whiteSpace: "pre-wrap" }}>{c.content || "Click to add text"}</p>
        </div>
      );

    case "button":
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px`, textAlign: c.align }}>
            <input autoFocus value={c.text} onChange={e => set("text", e.target.value)}
              placeholder="Button text"
              style={{ display: "inline-block", background: c.bgColor, color: c.color, padding: `${c.paddingV}px ${c.paddingH}px`, borderRadius: c.radius, fontSize: c.fontSize, fontWeight: 600, fontFamily: "sans-serif", border: "2px dashed rgba(255,255,255,0.6)", outline: "none", textAlign: "center" }} />
            <div style={{ marginTop: 8 }}>
              <input value={c.url} onChange={e => set("url", e.target.value)} placeholder="https://..."
                style={{ width: "100%", fontSize: 12, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontFamily: "monospace", background: "#fff", boxSizing: "border-box", outline: "none" }} />
            </div>
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, textAlign: c.align, cursor: "pointer" }}>
          <span style={{ display: "inline-block", background: c.bgColor, color: c.color, padding: `${c.paddingV}px ${c.paddingH}px`, borderRadius: c.radius, fontSize: c.fontSize, fontWeight: 600, fontFamily: "sans-serif" }}>
            {c.text || "Button"}
          </span>
        </div>
      );

    case "image":
      return !c.url ? (
        <div style={{ margin: `${c.padding}px`, border: "2px dashed #e2e8f0", borderRadius: 8, padding: "32px 16px", textAlign: "center", background: "#f8fafc", color: "#94a3b8", fontFamily: "sans-serif", fontSize: 13, cursor: "default" }}>
          🖼 Set image URL in the properties panel →
        </div>
      ) : (
        <div style={{ padding: `${c.padding}px`, textAlign: c.align }}>
          <img src={c.url} alt={c.alt} style={{ maxWidth: `${c.width}%`, borderRadius: c.radius, display: "block", margin: c.align === "center" ? "0 auto" : undefined }} />
        </div>
      );

    case "divider":
      return <hr style={{ border: "none", borderTop: `${c.thickness}px solid ${c.color}`, margin: `${c.margin}px 24px` }} />;

    case "spacer":
      return (
        <div style={{ height: c.height, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 48, height: 1, background: "#e2e8f0", borderRadius: 1 }} />
        </div>
      );

    case "columns":
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px`, display: "flex", gap: 12 }}>
            <textarea autoFocus value={c.leftContent} onChange={e => set("leftContent", e.target.value)}
              placeholder="Left column..."
              style={{ flex: 1, fontSize: c.fontSize, color: c.color, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "sans-serif", resize: "vertical", minHeight: 80, outline: "none" }} />
            <textarea value={c.rightContent} onChange={e => set("rightContent", e.target.value)}
              placeholder="Right column..."
              style={{ flex: 1, fontSize: c.fontSize, color: c.color, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "sans-serif", resize: "vertical", minHeight: 80, outline: "none" }} />
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, display: "flex", gap: 16, cursor: "text" }}>
          <p style={{ flex: 1, fontSize: c.fontSize, color: c.color, margin: 0, fontFamily: "sans-serif", lineHeight: 1.6 }}>{c.leftContent}</p>
          <p style={{ flex: 1, fontSize: c.fontSize, color: c.color, margin: 0, fontFamily: "sans-serif", lineHeight: 1.6 }}>{c.rightContent}</p>
        </div>
      );

    default: return null;
  }
}

// ── Block palette thumbnails ───────────────────────────────────────────────────
function BlockThumb({ type }) {
  const base = { width: "100%", height: 36, borderRadius: 6, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
  switch (type) {
    case "header":
      return (
        <div style={{ ...base, flexDirection: "column", gap: 3, alignItems: "flex-start", padding: "6px 8px" }}>
          <div style={{ height: 8, width: "72%", background: "#64748b", borderRadius: 3 }} />
          <div style={{ height: 4, width: "50%", background: "#cbd5e1", borderRadius: 2 }} />
        </div>
      );
    case "text":
      return (
        <div style={{ ...base, flexDirection: "column", gap: 2, alignItems: "flex-start", padding: "6px 8px" }}>
          <div style={{ height: 3, width: "100%", background: "#cbd5e1", borderRadius: 2 }} />
          <div style={{ height: 3, width: "95%", background: "#cbd5e1", borderRadius: 2 }} />
          <div style={{ height: 3, width: "70%", background: "#cbd5e1", borderRadius: 2 }} />
        </div>
      );
    case "button":
      return (
        <div style={base}>
          <div style={{ height: 14, width: 52, background: "#475569", borderRadius: 20 }} />
        </div>
      );
    case "image":
      return (
        <div style={{ ...base, background: "#e2e8f0", border: "2px dashed #cbd5e1" }}>
          <svg viewBox="0 0 20 16" width="20" height="16" fill="#94a3b8">
            <rect width="20" height="16" rx="2" fill="#e2e8f0" />
            <path d="M2 12 L6 7 L10 11 L14 6 L18 12Z" fill="#94a3b8" />
            <circle cx="6" cy="5" r="2" fill="#94a3b8" />
          </svg>
        </div>
      );
    case "divider":
      return (
        <div style={base}>
          <div style={{ flex: 1, height: 1, background: "#cbd5e1", margin: "0 8px" }} />
        </div>
      );
    case "spacer":
      return (
        <div style={{ ...base, flexDirection: "column", gap: 2 }}>
          <div style={{ width: 32, height: 1, background: "#cbd5e1" }} />
          <div style={{ width: 1, height: 8, background: "#e2e8f0" }} />
          <div style={{ width: 32, height: 1, background: "#cbd5e1" }} />
        </div>
      );
    case "columns":
      return (
        <div style={{ ...base, gap: 4, padding: "6px 8px" }}>
          {[0, 1].map(i => (
            <div key={i} style={{ flex: 1, height: 24, background: "#e2e8f0", borderRadius: 4, padding: "4px 5px", display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ height: 3, background: "#cbd5e1", borderRadius: 2 }} />
              <div style={{ height: 3, background: "#cbd5e1", borderRadius: 2, width: "75%" }} />
            </div>
          ))}
        </div>
      );
    default:
      return <div style={base} />;
  }
}

// ── Style panel helpers ────────────────────────────────────────────────────────
function ColorInput({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">{label}</Label>
      <div className="flex items-center gap-1.5 flex-1">
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          className="w-6 h-6 rounded border cursor-pointer p-0.5" style={{ borderColor: "#e2e8f0" }} />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="flex-1 h-6 px-2 text-[11px] border rounded font-mono" style={{ borderColor: "#e2e8f0" }} />
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min = 0, max = 999, unit = "px" }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">{label}</Label>
      <div className="flex items-center gap-1">
        <input type="number" value={value} min={min} max={max}
          onChange={e => onChange(Number(e.target.value))}
          className="w-14 h-6 px-2 text-xs border rounded text-center" style={{ borderColor: "#e2e8f0" }} />
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

function AlignPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">Align</Label>
      <div className="flex gap-0.5">
        {[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]].map(([v, Icon]) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn("p-1 rounded border transition-colors", value === v ? "bg-slate-800 border-slate-800 text-white" : "border-slate-200 text-slate-400 hover:bg-slate-50")}>
            <Icon className="w-3 h-3" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Style-only properties panel ────────────────────────────────────────────────
function StylePanel({ block, onChange }) {
  const c = block.config;
  const set = (k, v) => onChange({ ...block, config: { ...c, [k]: v } });
  switch (block.type) {
    case "header":
      return (
        <div className="space-y-3">
          <AlignPicker value={c.align} onChange={v => set("align", v)} />
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={12} max={48} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} />
          <ColorInput label="Title color" value={c.color} onChange={v => set("color", v)} />
          <ColorInput label="Subtitle" value={c.subtitleColor} onChange={v => set("subtitleColor", v)} />
        </div>
      );
    case "text":
      return (
        <div className="space-y-3">
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={32} />
          <NumberInput label="Line height" value={c.lineHeight} onChange={v => set("lineHeight", v)} min={1} max={3} unit="×" />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Link URL</Label>
            <Input value={c.url} onChange={e => set("url", e.target.value)} className="h-7 text-xs font-mono" placeholder="https://..." />
          </div>
          <AlignPicker value={c.align} onChange={v => set("align", v)} />
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={24} />
          <NumberInput label="Padding V" value={c.paddingV} onChange={v => set("paddingV", v)} />
          <NumberInput label="Padding H" value={c.paddingH} onChange={v => set("paddingH", v)} />
          <NumberInput label="Radius" value={c.radius} onChange={v => set("radius", v)} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Image URL</Label>
            <Input value={c.url} onChange={e => set("url", e.target.value)} className="h-7 text-xs" placeholder="https://..." />
          </div>
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Alt text</Label>
            <Input value={c.alt} onChange={e => set("alt", e.target.value)} className="h-7 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Click URL</Label>
            <Input value={c.link} onChange={e => set("link", e.target.value)} className="h-7 text-xs font-mono" />
          </div>
          <AlignPicker value={c.align} onChange={v => set("align", v)} />
          <NumberInput label="Width" value={c.width} onChange={v => set("width", v)} min={20} max={100} unit="%" />
          <NumberInput label="Radius" value={c.radius} onChange={v => set("radius", v)} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
        </div>
      );
    case "divider":
      return (
        <div className="space-y-3">
          <ColorInput label="Color" value={c.color} onChange={v => set("color", v)} />
          <NumberInput label="Thickness" value={c.thickness} onChange={v => set("thickness", v)} min={1} max={8} />
          <NumberInput label="Margin" value={c.margin} onChange={v => set("margin", v)} />
        </div>
      );
    case "spacer":
      return <NumberInput label="Height" value={c.height} onChange={v => set("height", v)} min={4} max={120} />;
    case "columns":
      return (
        <div className="space-y-3">
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={24} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
        </div>
      );
    default: return null;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────
export function parseHtmlToBlocks() { return null; }

// ── Main EmailBuilder ──────────────────────────────────────────────────────────
const EDITABLE_TYPES = new Set(["header", "text", "button", "columns"]);
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export default function EmailBuilder({ blocks, onChange, htmlMode, onHtmlModeChange, rawHtml, onRawHtmlChange }) {
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState("desktop");

  const selected = blocks.find(b => b.id === selectedId);

  const addBlock = (type) => {
    const b = { id: `${type}_${uid()}`, type, config: { ...BLOCK_DEFS[type].defaults } };
    onChange([...blocks, b]);
    setSelectedId(b.id);
    if (EDITABLE_TYPES.has(type)) setEditingId(b.id);
  };

  const updateBlock = (updated) => onChange(blocks.map(b => b.id === updated.id ? updated : b));

  const removeBlock = (id) => {
    onChange(blocks.filter(b => b.id !== id));
    if (selectedId === id) { setSelectedId(null); setEditingId(null); }
  };

  const moveBlock = (id, dir) => {
    const idx = blocks.findIndex(b => b.id === id);
    const next = idx + dir;
    if (next < 0 || next >= blocks.length) return;
    const arr = [...blocks];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    onChange(arr);
  };

  const duplicateBlock = (id) => {
    const idx = blocks.findIndex(b => b.id === id);
    if (idx === -1) return;
    const orig = blocks[idx];
    const copy = { ...orig, id: `${orig.type}_${uid()}`, config: { ...orig.config } };
    const arr = [...blocks];
    arr.splice(idx + 1, 0, copy);
    onChange(arr);
    setSelectedId(copy.id);
    setEditingId(null);
  };

  const applyTemplate = (tpl) => {
    onChange(tpl.blocks.map(b => ({ ...b, id: `${b.type}_${uid()}`, config: { ...b.config } })));
    setSelectedId(null);
    setEditingId(null);
  };

  const handleBlockClick = (block) => {
    setSelectedId(block.id);
    if (EDITABLE_TYPES.has(block.type)) setEditingId(block.id);
    else setEditingId(null);
  };

  return (
    <div style={{ display: "flex", height: "100%", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#fff" }}>

      {/* ── Left panel: block palette ── */}
      <div style={{ width: 196, flexShrink: 0, borderRight: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #e2e8f0" }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>Content Blocks</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {Object.entries(BLOCK_DEFS).map(([type, def]) => (
              <button key={type} onClick={() => addBlock(type)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 6px 7px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#93c5fd"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(59,130,246,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.boxShadow = "none"; }}>
                <BlockThumb type={type} />
                <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b" }}>{def.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Center: canvas ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0 }}>
          <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            {[
              { label: "Builder", icon: <Eye style={{ width: 12, height: 12 }} />, active: !htmlMode, onClick: () => onHtmlModeChange(false) },
              { label: "HTML", icon: <Code2 style={{ width: 12, height: 12 }} />, active: htmlMode, onClick: () => onHtmlModeChange(true) },
            ].map(btn => (
              <button key={btn.label} onClick={btn.onClick}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: btn.active ? "#1e293b" : "#fff", color: btn.active ? "#fff" : "#64748b", transition: "all 0.15s" }}>
                {btn.icon}{btn.label}
              </button>
            ))}
          </div>
          {!htmlMode && (
            <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden", marginLeft: "auto" }}>
              {[
                { label: "Desktop", icon: <Monitor style={{ width: 13, height: 13 }} />, val: "desktop" },
                { label: "Mobile", icon: <Smartphone style={{ width: 13, height: 13 }} />, val: "mobile" },
              ].map(btn => (
                <button key={btn.val} onClick={() => setPreview(btn.val)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: preview === btn.val ? "#1e293b" : "#fff", color: preview === btn.val ? "#fff" : "#64748b", transition: "all 0.15s" }}>
                  {btn.icon}{btn.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, overflowY: "auto", background: "#f1f5f9", display: "flex", justifyContent: "center", padding: "24px 16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}>
          {htmlMode ? (
            <Textarea value={rawHtml} onChange={e => onRawHtmlChange(e.target.value)}
              style={{ width: "100%", maxWidth: 600, fontFamily: "monospace", fontSize: 12, background: "#fff", resize: "none", height: "100%" }}
              placeholder="Paste or write raw HTML..." />
          ) : (
            <div style={{ width: preview === "mobile" ? 375 : 600, maxWidth: "100%", minHeight: 400, background: "#fff", borderRadius: 4, boxShadow: "0 4px 24px rgba(0,0,0,0.10)", position: "relative" }}
              onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}>

              {blocks.length === 0 ? (
                /* Template gallery */
                <div style={{ padding: 32 }}>
                  <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", margin: "0 0 4px" }}>Start with a template</p>
                    <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Or add blocks from the left panel</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {TEMPLATES.map(tpl => (
                      <button key={tpl.id} onClick={() => applyTemplate(tpl)}
                        style={{ textAlign: "left", borderRadius: 10, border: "2px solid #e2e8f0", background: "#f8fafc", padding: "14px", cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "#93c5fd"; e.currentTarget.style.background = "#eff6ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#f8fafc"; }}>
                        <div style={{ height: 4, width: 28, borderRadius: 4, background: tpl.accent, marginBottom: 10 }} />
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", margin: "0 0 3px" }}>{tpl.name}</p>
                        <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>{tpl.description}</p>
                      </button>
                    ))}
                  </div>
                  <p style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", marginTop: 20 }}>or drag blocks from the left panel</p>
                </div>
              ) : (
                blocks.map((block, i) => {
                  const isSelected = selectedId === block.id;
                  const isEditing = editingId === block.id;
                  return (
                    <div key={block.id}
                      className="group"
                      style={{ position: "relative", outline: isSelected ? "2px solid #3b82f6" : undefined, outlineOffset: -2, transition: "outline 0.1s" }}
                      onClick={() => handleBlockClick(block)}>

                      {/* Floating toolbar */}
                      <div className={cn("absolute z-20 flex items-center rounded-md border bg-white shadow-lg transition-all duration-150",
                        "opacity-0 group-hover:opacity-100", isSelected && "opacity-100")}
                        style={{ top: 6, right: 6, borderColor: "#e2e8f0", gap: 0 }}
                        onClick={e => e.stopPropagation()}>
                        <span style={{ fontSize: 9, color: "#94a3b8", padding: "3px 7px", borderRight: "1px solid #f1f5f9", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {BLOCK_DEFS[block.type]?.label}
                        </span>
                        <button title="Move up" disabled={i === 0} onClick={() => moveBlock(block.id, -1)}
                          style={{ padding: "4px 5px", border: "none", background: "transparent", cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.3 : 1, display: "flex", alignItems: "center" }}>
                          <ChevronUp style={{ width: 12, height: 12, color: "#64748b" }} />
                        </button>
                        <button title="Move down" disabled={i === blocks.length - 1} onClick={() => moveBlock(block.id, 1)}
                          style={{ padding: "4px 5px", border: "none", background: "transparent", cursor: i === blocks.length - 1 ? "not-allowed" : "pointer", opacity: i === blocks.length - 1 ? 0.3 : 1, display: "flex", alignItems: "center" }}>
                          <ChevronDown style={{ width: 12, height: 12, color: "#64748b" }} />
                        </button>
                        <button title="Duplicate" onClick={() => duplicateBlock(block.id)}
                          style={{ padding: "4px 5px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center" }}>
                          <Copy style={{ width: 12, height: 12, color: "#64748b" }} />
                        </button>
                        <button title="Delete" onClick={() => removeBlock(block.id)}
                          style={{ padding: "4px 5px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", borderLeft: "1px solid #f1f5f9" }}>
                          <Trash2 style={{ width: 12, height: 12, color: "#ef4444" }} />
                        </button>
                      </div>

                      <CanvasBlock block={block} isEditing={isEditing} onUpdate={updateBlock} />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: style properties ── */}
      <div style={{ width: 220, flexShrink: 0, borderLeft: "1px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column" }}>
        {selected && !htmlMode ? (
          <>
            <div style={{ padding: "12px 12px 10px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", margin: 0 }}>{BLOCK_DEFS[selected.type]?.label} Style</p>
              <button onClick={() => { setSelectedId(null); setEditingId(null); }}
                style={{ fontSize: 14, color: "#94a3b8", border: "none", background: "transparent", cursor: "pointer", lineHeight: 1, padding: 2 }}>✕</button>
            </div>
            {EDITABLE_TYPES.has(selected.type) && (
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                <p style={{ fontSize: 10, color: "#94a3b8", margin: 0 }}>Click the block to edit content directly on the canvas</p>
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              <StylePanel block={selected} onChange={updateBlock} />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16, gap: 8 }}>
            {htmlMode ? (
              <p style={{ fontSize: 12, color: "#94a3b8" }}>Switch to Builder mode to edit block styles</p>
            ) : blocks.length === 0 ? (
              <>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✨</div>
                <p style={{ fontSize: 12, fontWeight: 500, color: "#64748b", margin: 0 }}>Pick a template or add blocks</p>
                <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Click any block to edit its style</p>
              </>
            ) : (
              <>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👆</div>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Click a block to edit its style</p>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
