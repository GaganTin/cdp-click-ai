import { useState, useId, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { DateRangeBar, KpiTile } from "@/components/analytics/AnalyticsKit";
import { toast } from "sonner";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, isSameMonth, isToday,
} from "date-fns";
import {
  Plus, Pencil, Trash2, MousePointer2, Mail, ToggleLeft,
  ToggleRight, Search, Calendar, Lightbulb,
  CheckCircle2, Clock, Users, Ghost, Layout,
  BarChart2, Upload, Eye, Filter,
  Link2, Copy, Info, LayoutGrid, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown,
  ArrowUp, ArrowDown, ArrowUpDown,
} from "lucide-react";
import TemplateBuilder, { generateHtml, DEFAULT_CONTAINER } from "@/components/popup/TemplateBuilder";
import PopupStats from "@/components/popup/PopupStats";
import TableToolbar from "@/components/ui/TableToolbar";
import { useStickyState } from "@/lib/useStickyState";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { DevicePreviewToggle, DevicePreviewFrame } from "@/components/ui/device-preview";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { usePreferences } from "@/lib/PreferencesContext";
import PageGuide from "@/components/PageGuide";

// ── Constants ──────────────────────────────────────────────────────────────────

const INTERACTION_TYPES = [
  { value: "banner",       label: "Banner" },
  { value: "modal",        label: "Modal" },
  { value: "slide_in",     label: "Slide-in" },
  { value: "notification", label: "Notification" },
];

const TABS = [
  { key: "popups",    label: "Pop Ups",         icon: MousePointer2 },
  { key: "templates", label: "Templates",        icon: Layout },
  { key: "analytics", label: "Analytics",        icon: BarChart2 },
  { key: "emails",    label: "Emails Collected", icon: Mail },
];

const STATUS_ACCENT = { active: "hsl(var(--foreground))", draft: "#eab308" };
const STATUS_STYLE  = { active: "bg-foreground text-background", draft: "bg-yellow-500/10 text-yellow-700 border border-yellow-500/40" };

// ── Pre-built Templates ────────────────────────────────────────────────────────
// Defined as visual-builder state (container + blocks) so that cloning one yields a
// fully editable template in the Template Builder. `content` (the HTML served to the
// plugin) is generated from that state so the two never drift apart.

function builtinTemplate({ id, name, description, category, container, blocks }) {
  const fullContainer = { ...DEFAULT_CONTAINER, ...container };
  return {
    id, name, description, category,
    builtin: true,
    builder_state: { container: fullContainer, blocks },
    content: generateHtml(fullContainer, blocks),
  };
}

const BUILTIN_TEMPLATES = [
  builtinTemplate({
    id: "email-collection",
    name: "Email Collection",
    description: "Newsletter signup with a clean form to capture visitor emails.",
    category: "Lead Gen",
    container: { background: "#ffffff", paddingY: "32", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: true },
    blocks: [
      { type: "heading", id: "ec-h", content: "Stay in the loop", level: "2", color: "#111111", align: "left", fontSize: "22", fontWeight: "700" },
      { type: "text", id: "ec-t", content: "Get exclusive offers and updates straight to your inbox.", color: "#555555", align: "left", fontSize: "14", lineHeight: "1.6" },
      { type: "email_form", id: "ec-f", placeholder: "your@email.com", buttonText: "Subscribe", buttonBg: "#111111", buttonColor: "#ffffff", borderRadius: "8", privacyNote: "No spam. Unsubscribe any time.", showName: false },
    ],
  }),
  builtinTemplate({
    id: "discount-coupon",
    name: "Discount Coupon",
    description: "Show a promo code with a clear call-to-action to drive conversions.",
    category: "Promotion",
    container: { background: "#ffffff", paddingY: "32", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: true },
    blocks: [
      { type: "heading", id: "dc-emoji", content: "🎉", level: "2", color: "#111111", align: "center", fontSize: "48", fontWeight: "700" },
      { type: "heading", id: "dc-h", content: "20% OFF", level: "2", color: "#111111", align: "center", fontSize: "26", fontWeight: "800" },
      { type: "text", id: "dc-t1", content: "Use code at checkout:", color: "#555555", align: "center", fontSize: "14", lineHeight: "1.6" },
      { type: "html", id: "dc-code", html: `<div style="text-align:center;margin:0 0 16px"><span style="display:inline-block;padding:8px 20px;background:#f5f5f5;border-radius:8px;font-size:18px;font-weight:700;letter-spacing:2px;color:#111">SAVE20</span></div>` },
      { type: "text", id: "dc-t2", content: "Valid for the next 24 hours only.", color: "#888888", align: "center", fontSize: "13", lineHeight: "1.6" },
      { type: "button", id: "dc-btn", content: "Shop Now", href: "#", align: "center", bg: "#111111", color: "#ffffff", borderRadius: "8", paddingY: "12", paddingX: "32", fontSize: "14", fontWeight: "600" },
    ],
  }),
  builtinTemplate({
    id: "announcement",
    name: "Announcement",
    description: "Highlight a new feature, event, or update to your visitors.",
    category: "Awareness",
    container: { background: "#111111", paddingY: "24", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: false },
    blocks: [
      { type: "heading", id: "an-h", content: "📢 New Feature Available", level: "2", color: "#ffffff", align: "left", fontSize: "18", fontWeight: "700" },
      { type: "text", id: "an-t", content: "We've just launched something exciting. Check it out and let us know what you think!", color: "#aaaaaa", align: "left", fontSize: "14", lineHeight: "1.6" },
      { type: "button", id: "an-btn", content: "Learn More", href: "#", align: "left", bg: "#ffffff", color: "#111111", borderRadius: "8", paddingY: "10", paddingX: "24", fontSize: "13", fontWeight: "600" },
    ],
  }),
  builtinTemplate({
    id: "exit-intent",
    name: "Exit Intent",
    description: "Last-chance offer shown when visitors are about to leave.",
    category: "Retention",
    container: { background: "#ffffff", paddingY: "32", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: true },
    blocks: [
      { type: "heading", id: "ei-emoji", content: "⏳", level: "2", color: "#111111", align: "center", fontSize: "40", fontWeight: "700" },
      { type: "heading", id: "ei-h", content: "Wait! Before you go…", level: "2", color: "#111111", align: "center", fontSize: "22", fontWeight: "700" },
      { type: "text", id: "ei-t", content: "We'd love to keep you in the loop. Get 10% off your next purchase when you sign up.", color: "#666666", align: "center", fontSize: "14", lineHeight: "1.5" },
      { type: "email_form", id: "ei-f", placeholder: "your@email.com", buttonText: "Claim 10%", buttonBg: "#e53e3e", buttonColor: "#ffffff", borderRadius: "8", privacyNote: "Offer valid for new subscribers only.", showName: false },
    ],
  }),
  builtinTemplate({
    id: "welcome",
    name: "Welcome",
    description: "Greet new visitors and introduce your brand or service.",
    category: "Engagement",
    container: { background: "#764ba2", paddingY: "32", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: false },
    blocks: [
      { type: "heading", id: "wc-emoji", content: "", level: "2", color: "#ffffff", align: "center", fontSize: "48", fontWeight: "700" },
      { type: "heading", id: "wc-h", content: "Welcome!", level: "2", color: "#ffffff", align: "center", fontSize: "24", fontWeight: "700" },
      { type: "text", id: "wc-t", content: "We're glad you're here. Explore our latest resources, events, and membership benefits.", color: "#ece7f4", align: "center", fontSize: "14", lineHeight: "1.6" },
      { type: "button", id: "wc-btn", content: "Explore Now", href: "#", align: "center", bg: "#ffffff", color: "#764ba2", borderRadius: "8", paddingY: "12", paddingX: "32", fontSize: "14", fontWeight: "700" },
    ],
  }),
  builtinTemplate({
    id: "survey",
    name: "Quick Survey",
    description: "Collect a single feedback response from visitors.",
    category: "Feedback",
    container: { background: "#ffffff", paddingY: "28", paddingX: "24", borderRadius: "12", maxWidth: "480", shadow: true },
    blocks: [
      { type: "heading", id: "sv-h", content: "Quick question for you 🤔", level: "2", color: "#111111", align: "left", fontSize: "18", fontWeight: "700" },
      { type: "text", id: "sv-t", content: "What brought you to our site today?", color: "#666666", align: "left", fontSize: "13", lineHeight: "1.6" },
      { type: "html", id: "sv-form", html: `<form>
  <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
    <input type="radio" name="reason" value="membership" /> <span style="font-size:13px">Join / renew membership</span>
  </label>
  <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
    <input type="radio" name="reason" value="events" /> <span style="font-size:13px">Upcoming events</span>
  </label>
  <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
    <input type="radio" name="reason" value="resources" /> <span style="font-size:13px">Resources &amp; content</span>
  </label>
  <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:12px">
    <input type="radio" name="reason" value="other" /> <span style="font-size:13px">Something else</span>
  </label>
  <button type="submit" style="width:100%;padding:10px;background:#111;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Submit</button>
</form>` },
    ],
  }),
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function toDateInput(ts) {
  if (!ts) return "";
  try { return new Date(ts).toISOString().slice(0, 16); } catch { return ""; }
}

// ── Popup Form Dialog ──────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: "",
  interaction_type: "banner",
  content: "",
  is_active: false,
  is_default: false,
  start_time: "",
  end_time: "",
  rules: { visit: 3, exit_threshold: 50, anonymous_segment_id: "", customer_segment_id: "" },
};

function PopupFormDialog({ open, onClose, onSave, initial = null, isSaving, initialContent = "", initialTemplateId = "" }) {
  const { t } = usePreferences();
  const uid = useId();
  const isEdit = !!initial;

  const [form, setForm] = useState(() => {
    if (initial) {
      const rules = initial.rules || {};
      return {
        name: initial.name || "",
        interaction_type: initial.interaction_type || "banner",
        content: initial.content || "",
        is_active: initial.is_active || false,
        is_default: initial.is_default || false,
        start_time: toDateInput(initial.start_time),
        end_time: toDateInput(initial.end_time),
        rules: {
          visit: rules.visit ?? 3,
          exit_threshold: rules.exit_threshold ?? 50,
          anonymous_segment_id: rules.anonymous_segment_id || "",
          customer_segment_id: rules.customer_segment_id || "",
        },
      };
    }
    return { ...DEFAULT_FORM, content: initialContent, rules: { ...DEFAULT_FORM.rules } };
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setRule = (key, val) => setForm(f => ({ ...f, rules: { ...f.rules, [key]: val } }));

  const { data: allSegments = [] } = useQuery({
    queryKey: ["segments-all"],
    queryFn: () => appClient.entities.Segment.list(),
    enabled: open,
  });
  const anonymousSegments = allSegments.filter(s => s.segment_type === "anonymous_profile" && s.status !== "archived");
  const customerSegments  = allSegments.filter(s => s.segment_type === "customer"          && s.status !== "archived");

  // Template picker - a pop-up's design comes from a saved template (built-in or custom).
  const { data: customTemplates = [] } = useQuery({
    queryKey: ["popup-templates"],
    queryFn: () => appClient.popup.listTemplates(),
    enabled: open,
  });
  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];

  // When opened from "Use Template", the chosen template is preselected directly.
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId || "");
  // Otherwise reflect the existing design in the dropdown: match saved content to a
  // template, or flag it as a one-off "custom" design not created from a template.
  useEffect(() => {
    if (selectedTemplateId || !form.content.trim()) return;
    const match = allTemplates.find(tpl => (tpl.content || "") === form.content);
    setSelectedTemplateId(match ? match.id : "__custom__");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customTemplates]);

  const handleSelectTemplate = (id) => {
    if (id === "__custom__") return;
    setSelectedTemplateId(id);
    const tpl = allTemplates.find(x => x.id === id);
    if (tpl) set("content", tpl.content || "");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim())    { toast.error(t("Name is required")); return; }
    if (!form.content.trim()) { toast.error(t("Please select a template")); return; }

    onSave({
      name: form.name.trim(),
      interaction_type: form.interaction_type,
      content: form.content,
      is_active: form.is_active,
      is_default: form.is_default,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      rules: {
        visit: Number(form.rules.visit) || 3,
        exit_threshold: Number(form.rules.exit_threshold) || 50,
        ...(form.rules.anonymous_segment_id && { anonymous_segment_id: form.rules.anonymous_segment_id }),
        ...(form.rules.customer_segment_id  && { customer_segment_id:  form.rules.customer_segment_id }),
      },
    });
  };

  const selectedAnonSegment = anonymousSegments.find(s => s.id === form.rules.anonymous_segment_id);
  const selectedCustSegment = customerSegments.find(s => s.id === form.rules.customer_segment_id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("Edit Pop Up") : t("New Pop Up")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">

          {/* ── Basic Info ── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Basic Info")}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-name`} className="text-xs">{t("Name")} <span className="text-destructive">*</span></Label>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder={t("Summer Sale Banner")}
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-type`} className="text-xs">{t("Type")}</Label>
                <Select value={form.interaction_type} onValueChange={v => set("interaction_type", v)}>
                  <SelectTrigger id={`${uid}-type`} className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERACTION_TYPES.map(it => (
                      <SelectItem key={it.value} value={it.value}>{t(it.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-start`} className="text-xs">{t("Start Date")}</Label>
                <Input id={`${uid}-start`} type="datetime-local" value={form.start_time} onChange={e => set("start_time", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-end`} className="text-xs">{t("End Date")}</Label>
                <Input id={`${uid}-end`} type="datetime-local" value={form.end_time} onChange={e => set("end_time", e.target.value)} className="h-9 text-sm" />
              </div>
            </div>

            <TooltipProvider delayDuration={150}>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-1.5">
                  <Switch id={`${uid}-active`} checked={form.is_active} onCheckedChange={v => set("is_active", v)} />
                  <Label htmlFor={`${uid}-active`} className="text-sm cursor-pointer">{t("Active")}</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={t("What does Active do?")} className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] leading-relaxed">
                      {t("When on, this pop-up is live and served to visitors by the WordPress plugin. When off, it stays a draft and is never shown.")}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1.5">
                  <Switch id={`${uid}-default`} checked={form.is_default} onCheckedChange={v => set("is_default", v)} />
                  <Label htmlFor={`${uid}-default`} className="text-sm cursor-pointer">{t("Default pop-up")}</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label={t("What does Default pop-up do?")} className="text-muted-foreground hover:text-foreground transition-colors">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px] leading-relaxed">
                      {t("The fallback shown to visitors who don't match any segment-targeted pop-up, so everyone sees something. Typically only one pop-up is the default.")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </TooltipProvider>
          </section>

          {/* ── Template ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Template")}</h3>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Pop-Up Template")} <span className="text-destructive">*</span></Label>
              <Select value={selectedTemplateId || ""} onValueChange={handleSelectTemplate}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={t("Select a template")} />
                </SelectTrigger>
                <SelectContent>
                  {selectedTemplateId === "__custom__" && (
                    <SelectItem value="__custom__" disabled>{t("Custom design (current)")}</SelectItem>
                  )}
                  {allTemplates.length === 0 && (
                    <SelectItem value="_empty" disabled>{t("No templates available")}</SelectItem>
                  )}
                  {allTemplates.map(tpl => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}{tpl.category ? ` · ${tpl.category}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("Choose a design for this pop-up. To create or edit a template's design, go to the")} <strong>{t("Templates")}</strong> {t("tab.")}
              </p>
            </div>
          </section>

          {/* ── Targeting Rules ── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("Targeting")}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-visit`} className="text-xs">{t("Visit Threshold")}</Label>
                <Input
                  id={`${uid}-visit`}
                  type="number" min="1"
                  value={form.rules.visit}
                  onChange={e => setRule("visit", e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">{t("Min page visits before showing (default: 3)")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-exit`} className="text-xs">{t("Daily Exit Threshold")}</Label>
                <Input
                  id={`${uid}-exit`}
                  type="number" min="1"
                  value={form.rules.exit_threshold}
                  onChange={e => setRule("exit_threshold", e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">{t("Max deliveries per day (default: 50)")}</p>
              </div>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-4 bg-secondary/10">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">{t("Segment Targeting")}</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                {t("Select segments to target. The GA IDs from each segment are resolved and passed to the WordPress plugin as targeting criteria. Leave both empty to show to all visitors meeting the visit threshold.")}
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Ghost className="w-3 h-3" /> {t("Anonymous Segment")}
                </Label>
                <Select
                  value={form.rules.anonymous_segment_id || "none"}
                  onValueChange={v => setRule("anonymous_segment_id", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={t("No anonymous targeting")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("No anonymous targeting")}</SelectItem>
                    {anonymousSegments.length === 0 && (
                      <SelectItem value="_empty" disabled>{t("No anonymous segments saved")}</SelectItem>
                    )}
                    {anonymousSegments.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.estimated_size ? ` (${s.estimated_size.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAnonSegment && (
                  <p className="text-[11px] text-muted-foreground">{selectedAnonSegment.description || t("Anonymous visitor segment")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {t("Customer Segment")}
                </Label>
                <Select
                  value={form.rules.customer_segment_id || "none"}
                  onValueChange={v => setRule("customer_segment_id", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={t("No customer targeting")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("No customer targeting")}</SelectItem>
                    {customerSegments.length === 0 && (
                      <SelectItem value="_empty" disabled>{t("No customer segments saved")}</SelectItem>
                    )}
                    {customerSegments.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.estimated_size ? ` (${s.estimated_size.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCustSegment && (
                  <p className="text-[11px] text-muted-foreground">{selectedCustSegment.description || t("Customer segment")}</p>
                )}
              </div>
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("Cancel")}</Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? t("Saving…") : isEdit ? t("Save Changes") : t("Save as Draft")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Popup Card ─────────────────────────────────────────────────────────────────

function PopupCard({ popup, onPreview, onEdit, onDelete, onToggleActive, onStats, segments = [] }) {
  const { t } = usePreferences();
  const accent = STATUS_ACCENT[popup.status] || STATUS_ACCENT.draft;
  const isActive = popup.status === "active";
  const typeLabel = INTERACTION_TYPES.find(it => it.value === popup.interaction_type)?.label || popup.interaction_type;

  // Stats are meaningful once a pop-up is (or has been) live: active now, or its
  // scheduled run has already ended (completed). Drafts that never went live show none.
  const isCompleted = popup.end_time && new Date(popup.end_time).getTime() < Date.now();
  const canViewStats = isActive || isCompleted;

  const anonSeg = segments.find(s => s.id === popup.rules?.anonymous_segment_id);
  const custSeg = segments.find(s => s.id === popup.rules?.customer_segment_id);

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
      <div className="h-1 flex-shrink-0" style={{ background: accent }} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug truncate">{popup.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t(typeLabel)}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {popup.is_default && (
              <Badge className="bg-secondary text-muted-foreground border border-border text-[10px] h-4 px-1.5">{t("Default")}</Badge>
            )}
            <Badge className={`${STATUS_STYLE[popup.status] || STATUS_STYLE.draft} text-[10px] h-4 px-1.5 flex items-center gap-0.5`}>
              {isActive ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
              {t(isActive ? "Active" : "Draft")}
            </Badge>
          </div>
        </div>

        {(popup.start_time || popup.end_time) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="w-3 h-3 flex-shrink-0" />
            <span>
              {popup.start_time ? format(new Date(popup.start_time), "MMM d, yyyy") : "-"}
              {" → "}
              {popup.end_time ? format(new Date(popup.end_time), "MMM d, yyyy") : t("No end")}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {t("Visit:")} <strong className="text-foreground">{popup.rules?.visit ?? 3}</strong>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground">
            {t("Cap:")} <strong className="text-foreground">{popup.rules?.exit_threshold ?? 50}{t("/day")}</strong>
          </span>
          {anonSeg && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Ghost className="w-2.5 h-2.5" /> {anonSeg.name}
              </span>
            </>
          )}
          {custSeg && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Users className="w-2.5 h-2.5" /> {custSeg.name}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="px-2 py-2 border-t border-border bg-secondary/20 flex items-center flex-wrap gap-0.5">
        <Button
          variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onPreview(popup)}
        >
          <Eye className="w-3 h-3 flex-shrink-0" /> {t("Preview")}
        </Button>
        <Button
          variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(popup)}
        >
          <Pencil className="w-3 h-3 flex-shrink-0" /> {t("Edit")}
        </Button>
        {canViewStats && (
          <Button
            variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => onStats(popup)}
          >
            <BarChart2 className="w-3 h-3 flex-shrink-0" /> {t("Stats")}
          </Button>
        )}
        <Button
          variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => onToggleActive(popup)}
        >
          {isActive ? <ToggleRight className="w-3.5 h-3.5 flex-shrink-0" /> : <ToggleLeft className="w-3.5 h-3.5 flex-shrink-0" />}
          {isActive ? t("Deactivate") : t("Activate")}
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7 ml-auto flex-shrink-0 text-muted-foreground hover:text-destructive"
          title={t("Delete pop-up")}
          onClick={() => onDelete(popup.id)}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Calendar view ────────────────────────────────────────────────────────────
// Maps pop ups onto a month grid by their active dates (start_time → end_time).
// A pop up appears on every day its schedule covers, so days with 2+ pop ups
// reveal overlapping schedules. Pop ups with no dates run continuously.

const DAY_MS = 86_400_000;

function popupBounds(p) {
  return {
    start: p.start_time ? new Date(p.start_time).getTime() : null,
    end:   p.end_time   ? new Date(p.end_time).getTime()   : null,
  };
}

// A pop up is active on a given day if its window intersects that day. A missing
// start means "active from the beginning", a missing end means "active indefinitely".
function popupActiveOnDay(p, dayStartMs, dayEndMs) {
  const { start, end } = popupBounds(p);
  return (start == null || start <= dayEndMs) && (end == null || end >= dayStartMs);
}

function PopupCalendar({ popups, onPreview }) {
  const { t } = usePreferences();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const scheduled = popups.filter(p => p.start_time || p.end_time);
  const alwaysOn  = popups.filter(p => !p.start_time && !p.end_time);

  const AlwaysOnList = () => (
    alwaysOn.length > 0 && (
      <div className="border border-border rounded-lg p-3 bg-secondary/10">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {t("Always active (no dates) · runs continuously")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {alwaysOn.map(p => (
            <button
              key={p.id}
              onClick={() => onPreview(p)}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-border bg-background hover:border-foreground/40 transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${p.status === "active" ? "bg-foreground" : "bg-border"}`} />
              {p.name}
            </button>
          ))}
        </div>
      </div>
    )
  );

  const monthStart = startOfMonth(cursor);
  const monthEnd   = endOfMonth(cursor);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end:   endOfWeek(monthEnd, { weekStartsOn: 0 }),
  });
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const monthStartMs = monthStart.getTime();
  const monthEndMs   = monthEnd.getTime() + DAY_MS - 1;
  const monthCount = scheduled.filter(p => {
    const { start, end } = popupBounds(p);
    return (start ?? -Infinity) <= monthEndMs && (end ?? Infinity) >= monthStartMs;
  }).length;

  // Pack pop ups into horizontal lanes so each keeps a consistent row for the whole
  // month and renders as one continuous bar that simply wraps at week boundaries.
  const laneEnds = [];
  const laneOf = new Map();
  [...scheduled]
    .sort((a, b) => {
      const as = a.start_time ? new Date(a.start_time).getTime() : -Infinity;
      const bs = b.start_time ? new Date(b.start_time).getTime() : -Infinity;
      return as - bs;
    })
    .forEach(p => {
      const { start, end } = popupBounds(p);
      const s = start ?? -Infinity, e = end ?? Infinity;
      let lane = laneEnds.findIndex(le => le < s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); }
      else laneEnds[lane] = e;
      laneOf.set(p.id, lane);
    });

  const MAX_LANES = 4;
  const LANE_H = 18;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      {/* Month navigation + legend */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center border border-input rounded-md overflow-hidden h-8">
          <button type="button" onClick={() => setCursor(c => addMonths(c, -1))} title={t("Previous month")} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => setCursor(startOfMonth(new Date()))} title={t("Jump to current month")} className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors border-x border-input">
            {t("Today")}
          </button>
          <button type="button" onClick={() => setCursor(c => addMonths(c, 1))} title={t("Next month")} className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-sm font-semibold">{format(cursor, "MMMM yyyy")}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ml-auto">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-foreground" /> {t("Active")}</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-secondary border border-border" /> {t("Draft")}</span>
          <span className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 text-yellow-500" /> {t("Overlapping")}</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/70 -mt-2">
        {monthCount} {monthCount !== 1 ? t("pop ups") : t("pop up")} {t("active this month · a day with 2+ pop ups means overlapping schedules · click to preview")}
      </p>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/20">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center">{t(d)}</div>
          ))}
        </div>

        {weeks.map((week, wIdx) => {
          const weekStartMs = week[0].getTime();
          const weekEndMs   = week[6].getTime() + DAY_MS - 1;
          const activeThisWeek = scheduled.filter(p => {
            const { start, end } = popupBounds(p);
            return (start ?? -Infinity) <= weekEndMs && (end ?? Infinity) >= weekStartMs;
          });
          const visible  = activeThisWeek.filter(p => laneOf.get(p.id) < MAX_LANES);
          const overflow = activeThisWeek.filter(p => laneOf.get(p.id) >= MAX_LANES).length;

          return (
            <div key={wIdx} className="relative border-b border-border last:border-b-0">
              {/* Background day cells */}
              <div className="grid grid-cols-7">
                {week.map((day, di) => {
                  const inMonth = isSameMonth(day, cursor);
                  const today = isToday(day);
                  const dayActive = scheduled.filter(p => popupActiveOnDay(p, day.getTime(), day.getTime() + DAY_MS - 1)).length;
                  return (
                    <div key={di} className={`min-h-[132px] p-1.5 ${di !== 6 ? "border-r border-border" : ""} ${inMonth ? "" : "bg-secondary/20"}`}>
                      <div className="flex items-start justify-between">
                        <span className={`text-[11px] inline-flex items-center justify-center ${today ? "bg-foreground text-background rounded-full w-5 h-5 font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground/40"}`}>
                          {format(day, "d")}
                        </span>
                        {dayActive >= 2 && <AlertTriangle className="w-3 h-3 text-yellow-500" title={`${dayActive} ` + t("pop ups overlap on this day")} />}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Continuous event bars, positioned over the cells and spanning columns */}
              <div
                className="absolute inset-x-0 top-0 grid grid-cols-7 gap-x-1 px-1 pointer-events-none"
                style={{ paddingTop: 28, gridAutoRows: `${LANE_H}px`, rowGap: 3 }}
              >
                {visible.map(p => {
                  let startCol = -1, endCol = -1;
                  for (let di = 0; di < 7; di++) {
                    const ds = week[di].getTime();
                    if (popupActiveOnDay(p, ds, ds + DAY_MS - 1)) { if (startCol === -1) startCol = di; endCol = di; }
                  }
                  if (startCol === -1) return null;
                  const { start, end } = popupBounds(p);
                  const roundedLeft  = start != null && start >= week[startCol].getTime();
                  const roundedRight = end != null && end <= week[endCol].getTime() + DAY_MS - 1;
                  const isActive = p.status === "active";
                  const title = `${p.name}\n${start ? format(new Date(start), "MMM d, yyyy") : t("No start")} → ${end ? format(new Date(end), "MMM d, yyyy") : t("No end")}`;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onPreview(p)}
                      title={title}
                      className={`pointer-events-auto h-[18px] px-1.5 flex items-center overflow-hidden transition-all hover:brightness-95 ${
                        isActive ? "bg-foreground text-background" : "bg-secondary text-foreground border border-border"
                      } ${roundedLeft ? "rounded-l" : ""} ${roundedRight ? "rounded-r" : ""}`}
                      style={{ gridColumn: `${startCol + 1} / ${endCol + 2}`, gridRow: laneOf.get(p.id) + 1 }}
                    >
                      <span className="text-[10px] font-medium truncate leading-none">{p.name}</span>
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <span className="text-[10px] text-muted-foreground self-center pl-1" style={{ gridColumn: "1 / 8", gridRow: MAX_LANES + 1 }}>
                    +{overflow} {t("more")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlwaysOnList />
    </div>
  );
}

// ── Templates Tab ──────────────────────────────────────────────────────────────

function TemplatesTab({ onUseTemplate, templateFormOpen, onTemplateFormOpen, onTemplateFormClose, actionsRef }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [builderOpen, setBuilderOpen] = useState(false);    // for TemplateBuilder
  const [builderTarget, setBuilderTarget] = useState(null); // template loaded into builder
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef(null);
  const filterRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // "New Template" button in parent header opens builder
  useEffect(() => {
    if (templateFormOpen) {
      setBuilderTarget(null);
      setBuilderOpen(true);
      onTemplateFormClose();
    }
  }, [templateFormOpen]);

  useEffect(() => {
    if (actionsRef) actionsRef.current = { triggerImport: () => fileInputRef.current?.click() };
  });

  const { data: customTemplates = [], isLoading } = useQuery({
    queryKey: ["popup-templates"],
    queryFn: () => appClient.popup.listTemplates(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.popup.createTemplate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["popup-templates"] });
      setBuilderOpen(false); setBuilderTarget(null);
      onTemplateFormClose();
      toast.success(t("Template saved"));
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.popup.updateTemplate(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["popup-templates"] });
      setBuilderOpen(false); setBuilderTarget(null);
      onTemplateFormClose();
      toast.success(t("Template updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.popup.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popup-templates"] }); setDeleteTarget(null); toast.success(t("Template deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const cloneMutation = useMutation({
    mutationFn: (tpl) => appClient.popup.createTemplate({
      name: `${tpl.name} (copy)`,
      category: tpl.category,
      description: tpl.description || "",
      content: tpl.content || "",
      ...(tpl.builder_state ? { builder_state: tpl.builder_state } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popup-templates"] }); toast.success(t("Template cloned")); },
    onError: (e) => toast.error(e.message),
  });

  // Builder save - update when editing an existing template, create otherwise
  const handleBuilderSave = (data) => {
    if (builderTarget?.id) updateMutation.mutate({ id: builderTarget.id, data });
    else createMutation.mutate(data);
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      createMutation.mutate({ name: file.name.replace(/\.html?$/, ""), category: "Custom", description: "", content: ev.target.result });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Editing always opens the visual builder so any template can be completely
  // redesigned. Templates that already have builder state load their blocks;
  // HTML-only templates (e.g. imported HTML) are seeded as a single Custom HTML
  // block so their existing markup is preserved and fully editable.
  const openEdit = (tpl) => {
    if (tpl.builder_state) {
      setBuilderTarget(tpl);
    } else {
      setBuilderTarget({
        ...tpl,
        builder_state: {
          container: { ...DEFAULT_CONTAINER, background: "transparent", paddingY: "0", paddingX: "0", borderRadius: "0", shadow: false, maxWidth: "600" },
          blocks: [{ type: "html", id: "imported-html", html: tpl.content || "" }],
        },
      });
    }
    setBuilderOpen(true);
  };

  const allTemplates = [
    ...BUILTIN_TEMPLATES,
    ...customTemplates.map(tpl => ({ ...tpl, builtin: false })),
  ];
  const allCategories = [...new Set(allTemplates.map(tpl => tpl.category))].sort();
  const visible = allTemplates.filter(tpl => {
    const q = search.toLowerCase();
    const matchSearch = !q || tpl.name.toLowerCase().includes(q) || tpl.description?.toLowerCase().includes(q) || tpl.category.toLowerCase().includes(q);
    const matchCat = !categoryFilter.length || categoryFilter.includes(tpl.category);
    return matchSearch && matchCat;
  });
  const hasActiveFilters = categoryFilter.length > 0;

  const GROUPS = [
    { key: "default", label: "Default Pop Ups", filter: tpl => tpl.builtin },
    { key: "custom",  label: "Custom Pop Ups",  filter: tpl => !tpl.builtin },
  ].filter(g => visible.some(g.filter));

  return (
    <div className="px-8 py-6">
      {/* Toolbar */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("Search templates…")}
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div ref={filterRef} className="relative">
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
              <Filter className="w-3.5 h-3.5" /> {t("Filters")}
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
            </Button>
            {showFilters && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-56">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                  {hasActiveFilters && <button onClick={() => setCategoryFilter([])} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">{t("Category")}</p>
                  <MultiSelect value={categoryFilter} onChange={setCategoryFilter} options={allCategories} placeholder={t("All Categories")} />
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> {t("Import HTML")}
          </Button>
          <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImportFile} />
        </div>
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {categoryFilter.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                {t("Category:")} <strong>{v}</strong>
                <button onClick={() => setCategoryFilter(categoryFilter.filter(x => x !== v))} className="hover:text-foreground text-muted-foreground ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {isLoading && <div className="flex items-center justify-center py-20"><div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" /></div>}

      {!isLoading && visible.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <Layout className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>{t("No templates match your search.")}</p>
        </div>
      )}

      {!isLoading && visible.length > 0 && GROUPS.map(group => (
        <div key={group.key} className="mb-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {t(group.label)}
          </p>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {visible.filter(group.filter).map(tpl => (
              <TemplateCard
                key={tpl.id || tpl.name}
                template={tpl}
                onPreview={() => setPreview(tpl)}
                onUse={() => onUseTemplate(tpl)}
                onClone={() => cloneMutation.mutate(tpl)}
                onEdit={tpl.builtin ? undefined : () => openEdit(tpl)}
                onDelete={tpl.builtin ? undefined : () => setDeleteTarget(tpl.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{preview?.name} - {t("Preview")}</DialogTitle>
              <DevicePreviewToggle device={previewDevice} onChange={setPreviewDevice} className="flex-shrink-0 mr-6" />
            </div>
          </DialogHeader>
          <div className="bg-gray-50 rounded-lg p-4 max-h-[60vh] overflow-auto">
            <DevicePreviewFrame html={preview?.content} device={previewDevice} title={t("Template preview")} height={380} />
          </div>
          <div className="flex items-center justify-between pt-1">
            {preview && !preview.builtin && (
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { openEdit(preview); setPreview(null); }}>
                {t("Open in Builder")}
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>{t("Close")}</Button>
              <Button size="sm" onClick={() => { onUseTemplate(preview); setPreview(null); }}>
                {t("Use Template")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Visual Template Builder - the single editor for new templates and for
          editing/redesigning any existing template. Mounted only while open so it
          remounts fresh each time and picks up the current target's blocks. */}
      {builderOpen && (
        <TemplateBuilder
          open
          onClose={() => { setBuilderOpen(false); setBuilderTarget(null); }}
          onSave={handleBuilderSave}
          initial={builderTarget}
          isSaving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this template?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("This cannot be undone.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Template Card (shared) ─────────────────────────────────────────────────────

function TemplateCard({ template, onPreview, onUse, onEdit, onClone, onDelete }) {
  const { t } = usePreferences();
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
      <div className="h-1 flex-shrink-0 bg-gradient-to-r from-border to-muted-foreground/30" />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-semibold text-sm truncate">{template.name}</p>
          </div>
          <Badge className="bg-secondary text-secondary-foreground text-[10px] h-4 px-1.5 flex-shrink-0">
            {template.category}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
      </div>
      <div className="border-t border-border bg-secondary/20">
        {/* Labeled secondary actions */}
        <div className="px-3 pt-2 pb-1 flex items-center gap-1">
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onPreview}
          >
            <Eye className="w-3 h-3" /> {t("Preview")}
          </Button>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onClone}
          >
            <Copy className="w-3 h-3" /> {t("Clone")}
          </Button>
          {onEdit && (
            <Button
              variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              <Pencil className="w-3 h-3" /> {t("Edit")}
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto"
              onClick={onDelete}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          )}
        </div>
        {/* Primary action */}
        <div className="px-3 pb-2.5">
          <Button size="sm" className="w-full h-8 text-xs gap-1.5" onClick={onUse}>
            <Plus className="w-3 h-3" /> {t("Use Template")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Analytics Tab ──────────────────────────────────────────────────────────────

const PERF_COLUMNS = [
  { key: "name",                label: "Pop-Up Name",        align: "left",  defaultVisible: true,  filterable: true,  type: "text" },
  { key: "interaction_type",    label: "Type",               align: "left",  defaultVisible: true,  filterable: true,  type: "select", options: ["banner","modal","slide_in","notification"] },
  { key: "status",              label: "Status",             align: "left",  defaultVisible: true,  filterable: true,  type: "select", options: ["active","draft"] },
  { key: "impressions",         label: "Impressions",        align: "right", defaultVisible: true,  filterable: false },
  { key: "unique_views",        label: "Unique Views",       align: "right", defaultVisible: true,  filterable: false },
  { key: "clicks",              label: "Total Clicks",       align: "right", defaultVisible: false, filterable: false },
  { key: "ctr",                 label: "Click-Through Rate", align: "right", defaultVisible: true,  filterable: false },
  { key: "emails",              label: "Emails Collected",   align: "right", defaultVisible: true,  filterable: false },
  { key: "email_rate",          label: "Email Conv. Rate",   align: "right", defaultVisible: true,  filterable: false },
  { key: "dismissals",          label: "Dismissals",         align: "right", defaultVisible: false, filterable: false },
  { key: "dismissal_rate",      label: "Dismiss Rate",       align: "right", defaultVisible: true,  filterable: false },
  { key: "conversion_rate",     label: "Conv. Rate",         align: "right", defaultVisible: false, filterable: false },
  { key: "avg_engagement_secs", label: "Avg Engagement",     align: "right", defaultVisible: true,  filterable: false },
  { key: "segment_name",        label: "Segment",            align: "left",  defaultVisible: true,  filterable: true,  type: "text" },
  { key: "start_time",          label: "Start Date",         align: "left",  defaultVisible: false, filterable: false },
  { key: "end_time",            label: "End Date",           align: "left",  defaultVisible: false, filterable: false },
];

function AnalyticsTab() {
  const { t } = usePreferences();
  const [search, setSearch]   = useState("");
  const [filters, setFilters] = useState({});
  const [colOrder, setColOrder] = useState(() => PERF_COLUMNS.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(PERF_COLUMNS.filter(c => !c.defaultVisible).map(c => c.key)));
  const [selected, setSelected] = useState(new Set());
  const [sortKey, setSortKey]   = useState("");
  const [sortDir, setSortDir]   = useState("asc");
  // Period + compare selections persist across refresh (localStorage).
  const [dateFrom, setDateFrom] = useStickyState("", "popupAnalytics.dateFrom");
  const [dateTo,   setDateTo]   = useStickyState("", "popupAnalytics.dateTo");
  const [compare,  setCompare]  = useStickyState(false, "popupAnalytics.compare");
  const [cmpFrom,  setCmpFrom]  = useStickyState("", "popupAnalytics.cmpFrom");
  const [cmpTo,    setCmpTo]    = useStickyState("", "popupAnalytics.cmpTo");

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key, val) => { setFilters(prev => ({ ...prev, [key]: val })); setSelected(new Set()); };
  const toggleCol = (key) => setHiddenCols(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else if (colOrder.filter(k => !n.has(k)).length > 1) n.add(key); return n; });
  const moveCol   = (key, dir) => setColOrder(prev => { const idx = prev.indexOf(key); if (idx === - 1) return prev; const n = [...prev]; if (dir==="up" && idx>0) [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; else if (dir==="down" && idx<prev.length-1) [n[idx],n[idx+1]]=[n[idx+1],n[idx]]; return n; });

  // Counts are aggregated server-side over the selected range (range-accurate),
  // so the query key carries the period and refetches when it changes.
  const { data: analytics = [], isLoading: loadingAnalytics } = useQuery({
    queryKey: ["popup-analytics", dateFrom, dateTo],
    queryFn: () => appClient.popup.getAnalytics({ from: dateFrom, to: dateTo }),
  });
  // Comparison period - a parallel server query over the prev range (only when on).
  const { data: prevAnalytics = [] } = useQuery({
    queryKey: ["popup-analytics", cmpFrom, cmpTo],
    queryFn: () => appClient.popup.getAnalytics({ from: cmpFrom, to: cmpTo }),
    enabled: compare && !!(cmpFrom || cmpTo),
  });

  const formatSecs = (secs) => {
    if (!secs) return "-";
    const s = Number(secs);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  };

  const pct = (num, denom) => denom > 0 ? ((num / denom) * 100).toFixed(1) : "0.0";


  const matchesNonDate = (p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      if (String(p[key] ?? "").toLowerCase() !== val.toLowerCase()) return false;
    }
    return true;
  };
  // Date range is applied server-side; here we only apply search / column filters.
  const filtered = analytics.filter(matchesNonDate);

  const sumTotals = (rows) => rows.reduce((acc, p) => ({
    impressions: acc.impressions + Number(p.impressions || 0),
    unique_views: acc.unique_views + Number(p.unique_views || 0),
    clicks: acc.clicks + Number(p.clicks || 0),
    emails: acc.emails + Number(p.emails || 0),
    dismissals: acc.dismissals + Number(p.dismissals || 0),
  }), { impressions: 0, unique_views: 0, clicks: 0, emails: 0, dismissals: 0 });
  const avgEng = (rows) => {
    const r = rows.filter(p => Number(p.avg_engagement_secs) > 0);
    return r.length ? r.reduce((s, p) => s + Number(p.avg_engagement_secs), 0) / r.length : null;
  };

  // Totals derived from filtered set so KPI tiles respect the date range
  const totals = sumTotals(filtered);
  const avgEngSecs = avgEng(filtered);

  // Comparison totals from the prev-range server query (same search/col filters).
  const prevFiltered = compare ? prevAnalytics.filter(matchesNonDate) : [];
  const pTotals = sumTotals(prevFiltered);
  const pAvgEng = avgEng(prevFiltered);
  const pctN = (num, denom) => (denom > 0 ? (num / denom) * 100 : 0);

  const visibleColDefs = colOrder.filter(k => !hiddenCols.has(k)).map(k => PERF_COLUMNS.find(c => c.key === k)).filter(Boolean);

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    let av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; if (bv == null) return - 1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : - cmp;
  });

  // Selection helpers
  const allFilteredIds  = sortedFiltered.map(p => p.id);
  const allSelected     = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));
  const someSelected    = allFilteredIds.some(id => selected.has(id));
  const toggleRow       = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll       = () => {
    if (allSelected) setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.delete(id)); return n; });
    else             setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.add(id)); return n; });
  };

  const buildCsv = (rows) => {
    const header = visibleColDefs.map(c => c.label).join(",");
    const body = rows.map(p => visibleColDefs.map(c => {
      let v = "";
      if (c.key === "avg_engagement_secs") v = formatSecs(p[c.key]);
      else if (c.key === "start_time" || c.key === "end_time") v = p[c.key] ? format(new Date(p[c.key]), "MMM d, yyyy") : "";
      else v = String(p[c.key] ?? "");
      return v.includes(",") ? `"${v}"` : v;
    }).join(",")).join("\n");
    return `${header}\n${body}`;
  };

  const exportCsv = (onlySelected = false) => {
    const rows = onlySelected ? filtered.filter(p => selected.has(p.id)) : filtered;
    if (!rows.length) return;
    const blob = new Blob([buildCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = onlySelected ? "popup-performance-selected.csv" : "popup-performance.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const renderCell = (col, p) => {
    switch (col.key) {
      case "name": return (
        <td key={col.key} className={`px-4 py-3 font-medium ${col.width}`}>
          <p className="truncate max-w-[220px]">{p.name}</p>
          {Number(p.emails) > 0 && <p className="text-[10px] text-muted-foreground">{t("- Emails Collected tab")}</p>}
        </td>
      );
      case "interaction_type": return (
        <td key={col.key} className={`px-4 py-3 text-xs text-muted-foreground capitalize ${col.width}`}>
          {(p.interaction_type || "").replace(/_/g, " ")}
        </td>
      );
      case "status": return (
        <td key={col.key} className={`px-4 py-3 text-xs text-muted-foreground capitalize ${col.width}`}>{p.status || "-"}</td>
      );
      case "impressions": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{Number(p.impressions || 0).toLocaleString()}</td>;
      case "unique_views": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{Number(p.unique_views || 0).toLocaleString()}</td>;
      case "clicks": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{Number(p.clicks || 0).toLocaleString()}</td>;
      case "ctr": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{p.ctr ?? "0.0"}%</td>;
      case "emails": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{Number(p.emails || 0).toLocaleString()}</td>;
      case "email_rate": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{p.email_rate ?? "0.0"}%</td>;
      case "dismissals": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{Number(p.dismissals || 0).toLocaleString()}</td>;
      case "dismissal_rate": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{p.dismissal_rate ?? "0.0"}%</td>;
      case "conversion_rate": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{p.conversion_rate ?? "0.0"}%</td>;
      case "avg_engagement_secs": return <td key={col.key} className={`px-4 py-3 text-right tabular-nums text-muted-foreground ${col.width}`}>{formatSecs(p.avg_engagement_secs)}</td>;
      case "segment_name": return <td key={col.key} className={`px-4 py-3 text-xs text-muted-foreground ${col.width}`}>{p.segment_name || "-"}</td>;
      case "start_time": return <td key={col.key} className={`px-4 py-3 text-xs text-muted-foreground ${col.width}`}>{p.start_time ? format(new Date(p.start_time), "MMM d, yyyy") : "-"}</td>;
      case "end_time": return <td key={col.key} className={`px-4 py-3 text-xs text-muted-foreground ${col.width}`}>{p.end_time ? format(new Date(p.end_time), "MMM d, yyyy") : "-"}</td>;
      default: return <td key={col.key} />;
    }
  };

  if (loadingAnalytics) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-8 py-6 space-y-6">

      {/* ── Date period + compare bar (shared AnalyticsKit) ── */}
      <DateRangeBar
        t={t}
        from={dateFrom} to={dateTo}
        onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
        compare={compare} setCompare={setCompare}
        compareRange={{ from: cmpFrom, to: cmpTo }}
        onCompareChange={({ from, to }) => { setCmpFrom(from); setCmpTo(to); }}
        note={(dateFrom || dateTo)
          ? `${filtered.length} ${filtered.length !== 1 ? t("pop-ups") : t("pop-up")} · ${totals.impressions.toLocaleString()} ${t("impressions in range")}`
          : undefined}
      />

      {/* ── KPI tiles (shared AnalyticsKit) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile label={t("Total Impressions")} value={totals.impressions.toLocaleString()}
          sub={`${totals.unique_views.toLocaleString()} ${t("unique views")}`} icon={Eye}
          curr={compare ? totals.impressions : undefined} prev={compare ? pTotals.impressions : undefined}
          prevDisplay={pTotals.impressions.toLocaleString()} />
        <KpiTile label={t("Click-Through Rate")} value={`${pct(totals.clicks, totals.impressions)}%`}
          sub={`${totals.clicks.toLocaleString()} ${t("total clicks")}`} icon={MousePointer2}
          curr={compare ? pctN(totals.clicks, totals.impressions) : undefined}
          prev={compare ? pctN(pTotals.clicks, pTotals.impressions) : undefined}
          prevDisplay={`${pct(pTotals.clicks, pTotals.impressions)}%`} isRate />
        <KpiTile label={t("Email Conversion")} value={`${pct(totals.emails, totals.impressions)}%`}
          sub={`${totals.emails.toLocaleString()} ${t("emails collected")}`} icon={Mail}
          curr={compare ? pctN(totals.emails, totals.impressions) : undefined}
          prev={compare ? pctN(pTotals.emails, pTotals.impressions) : undefined}
          prevDisplay={`${pct(pTotals.emails, pTotals.impressions)}%`} isRate />
        <KpiTile label={t("Avg Engagement Time")} value={formatSecs(avgEngSecs)}
          sub={`${pct(totals.dismissals, totals.impressions)}% ${t("close rate")}`} icon={Clock}
          curr={compare && avgEngSecs != null ? avgEngSecs : undefined}
          prev={compare && pAvgEng != null ? pAvgEng : undefined}
          prevDisplay={formatSecs(pAvgEng)} />
      </div>

      {/* Per-popup performance table (or empty state when there's no pop-up data at all) */}
      {analytics.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">{t("No pop ups yet")}</p>
          <p className="text-xs">{t("Create a pop-up to see analytics here.")}</p>
        </div>
      ) : (
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("Per Pop-Up Performance")}</p>
        <TableToolbar
          search={search} onSearch={v => { setSearch(v); setSelected(new Set()); }}
          columns={PERF_COLUMNS} colOrder={colOrder} hiddenCols={hiddenCols}
          onToggleCol={toggleCol} onMoveCol={moveCol}
          filters={filters} onFilter={setFilter}
          resultCount={filtered.length} totalCount={analytics.length}
          placeholder={t("Search by name...")}
        />

        {/* Selection toolbar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
            <span className="font-medium text-sm flex-shrink-0">{selected.size} {t("selected")}</span>
            <div className="flex items-center gap-1 ml-2">
              <Button
                size="sm" variant="secondary"
                className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                onClick={() => exportCsv(true)}
              >
                {t("Export CSV")}
              </Button>
            </div>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0"
            >
              {t("Clear")}
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="border border-border rounded-lg py-12 text-center text-sm text-muted-foreground">
            <BarChart2 className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p>{t("No pop ups match your filters.")}</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                    />
                  </th>
                  {visibleColDefs.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {t(col.label)}
                        {sortKey === col.key
                          ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map(p => {
                  const isSelected = selected.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-border last:border-0 cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/10"}`}
                      onClick={() => toggleRow(p.id)}
                    >
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={isSelected}
                          onChange={() => toggleRow(p.id)}
                        />
                      </td>
                      {visibleColDefs.map(col => renderCell(col, p))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          {t("Emails submitted via pop-up forms are accessible in the Emails Collected tab.")}
        </p>
      </div>
      )}
    </div>
  );
}

// ── Emails Tab ─────────────────────────────────────────────────────────────────

const EMAIL_STATUS_STYLES = {
  new:          "bg-secondary text-foreground border border-border",
  contacted:    "bg-secondary text-foreground border border-border",
  converted:    "bg-foreground text-background",
  unsubscribed: "bg-muted text-muted-foreground opacity-60",
};

const PEC_COLUMNS = [
  { key: "email",        label: "Email",        filterable: false, defaultVisible: true },
  { key: "name",         label: "Name",         filterable: false, defaultVisible: true },
  { key: "phone",        label: "Phone",        filterable: true,  defaultVisible: true,  type: "text" },
  { key: "popup_name",   label: "Pop-Up",       filterable: true,  defaultVisible: true,  type: "text" },
  { key: "source_url",   label: "Source URL",   filterable: true,  defaultVisible: true,  type: "text" },
  { key: "page_title",   label: "Page Title",   filterable: true,  defaultVisible: false, type: "text" },
  { key: "device_type",  label: "Device",       filterable: true,  defaultVisible: true,  type: "select", options: ["desktop","mobile","tablet"] },
  { key: "browser",      label: "Browser",      filterable: true,  defaultVisible: true,  type: "text" },
  { key: "os",           label: "OS",           filterable: true,  defaultVisible: false, type: "text" },
  { key: "country",      label: "Country",      filterable: true,  defaultVisible: true,  type: "text" },
  { key: "city",         label: "City",         filterable: true,  defaultVisible: false, type: "text" },
  { key: "visitor_id",   label: "Visitor ID",   filterable: false, defaultVisible: false },
  { key: "utm_source",   label: "UTM Source",   filterable: true,  defaultVisible: true,  type: "text" },
  { key: "utm_medium",   label: "UTM Medium",   filterable: true,  defaultVisible: false, type: "text" },
  { key: "utm_campaign", label: "UTM Campaign", filterable: true,  defaultVisible: true,  type: "text" },
  { key: "utm_term",     label: "UTM Term",     filterable: true,  defaultVisible: false, type: "text" },
  { key: "utm_content",  label: "UTM Content",  filterable: true,  defaultVisible: false, type: "text" },
  { key: "status",       label: "Status",       filterable: true,  defaultVisible: true,  type: "select", options: ["new","contacted","converted","unsubscribed"] },
  { key: "collected_at", label: "Collected At", filterable: false, defaultVisible: true },
];

const EMAIL_STATUS_OPTIONS = ["new", "contacted", "converted", "unsubscribed"];

function EmailsTab({ popups }) {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [search, setSearch]   = useState("");
  const [filters, setFilters] = useState({});
  const [colOrder, setColOrder] = useState(() => PEC_COLUMNS.map(c => c.key));
  const [hiddenCols, setHiddenCols] = useState(() => new Set(PEC_COLUMNS.filter(c => !c.defaultVisible).map(c => c.key)));
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [profileBulkTarget, setProfileBulkTarget] = useState(null); // array of records
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("contacted");
  const PAGE_SIZE = 25;

  const createProfileMutation = useMutation({
    mutationFn: async (records) => {
      const results = [];
      for (const r of records) {
        if (r.profile_created) continue;
        const res = await appClient.popup.createProfile(r.id);
        results.push(res);
      }
      return results;
    },
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["popup-email-collected"] });
      setProfileBulkTarget(null);
      setSelected(new Set());
      const created = results.filter(r => r.action === "created").length;
      const linked  = results.filter(r => r.action === "linked").length;
      const parts = [];
      if (created) parts.push(`${created} ` + (created > 1 ? t("profiles created") : t("profile created")));
      if (linked)  parts.push(`${linked} ` + t("linked to existing"));
      toast.success(parts.join(", ") || t("Done"));
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => appClient.popup.bulkUpdateStatus(ids, status),
    onSuccess: (_, { ids, status }) => {
      qc.invalidateQueries({ queryKey: ["popup-email-collected"] });
      setBulkStatusOpen(false);
      setSelected(new Set());
      toast.success(`${ids.length} ` + (ids.length > 1 ? t("records") : t("record")) + " " + t("updated to") + ` "${status}"`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [sortKey, setSortKey]   = useState("");
  const [sortDir, setSortDir]   = useState("asc");
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const setFilter = (key, val) => { setFilters(prev => ({ ...prev, [key]: val })); setPage(1); setSelected(new Set()); };

  const toggleCol = (key) => setHiddenCols(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else if (colOrder.filter(k => !next.has(k)).length > 1) next.add(key);
    return next;
  });

  const moveCol = (key, dir) => setColOrder(prev => {
    const idx = prev.indexOf(key);
    if (idx === - 1) return prev;
    const next = [...prev];
    if (dir === "up" && idx > 0) [next[idx-1], next[idx]] = [next[idx], next[idx-1]];
    else if (dir === "down" && idx < prev.length-1) [next[idx], next[idx+1]] = [next[idx+1], next[idx]];
    return next;
  });

  const visibleCols = colOrder.filter(k => !hiddenCols.has(k)).map(k => PEC_COLUMNS.find(c => c.key === k)).filter(Boolean);

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Build API params from search + filters
  const apiParams = {
    search: search || undefined,
    status: filters.status || undefined,
    device_type: filters.device_type || undefined,
    browser: filters.browser || undefined,
    country: filters.country || undefined,
    utm_source: filters.utm_source || undefined,
    utm_campaign: filters.utm_campaign || undefined,
    popup_name: filters.popup_name || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["popup-email-collected", apiParams],
    queryFn: () => appClient.popup.getEmailCollected(apiParams),
  });

  const rows  = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Selection helpers - depend on rows so must come after useQuery
  const allPageIds = rows.map(r => r.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const somePageSelected = allPageIds.some(id => selected.has(id));
  const toggleAllPage = () => {
    if (allPageSelected) {
      setSelected(prev => { const next = new Set(prev); allPageIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => { const next = new Set(prev); allPageIds.forEach(id => next.add(id)); return next; });
    }
  };

  const getCellVal = (r, key) => {
    if (key === "name") return `${r.first_name || ""} ${r.last_name || ""}`.trim();
    if (key === "source_url") return r.source_url ? r.source_url.replace(/^https?:\/\/[^/]+/, "") || "/" : "";
    return r[key] ?? "";
  };

  const buildCsv = (exportRows) => {
    const header = visibleCols.map(c => c.label).join(",");
    const body = exportRows.map(r => visibleCols.map(c => {
      const v = String(getCellVal(r, c.key));
      return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",")).join("\n");
    return `${header}\n${body}`;
  };

  const handleExport = async () => {
    // If rows are selected, export only those
    if (selected.size > 0 && rows.length > 0) {
      const selectedRows = rows.filter(r => selected.has(r.id));
      if (!selectedRows.length) return;
      const blob = new Blob([buildCsv(selectedRows)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "emails-collected-selected.csv";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      return;
    }
    // Otherwise export all matching filters
    const exportData = await appClient.popup.exportEmailCollected({
      search: search || undefined,
      ...Object.fromEntries(Object.entries(filters).filter(([,v]) => v)),
    });
    const exportRows = exportData?.data || [];
    if (!exportRows.length) return;
    const blob = new Blob([buildCsv(exportRows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "emails-collected.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const columnsWithPopupOptions = PEC_COLUMNS.map(c =>
    c.key === "popup_name" ? { ...c, options: popups.length ? popups.map(p => p.name) : undefined } : c
  );

  const selectedRows = (rows || []).filter(r => selected.has(r.id));
  const canCreateProfile = selectedRows.some(r => !r.profile_created);

  return (
    <div className="px-8 py-6">
      <TableToolbar
        search={search}
        onSearch={v => { setSearch(v); setPage(1); setSelected(new Set()); }}
        columns={columnsWithPopupOptions}
        colOrder={colOrder}
        hiddenCols={hiddenCols}
        onToggleCol={toggleCol}
        onMoveCol={moveCol}
        filters={filters}
        onFilter={setFilter}
        resultCount={total}
        totalCount={total}
        placeholder={t("Search email, name, URL...")}
      />

      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-foreground text-background rounded-lg text-sm">
          <span className="font-medium text-sm flex-shrink-0">{selected.size} {t("selected")}</span>
          <div className="flex items-center gap-1 ml-2 flex-wrap">
            {canCreateProfile && (
              <Button
                size="sm" variant="secondary"
                className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
                onClick={() => setProfileBulkTarget(selectedRows.filter(r => !r.profile_created))}
                disabled={createProfileMutation.isPending}
              >
                {t("Create Profiles")} ({selectedRows.filter(r => !r.profile_created).length})
              </Button>
            )}
            <Button
              size="sm" variant="secondary"
              className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
              onClick={() => setBulkStatusOpen(true)}
            >
              {t("Update Status")}
            </Button>
            <Button
              size="sm" variant="secondary"
              className="h-7 text-xs gap-1.5 bg-background/10 text-background hover:bg-background/20 border-0"
              onClick={handleExport}
            >
              {t("Export CSV")}
            </Button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-background/70 hover:text-background text-xs flex-shrink-0"
          >
            {t("Clear")}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>{t("No emails collected yet.")}</p>
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={allPageSelected}
                      ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                      onChange={toggleAllPage}
                    />
                  </th>
                  {visibleCols.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        {t(col.label)}
                        {sortKey === col.key
                          ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => {
                  if (!sortKey) return 0;
                  let av = a[sortKey], bv = b[sortKey];
                  if (av == null && bv == null) return 0;
                  if (av == null) return 1; if (bv == null) return - 1;
                  const cmp = String(av).localeCompare(String(bv));
                  return sortDir === "asc" ? cmp : - cmp;
                }).map(r => {
                  const isSelected = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-border last:border-0 cursor-pointer ${isSelected ? "bg-secondary/30" : "hover:bg-secondary/10"}`}
                      onClick={() => toggleRow(r.id)}
                    >
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={isSelected}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                      {visibleCols.map(col => {
                        switch (col.key) {
                          case "email":        return <td key={col.key} className="px-4 py-3"><p className="text-sm font-mono truncate max-w-[200px]">{r.email}</p>{r.profile_created && <p className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" />{r.profile_lineage?.matched_existing ? t("Linked") : t("Profile created")}</p>}</td>;
                          case "name":         return <td key={col.key} className="px-4 py-3 text-sm min-w-[120px]">{r.first_name || r.last_name ? `${r.first_name || ""} ${r.last_name || ""}`.trim() : <span className="text-muted-foreground">-</span>}</td>;
                          case "phone":        return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{r.phone || "-"}</td>;
                          case "popup_name":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground max-w-[140px] truncate">{r.popup_name || "-"}</td>;
                          case "source_url":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate" title={r.source_url}>{r.source_url ? r.source_url.replace(/^https?:\/\/[^/]+/, "") || "/" : "-"}</td>;
                          case "page_title":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground max-w-[140px] truncate">{r.page_title || "-"}</td>;
                          case "device_type":  return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground capitalize">{r.device_type || "-"}</td>;
                          case "browser":      return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.browser || "-"}</td>;
                          case "os":           return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.os || "-"}</td>;
                          case "country":      return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.country || "-"}</td>;
                          case "city":         return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.city || "-"}</td>;
                          case "visitor_id":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground font-mono">{r.visitor_id || "-"}</td>;
                          case "utm_source":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground">{r.utm_source || "-"}</td>;
                          case "utm_medium":   return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground">{r.utm_medium || "-"}</td>;
                          case "utm_campaign": return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{r.utm_campaign || "-"}</td>;
                          case "utm_term":     return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground">{r.utm_term || "-"}</td>;
                          case "utm_content":  return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground">{r.utm_content || "-"}</td>;
                          case "status":       return <td key={col.key} className="px-4 py-3"><span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${EMAIL_STATUS_STYLES[r.status] || EMAIL_STATUS_STYLES.new}`}>{r.status || "new"}</span></td>;
                          case "collected_at": return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.collected_at ? format(new Date(r.collected_at), "MMM d, yyyy HH:mm") : "-"}</td>;
                          default:             return <td key={col.key} className="px-4 py-3 text-xs text-muted-foreground">{String(r[col.key] ?? "-")}</td>;
                        }
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground">{t("Page")} {page} {t("of")} {totalPages} ({total.toLocaleString()} {t("total")})</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t("Previous")}</Button>
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t("Next")}</Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bulk Create Profiles dialog */}
      <AlertDialog open={!!profileBulkTarget} onOpenChange={(o) => !o && setProfileBulkTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Create Profiles for")} {profileBulkTarget?.length} {profileBulkTarget?.length !== 1 ? t("Emails") : t("Email")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5 space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{t("What happens for each email:")}</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    <li>{t("If the email matches an existing customer - it will be")} <strong>{t("linked")}</strong> {t("to that profile with a popup lineage tag.")}</li>
                    <li>{t("If the email is new - a")} <strong>{t("new customer profile")}</strong> {t("will be created, tagged with")} <code>source: popup_email_collection</code> {t("and the originating popup's details.")}</li>
                  </ul>
                </div>
                <p className="text-[11px] text-muted-foreground">{t("All profiles are traceable back to the popup that captured the email.")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => createProfileMutation.mutate(profileBulkTarget)}
              disabled={createProfileMutation.isPending}
            >
              {createProfileMutation.isPending ? t("Creating…") : t("Create") + ` ${profileBulkTarget?.length} ` + (profileBulkTarget?.length !== 1 ? t("Profiles") : t("Profile"))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Update Status dialog */}
      <Dialog open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("Update Status for")} {selected.size} {selected.size !== 1 ? t("Records") : t("Record")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">{t("Choose the new status to apply to all selected emails.")}</p>
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-input rounded-md text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              {EMAIL_STATUS_OPTIONS.map(s => (
                <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setBulkStatusOpen(false)}>{t("Cancel")}</Button>
            <Button
              size="sm"
              onClick={() => bulkStatusMutation.mutate({ ids: [...selected], status: bulkStatus })}
              disabled={bulkStatusMutation.isPending}
            >
              {bulkStatusMutation.isPending ? t("Updating…") : t("Apply")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PopUp() {
  const { t } = usePreferences();
  const qc = useQueryClient();
  const [tab, setTab] = useState("popups");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [initialContent, setInitialContent] = useState("");
  const [initialTemplateId, setInitialTemplateId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [statsTarget, setStatsTarget] = useState(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const templateActionsRef = useRef(null);

  // pop ups search + filter
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [popupView, setPopupView] = useState("grid"); // "grid" | "calendar"
  const [groupByStatus, setGroupByStatus] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroupCollapse = (k) => setCollapsedGroups(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const [sortBy, setSortBy] = useStickyState("date", "popup.sortBy");   // "date" | "name" | "status"
  const [sortDir, setSortDir] = useStickyState("desc", "popup.sortDir");
  const [filters, setFilters] = useState({ status: [], interaction_type: [], is_default: "" });
  const setPopupFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const popupFilterRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.target.closest?.("[data-multiselect-popover]")) return; if (popupFilterRef.current && !popupFilterRef.current.contains(e.target)) setShowFilters(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: popups = [], isLoading } = useQuery({
    queryKey: ["popups"],
    queryFn: () => appClient.popup.list(),
  });

  const { data: allSegments = [] } = useQuery({
    queryKey: ["segments-all"],
    queryFn: () => appClient.entities.Segment.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.popup.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); setFormOpen(false); toast.success(t("Pop-up created")); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.popup.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["popups"] });
      setEditTarget(null);
      setFormOpen(false);
      toast.success(t("Pop-up updated"));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.popup.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); setDeleteTarget(null); toast.success(t("Pop-up deleted")); },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => appClient.popup.update(id, { is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); toast.success(t("Pop-up updated")); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (data) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data });
    else createMutation.mutate(data);
  };

  const openCreate = (content = "", templateId = "") => { setEditTarget(null); setInitialContent(content); setInitialTemplateId(templateId); setFormOpen(true); };
  const openEdit   = (p) => { setEditTarget(p); setInitialContent(""); setInitialTemplateId(""); setFormOpen(true); };

  const handleUseTemplate = (template) => { setTab("popups"); openCreate(template.content || "", template.id || ""); };

  const hasActiveFilters = filters.status.length > 0 || filters.interaction_type.length > 0 || !!filters.is_default;

  const filtered = popups.filter(p => {
    const q = search.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (filters.status.length && !filters.status.includes(p.status)) return false;
    if (filters.interaction_type.length && !filters.interaction_type.includes(p.interaction_type)) return false;
    if (filters.is_default === "yes" && !p.is_default) return false;
    if (filters.is_default === "no" && p.is_default) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Pop Up")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("Create and manage pop ups served to visitors through your WordPress plugin.")}
            </p>
          </div>
          {tab === "popups" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => openCreate()}>
              <Plus className="w-3.5 h-3.5" /> {t("New Pop Up")}
            </Button>
          )}
          {tab === "templates" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setTemplateFormOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> {t("New Template")}
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(tabDef => {
            const Icon = tabDef.icon;
            return (
              <button
                key={tabDef.key}
                onClick={() => setTab(tabDef.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === tabDef.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tabDef.label)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0">

        {/* ── Pop Ups tab ── */}
        {tab === "popups" && (
          <div className="px-8 py-6">
            {/* Search + filter */}
            <div className="mb-6">
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t("Search pop ups…")}
                    className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div ref={popupFilterRef} className="relative">
                  <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
                    <Filter className="w-3.5 h-3.5" /> {t("Filters")}
                    {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground flex-shrink-0" />}
                  </Button>
                  {showFilters && (
                    <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-border rounded-lg shadow-lg p-4 w-80 md:w-[480px]">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{t("Filter by")}</p>
                        {hasActiveFilters && (
                          <button onClick={() => setFilters({ status: [], interaction_type: [], is_default: "" })} className="text-[11px] text-muted-foreground hover:text-foreground">{t("Clear all")}</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">{t("Status")}</p>
                          <MultiSelect value={filters.status} onChange={v => setPopupFilter("status", v)}
                            options={["active","draft"]} placeholder={t("All")} />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">{t("Type")}</p>
                          <MultiSelect value={filters.interaction_type} onChange={v => setPopupFilter("interaction_type", v)}
                            options={[{ value: "banner", label: t("Banner") }, { value: "modal", label: t("Modal") }, { value: "slide_in", label: t("Slide-in") }, { value: "notification", label: t("Notification") }]} placeholder={t("All")} />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-1">{t("Default Pop-Up")}</p>
                          <select value={filters.is_default} onChange={e => setPopupFilter("is_default", e.target.value)}
                            className="w-full h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                            <option value="">{t("All")}</option>
                            <option value="yes">{t("Default only")}</option>
                            <option value="no">{t("Non-default only")}</option>
                          </select>
                        </div>
                      </div>

                      {/* Sort */}
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Sort by")}</p>
                        <div className="flex items-center gap-2">
                          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                            className="flex-1 h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground">
                            <option value="date">{t("Date")}</option>
                            <option value="name">{t("Name")}</option>
                            <option value="status">{t("Status")}</option>
                          </select>
                          <button type="button" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                            className="h-8 px-2.5 flex items-center gap-1 border border-input rounded-md text-xs text-muted-foreground hover:text-foreground">
                            {sortDir === "asc" ? <><ArrowUp className="w-3.5 h-3.5" /> {t("Asc")}</> : <><ArrowDown className="w-3.5 h-3.5" /> {t("Desc")}</>}
                          </button>
                        </div>
                      </div>
                      {popupView === "grid" && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("Group by")}</p>
                          <label className="flex items-center justify-between cursor-pointer">
                            <span className="text-xs text-muted-foreground">{t("Status")}</span>
                            <input type="checkbox" checked={groupByStatus} onChange={e => setGroupByStatus(e.target.checked)}
                              className="rounded border-border cursor-pointer" />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* View toggle: grid / calendar */}
                <div className="flex items-center border border-input rounded-md overflow-hidden h-9">
                  <button
                    type="button"
                    onClick={() => setPopupView("grid")}
                    className={`h-9 px-2.5 flex items-center gap-1.5 text-xs transition-colors ${popupView === "grid" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" /> {t("Grid")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPopupView("calendar")}
                    className={`h-9 px-2.5 flex items-center gap-1.5 text-xs border-l border-input transition-colors ${popupView === "calendar" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Calendar className="w-3.5 h-3.5" /> {t("Calendar")}
                  </button>
                </div>
              </div>
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(filters).filter(([, v]) => v).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      {k.replace(/_/g, " ")}: <strong>{v}</strong>
                      <button onClick={() => setPopupFilter(k, "")} className="hover:text-foreground text-muted-foreground ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Always-available guide so teammates who join later can still learn the page. */}
            {!isLoading && popups.length > 0 && (
              <PageGuide
                storageKey="guide.popups"
                title={t("How pop ups work")}
                intro={t("Pop ups are on-site messages shown to visitors as they browse your website - served automatically by your WordPress plugin. Use them to greet, convert, or collect details from the right people at the right moment.")}
                uses={[
                  { icon: Users, title: t("Target an audience"), desc: t("Show a pop up only to visitors in a chosen segment - or to everyone.") },
                  { icon: Mail, title: t("Capture emails"), desc: t("Collect email addresses and grow your contactable audience.") },
                  { icon: BarChart2, title: t("Measure impact"), desc: t("Track impressions and clicks to see what actually converts.") },
                ]}
                footer={t("Start from a ready-made template, or build your own from scratch - then target a segment and publish.")}
              />
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
              </div>
            )}

            {/* Truly empty - full get-started explainer */}
            {!isLoading && popups.length === 0 && (
              <div className="border border-dashed border-border rounded-lg p-8 max-w-2xl mx-auto space-y-6">
                {/* What a pop up is */}
                <div className="text-center space-y-2">
                  <MousePointer2 className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
                  <p className="text-base font-semibold text-foreground">{t("Get started with pop ups")}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-lg mx-auto">
                    {t("Pop ups are on-site messages shown to visitors as they browse your website - served automatically by your WordPress plugin. Use them to greet, convert, or collect details from the right people at the right moment.")}
                  </p>
                </div>

                {/* What you can do with them */}
                <div className="rounded-lg bg-secondary/30 p-4 space-y-3">
                  <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" /> {t("What you can do with pop ups")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                    {[
                      [Users, t("Target an audience"), t("Show a pop up only to visitors in a chosen segment - or to everyone.")],
                      [Mail, t("Capture emails"), t("Collect email addresses and grow your contactable audience.")],
                      [BarChart2, t("Measure impact"), t("Track impressions and clicks to see what actually converts.")],
                    ].map(([Icon, title, desc]) => (
                      <div key={title} className="space-y-1">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <p className="text-xs font-medium text-foreground">{title}</p>
                        <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* How to start */}
                <div className="border-t border-border pt-4 text-center space-y-3">
                  <p className="text-xs text-muted-foreground">{t("Start from a ready-made template, or build your own from scratch - then target a segment and publish.")}</p>
                  <div className="flex items-center justify-center gap-2">
                    <Button size="sm" className="gap-1.5 h-9" onClick={() => openCreate()}>
                      <Plus className="w-3.5 h-3.5" /> {t("New Pop Up")}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => setTab("templates")}>
                      <Layout className="w-3.5 h-3.5" /> {t("Browse Templates")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Have pop ups, but filters/search hide them all */}
            {!isLoading && popups.length > 0 && filtered.length === 0 && (
              <div className="text-center py-20 text-sm text-muted-foreground">
                <MousePointer2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium text-foreground mb-1">{t("No pop ups match your search or filters")}</p>
                <p className="text-xs">{t("Try adjusting or clearing them to see your pop ups.")}</p>
              </div>
            )}

            {!isLoading && filtered.length > 0 && popupView === "calendar" && (
              <PopupCalendar popups={filtered} onPreview={(popup) => setPreviewTarget(popup)} />
            )}

            {!isLoading && filtered.length > 0 && popupView === "grid" && (() => {
              const GROUPS = [
                { key: "draft",  label: "Drafts",  filter: p => p.status === "draft"  },
                { key: "active", label: "Active",  filter: p => p.status === "active" },
              ].filter(g => filtered.some(g.filter));
              const displayGroups = groupByStatus ? GROUPS : [{ key: "all", label: "All", filter: () => true }];
              const sortGet = { date: p => p.created_date || "", name: p => (p.name || "").toLowerCase(), status: p => p.status || "" }[sortBy];
              const sortedAsc = sortGet ? [...filtered].sort((a, b) => { const av = sortGet(a), bv = sortGet(b); return av < bv ? -1 : av > bv ? 1 : 0; }) : filtered;
              const sorted = sortDir === "asc" ? sortedAsc : [...sortedAsc].reverse();
              const allGroupsCollapsed = groupByStatus && GROUPS.length > 0 && GROUPS.every(g => collapsedGroups.has(g.key));
              const toggleAllGroups = () => setCollapsedGroups(allGroupsCollapsed ? new Set() : new Set(GROUPS.map(g => g.key)));
              return (
                <>
                {groupByStatus && GROUPS.length > 1 && (
                  <div className="flex justify-end mb-3">
                    <button onClick={toggleAllGroups} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                      {allGroupsCollapsed ? <ChevronsUpDown className="w-3.5 h-3.5" /> : <ChevronsDownUp className="w-3.5 h-3.5" />}
                      {allGroupsCollapsed ? t("Expand all") : t("Collapse all")}
                    </button>
                  </div>
                )}
                {displayGroups.map(group => (
                <div key={group.key} className="mb-8">
                  {groupByStatus && (
                    <button onClick={() => toggleGroupCollapse(group.key)} className="flex items-center gap-1.5 mb-3 group/h">
                      {collapsedGroups.has(group.key) ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide group-hover/h:text-foreground">{t(group.label)}</span>
                    </button>
                  )}
                  {!(groupByStatus && collapsedGroups.has(group.key)) && (
                  <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                    {sorted.filter(group.filter).map(p => (
                      <PopupCard
                        key={p.id}
                        popup={p}
                        segments={allSegments}
                        onPreview={(popup) => setPreviewTarget(popup)}
                        onEdit={openEdit}
                        onStats={(popup) => setStatsTarget(popup)}
                        onDelete={(id) => setDeleteTarget(id)}
                        onToggleActive={(popup) => toggleMutation.mutate({ id: popup.id, is_active: !popup.is_active })}
                      />
                    ))}
                  </div>
                  )}
                </div>
                ))}
                </>
              );
            })()}
          </div>
        )}

        {tab === "templates" && (
          <TemplatesTab
            onUseTemplate={handleUseTemplate}
            templateFormOpen={templateFormOpen}
            onTemplateFormOpen={() => setTemplateFormOpen(true)}
            onTemplateFormClose={() => setTemplateFormOpen(false)}
            actionsRef={templateActionsRef}
          />
        )}

        {tab === "analytics" && <AnalyticsTab />}
        {tab === "emails"    && <EmailsTab popups={popups} />}
      </div>

      {/* Create / Edit popup dialog - mounted only while open so it always opens
          fresh with the right initial content / selected template. */}
      {formOpen && (
        <PopupFormDialog
          open
          onClose={() => { setFormOpen(false); setEditTarget(null); setInitialContent(""); setInitialTemplateId(""); }}
          onSave={handleSave}
          initial={editTarget}
          isSaving={createMutation.isPending || updateMutation.isPending}
          initialContent={initialContent}
          initialTemplateId={initialTemplateId}
        />
      )}

      {/* Stats dialog */}
      {statsTarget && (
        <PopupStats
          popupId={statsTarget.id}
          popupName={statsTarget.name}
          open
          onClose={() => setStatsTarget(null)}
        />
      )}

      {/* Preview dialog */}
      <Dialog open={!!previewTarget} onOpenChange={(o) => !o && setPreviewTarget(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{previewTarget?.name} - {t("Preview")}</DialogTitle>
              <DevicePreviewToggle device={previewDevice} onChange={setPreviewDevice} className="flex-shrink-0 mr-6" />
            </div>
          </DialogHeader>
          <div className="bg-gray-50 rounded-lg p-4 max-h-[60vh] overflow-auto">
            <DevicePreviewFrame html={previewTarget?.content} device={previewDevice} title={t("Pop-up preview")} height={380} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setPreviewTarget(null)}>{t("Close")}</Button>
            <Button size="sm" onClick={() => { const target = previewTarget; setPreviewTarget(null); openEdit(target); }}>
              {t("Edit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this pop-up?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This will remove the pop-up from the CDP. The WordPress plugin will stop serving it to visitors. This cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
