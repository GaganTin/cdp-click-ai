import { useState, useId, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Plus, Pencil, Trash2, MousePointer2, Mail, ToggleLeft,
  ToggleRight, Search, Calendar, Copy, RefreshCw,
  CheckCircle2, Clock, Download, Users, Ghost, Layout,
  BarChart2, Upload, Eye, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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

const STATUS_ACCENT = { active: "#10b981", draft: "#94a3b8" };
const STATUS_STYLE  = { active: "bg-green-100 text-green-800", draft: "bg-secondary text-secondary-foreground" };

const TEMPLATE_CATEGORIES = ["Lead Gen", "Promotion", "Awareness", "Retention", "Engagement", "Feedback", "Custom"];

// ── Pre-built HTML Templates ───────────────────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    id: "email-collection",
    name: "Email Collection",
    description: "Newsletter signup with a clean form to capture visitor emails.",
    category: "Lead Gen",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12)">
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Stay in the loop</h2>
  <p style="margin:0 0 20px;font-size:14px;color:#555">Get exclusive offers and updates straight to your inbox.</p>
  <form>
    <input name="email" type="email" placeholder="your@email.com" required
      style="width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin-bottom:12px" />
    <button type="submit"
      style="width:100%;padding:11px;background:#111;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">
      Subscribe
    </button>
  </form>
  <p style="margin:12px 0 0;font-size:11px;color:#aaa;text-align:center">No spam. Unsubscribe any time.</p>
</div>`,
  },
  {
    id: "discount-coupon",
    name: "Discount Coupon",
    description: "Show a promo code with a clear call-to-action to drive conversions.",
    category: "Promotion",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center">
  <div style="font-size:48px;margin-bottom:8px">🎉</div>
  <h2 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#111">20% OFF</h2>
  <p style="margin:0 0 4px;font-size:14px;color:#555">Use code at checkout:</p>
  <div style="display:inline-block;padding:8px 20px;background:#f5f5f5;border-radius:8px;font-size:18px;font-weight:700;letter-spacing:2px;color:#111;margin:8px 0 20px">SAVE20</div>
  <p style="margin:0 0 20px;font-size:13px;color:#888">Valid for the next 24 hours only.</p>
  <a href="#" style="display:inline-block;padding:12px 32px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Shop Now</a>
</div>`,
  },
  {
    id: "announcement",
    name: "Announcement",
    description: "Highlight a new feature, event, or update to your visitors.",
    category: "Awareness",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#111;border-radius:12px;color:#fff">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <span style="font-size:20px">📢</span>
    <h2 style="margin:0;font-size:18px;font-weight:700">New Feature Available</h2>
  </div>
  <p style="margin:0 0 16px;font-size:14px;color:#aaa;line-height:1.6">
    We've just launched something exciting. Check it out and let us know what you think!
  </p>
  <a href="#" style="display:inline-block;padding:10px 24px;background:#fff;color:#111;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">Learn More</a>
</div>`,
  },
  {
    id: "exit-intent",
    name: "Exit Intent",
    description: "Last-chance offer shown when visitors are about to leave.",
    category: "Retention",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.16);text-align:center">
  <div style="font-size:40px;margin-bottom:12px">⏳</div>
  <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Wait! Before you go…</h2>
  <p style="margin:0 0 20px;font-size:14px;color:#666;line-height:1.5">
    We'd love to keep you in the loop. Get 10% off your next purchase when you sign up.
  </p>
  <form style="display:flex;gap:8px;max-width:320px;margin:0 auto">
    <input name="email" type="email" placeholder="your@email.com" required
      style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px" />
    <button type="submit"
      style="padding:10px 16px;background:#e53e3e;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">
      Claim 10%
    </button>
  </form>
  <p style="margin:12px 0 0;font-size:11px;color:#aaa">Offer valid for new subscribers only.</p>
</div>`,
  },
  {
    id: "welcome",
    name: "Welcome",
    description: "Greet new visitors and introduce your brand or service.",
    category: "Engagement",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px;color:#fff;text-align:center">
  <div style="font-size:48px;margin-bottom:12px">👋</div>
  <h2 style="margin:0 0 10px;font-size:24px;font-weight:700">Welcome!</h2>
  <p style="margin:0 0 24px;font-size:14px;opacity:.85;line-height:1.6">
    We're glad you're here. Explore our latest resources, events, and membership benefits.
  </p>
  <a href="#" style="display:inline-block;padding:12px 32px;background:#fff;color:#764ba2;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700">
    Explore Now
  </a>
</div>`,
  },
  {
    id: "survey",
    name: "Quick Survey",
    description: "Collect a single feedback response from visitors.",
    category: "Feedback",
    builtin: true,
    content: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1)">
  <h2 style="margin:0 0 6px;font-size:18px;font-weight:700;color:#111">Quick question for you 🤔</h2>
  <p style="margin:0 0 16px;font-size:13px;color:#666">What brought you to our site today?</p>
  <form>
    <div>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
        <input type="radio" name="reason" value="membership" /> <span style="font-size:13px">Join / renew membership</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
        <input type="radio" name="reason" value="events" /> <span style="font-size:13px">Upcoming events</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:8px">
        <input type="radio" name="reason" value="resources" /> <span style="font-size:13px">Resources & content</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #eee;border-radius:8px;cursor:pointer;margin-bottom:12px">
        <input type="radio" name="reason" value="other" /> <span style="font-size:13px">Something else</span>
      </label>
    </div>
    <button type="submit"
      style="width:100%;padding:10px;background:#111;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">
      Submit
    </button>
  </form>
</div>`,
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateRefId(name) {
  const slug = (name || "popup")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${slug || "popup"}-${rand}`;
}

function toDateInput(ts) {
  if (!ts) return "";
  try { return new Date(ts).toISOString().slice(0, 16); } catch { return ""; }
}

// ── Popup Form Dialog ──────────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name: "",
  interaction_type: "banner",
  cdp_reference_id: "",
  content: "",
  is_active: false,
  is_default: false,
  start_time: "",
  end_time: "",
  rules: { visit: 3, exit_threshold: 50, anonymous_segment_id: "", customer_segment_id: "" },
};

function PopupFormDialog({ open, onClose, onSave, initial = null, isSaving, initialContent = "" }) {
  const uid = useId();
  const isEdit = !!initial;

  const [form, setForm] = useState(() => {
    if (initial) {
      const rules = initial.rules || {};
      return {
        name: initial.name || "",
        interaction_type: initial.interaction_type || "banner",
        cdp_reference_id: initial.cdp_reference_id || "",
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim())             { toast.error("Name is required"); return; }
    if (!form.cdp_reference_id.trim()) { toast.error("CDP Reference ID is required"); return; }
    if (!form.content.trim())          { toast.error("HTML Content is required"); return; }

    onSave({
      name: form.name.trim(),
      interaction_type: form.interaction_type,
      cdp_reference_id: form.cdp_reference_id.trim(),
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
          <DialogTitle>{isEdit ? "Edit Pop Up" : "New Pop Up"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">

          {/* ── Basic Info ── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basic Info</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-name`} className="text-xs">Name <span className="text-destructive">*</span></Label>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={e => {
                    set("name", e.target.value);
                    if (!isEdit && !form.cdp_reference_id) set("cdp_reference_id", generateRefId(e.target.value));
                  }}
                  placeholder="Summer Sale Banner"
                  className="h-9 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-type`} className="text-xs">Type</Label>
                <Select value={form.interaction_type} onValueChange={v => set("interaction_type", v)}>
                  <SelectTrigger id={`${uid}-type`} className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERACTION_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-ref`} className="text-xs">CDP Reference ID <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                <Input
                  id={`${uid}-ref`}
                  value={form.cdp_reference_id}
                  onChange={e => set("cdp_reference_id", e.target.value)}
                  placeholder="summer-sale-abc12"
                  className="h-9 text-sm font-mono flex-1"
                />
                <Button
                  type="button" variant="outline" size="sm" className="h-9 text-xs gap-1.5 flex-shrink-0"
                  onClick={() => set("cdp_reference_id", generateRefId(form.name))}
                >
                  <RefreshCw className="w-3 h-3" /> Generate
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Unique ID used by the WordPress plugin to retrieve this pop-up.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-start`} className="text-xs">Start Date</Label>
                <Input id={`${uid}-start`} type="datetime-local" value={form.start_time} onChange={e => set("start_time", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-end`} className="text-xs">End Date</Label>
                <Input id={`${uid}-end`} type="datetime-local" value={form.end_time} onChange={e => set("end_time", e.target.value)} className="h-9 text-sm" />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch id={`${uid}-active`} checked={form.is_active} onCheckedChange={v => set("is_active", v)} />
                <Label htmlFor={`${uid}-active`} className="text-sm cursor-pointer">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id={`${uid}-default`} checked={form.is_default} onCheckedChange={v => set("is_default", v)} />
                <Label htmlFor={`${uid}-default`} className="text-sm cursor-pointer">Default pop-up</Label>
              </div>
            </div>
          </section>

          {/* ── HTML Content ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">HTML Content</h3>
            <Textarea
              value={form.content}
              onChange={e => set("content", e.target.value)}
              placeholder="<div>Your popup HTML here...</div>"
              className="font-mono text-xs leading-relaxed min-h-[180px] resize-y"
            />
            <p className="text-[11px] text-muted-foreground">
              Use the <strong>Templates</strong> tab to start from a pre-built design.
              Include a form with <code className="font-mono bg-secondary px-1 rounded">name="email"</code> to collect emails.
            </p>
          </section>

          {/* ── Targeting Rules ── */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Targeting</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-visit`} className="text-xs">Visit Threshold</Label>
                <Input
                  id={`${uid}-visit`}
                  type="number" min="1"
                  value={form.rules.visit}
                  onChange={e => setRule("visit", e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Min page visits before showing (default: 3)</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-exit`} className="text-xs">Daily Exit Threshold</Label>
                <Input
                  id={`${uid}-exit`}
                  type="number" min="1"
                  value={form.rules.exit_threshold}
                  onChange={e => setRule("exit_threshold", e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Max deliveries per day (default: 50)</p>
              </div>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-4 bg-secondary/10">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">Segment Targeting</p>
              </div>
              <p className="text-[11px] text-muted-foreground -mt-2">
                Select segments to target. The GA IDs from each segment are resolved and passed to the WordPress plugin as targeting criteria.
                Leave both empty to show to all visitors meeting the visit threshold.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Ghost className="w-3 h-3" /> Anonymous Segment
                </Label>
                <Select
                  value={form.rules.anonymous_segment_id || "none"}
                  onValueChange={v => setRule("anonymous_segment_id", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="No anonymous targeting" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No anonymous targeting</SelectItem>
                    {anonymousSegments.length === 0 && (
                      <SelectItem value="_empty" disabled>No anonymous segments saved</SelectItem>
                    )}
                    {anonymousSegments.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.estimated_size ? ` (${s.estimated_size.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAnonSegment && (
                  <p className="text-[11px] text-muted-foreground">{selectedAnonSegment.description || "Anonymous visitor segment"}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> Customer Segment
                </Label>
                <Select
                  value={form.rules.customer_segment_id || "none"}
                  onValueChange={v => setRule("customer_segment_id", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="No customer targeting" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No customer targeting</SelectItem>
                    {customerSegments.length === 0 && (
                      <SelectItem value="_empty" disabled>No customer segments saved</SelectItem>
                    )}
                    {customerSegments.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.estimated_size ? ` (${s.estimated_size.toLocaleString()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCustSegment && (
                  <p className="text-[11px] text-muted-foreground">{selectedCustSegment.description || "Customer segment"}</p>
                )}
              </div>
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : isEdit ? "Save Changes" : "Create Pop Up"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Template Form Dialog ───────────────────────────────────────────────────────

function TemplateFormDialog({ open, onClose, onSave, initial = null, isSaving }) {
  const uid = useId();
  const isEdit = !!initial;
  const fileInputRef = useRef(null);

  const [form, setForm] = useState(() => ({
    name: initial?.name || "",
    category: initial?.category || "Custom",
    description: initial?.description || "",
    content: initial?.content || "",
  }));

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      set("content", ev.target.result);
      if (!form.name) set("name", file.name.replace(/\.html?$/, ""));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim())    { toast.error("Name is required"); return; }
    if (!form.content.trim()) { toast.error("HTML content is required"); return; }
    onSave({ name: form.name.trim(), category: form.category, description: form.description, content: form.content });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-tname`} className="text-xs">Name <span className="text-destructive">*</span></Label>
              <Input id={`${uid}-tname`} value={form.name} onChange={e => set("name", e.target.value)} placeholder="My Template" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-cat`} className="text-xs">Category</Label>
              <Input
                id={`${uid}-cat`}
                list={`${uid}-cat-list`}
                value={form.category}
                onChange={e => set("category", e.target.value)}
                placeholder="e.g. Lead Gen, Custom…"
                className="h-9 text-sm"
              />
              <datalist id={`${uid}-cat-list`}>
                {TEMPLATE_CATEGORIES.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-desc`} className="text-xs">Description</Label>
            <Input id={`${uid}-desc`} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Briefly describe this template" className="h-9 text-sm" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">HTML Content <span className="text-destructive">*</span></Label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3 h-3" /> Import HTML
              </Button>
              <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImport} />
            </div>
            <Textarea
              value={form.content}
              onChange={e => set("content", e.target.value)}
              placeholder="<div>Your popup HTML here...</div>"
              className="font-mono text-xs leading-relaxed min-h-[220px] resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : isEdit ? "Save Changes" : "Create Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Popup Card ─────────────────────────────────────────────────────────────────

function PopupCard({ popup, onEdit, onDelete, onToggleActive, segments = [] }) {
  const [copied, setCopied] = useState(false);
  const accent = STATUS_ACCENT[popup.status] || STATUS_ACCENT.draft;
  const isActive = popup.status === "active";
  const typeLabel = INTERACTION_TYPES.find(t => t.value === popup.interaction_type)?.label || popup.interaction_type;

  const anonSeg = segments.find(s => s.id === popup.rules?.anonymous_segment_id);
  const custSeg = segments.find(s => s.id === popup.rules?.customer_segment_id);

  const copyRef = () => {
    navigator.clipboard.writeText(popup.cdp_reference_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
      <div className="h-1 flex-shrink-0" style={{ background: accent }} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug truncate">{popup.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{typeLabel}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {popup.is_default && (
              <Badge className="bg-blue-100 text-blue-700 text-[10px] h-4 px-1.5">Default</Badge>
            )}
            <Badge className={`${STATUS_STYLE[popup.status] || STATUS_STYLE.draft} text-[10px] h-4 px-1.5 flex items-center gap-0.5`}>
              {isActive ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
              {popup.status}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground font-mono truncate flex-1">{popup.cdp_reference_id}</span>
          <button onClick={copyRef} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            {copied ? <CheckCircle2 className="w-3 h-3 text-foreground" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        {(popup.start_time || popup.end_time) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="w-3 h-3 flex-shrink-0" />
            <span>
              {popup.start_time ? format(new Date(popup.start_time), "MMM d, yyyy") : "-"}
              {" → "}
              {popup.end_time ? format(new Date(popup.end_time), "MMM d, yyyy") : "No end"}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            Visit: <strong className="text-foreground">{popup.rules?.visit ?? 3}</strong>
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground">
            Cap: <strong className="text-foreground">{popup.rules?.exit_threshold ?? 50}/day</strong>
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

      <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
        <Button
          variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(popup)}
        >
          <Pencil className="w-3 h-3" /> Edit
        </Button>
        <Button
          variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => onToggleActive(popup)}
        >
          {isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
          {isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(popup.id)}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Templates Tab ──────────────────────────────────────────────────────────────

function TemplatesTab({ onUseTemplate, templateFormOpen, onTemplateFormOpen, onTemplateFormClose }) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef(null);

  const { data: customTemplates = [], isLoading } = useQuery({
    queryKey: ["popup-templates"],
    queryFn: () => appClient.popup.listTemplates(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.popup.createTemplate(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popup-templates"] }); onTemplateFormClose(); toast.success("Template saved"); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.popup.updateTemplate(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popup-templates"] }); setEditTarget(null); onTemplateFormClose(); toast.success("Template updated"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.popup.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popup-templates"] }); setDeleteTarget(null); toast.success("Template deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (data) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data });
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

  // Combine all templates; custom ones are editable/deletable
  const allTemplates = [
    ...BUILTIN_TEMPLATES,
    ...customTemplates.map(t => ({ ...t, builtin: false })),
  ];

  // All unique categories
  const allCategories = [...new Set(allTemplates.map(t => t.category))].sort();

  // Filtered list
  const visible = allTemplates.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
    const matchCat = !categoryFilter || t.category === categoryFilter;
    return matchSearch && matchCat;
  });

  const hasActiveFilters = !!categoryFilter;

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
              placeholder="Search templates…"
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
            <Filter className="w-3.5 h-3.5" /> Filters
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" /> Import HTML
          </Button>
          <Button size="sm" className="h-9 gap-1.5" onClick={onTemplateFormOpen}>
            <Plus className="w-3.5 h-3.5" /> New Template
          </Button>
          <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleImportFile} />
        </div>

        {showFilters && (
          <div className="mt-3 p-4 border border-border rounded-lg bg-secondary/20 flex gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Category</p>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground"
              >
                <option value="">All Categories</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}

        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {categoryFilter && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                Category: <strong>{categoryFilter}</strong>
                <button onClick={() => setCategoryFilter("")} className="hover:text-foreground text-muted-foreground ml-0.5">×</button>
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && visible.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <Layout className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p>No templates match your search.</p>
        </div>
      )}

      {/* Templates flat grid */}
      {!isLoading && visible.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {visible.map(t => (
            <TemplateCard
              key={t.id || t.name}
              template={t}
              onPreview={() => setPreview(t)}
              onUse={() => onUseTemplate(t.content)}
              onEdit={t.builtin ? undefined : () => { setEditTarget(t); onTemplateFormOpen(); }}
              onDelete={t.builtin ? undefined : () => setDeleteTarget(t.id)}
            />
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{preview?.name} — Preview</DialogTitle>
          </DialogHeader>
          <div className="border border-border rounded-lg overflow-hidden bg-gray-50">
            <iframe
              srcDoc={preview?.content || ""}
              title="Template preview"
              className="w-full"
              style={{ height: 380, border: "none" }}
              sandbox="allow-same-origin"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Close</Button>
            <Button size="sm" onClick={() => { onUseTemplate(preview.content); setPreview(null); }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Use Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create / Edit template dialog */}
      <TemplateFormDialog
        open={templateFormOpen || !!editTarget}
        onClose={() => { setEditTarget(null); onTemplateFormClose(); }}
        onSave={handleSave}
        initial={editTarget}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Template Card (shared) ─────────────────────────────────────────────────────

function TemplateCard({ template, onPreview, onUse, onEdit, onDelete }) {
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all flex flex-col">
      <div className="h-1 flex-shrink-0 bg-gradient-to-r from-border to-muted-foreground/30" />
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm">{template.name}</p>
          <Badge className="bg-secondary text-secondary-foreground text-[10px] h-4 px-1.5 flex-shrink-0">
            {template.category}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
      </div>
      <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
        <Button
          variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onPreview}
        >
          <Eye className="w-3 h-3" /> Preview
        </Button>
        {onEdit && (
          <Button
            variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
          >
            <Pencil className="w-3 h-3" /> Edit
          </Button>
        )}
        <Button size="sm" className="h-7 text-xs gap-1.5 ml-auto" onClick={onUse}>
          <Plus className="w-3 h-3" /> Use Template
        </Button>
        {onDelete && (
          <Button
            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Analytics Tab ──────────────────────────────────────────────────────────────

function AnalyticsTab({ popups }) {
  const active  = popups.filter(p => p.status === "active").length;
  const draft   = popups.filter(p => p.status === "draft").length;
  const withSeg = popups.filter(p => p.rules?.anonymous_segment_id || p.rules?.customer_segment_id).length;

  return (
    <div className="px-8 py-6 space-y-8">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Pop Ups",    value: popups.length },
          { label: "Active",           value: active },
          { label: "Drafts",           value: draft },
          { label: "With Targeting",   value: withSeg },
        ].map(tile => (
          <div key={tile.label} className="border border-border rounded-lg p-4 space-y-1">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="text-2xl font-bold">{tile.value}</p>
          </div>
        ))}
      </div>

      {popups.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">All Pop Ups</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Visit Threshold</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Daily Cap</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {popups.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/10">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{p.cdp_reference_id}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{p.interaction_type}</td>
                    <td className="px-4 py-3">
                      <Badge className={`${STATUS_STYLE[p.status] || STATUS_STYLE.draft} text-[10px]`}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{p.rules?.visit ?? 3}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{p.rules?.exit_threshold ?? 50}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {format(new Date(p.created_date), "MMM d, yyyy")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No data yet</p>
          <p className="text-xs">Create your first pop-up to see analytics here.</p>
        </div>
      )}
    </div>
  );
}

// ── Emails Tab ─────────────────────────────────────────────────────────────────

function EmailsTab({ popups }) {
  const [selectedPopupId, setSelectedPopupId] = useState(() => popups[0]?.id || "");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["popup-emails", selectedPopupId],
    queryFn: () => appClient.popup.getEmails(selectedPopupId),
    enabled: !!selectedPopupId,
  });

  const emailList = data?.emailList || [];

  const downloadCsv = () => {
    const csv = ["email", ...emailList].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "collected-emails.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="px-8 py-6">
      {popups.length === 0 ? (
        <div className="text-center py-20 text-sm text-muted-foreground">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No pop-ups yet</p>
          <p className="text-xs">Create a pop-up with an email form to start collecting emails.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-6">
            <Select value={selectedPopupId} onValueChange={setSelectedPopupId}>
              <SelectTrigger className="h-9 text-sm w-64">
                <SelectValue placeholder="Select pop-up…" />
              </SelectTrigger>
              <SelectContent>
                {popups.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {emailList.length > 0 && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5 ml-auto" onClick={downloadCsv}>
                <Download className="w-3.5 h-3.5" /> Download CSV
              </Button>
            )}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && emailList.length === 0 && (
            <div className="text-center py-16 text-sm text-muted-foreground">
              <Mail className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>No emails collected yet for this pop-up.</p>
            </div>
          )}

          {!isLoading && emailList.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {emailList.length} email{emailList.length !== 1 ? "s" : ""} collected
              </p>
              <div className="border border-border rounded-lg overflow-hidden">
                {emailList.map((email, i) => (
                  <div key={i} className="flex items-center px-4 py-2.5 border-b border-border last:border-0 hover:bg-secondary/20">
                    <span className="text-sm font-mono">{email}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PopUp() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("popups");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [initialContent, setInitialContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);

  // Pop-ups search + filter
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); setFormOpen(false); toast.success("Pop-up created"); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => appClient.popup.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["popups"] });
      setEditTarget(null);
      setFormOpen(false);
      toast.success("Pop-up updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.popup.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); setDeleteTarget(null); toast.success("Pop-up deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => appClient.popup.update(id, { is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["popups"] }); toast.success("Pop-up updated"); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = (data) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data });
    else createMutation.mutate(data);
  };

  const openCreate = (content = "") => { setEditTarget(null); setInitialContent(content); setFormOpen(true); };
  const openEdit   = (p) => { setEditTarget(p); setInitialContent(""); setFormOpen(true); };

  const handleUseTemplate = (content) => { setTab("popups"); openCreate(content); };

  const hasActiveFilters = !!statusFilter;

  const filtered = popups.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.name.toLowerCase().includes(q) || p.cdp_reference_id?.toLowerCase().includes(q);
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Pop Up</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Create and manage pop-ups served to visitors through your WordPress plugin.
            </p>
          </div>
          {tab === "popups" && (
            <Button size="sm" className="gap-1.5 h-9" onClick={() => openCreate()}>
              <Plus className="w-3.5 h-3.5" /> New Pop Up
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
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
                    placeholder="Search pop-ups…"
                    className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setShowFilters(f => !f)}>
                  <Filter className="w-3.5 h-3.5" /> Filters
                  {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-foreground" />}
                </Button>
              </div>
              {showFilters && (
                <div className="mt-3 p-4 border border-border rounded-lg bg-secondary/20 flex gap-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Status</p>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="h-8 px-2 text-xs bg-background border border-input rounded-md text-foreground"
                    >
                      <option value="">All</option>
                      <option value="active">Active</option>
                      <option value="draft">Draft</option>
                    </select>
                  </div>
                </div>
              )}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {statusFilter && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-border bg-secondary/40">
                      Status: <strong>{statusFilter}</strong>
                      <button onClick={() => setStatusFilter("")} className="hover:text-foreground text-muted-foreground ml-0.5">
                        ×
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
              </div>
            )}

            {!isLoading && filtered.length === 0 && (
              <div className="text-center py-20 text-sm text-muted-foreground">
                <MousePointer2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium text-foreground mb-1">No pop-ups yet</p>
                <p className="text-xs mb-4">
                  Create a pop-up or start from a template - the WordPress plugin will serve it to your visitors.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" className="gap-1.5 h-9" onClick={() => openCreate()}>
                    <Plus className="w-3.5 h-3.5" /> New Pop Up
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 h-9" onClick={() => setTab("templates")}>
                    <Layout className="w-3.5 h-3.5" /> Browse Templates
                  </Button>
                </div>
              </div>
            )}

            {!isLoading && filtered.length > 0 && (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {filtered.map(p => (
                  <PopupCard
                    key={p.id}
                    popup={p}
                    segments={allSegments}
                    onEdit={openEdit}
                    onDelete={(id) => setDeleteTarget(id)}
                    onToggleActive={(popup) => toggleMutation.mutate({ id: popup.id, is_active: !popup.is_active })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "templates" && (
          <TemplatesTab
            onUseTemplate={handleUseTemplate}
            templateFormOpen={templateFormOpen}
            onTemplateFormOpen={() => setTemplateFormOpen(true)}
            onTemplateFormClose={() => setTemplateFormOpen(false)}
          />
        )}

        {tab === "analytics" && <AnalyticsTab popups={popups} />}
        {tab === "emails"    && <EmailsTab popups={popups} />}
      </div>

      {/* Create / Edit popup dialog */}
      <PopupFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); setInitialContent(""); }}
        onSave={handleSave}
        initial={editTarget}
        isSaving={createMutation.isPending || updateMutation.isPending}
        initialContent={initialContent}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pop-up?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the pop-up from the CDP. The WordPress plugin will stop serving it to visitors. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
