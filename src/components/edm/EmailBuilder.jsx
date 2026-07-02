import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/ui/image-upload-field";
import {
  ChevronUp, ChevronDown, Trash2, Copy, Eye, Code2,
  AlignCenter, AlignLeft, AlignRight, Monitor, Smartphone,
  GripVertical, SlidersHorizontal, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_EMAIL_CONTAINER } from "./emailHtml";

// ── Block definitions ──────────────────────────────────────────────────────────
const BLOCK_DEFS = {
  header: {
    label: "Heading",
    defaults: { title: "Hi {{first_name}},", subtitle: "", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", subtitleSize: 15, align: "left", fontSize: 26, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0, padding: 24 },
  },
  text: {
    label: "Text",
    defaults: { content: "Your message here. Keep it concise and focused on one clear action.", color: "#374151", bgColor: "transparent", fontSize: 15, fontWeight: 400, lineHeight: 1.6, align: "left", padding: 16 },
  },
  button: {
    label: "Button",
    defaults: { text: "Click here", url: "https://", bgColor: "#2563eb", color: "#ffffff", align: "center", fontSize: 14, fontWeight: 600, paddingV: 12, paddingH: 28, radius: 6, fullWidth: false, borderWidth: 0, borderColor: "#2563eb", padding: 16 },
  },
  image: {
    label: "Image",
    defaults: { url: "", alt: "", link: "", width: 100, radius: 0, align: "center", shadow: false, borderWidth: 0, borderColor: "#e5e7eb", padding: 0 },
  },
  divider: {
    label: "Divider",
    defaults: { color: "#e5e7eb", thickness: 1, style: "solid", widthPct: 100, margin: 16 },
  },
  spacer: {
    label: "Spacer",
    defaults: { height: 32 },
  },
  columns: {
    label: "2 Columns",
    defaults: { leftContent: "Left column text here.", rightContent: "Right column text here.", color: "#374151", bgColor: "transparent", fontSize: 14, ratio: "50-50", gap: 16, valign: "top", padding: 16 },
  },
};

const COLUMN_FLEX = {
  "50-50": [50, 50], "60-40": [60, 40], "40-60": [40, 60], "70-30": [70, 30], "30-70": [30, 70],
};

const FONT_OPTIONS = [
  { value: "sans-serif", label: "Sans-serif" },
  { value: "serif", label: "Serif" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet MS" },
  { value: "'Courier New', monospace", label: "Courier New" },
];

const TOKENS = ["{{first_name}}", "{{last_name}}", "{{email}}", "{{member_type}}", "{{member_no}}"];

// ── HTML Export ────────────────────────────────────────────────────────────────
// The block→HTML generator lives in a framework-free module so it can be unit
// tested and reused outside React. Re-exported here for existing call sites.
export { blocksToHtml, renderBlockHtml, DEFAULT_EMAIL_CONTAINER } from "./emailHtml";

// ── Inline-editable canvas blocks ──────────────────────────────────────────────
function TokenBar({ onAppend }) {
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
              style={{ display: "block", width: "100%", fontSize: c.fontSize, fontWeight: c.fontWeight ?? 700, color: c.color, letterSpacing: c.letterSpacing, border: "none", background: "transparent", outline: "2px dashed #60a5fa", outlineOffset: 2, borderRadius: 3, padding: "2px 6px", fontFamily: "inherit", lineHeight: c.lineHeight ?? 1.2, boxSizing: "border-box" }} />
            <TokenBar onAppend={t => set("title", c.title + t)} />
            <input value={c.subtitle || ""} onChange={e => set("subtitle", e.target.value)}
              placeholder="Subtitle (optional)"
              style={{ display: "block", width: "100%", fontSize: c.subtitleSize ?? 15, color: c.subtitleColor, border: "none", background: "transparent", outline: "2px dashed #bfdbfe", outlineOffset: 2, borderRadius: 3, padding: "2px 6px", marginTop: 8, fontFamily: "inherit", boxSizing: "border-box" }} />
          </div>
        );
      }
      return (
        <div style={{ background: c.bgColor, padding: `${c.padding}px`, textAlign: c.align, cursor: "text" }}>
          <h1 style={{ fontSize: c.fontSize, fontWeight: c.fontWeight ?? 700, color: c.color, margin: 0, lineHeight: c.lineHeight ?? 1.2, letterSpacing: c.letterSpacing, fontFamily: "inherit" }}>{c.title || "Click to edit heading"}</h1>
          {c.subtitle && <p style={{ fontSize: c.subtitleSize ?? 15, color: c.subtitleColor, margin: "8px 0 0", fontFamily: "inherit", lineHeight: 1.5 }}>{c.subtitle}</p>}
        </div>
      );

    case "text":
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px`, background: c.bgColor === "transparent" ? undefined : c.bgColor }}>
            <textarea autoFocus value={c.content} onChange={e => set("content", e.target.value)}
              placeholder="Enter your text..."
              style={{ display: "block", width: "100%", minHeight: 80, fontSize: c.fontSize, fontWeight: c.fontWeight ?? 400, lineHeight: c.lineHeight, color: c.color, textAlign: c.align, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", outline: "none", background: "transparent", boxSizing: "border-box" }} />
            <TokenBar onAppend={t => set("content", c.content + t)} />
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, cursor: "text", background: c.bgColor === "transparent" ? undefined : c.bgColor }}>
          <p style={{ fontSize: c.fontSize, fontWeight: c.fontWeight ?? 400, lineHeight: c.lineHeight, color: c.color, textAlign: c.align || "left", margin: 0, fontFamily: "inherit", whiteSpace: "pre-wrap" }}>{c.content || "Click to add text"}</p>
        </div>
      );

    case "button":
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px`, textAlign: c.align }}>
            <input autoFocus value={c.text} onChange={e => set("text", e.target.value)}
              placeholder="Button text"
              style={{ display: c.fullWidth ? "block" : "inline-block", width: c.fullWidth ? "100%" : undefined, background: c.bgColor, color: c.color, padding: `${c.paddingV}px ${c.paddingH}px`, borderRadius: c.radius, fontSize: c.fontSize, fontWeight: c.fontWeight ?? 600, fontFamily: "inherit", border: "2px dashed rgba(255,255,255,0.6)", outline: "none", textAlign: "center", boxSizing: "border-box" }} />
            <div style={{ marginTop: 8 }}>
              <input value={c.url} onChange={e => set("url", e.target.value)} placeholder="https://..."
                style={{ width: "100%", fontSize: 12, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontFamily: "monospace", background: "#fff", boxSizing: "border-box", outline: "none" }} />
            </div>
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, textAlign: c.align, cursor: "pointer" }}>
          <span style={{ display: c.fullWidth ? "block" : "inline-block", background: c.bgColor, color: c.color, padding: `${c.paddingV}px ${c.paddingH}px`, borderRadius: c.radius, fontSize: c.fontSize, fontWeight: c.fontWeight ?? 600, fontFamily: "inherit", border: c.borderWidth ? `${c.borderWidth}px solid ${c.borderColor || c.bgColor}` : undefined, textAlign: "center", boxSizing: "border-box" }}>
            {c.text || "Button"}
          </span>
        </div>
      );

    case "image":
      return !c.url ? (
        <div style={{ margin: `${c.padding}px`, border: "2px dashed #e2e8f0", borderRadius: 8, padding: "32px 16px", textAlign: "center", background: "#f8fafc", color: "#94a3b8", fontFamily: "sans-serif", fontSize: 13, cursor: "default" }}>
          🖼 Upload an image or paste a URL in the panel →
        </div>
      ) : (
        <div style={{ padding: `${c.padding}px`, textAlign: c.align }}>
          <img src={c.url} alt={c.alt} style={{ maxWidth: `${c.width}%`, borderRadius: c.radius, display: "block", boxShadow: c.shadow ? "0 4px 16px rgba(0,0,0,0.15)" : undefined, border: c.borderWidth ? `${c.borderWidth}px solid ${c.borderColor || "#e5e7eb"}` : undefined, margin: c.align === "center" ? "0 auto" : c.align === "right" ? "0 0 0 auto" : undefined }} />
        </div>
      );

    case "divider":
      return (
        <div style={{ padding: "0 24px" }}>
          <hr style={{ border: "none", borderTop: `${c.thickness}px ${c.style || "solid"} ${c.color}`, margin: `${c.margin}px ${c.widthPct < 100 ? "auto" : "0"}`, width: `${c.widthPct ?? 100}%` }} />
        </div>
      );

    case "spacer":
      return (
        <div style={{ height: c.height, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 48, height: 1, background: "#e2e8f0", borderRadius: 1 }} />
        </div>
      );

    case "columns": {
      const [lf, rf] = COLUMN_FLEX[c.ratio] || COLUMN_FLEX["50-50"];
      const bg = c.bgColor === "transparent" ? undefined : c.bgColor;
      if (isEditing) {
        return (
          <div style={{ padding: `${c.padding}px`, display: "flex", gap: c.gap ?? 12, alignItems: c.valign === "middle" ? "center" : c.valign === "bottom" ? "flex-end" : "flex-start", background: bg }}>
            <textarea autoFocus value={c.leftContent} onChange={e => set("leftContent", e.target.value)}
              placeholder="Left column..."
              style={{ flex: lf, fontSize: c.fontSize, color: c.color, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", minHeight: 80, outline: "none" }} />
            <textarea value={c.rightContent} onChange={e => set("rightContent", e.target.value)}
              placeholder="Right column..."
              style={{ flex: rf, fontSize: c.fontSize, color: c.color, border: "2px dashed #60a5fa", borderRadius: 4, padding: "6px 8px", fontFamily: "inherit", resize: "vertical", minHeight: 80, outline: "none" }} />
          </div>
        );
      }
      return (
        <div style={{ padding: `${c.padding}px`, display: "flex", gap: c.gap ?? 16, alignItems: c.valign === "middle" ? "center" : c.valign === "bottom" ? "flex-end" : "flex-start", cursor: "text", background: bg }}>
          <p style={{ flex: lf, fontSize: c.fontSize, color: c.color, margin: 0, fontFamily: "inherit", lineHeight: 1.6 }}>{c.leftContent}</p>
          <p style={{ flex: rf, fontSize: c.fontSize, color: c.color, margin: 0, fontFamily: "inherit", lineHeight: 1.6 }}>{c.rightContent}</p>
        </div>
      );
    }

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
function ColorInput({ label, value, onChange, allowTransparent }) {
  const isTransparent = value === "transparent" || !value;
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">{label}</Label>
      <div className="flex items-center gap-1.5 flex-1">
        <input type="color" value={isTransparent ? "#ffffff" : value} onChange={e => onChange(e.target.value)}
          className="w-6 h-6 rounded border cursor-pointer p-0.5" style={{ borderColor: "#e2e8f0" }} />
        <input type="text" value={value || ""} onChange={e => onChange(e.target.value)}
          className="flex-1 h-6 px-2 text-[11px] border rounded font-mono min-w-0" style={{ borderColor: "#e2e8f0" }} />
        {allowTransparent && (
          <button type="button" onClick={() => onChange("transparent")} title="Clear / transparent"
            className="text-[10px] text-slate-400 hover:text-slate-600 flex-shrink-0">none</button>
        )}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min = 0, max = 999, step = 1, unit = "px" }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">{label}</Label>
      <div className="flex items-center gap-1">
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(Number(e.target.value))}
          className="w-14 h-6 px-2 text-xs border rounded text-center" style={{ borderColor: "#e2e8f0" }} />
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

function SelectInput({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px] w-20 flex-shrink-0 text-slate-500">{label}</Label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="flex-1 h-6 px-1 text-[11px] border rounded bg-white min-w-0" style={{ borderColor: "#e2e8f0" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ToggleInput({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-[11px] text-slate-500">{label}</span>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
        className="rounded border-slate-300 cursor-pointer" />
    </label>
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
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={12} max={64} />
          <SelectInput label="Weight" value={String(c.fontWeight ?? 700)} onChange={v => set("fontWeight", Number(v))}
            options={[{ value: "400", label: "Regular" }, { value: "600", label: "Semi-bold" }, { value: "700", label: "Bold" }, { value: "800", label: "Extra-bold" }]} />
          <NumberInput label="Line height" value={c.lineHeight ?? 1.2} onChange={v => set("lineHeight", v)} min={1} max={3} step={0.1} unit="×" />
          <NumberInput label="Letter sp." value={c.letterSpacing ?? 0} onChange={v => set("letterSpacing", v)} min={-2} max={10} />
          <NumberInput label="Subtitle sz" value={c.subtitleSize ?? 15} onChange={v => set("subtitleSize", v)} min={10} max={28} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} />
          <ColorInput label="Title color" value={c.color} onChange={v => set("color", v)} />
          <ColorInput label="Subtitle" value={c.subtitleColor} onChange={v => set("subtitleColor", v)} />
        </div>
      );
    case "text":
      return (
        <div className="space-y-3">
          <AlignPicker value={c.align || "left"} onChange={v => set("align", v)} />
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={32} />
          <SelectInput label="Weight" value={String(c.fontWeight ?? 400)} onChange={v => set("fontWeight", Number(v))}
            options={[{ value: "300", label: "Light" }, { value: "400", label: "Regular" }, { value: "600", label: "Semi-bold" }, { value: "700", label: "Bold" }]} />
          <NumberInput label="Line height" value={c.lineHeight} onChange={v => set("lineHeight", v)} min={1} max={3} step={0.1} unit="×" />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} allowTransparent />
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
          <ToggleInput label="Full width" value={c.fullWidth} onChange={v => set("fullWidth", v)} />
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={24} />
          <SelectInput label="Weight" value={String(c.fontWeight ?? 600)} onChange={v => set("fontWeight", Number(v))}
            options={[{ value: "400", label: "Regular" }, { value: "600", label: "Semi-bold" }, { value: "700", label: "Bold" }]} />
          <NumberInput label="Padding V" value={c.paddingV} onChange={v => set("paddingV", v)} />
          <NumberInput label="Padding H" value={c.paddingH} onChange={v => set("paddingH", v)} />
          <NumberInput label="Radius" value={c.radius} onChange={v => set("radius", v)} />
          <NumberInput label="Border" value={c.borderWidth ?? 0} onChange={v => set("borderWidth", v)} min={0} max={8} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
          {c.borderWidth > 0 && <ColorInput label="Border col." value={c.borderColor} onChange={v => set("borderColor", v)} />}
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <ImageUploadField label="Image" value={c.url} onChange={v => set("url", v)} />
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Alt text</Label>
            <Input value={c.alt} onChange={e => set("alt", e.target.value)} className="h-7 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] mb-1 block text-slate-500">Click URL</Label>
            <Input value={c.link} onChange={e => set("link", e.target.value)} className="h-7 text-xs font-mono" placeholder="https://..." />
          </div>
          <AlignPicker value={c.align} onChange={v => set("align", v)} />
          <NumberInput label="Width" value={c.width} onChange={v => set("width", v)} min={10} max={100} unit="%" />
          <NumberInput label="Radius" value={c.radius} onChange={v => set("radius", v)} />
          <NumberInput label="Border" value={c.borderWidth ?? 0} onChange={v => set("borderWidth", v)} min={0} max={8} />
          {c.borderWidth > 0 && <ColorInput label="Border col." value={c.borderColor} onChange={v => set("borderColor", v)} />}
          <ToggleInput label="Drop shadow" value={c.shadow} onChange={v => set("shadow", v)} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
        </div>
      );
    case "divider":
      return (
        <div className="space-y-3">
          <ColorInput label="Color" value={c.color} onChange={v => set("color", v)} />
          <NumberInput label="Thickness" value={c.thickness} onChange={v => set("thickness", v)} min={1} max={12} />
          <SelectInput label="Style" value={c.style || "solid"} onChange={v => set("style", v)}
            options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} />
          <NumberInput label="Width" value={c.widthPct ?? 100} onChange={v => set("widthPct", v)} min={10} max={100} unit="%" />
          <NumberInput label="Margin" value={c.margin} onChange={v => set("margin", v)} />
        </div>
      );
    case "spacer":
      return <NumberInput label="Height" value={c.height} onChange={v => set("height", v)} min={4} max={200} />;
    case "columns":
      return (
        <div className="space-y-3">
          <SelectInput label="Ratio" value={c.ratio || "50-50"} onChange={v => set("ratio", v)}
            options={[{ value: "50-50", label: "50 / 50" }, { value: "60-40", label: "60 / 40" }, { value: "40-60", label: "40 / 60" }, { value: "70-30", label: "70 / 30" }, { value: "30-70", label: "30 / 70" }]} />
          <SelectInput label="V-align" value={c.valign || "top"} onChange={v => set("valign", v)}
            options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
          <NumberInput label="Gap" value={c.gap ?? 16} onChange={v => set("gap", v)} min={0} max={48} />
          <NumberInput label="Font size" value={c.fontSize} onChange={v => set("fontSize", v)} min={11} max={24} />
          <NumberInput label="Padding" value={c.padding} onChange={v => set("padding", v)} />
          <ColorInput label="Text color" value={c.color} onChange={v => set("color", v)} />
          <ColorInput label="Background" value={c.bgColor} onChange={v => set("bgColor", v)} allowTransparent />
        </div>
      );
    default: return null;
  }
}

// ── Global container / design panel ────────────────────────────────────────────
function ContainerPanel({ container, onChange }) {
  const ct = { ...DEFAULT_EMAIL_CONTAINER, ...container };
  const set = (k, v) => onChange({ ...ct, [k]: v });
  return (
    <div className="space-y-3">
      <NumberInput label="Width" value={ct.contentWidth} onChange={v => set("contentWidth", v)} min={320} max={800} />
      <SelectInput label="Font" value={ct.fontFamily} onChange={v => set("fontFamily", v)} options={FONT_OPTIONS} />
      <ColorInput label="Body bg" value={ct.contentBg} onChange={v => set("contentBg", v)} />
      <ColorInput label="Page bg" value={ct.bgColor} onChange={v => set("bgColor", v)} />
      <NumberInput label="Pad Y" value={ct.paddingY} onChange={v => set("paddingY", v)} min={0} max={80} />
      <NumberInput label="Pad X" value={ct.paddingX} onChange={v => set("paddingX", v)} min={0} max={80} />
      <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
        These apply to the whole email. Drag the handle on the canvas edge to resize the width visually.
      </p>
    </div>
  );
}

// ── Exports ────────────────────────────────────────────────────────────────────
export function parseHtmlToBlocks() { return null; }

// ── Main EmailBuilder ──────────────────────────────────────────────────────────
const EDITABLE_TYPES = new Set(["header", "text", "button", "columns"]);
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export default function EmailBuilder({
  blocks, onChange, htmlMode, onHtmlModeChange, rawHtml, onRawHtmlChange, onOpenTemplatePicker,
  container, onContainerChange,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [preview, setPreview] = useState("desktop");
  const [rightTab, setRightTab] = useState("block"); // "block" | "design"
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  // Container is optional — parents that haven't adopted it fall back to defaults
  // and container edits become no-ops (blocks still render at the 600px default).
  const ct = { ...DEFAULT_EMAIL_CONTAINER, ...(container || {}) };
  const setContainer = (next) => onContainerChange?.(next);

  const canvasRef = useRef(null);
  const resizeState = useRef(null);

  const selected = blocks.find(b => b.id === selectedId);

  const addBlock = (type) => {
    const b = { id: `${type}_${uid()}`, type, config: { ...BLOCK_DEFS[type].defaults } };
    onChange([...blocks, b]);
    setSelectedId(b.id);
    setRightTab("block");
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

  // ── Drag-and-drop reordering ──────────────────────────────────────────────────
  const handleDrop = () => {
    if (dragId && overId && dragId !== overId) {
      const from = blocks.findIndex(b => b.id === dragId);
      const to = blocks.findIndex(b => b.id === overId);
      if (from > -1 && to > -1) {
        const arr = [...blocks];
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        onChange(arr);
      }
    }
    setDragId(null);
    setOverId(null);
  };

  const handleBlockClick = (block) => {
    setSelectedId(block.id);
    setRightTab("block");
    if (EDITABLE_TYPES.has(block.type)) setEditingId(block.id);
    else setEditingId(null);
  };

  // ── Container width drag ──────────────────────────────────────────────────────
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startWidth: ct.contentWidth };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
  };
  const onResizeMove = (e) => {
    if (!resizeState.current) return;
    // Body is centred, so a drag on the right edge grows both sides → ×2.
    const delta = (e.clientX - resizeState.current.startX) * 2;
    const next = Math.max(320, Math.min(800, Math.round(resizeState.current.startWidth + delta)));
    setContainer({ ...ct, contentWidth: next });
  };
  const stopResize = () => {
    resizeState.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
  };

  const bodyWidth = preview === "mobile" ? 375 : ct.contentWidth;
  const canResize = preview !== "mobile" && !!onContainerChange;

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
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{bodyWidth}px</span>
                <div style={{ display: "flex", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
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
              </div>
            </>
          )}
        </div>

        {/* Canvas area */}
        <div ref={canvasRef} style={{ flex: 1, overflowY: "auto", background: htmlMode ? "#f1f5f9" : ct.bgColor, display: "flex", justifyContent: "center", padding: "24px 16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}>
          {htmlMode ? (
            <Textarea value={rawHtml} onChange={e => onRawHtmlChange(e.target.value)}
              style={{ width: "100%", maxWidth: 600, fontFamily: "monospace", fontSize: 12, background: "#fff", resize: "none", height: "100%" }}
              placeholder="Paste or write raw HTML..." />
          ) : (
            <div style={{ position: "relative", width: bodyWidth, maxWidth: "100%", flexShrink: 0 }}>
              <div style={{ width: "100%", minHeight: 400, background: ct.contentBg, borderRadius: 4, boxShadow: "0 4px 24px rgba(0,0,0,0.10)", position: "relative", fontFamily: ct.fontFamily, padding: (ct.paddingY || ct.paddingX) ? `${ct.paddingY}px ${ct.paddingX}px` : 0 }}
                onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setEditingId(null); } }}>

                {blocks.length === 0 ? (
                  /* Empty canvas - prompt to load a saved template or add blocks */
                  <div style={{ padding: 48, textAlign: "center" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", margin: "0 0 6px" }}>Empty canvas</p>
                    <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 20px" }}>Load a saved template or add blocks from the left panel.</p>
                    {onOpenTemplatePicker && (
                      <button
                        onClick={onOpenTemplatePicker}
                        style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "#1e293b", border: "none", borderRadius: 8, padding: "9px 22px", cursor: "pointer" }}
                      >
                        Load Template
                      </button>
                    )}
                  </div>
                ) : (
                  blocks.map((block, i) => {
                    const isSelected = selectedId === block.id;
                    const isEditing = editingId === block.id;
                    const isDragging = dragId === block.id;
                    const isOver = overId === block.id && dragId && dragId !== block.id;
                    return (
                      <div key={block.id}
                        className="group"
                        draggable={!isEditing}
                        onDragStart={() => { setDragId(block.id); setEditingId(null); }}
                        onDragEnter={() => setOverId(block.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={handleDrop}
                        onDragEnd={handleDrop}
                        style={{
                          position: "relative",
                          outline: isSelected ? "2px solid #3b82f6" : undefined,
                          outlineOffset: -2,
                          transition: "outline 0.1s",
                          opacity: isDragging ? 0.4 : 1,
                          boxShadow: isOver ? "inset 0 3px 0 #3b82f6" : undefined,
                        }}
                        onClick={() => handleBlockClick(block)}>

                        {/* Floating toolbar */}
                        <div className={cn("absolute z-20 flex items-center rounded-md border bg-white shadow-lg transition-all duration-150",
                          "opacity-0 group-hover:opacity-100", isSelected && "opacity-100")}
                          style={{ top: 6, right: 6, borderColor: "#e2e8f0", gap: 0 }}
                          onClick={e => e.stopPropagation()}>
                          <span title="Drag to reorder" style={{ padding: "4px 4px", display: "flex", alignItems: "center", cursor: "grab", borderRight: "1px solid #f1f5f9" }}>
                            <GripVertical style={{ width: 12, height: 12, color: "#94a3b8" }} />
                          </span>
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

              {/* Width-resize handle (desktop only) */}
              {canResize && blocks.length > 0 && (
                <div
                  onPointerDown={startResize}
                  title="Drag to resize email width"
                  style={{ position: "absolute", top: 0, bottom: 0, right: -8, width: 16, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <div style={{ width: 4, height: 44, borderRadius: 4, background: "#cbd5e1" }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: style properties ── */}
      <div style={{ width: 224, flexShrink: 0, borderLeft: "1px solid #e2e8f0", background: "#fff", display: "flex", flexDirection: "column" }}>
        {htmlMode ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 16 }}>
            <p style={{ fontSize: 12, color: "#94a3b8" }}>Switch to Builder mode to edit styles</p>
          </div>
        ) : (
          <>
            {/* Tab switcher: Block / Design */}
            <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <button onClick={() => setRightTab("block")}
                style={{ flex: 1, padding: "9px 0", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "none", background: "transparent", cursor: "pointer", color: rightTab === "block" ? "#1e293b" : "#94a3b8", borderBottom: rightTab === "block" ? "2px solid #1e293b" : "2px solid transparent" }}>
                <SlidersHorizontal style={{ width: 12, height: 12 }} /> Block
              </button>
              <button onClick={() => setRightTab("design")}
                style={{ flex: 1, padding: "9px 0", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, border: "none", background: "transparent", cursor: "pointer", color: rightTab === "design" ? "#1e293b" : "#94a3b8", borderBottom: rightTab === "design" ? "2px solid #1e293b" : "2px solid transparent" }}>
                <Layers style={{ width: 12, height: 12 }} /> Design
              </button>
            </div>

            {rightTab === "design" ? (
              <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Email Design</p>
                {onContainerChange ? (
                  <ContainerPanel container={ct} onChange={setContainer} />
                ) : (
                  <p style={{ fontSize: 11, color: "#94a3b8" }}>Global design settings aren't available in this editor.</p>
                )}
              </div>
            ) : selected ? (
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
                {blocks.length === 0 ? (
                  <>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✨</div>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#64748b", margin: 0 }}>Pick a template or add blocks</p>
                    <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Click any block to edit its style, or the <strong>Design</strong> tab for global settings</p>
                  </>
                ) : (
                  <>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👆</div>
                    <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Click a block to edit its style</p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}
