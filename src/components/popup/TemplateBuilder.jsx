import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Type, AlignLeft, MousePointer2, ImageIcon, Mail,
  Minus, MoveVertical, ChevronUp, ChevronDown, Trash2,
  Eye, EyeOff, Settings, ArrowLeft, Save, Layers, Code,
  GripVertical, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ImageUploadField } from "@/components/ui/image-upload-field";

// ── Block palette ──────────────────────────────────────────────────────────────

const BLOCK_PALETTE = [
  { type: "heading",    label: "Heading",    Icon: Type,          desc: "Title or headline" },
  { type: "text",       label: "Text",       Icon: AlignLeft,     desc: "Paragraph of text" },
  { type: "button",     label: "Button",     Icon: MousePointer2, desc: "CTA button with link" },
  { type: "email_form", label: "Email Form", Icon: Mail,          desc: "Email capture with submit" },
  { type: "image",      label: "Image",      Icon: ImageIcon,     desc: "Image from URL" },
  { type: "divider",    label: "Divider",    Icon: Minus,         desc: "Horizontal separator" },
  { type: "spacer",     label: "Spacer",     Icon: MoveVertical,  desc: "Empty vertical space" },
  { type: "html",       label: "Custom HTML", Icon: Code,         desc: "Paste raw HTML" },
];

const BLOCK_TYPE_LABELS = {
  heading: "Heading", text: "Text", button: "Button",
  email_form: "Email Form", image: "Image", divider: "Divider", spacer: "Spacer",
  html: "Custom HTML",
};

const PRESET_CATEGORIES = ["Lead Gen", "Promotion", "Awareness", "Retention", "Engagement", "Feedback"];
// "Custom" is not a real preset - any value not in PRESET_CATEGORIES is treated
// as a user-typed custom value, which reveals the free-text input.
function isPreset(cat) { return PRESET_CATEGORIES.includes(cat); }

// ── Block defaults ─────────────────────────────────────────────────────────────

function newBlock(type) {
  const id = Math.random().toString(36).slice(2, 10);
  const defaults = {
    heading:    { type, id, content: "Your Headline", level: "2", color: "#111111", align: "center", fontSize: "24", fontWeight: "700", lineHeight: "1.3", letterSpacing: "0", marginBottom: "12" },
    text:       { type, id, content: "Add your message here. Keep it clear and focused on one idea.", color: "#555555", align: "center", fontSize: "14", fontWeight: "400", lineHeight: "1.6", marginBottom: "16" },
    button:     { type, id, content: "Click Here", href: "#", align: "center", bg: "#111111", color: "#ffffff", borderRadius: "8", paddingY: "12", paddingX: "32", fontSize: "14", fontWeight: "600", fullWidth: false, borderWidth: "0", borderColor: "#111111", marginBottom: "16" },
    email_form: { type, id, placeholder: "your@email.com", buttonText: "Subscribe", buttonBg: "#111111", buttonColor: "#ffffff", inputBg: "#ffffff", inputColor: "#111111", inputBorderColor: "#dddddd", borderRadius: "8", privacyNote: "No spam. Unsubscribe any time.", showName: false },
    image:      { type, id, src: "", alt: "", href: "", align: "center", maxWidth: "100", borderRadius: "0", shadow: false, marginBottom: "16" },
    divider:    { type, id, color: "#e5e7eb", thickness: "1", style: "solid", widthPct: "100", marginY: "16" },
    spacer:     { type, id, height: "24" },
    html:       { type, id, html: `<p style="text-align:center;margin:0;font-size:14px;color:#555">Your custom HTML here</p>` },
  };
  return defaults[type];
}

export const DEFAULT_CONTAINER = {
  background: "#ffffff",
  bgImage: "",
  paddingY: "32",
  paddingX: "24",
  borderRadius: "12",
  maxWidth: "480",
  minHeight: "0",
  borderWidth: "0",
  borderColor: "#e5e7eb",
  fontFamily: "sans-serif",
  shadow: true,
};

// ── HTML generation ────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function blockToHtml(b) {
  switch (b.type) {
    case "heading": {
      const t = `h${b.level || 2}`;
      const ls = b.letterSpacing && b.letterSpacing !== "0" ? `letter-spacing:${b.letterSpacing}px;` : "";
      return `<${t} style="margin:0 0 ${b.marginBottom ?? 12}px;font-size:${b.fontSize || 24}px;font-weight:${b.fontWeight || 700};line-height:${b.lineHeight || 1.3};${ls}color:${b.color || "#111"};text-align:${b.align || "center"}">${esc(b.content)}</${t}>`;
    }
    case "text":
      return `<p style="margin:0 0 ${b.marginBottom ?? 16}px;font-size:${b.fontSize || 14}px;font-weight:${b.fontWeight || 400};color:${b.color || "#555"};text-align:${b.align || "center"};line-height:${b.lineHeight || 1.6}">${esc(b.content)}</p>`;
    case "button": {
      const border = b.borderWidth && b.borderWidth !== "0" ? `border:${b.borderWidth}px solid ${b.borderColor || b.bg || "#111"};` : "";
      const display = b.fullWidth ? "display:block;text-align:center;" : "display:inline-block;";
      return `<div style="text-align:${b.align || "center"};margin:0 0 ${b.marginBottom ?? 16}px"><a href="${esc(b.href || "#")}" style="${display}padding:${b.paddingY || 12}px ${b.paddingX || 32}px;background:${b.bg || "#111"};color:${b.color || "#fff"};text-decoration:none;border-radius:${b.borderRadius || 8}px;font-size:${b.fontSize || 14}px;font-weight:${b.fontWeight || 600};${border}cursor:pointer">${esc(b.content || "Click Here")}</a></div>`;
    }
    case "email_form": {
      const inputStyle = `width:100%;box-sizing:border-box;padding:10px 14px;background:${b.inputBg || "#fff"};color:${b.inputColor || "#111"};border:1px solid ${b.inputBorderColor || "#ddd"};border-radius:${b.borderRadius || 8}px;font-size:14px`;
      return `<form style="margin:0 0 8px">
  ${b.showName ? `<input name="name" type="text" placeholder="Your name" style="${inputStyle};margin-bottom:8px" />\n  ` : ""}<input name="email" type="email" placeholder="${esc(b.placeholder || "your@email.com")}" required style="${inputStyle};margin-bottom:10px" />
  <button type="submit" style="width:100%;padding:11px;background:${b.buttonBg || "#111"};color:${b.buttonColor || "#fff"};border:none;border-radius:${b.borderRadius || 8}px;font-size:14px;font-weight:600;cursor:pointer">${esc(b.buttonText || "Subscribe")}</button>
</form>${b.privacyNote ? `\n<p style="margin:8px 0 0;font-size:11px;color:#aaa;text-align:center">${esc(b.privacyNote)}</p>` : ""}`;
    }
    case "image": {
      if (!b.src) return "";
      const shadow = b.shadow ? "box-shadow:0 4px 16px rgba(0,0,0,.15);" : "";
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt || "")}" style="max-width:${b.maxWidth || 100}%;height:auto;display:inline-block;border-radius:${b.borderRadius || 0}px;${shadow}" />`;
      const wrapped = b.href ? `<a href="${esc(b.href)}">${img}</a>` : img;
      return `<div style="text-align:${b.align || "center"};margin:0 0 ${b.marginBottom ?? 16}px">${wrapped}</div>`;
    }
    case "divider":
      return `<hr style="border:none;border-top:${b.thickness || 1}px ${b.style || "solid"} ${b.color || "#e5e7eb"};width:${b.widthPct || 100}%;margin:${b.marginY || 16}px auto" />`;
    case "spacer":
      return `<div style="height:${b.height || 24}px"></div>`;
    case "html":
      return b.html || "";
    default:
      return "";
  }
}

export function generateHtml(container, blocks) {
  const shadow = container.shadow ? "box-shadow:0 4px 24px rgba(0,0,0,.12);" : "";
  const bgImage = container.bgImage
    ? `background-image:url('${esc(container.bgImage)}');background-size:cover;background-position:center;`
    : "";
  const border = container.borderWidth && container.borderWidth !== "0"
    ? `border:${container.borderWidth}px solid ${container.borderColor || "#e5e7eb"};`
    : "";
  const minHeight = container.minHeight && container.minHeight !== "0"
    ? `min-height:${container.minHeight}px;`
    : "";
  const inner = blocks.map(blockToHtml).filter(Boolean).join("\n");
  return `<div style="font-family:${container.fontFamily || "sans-serif"};max-width:${container.maxWidth || 480}px;margin:0 auto;padding:${container.paddingY || 32}px ${container.paddingX || 24}px;background:${container.background || "#fff"};${bgImage}${border}${minHeight}border-radius:${container.borderRadius || 12}px;${shadow}">\n${inner}\n</div>`;
}

// ── Shared field components ────────────────────────────────────────────────────

function ColorField({ label, value, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color" value={value || "#000000"}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded border border-input cursor-pointer p-0.5 flex-shrink-0"
        />
        <Input
          value={value || ""} onChange={e => onChange(e.target.value)}
          className="h-7 text-xs font-mono" placeholder="#000000"
        />
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min, max, unit }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">
        {label}{unit && <span className="text-muted-foreground ml-1 font-normal">({unit})</span>}
      </Label>
      <Input
        type="number" value={value ?? ""} min={min} max={max}
        onChange={e => onChange(e.target.value)} className="h-7 text-xs"
      />
    </div>
  );
}

function AlignField({ value, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">Alignment</Label>
      <div className="flex gap-1">
        {["left", "center", "right"].map(a => (
          <button
            key={a} onClick={() => onChange(a)}
            className={`flex-1 h-7 text-[11px] rounded border transition-colors capitalize ${
              value === a
                ? "bg-foreground text-background border-foreground"
                : "bg-background border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextareaField({ label, value, onChange, rows = 3 }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <textarea
        value={value ?? ""} onChange={e => onChange(e.target.value)} rows={rows}
        className="w-full text-xs p-2 border border-input rounded-md resize-none bg-background outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full h-7 px-2 text-xs bg-background border border-input rounded-md">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ToggleField({ label, value, onChange, hint }) {
  const id = Math.random().toString(36).slice(2);
  return (
    <div className="flex items-start gap-2">
      <input type="checkbox" id={id} checked={!!value} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded border-border cursor-pointer" />
      <div>
        <Label htmlFor={id} className="text-[11px] cursor-pointer">{label}</Label>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

// ── Block property panels ──────────────────────────────────────────────────────

function BlockProperties({ block, onChange }) {
  const set = (k, v) => onChange({ ...block, [k]: v });

  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-3">
          <TextareaField label="Text" value={block.content} onChange={v => set("content", v)} rows={2} />
          <div className="space-y-1">
            <Label className="text-[11px]">Level</Label>
            <select value={block.level || "2"} onChange={e => set("level", e.target.value)}
              className="w-full h-7 px-2 text-xs bg-background border border-input rounded-md">
              <option value="1">H1 - Largest</option>
              <option value="2">H2 - Large</option>
              <option value="3">H3 - Medium</option>
            </select>
          </div>
          <NumField label="Font size" value={block.fontSize} onChange={v => set("fontSize", v)} min={12} max={72} unit="px" />
          <div className="space-y-1">
            <Label className="text-[11px]">Weight</Label>
            <select value={block.fontWeight || "700"} onChange={e => set("fontWeight", e.target.value)}
              className="w-full h-7 px-2 text-xs bg-background border border-input rounded-md">
              <option value="400">Regular</option>
              <option value="600">Semi-bold</option>
              <option value="700">Bold</option>
              <option value="800">Extra-bold</option>
            </select>
          </div>
          <NumField label="Line height" value={block.lineHeight} onChange={v => set("lineHeight", v)} min={1} max={3} unit="×" />
          <NumField label="Letter spacing" value={block.letterSpacing} onChange={v => set("letterSpacing", v)} min={-2} max={12} unit="px" />
          <NumField label="Space below" value={block.marginBottom} onChange={v => set("marginBottom", v)} min={0} max={64} unit="px" />
          <AlignField value={block.align} onChange={v => set("align", v)} />
          <ColorField label="Text color" value={block.color} onChange={v => set("color", v)} />
        </div>
      );

    case "text":
      return (
        <div className="space-y-3">
          <TextareaField label="Content" value={block.content} onChange={v => set("content", v)} rows={4} />
          <NumField label="Font size" value={block.fontSize} onChange={v => set("fontSize", v)} min={10} max={36} unit="px" />
          <SelectField label="Weight" value={block.fontWeight || "400"} onChange={v => set("fontWeight", v)}
            options={[{ value: "300", label: "Light" }, { value: "400", label: "Regular" }, { value: "600", label: "Semi-bold" }, { value: "700", label: "Bold" }]} />
          <NumField label="Line height" value={block.lineHeight} onChange={v => set("lineHeight", v)} min={1} max={3} unit="×" />
          <NumField label="Space below" value={block.marginBottom} onChange={v => set("marginBottom", v)} min={0} max={64} unit="px" />
          <AlignField value={block.align} onChange={v => set("align", v)} />
          <ColorField label="Text color" value={block.color} onChange={v => set("color", v)} />
        </div>
      );

    case "button":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Button text</Label>
            <Input value={block.content} onChange={e => set("content", e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Link URL</Label>
            <Input value={block.href} onChange={e => set("href", e.target.value)} placeholder="https://..." className="h-7 text-xs" />
          </div>
          <AlignField value={block.align} onChange={v => set("align", v)} />
          <ToggleField label="Full width" value={block.fullWidth} onChange={v => set("fullWidth", v)}
            hint="Stretch the button to fill the popup width" />
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Background" value={block.bg} onChange={v => set("bg", v)} />
            <ColorField label="Text color" value={block.color} onChange={v => set("color", v)} />
          </div>
          <NumField label="Border radius" value={block.borderRadius} onChange={v => set("borderRadius", v)} min={0} max={50} unit="px" />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Border width" value={block.borderWidth} onChange={v => set("borderWidth", v)} min={0} max={8} unit="px" />
            <ColorField label="Border color" value={block.borderColor} onChange={v => set("borderColor", v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Padding Y" value={block.paddingY} onChange={v => set("paddingY", v)} min={4} max={40} unit="px" />
            <NumField label="Padding X" value={block.paddingX} onChange={v => set("paddingX", v)} min={8} max={80} unit="px" />
          </div>
          <NumField label="Font size" value={block.fontSize} onChange={v => set("fontSize", v)} min={10} max={24} unit="px" />
          <SelectField label="Font weight" value={block.fontWeight || "600"} onChange={v => set("fontWeight", v)}
            options={[{ value: "400", label: "Regular" }, { value: "600", label: "Semi-bold" }, { value: "700", label: "Bold" }]} />
          <NumField label="Space below" value={block.marginBottom} onChange={v => set("marginBottom", v)} min={0} max={64} unit="px" />
        </div>
      );

    case "email_form":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Email placeholder</Label>
            <Input value={block.placeholder} onChange={e => set("placeholder", e.target.value)} className="h-7 text-xs" />
          </div>
          <ToggleField label="Include name field" value={block.showName} onChange={v => set("showName", v)}
            hint="Adds a name input above the email field" />
          <div className="space-y-1">
            <Label className="text-[11px]">Submit button text</Label>
            <Input value={block.buttonText} onChange={e => set("buttonText", e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Button bg" value={block.buttonBg} onChange={v => set("buttonBg", v)} />
            <ColorField label="Button text" value={block.buttonColor} onChange={v => set("buttonColor", v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Input bg" value={block.inputBg} onChange={v => set("inputBg", v)} />
            <ColorField label="Input text" value={block.inputColor} onChange={v => set("inputColor", v)} />
          </div>
          <ColorField label="Input border" value={block.inputBorderColor} onChange={v => set("inputBorderColor", v)} />
          <NumField label="Input border radius" value={block.borderRadius} onChange={v => set("borderRadius", v)} min={0} max={50} unit="px" />
          <div className="space-y-1">
            <Label className="text-[11px]">Privacy note</Label>
            <Input value={block.privacyNote} onChange={e => set("privacyNote", e.target.value)}
              placeholder="No spam. Unsubscribe any time." className="h-7 text-xs" />
            <p className="text-[10px] text-muted-foreground">Leave blank to hide</p>
          </div>
        </div>
      );

    case "image":
      return (
        <div className="space-y-3">
          <ImageUploadField label="Image" value={block.src} onChange={v => set("src", v)}
            placeholder="Or paste an image URL…" />
          <div className="space-y-1">
            <Label className="text-[11px]">Alt text</Label>
            <Input value={block.alt} onChange={e => set("alt", e.target.value)}
              placeholder="Describe the image" className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Link URL</Label>
            <Input value={block.href} onChange={e => set("href", e.target.value)}
              placeholder="https://… (optional)" className="h-7 text-xs" />
          </div>
          <NumField label="Max width" value={block.maxWidth} onChange={v => set("maxWidth", v)} min={10} max={100} unit="%" />
          <NumField label="Corner radius" value={block.borderRadius} onChange={v => set("borderRadius", v)} min={0} max={50} unit="px" />
          <NumField label="Space below" value={block.marginBottom} onChange={v => set("marginBottom", v)} min={0} max={64} unit="px" />
          <AlignField value={block.align} onChange={v => set("align", v)} />
          <ToggleField label="Drop shadow" value={block.shadow} onChange={v => set("shadow", v)} />
        </div>
      );

    case "divider":
      return (
        <div className="space-y-3">
          <ColorField label="Line color" value={block.color} onChange={v => set("color", v)} />
          <NumField label="Thickness" value={block.thickness} onChange={v => set("thickness", v)} min={1} max={12} unit="px" />
          <SelectField label="Style" value={block.style || "solid"} onChange={v => set("style", v)}
            options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }]} />
          <NumField label="Width" value={block.widthPct} onChange={v => set("widthPct", v)} min={10} max={100} unit="%" />
          <NumField label="Vertical margin" value={block.marginY} onChange={v => set("marginY", v)} min={0} max={80} unit="px" />
        </div>
      );

    case "spacer":
      return (
        <div className="space-y-3">
          <NumField label="Height" value={block.height} onChange={v => set("height", v)} min={4} max={200} unit="px" />
        </div>
      );

    case "html":
      return (
        <div className="space-y-1">
          <Label className="text-[11px]">Raw HTML</Label>
          <textarea
            value={block.html ?? ""}
            onChange={e => set("html", e.target.value)}
            rows={12}
            className="w-full text-xs p-2 border border-input rounded-md resize-y bg-background outline-none focus:ring-1 focus:ring-ring font-mono leading-relaxed"
            placeholder="<div>…</div>"
          />
          <p className="text-[10px] text-muted-foreground">
            Inserted as-is. Use this for layouts the visual blocks don't cover - coupon boxes, custom forms, etc.
          </p>
        </div>
      );

    default:
      return null;
  }
}

// ── Container property panel ───────────────────────────────────────────────────

function ContainerProperties({ container, onChange }) {
  const set = (k, v) => onChange({ ...container, [k]: v });
  return (
    <div className="space-y-3">
      <ColorField label="Background color" value={container.background} onChange={v => set("background", v)} />
      <ImageUploadField label="Background image" value={container.bgImage} onChange={v => set("bgImage", v)}
        placeholder="Or paste an image URL…" previewClassName="h-16" />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Padding top/bottom" value={container.paddingY} onChange={v => set("paddingY", v)} min={0} max={80} unit="px" />
        <NumField label="Padding left/right" value={container.paddingX} onChange={v => set("paddingX", v)} min={0} max={80} unit="px" />
      </div>
      <NumField label="Max width" value={container.maxWidth} onChange={v => set("maxWidth", v)} min={200} max={900} unit="px" />
      <NumField label="Min height" value={container.minHeight} onChange={v => set("minHeight", v)} min={0} max={900} unit="px" />
      <NumField label="Border radius" value={container.borderRadius} onChange={v => set("borderRadius", v)} min={0} max={40} unit="px" />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Border width" value={container.borderWidth} onChange={v => set("borderWidth", v)} min={0} max={12} unit="px" />
        <ColorField label="Border color" value={container.borderColor} onChange={v => set("borderColor", v)} />
      </div>
      <div className="space-y-1">
        <Label className="text-[11px]">Font family</Label>
        <select
          value={container.fontFamily || "sans-serif"}
          onChange={e => set("fontFamily", e.target.value)}
          className="w-full h-7 px-2 text-xs bg-background border border-input rounded-md"
        >
          <option value="sans-serif">Sans-serif (default)</option>
          <option value="serif">Serif</option>
          <option value="Arial, sans-serif">Arial</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Trebuchet MS', sans-serif">Trebuchet MS</option>
          <option value="'Courier New', monospace">Courier New</option>
        </select>
      </div>
      <ToggleField label="Drop shadow" value={container.shadow} onChange={v => set("shadow", v)}
        hint="Adds a soft shadow around the popup" />
    </div>
  );
}

// ── Inline canvas block preview ────────────────────────────────────────────────

function BlockPreview({ block }) {
  switch (block.type) {
    case "heading":
      return (
        <p style={{ color: block.color, textAlign: block.align, fontSize: `${Math.min(Number(block.fontSize || 24), 26)}px`, fontWeight: block.fontWeight || 700, margin: 0 }}>
          {block.content || "Heading"}
        </p>
      );
    case "text":
      return (
        <p style={{ color: block.color, textAlign: block.align, fontSize: `${block.fontSize || 14}px`, lineHeight: block.lineHeight || 1.6, margin: 0 }} className="line-clamp-3 text-xs">
          {block.content || "Text block"}
        </p>
      );
    case "button":
      return (
        <div style={{ textAlign: block.align }}>
          <span className={block.fullWidth ? "block text-xs text-center" : "inline-block text-xs"} style={{
            padding: `${Math.min(Number(block.paddingY || 12), 12)}px ${Math.min(Number(block.paddingX || 32), 24)}px`,
            background: block.bg, color: block.color,
            borderRadius: `${block.borderRadius || 8}px`,
            border: block.borderWidth && block.borderWidth !== "0" ? `${block.borderWidth}px solid ${block.borderColor || block.bg}` : undefined,
            fontSize: "12px", fontWeight: block.fontWeight || 600,
          }}>
            {block.content || "Button"}
          </span>
        </div>
      );
    case "email_form":
      return (
        <div className="space-y-1.5">
          {block.showName && <div className="h-6 border border-border rounded text-[10px] flex items-center px-2 text-muted-foreground">Your name</div>}
          <div className="h-6 border border-border rounded text-[10px] flex items-center px-2 text-muted-foreground">{block.placeholder || "your@email.com"}</div>
          <div className="h-6 rounded text-[10px] flex items-center justify-center font-medium" style={{ background: block.buttonBg, color: block.buttonColor }}>
            {block.buttonText || "Subscribe"}
          </div>
          {block.privacyNote && <p className="text-[9px] text-center text-muted-foreground">{block.privacyNote}</p>}
        </div>
      );
    case "image":
      return block.src
        ? <img src={block.src} alt={block.alt} className="max-h-16 mx-auto object-contain block" style={{ maxWidth: `${block.maxWidth || 100}%`, borderRadius: `${block.borderRadius || 0}px`, boxShadow: block.shadow ? "0 4px 16px rgba(0,0,0,.15)" : undefined }} />
        : <div className="h-12 border-2 border-dashed border-border rounded flex items-center justify-center text-[10px] text-muted-foreground">Upload or set an image in properties →</div>;
    case "divider":
      return <hr style={{ border: "none", borderTop: `${block.thickness || 1}px ${block.style || "solid"} ${block.color || "#e5e7eb"}`, width: `${block.widthPct || 100}%`, margin: "4px auto" }} />;
    case "spacer":
      return (
        <div className="flex items-center justify-center text-[9px] text-muted-foreground/40 bg-secondary/10 rounded"
          style={{ height: `${Math.min(Number(block.height || 24), 48)}px` }}>
          ↕ {block.height || 24}px
        </div>
      );
    case "html":
      return block.html?.trim()
        ? <div className="text-xs overflow-hidden max-h-40" dangerouslySetInnerHTML={{ __html: block.html }} />
        : <div className="h-10 border-2 border-dashed border-border rounded flex items-center justify-center text-[10px] text-muted-foreground">Add HTML in properties →</div>;
    default: return null;
  }
}

// ── Main TemplateBuilder component ─────────────────────────────────────────────

export default function TemplateBuilder({ open, onClose, onSave, initial = null, isSaving }) {
  const [meta, setMeta] = useState({
    name: initial?.name || "",
    category: initial?.category || "",
    description: initial?.description || "",
  });

  const [container, setContainer] = useState(
    initial?.builder_state?.container
      ? { ...DEFAULT_CONTAINER, ...initial.builder_state.container }
      : { ...DEFAULT_CONTAINER }
  );

  const [blocks, setBlocks] = useState(
    initial?.builder_state?.blocks || []
  );

  const [selectedId, setSelectedId] = useState(null);
  const [rightTab, setRightTab] = useState("block");
  const [showPreview, setShowPreview] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const resizeState = useRef(null);

  const selectedBlock = blocks.find(b => b.id === selectedId) || null;

  const addBlock = (type) => {
    const b = newBlock(type);
    setBlocks(prev => [...prev, b]);
    setSelectedId(b.id);
    setRightTab("block");
    setShowPreview(false);
  };

  const updateBlock = (updated) => setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));

  const removeBlock = (id) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const duplicateBlock = (id) => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], id: Math.random().toString(36).slice(2, 10) };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const moveBlock = (id, dir) => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0) return prev;
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  // Drag-and-drop reordering on the canvas.
  const handleDrop = () => {
    if (dragId && overId && dragId !== overId) {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === dragId);
        const to = prev.findIndex(b => b.id === overId);
        if (from < 0 || to < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    }
    setDragId(null);
    setOverId(null);
  };

  // Drag the canvas edge to resize the popup width (updates container.maxWidth).
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { startX: e.clientX, startWidth: Number(container.maxWidth) || 480 };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", stopResize);
  };
  const onResizeMove = (e) => {
    if (!resizeState.current) return;
    const delta = (e.clientX - resizeState.current.startX) * 2; // centred → grows both sides
    const next = Math.max(200, Math.min(900, Math.round(resizeState.current.startWidth + delta)));
    setContainer(prev => ({ ...prev, maxWidth: String(next) }));
  };
  const stopResize = () => {
    resizeState.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", stopResize);
  };

  const generatedHtml = generateHtml(container, blocks);

  const handleSave = () => {
    if (!meta.name.trim()) { toast.error("Template name is required"); return; }
    if (!blocks.length)    { toast.error("Add at least one block to the template"); return; }
    onSave({
      name: meta.name.trim(),
      category: meta.category.trim() || "Custom",
      description: meta.description,
      content: generatedHtml,
      builder_state: { container, blocks },
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] max-h-[92vh] p-0 flex flex-col overflow-hidden gap-0">

        {/* ── Top bar ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0 bg-background">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs flex-shrink-0" onClick={onClose}>
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Button>

          <div className="w-px h-5 bg-border flex-shrink-0" />

          <Input
            value={meta.name}
            onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
            placeholder="Template name..."
            className="h-8 text-sm w-48 flex-shrink-0"
          />
          <select
            value={isPreset(meta.category) ? meta.category : "Custom"}
            onChange={e => {
              const val = e.target.value;
              setMeta(m => ({ ...m, category: val === "Custom" ? "" : val }));
            }}
            className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground flex-shrink-0"
          >
            {PRESET_CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="Custom">Custom…</option>
          </select>
          {!isPreset(meta.category) && (
            <Input
              value={meta.category}
              onChange={e => setMeta(m => ({ ...m, category: e.target.value }))}
              placeholder="e.g. Onboarding, Event, Re-engagement…"
              className="h-8 text-xs w-44 flex-shrink-0"
              autoFocus
            />
          )}
          <Input
            value={meta.description}
            onChange={e => setMeta(m => ({ ...m, description: e.target.value }))}
            placeholder="Short description (optional)"
            className="h-8 text-xs flex-1 hidden lg:block"
          />

          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {blocks.length > 0 && (
              <span className="text-[11px] text-muted-foreground hidden md:inline">
                {blocks.length} block{blocks.length !== 1 ? "s" : ""}
              </span>
            )}
            <Button
              variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
              onClick={() => setShowPreview(p => !p)}
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? "Edit" : "Preview"}
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleSave} disabled={isSaving}>
              <Save className="w-3.5 h-3.5" />
              {isSaving ? "Saving…" : "Save Template"}
            </Button>
          </div>
        </div>

        {showPreview ? (
          /* ── Preview mode ──────────────────────────────────────────────────── */
          <div className="flex-1 overflow-auto bg-gray-100 p-8">
            <div className="max-w-xl mx-auto">
              <p className="text-[11px] text-muted-foreground text-center mb-4">Live preview - this is how your popup will appear</p>
              <iframe
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#f3f4f6">${generatedHtml}</body></html>`}
                title="Template preview"
                className="w-full rounded-xl border border-border"
                style={{ minHeight: 500, border: "none" }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        ) : (
          /* ── Builder mode ──────────────────────────────────────────────────── */
          <div className="flex flex-1 overflow-hidden">

            {/* Left: block palette ─────────────────────────────────────────── */}
            <div className="w-44 flex-shrink-0 border-r border-border bg-secondary/10 overflow-y-auto p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Add Block</p>
              <div className="space-y-1">
                {BLOCK_PALETTE.map(({ type, label, Icon, desc }) => (
                  <button
                    key={type}
                    onClick={() => addBlock(type)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-background hover:shadow-sm transition-all group border border-transparent hover:border-border"
                  >
                    <div className="w-7 h-7 rounded-md bg-background border border-border flex items-center justify-center flex-shrink-0 group-hover:border-foreground/20 transition-colors">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight">{label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Center: canvas ──────────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto bg-gray-100 p-6">
              {blocks.length === 0 ? (
                <div className="max-w-md mx-auto border-2 border-dashed border-border rounded-xl p-16 text-center bg-background/60">
                  <Layers className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium text-muted-foreground mb-1">Start building your popup</p>
                  <p className="text-xs text-muted-foreground">Click any block in the left panel to add it to your template</p>
                </div>
              ) : (
                <div className="mx-auto relative" style={{ width: `${container.maxWidth || 480}px`, maxWidth: "100%" }}>
                  {/* Container wrapper preview */}
                  <div
                    className="rounded-xl shadow-lg"
                    style={{
                      background: container.background,
                      backgroundImage: container.bgImage ? `url('${container.bgImage}')` : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      padding: `${container.paddingY || 32}px ${container.paddingX || 24}px`,
                      fontFamily: container.fontFamily || "sans-serif",
                      borderRadius: `${container.borderRadius || 12}px`,
                      border: container.borderWidth && container.borderWidth !== "0" ? `${container.borderWidth}px solid ${container.borderColor || "#e5e7eb"}` : undefined,
                      minHeight: container.minHeight && container.minHeight !== "0" ? `${container.minHeight}px` : undefined,
                      boxShadow: container.shadow ? "0 4px 24px rgba(0,0,0,.12)" : "none",
                    }}
                  >
                    {blocks.map((block, idx) => {
                      const isSelected = block.id === selectedId;
                      const isDragging = dragId === block.id;
                      const isOver = overId === block.id && dragId && dragId !== block.id;
                      return (
                        <div
                          key={block.id}
                          draggable
                          onDragStart={() => setDragId(block.id)}
                          onDragEnter={() => setOverId(block.id)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={handleDrop}
                          onDragEnd={handleDrop}
                          onClick={() => { setSelectedId(block.id); setRightTab("block"); }}
                          style={{ opacity: isDragging ? 0.4 : 1, boxShadow: isOver ? "inset 0 3px 0 var(--foreground, #111)" : undefined }}
                          className={`relative group rounded-md transition-all cursor-pointer mb-2 ${
                            isSelected
                              ? "ring-2 ring-foreground ring-offset-2"
                              : "hover:ring-1 hover:ring-border hover:ring-offset-1"
                          }`}
                        >
                          {/* Block label + drag handle (selected only) */}
                          {isSelected && (
                            <div className="absolute -top-2.5 left-1 z-20 flex items-center gap-1">
                              <span className="text-[9px] font-semibold bg-foreground text-background px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-grab">
                                <GripVertical className="w-2.5 h-2.5" /> {BLOCK_TYPE_LABELS[block.type]}
                              </span>
                            </div>
                          )}

                          {/* Controls (hover + selected) */}
                          <div className={`absolute -top-2.5 right-0 z-20 flex items-center gap-0.5 ${isSelected ? "flex" : "hidden group-hover:flex"}`}>
                            <button
                              onClick={e => { e.stopPropagation(); moveBlock(block.id, "up"); }}
                              disabled={idx === 0}
                              className="w-5 h-5 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); moveBlock(block.id, "down"); }}
                              disabled={idx === blocks.length - 1}
                              className="w-5 h-5 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); duplicateBlock(block.id); }}
                              className="w-5 h-5 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); removeBlock(block.id); }}
                              className="w-5 h-5 rounded bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="px-2 py-2 min-h-[28px]">
                            <BlockPreview block={block} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Width-resize handle */}
                  <div
                    onPointerDown={startResize}
                    title="Drag to resize popup width"
                    className="absolute top-0 bottom-0 -right-3 w-6 flex items-center justify-center cursor-ew-resize"
                  >
                    <div className="w-1 h-11 rounded bg-slate-300" />
                  </div>

                  <p className="text-center text-[11px] text-muted-foreground mt-4">
                    Drag blocks to reorder · Drag the edge to resize · {container.maxWidth || 480}px wide
                  </p>
                </div>
              )}
            </div>

            {/* Right: properties panel ─────────────────────────────────────── */}
            <div className="w-60 flex-shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
              {/* Tab switcher */}
              <div className="flex border-b border-border flex-shrink-0">
                <button
                  onClick={() => setRightTab("block")}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    rightTab === "block"
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Settings className="w-3 h-3" /> Block
                </button>
                <button
                  onClick={() => setRightTab("container")}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    rightTab === "container"
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Layers className="w-3 h-3" /> Container
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {rightTab === "container" ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Container Settings</p>
                    <ContainerProperties container={container} onChange={setContainer} />
                  </>
                ) : selectedBlock ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                      {BLOCK_TYPE_LABELS[selectedBlock.type]} Settings
                    </p>
                    <BlockProperties block={selectedBlock} onChange={updateBlock} />
                  </>
                ) : (
                  <div className="py-10 text-center">
                    <Settings className="w-8 h-8 mx-auto mb-2 opacity-15" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Select a block on the canvas to edit its properties here, or switch to <strong>Container</strong> to style the popup wrapper.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
