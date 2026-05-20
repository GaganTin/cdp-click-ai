import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Users, AlertCircle, Send, Clock, Zap, FlaskConical, Calendar, Plus, Trash2, Layout,
} from "lucide-react";
import { appClient } from "@/api/appClient";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import EmailBuilder, { blocksToHtml } from "./EmailBuilder";

// ── Default email blocks ──────────────────────────────────────────────────────
const DEFAULT_BLOCKS = [
  {
    id: "header_1", type: "header",
    config: { title: "Hi {{first_name}},", subtitle: "", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", align: "left", fontSize: 24, padding: 24 },
  },
  {
    id: "text_1", type: "text",
    config: { content: "Your message here. Keep it conversational and focused on one clear action.", color: "#374151", fontSize: 15, lineHeight: 1.6, padding: 16 },
  },
  {
    id: "button_1", type: "button",
    config: { text: "Call to action", url: "https://", bgColor: "#111111", color: "#ffffff", align: "left", fontSize: 14, paddingV: 12, paddingH: 28, radius: 6, padding: 16 },
  },
  {
    id: "text_2", type: "text",
    config: { content: "You're receiving this because you opted in to our communications.", color: "#9ca3af", fontSize: 13, lineHeight: 1.5, padding: 16 },
  },
];

const TRIGGER_OPTIONS = [
  { value: "manual",    label: "Manual Send",    icon: Send,  description: "Send immediately when you click the Send button." },
  { value: "scheduled", label: "Scheduled",      icon: Clock, description: "Auto-send at one or more scheduled date/times." },
  { value: "event",     label: "Event Triggered",icon: Zap,   description: "Auto-send when member events occur." },
];

// Grouped event trigger catalogue
const EVENT_TRIGGER_GROUPS = [
  {
    label: "Member Lifecycle",
    triggers: [
      { value: "new_member",        label: "New Member Joins" },
      { value: "member_upgraded",   label: "Member Type Upgraded" },
      { value: "member_expired",    label: "Membership Expired" },
      { value: "member_anniversary",label: "Membership Anniversary (1 year)" },
    ],
  },
  {
    label: "Offline Engagement",
    triggers: [
      { value: "seminar_attended",  label: "Attends a Seminar" },
      { value: "webinar_attended",  label: "Attends a Webinar" },
      { value: "form_submitted",    label: "Submits a Form" },
      { value: "event_registered",  label: "Registers for an Event" },
    ],
  },
  {
    label: "Web Activity",
    triggers: [
      { value: "high_activity",     label: "Highly Active (5+ sessions)" },
      { value: "page_viewed",       label: "Views a Specific Page" },
      { value: "file_downloaded",   label: "Downloads a File" },
      { value: "whatsapp_clicked",  label: "Clicks WhatsApp" },
    ],
  },
  {
    label: "Re-engagement",
    triggers: [
      { value: "inactivity_30d",    label: "30 Days Inactive" },
      { value: "inactivity_60d",    label: "60 Days Inactive" },
      { value: "inactivity_90d",    label: "90 Days Inactive" },
      { value: "inactivity_180d",   label: "6 Months Inactive" },
    ],
  },
  {
    label: "Date-based",
    triggers: [
      { value: "birthday",          label: "Member Birthday" },
      { value: "join_anniversary",  label: "Join Date Anniversary" },
    ],
  },
];

const EVENT_TRIGGERS_FLAT = EVENT_TRIGGER_GROUPS.flatMap(g => g.triggers);

const TOKENS = ["{{first_name}}", "{{last_name}}", "{{full_name}}", "{{email}}", "{{member_type}}", "{{member_no}}"];

// ── Template picker ───────────────────────────────────────────────────────────
function TemplatePicker({ open, onClose, onApply }) {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["edm-templates"],
    queryFn: () => appClient.edm.listTemplates(),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[70vh] flex flex-col p-0 gap-0" aria-describedby={undefined}>
        <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="text-sm font-semibold">Load from Template</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && templates.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <Layout className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>No templates yet.</p>
              <p className="text-xs mt-1">Go to Email → Templates to create reusable templates.</p>
            </div>
          )}

          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => onApply(t)}
              className="w-full flex items-start gap-3 p-3 rounded-lg border border-border hover:border-foreground/40 hover:bg-secondary/30 transition-all text-left mb-2 last:mb-0 group"
            >
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-violet-100 to-indigo-100 border border-violet-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Layout className="w-4 h-4 text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium group-hover:text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{t.subject}</p>
                {t.variables?._blocks && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    {t.variables._blocks.length} block{t.variables._blocks.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 self-center">
                Use →
              </span>
            </button>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Test send modal ───────────────────────────────────────────────────────────
function TestSendModal({ open, onClose, campaignState }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!email) return toast.error("Enter a test email address");
    if (!campaignState.subject) return toast.error("Add a subject line first");
    if (!campaignState.html_body) return toast.error("Add email content first");
    setSending(true);
    try {
      const result = await appClient.edm.testSend({
        test_email: email,
        subject: campaignState.subject,
        html_body: campaignState.html_body,
        from_name: campaignState.from_name,
        from_email: campaignState.from_email,
        reply_to: campaignState.reply_to,
      });
      if (result.simulated) {
        toast.success(`Test sent (simulated — no Resend API key configured)`);
      } else {
        toast.success(`Test email sent to ${email}`);
      }
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to send test");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Send Test Email</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <Label className="text-xs mb-1.5 block">Test recipient email</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="test@example.com"
              onKeyDown={e => e.key === "Enter" && send()}
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Subject is prefixed with <span className="font-mono">[TEST]</span>. Uses sample personalisation tokens (first_name = "Test").
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={send} disabled={sending}>
              {sending ? "Sending..." : "Send Test"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────
export default function CampaignEditor({ open, onClose, onSave, initial = null }) {
  // Only a real saved campaign has an id — AI suggestions passed as initial are treated as new
  const isEdit = !!initial?.id;

  const [activeTab, setActiveTab] = useState("email");

  // Email builder state
  const [blocks, setBlocks] = useState(DEFAULT_BLOCKS);
  const [htmlMode, setHtmlMode] = useState(false);
  const [rawHtml, setRawHtml] = useState("");

  // Trigger / schedule state
  const [triggerType, setTriggerType] = useState("manual");
  // Multiple schedules: [{ id, scheduled_at, label }]
  const [schedules, setSchedules] = useState([]);
  // Multiple event triggers: [{ id, event, delay_hours }]
  const [events, setEvents] = useState([]);

  // Campaign fields (no scheduled_at — derived from schedules array on save)
  const [form, setForm] = useState({
    name: "New Campaign",
    subject: "",
    preview_text: "",
    from_name: "Click AI",
    from_email: "onboarding@resend.dev",
    reply_to: "",
    segment_id: "",
    utm_campaign_id: "",
  });

  const [recipientCount, setRecipientCount] = useState(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // Only customer segments (anonymous profiles don't have emails)
  const { data: allSegments = [] } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date"),
  });
  const segments = allSegments.filter(s => s.segment_type === "customer");

  const { data: utmCampaigns = [] } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => appClient.entities.Campaign.list("-created_date"),
  });

  // Reset / populate when dialog opens or initial changes
  useEffect(() => {
    if (!open) return;
    if (initial) {
      const saved = initial.ab_test_config || {};
      setBlocks(saved._blocks || DEFAULT_BLOCKS);
      setHtmlMode(saved._html_mode || false);
      setRawHtml(initial.html_body || "");
      setTriggerType(saved._trigger_type || "manual");
      setSchedules(saved._schedules || (
        initial.scheduled_at
          ? [{ id: "s_legacy", scheduled_at: initial.scheduled_at.slice(0, 16), label: "" }]
          : []
      ));
      setEvents(saved._events || []);
      setForm({
        name: initial.name || "New Campaign",
        subject: initial.subject || "",
        preview_text: initial.preview_text || "",
        from_name: initial.from_name || "Click AI",
        from_email: initial.from_email || "onboarding@resend.dev",
        reply_to: initial.reply_to || "",
        segment_id: initial.segment_id || "",
        utm_campaign_id: initial.utm_campaign_id || "",
      });
    } else {
      setBlocks([]);
      setHtmlMode(false);
      setRawHtml("");
      setTriggerType("manual");
      setSchedules([]);
      setEvents([]);
      setForm({
        name: "New Campaign",
        subject: "",
        preview_text: "",
        from_name: "Click AI",
        from_email: "onboarding@resend.dev",
        reply_to: "",
        segment_id: "",
        utm_campaign_id: "",
      });
    }
    setRecipientCount(null);
    setActiveTab("email");
    setTestOpen(false);
  }, [initial, open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const previewRecipients = async () => {
    setLoadingRecipients(true);
    try {
      const data = await appClient.edm.previewRecipientsBySegment();
      setRecipientCount(data.count);
    } catch {
      toast.error("Could not preview recipients");
    } finally {
      setLoadingRecipients(false);
    }
  };

  // ── Schedule helpers ──────────────────────────────────────────────────────
  const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const addSchedule = () =>
    setSchedules(s => [...s, { id: uid(), scheduled_at: "", label: "" }]);
  const removeSchedule = (id) =>
    setSchedules(s => s.filter(x => x.id !== id));
  const updateSchedule = (id, key, val) =>
    setSchedules(s => s.map(x => x.id === id ? { ...x, [key]: val } : x));

  const addEvent = () =>
    setEvents(e => [...e, { id: uid(), event: "new_member", delay_hours: 24 }]);
  const removeEvent = (id) =>
    setEvents(e => e.filter(x => x.id !== id));
  const updateEvent = (id, key, val) =>
    setEvents(e => e.map(x => x.id === id ? { ...x, [key]: val } : x));

  // ── Apply template ────────────────────────────────────────────────────────
  const applyTemplate = (template) => {
    const vars = template.variables || {};
    if (vars._blocks) {
      const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setBlocks(vars._blocks.map(b => ({ ...b, id: `${b.type}_${uid()}`, config: { ...b.config } })));
      setHtmlMode(vars._html_mode || false);
    }
    if (template.subject && !form.subject) {
      set("subject", template.subject);
    }
    setTemplatePickerOpen(false);
    toast.success(`Template "${template.name}" applied`);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name || !form.subject || !form.from_email) {
      return toast.error("Name, subject, and from email are required");
    }
    if (triggerType === "scheduled") {
      if (schedules.length === 0) return toast.error("Add at least one send time");
      if (schedules.some(s => !s.scheduled_at)) return toast.error("All send times need a date selected");
    }
    if (triggerType === "event" && events.length === 0) {
      return toast.error("Add at least one trigger event");
    }
    setSaving(true);
    try {
      const html_body = htmlMode ? rawHtml : blocksToHtml(blocks);
      // Earliest upcoming schedule drives the DB column (existing cron picks it up)
      const sortedSchedules = [...schedules].sort((a, b) =>
        new Date(a.scheduled_at) - new Date(b.scheduled_at)
      );
      const primaryScheduledAt = triggerType === "scheduled" && sortedSchedules[0]?.scheduled_at
        ? sortedSchedules[0].scheduled_at
        : null;
      const ab_test_config = {
        _blocks: blocks,
        _html_mode: htmlMode,
        _trigger_type: triggerType,
        _schedules: schedules,
        _events: events,
      };
      await onSave({
        ...form,
        html_body,
        segment_id: form.segment_id || null,
        utm_campaign_id: form.utm_campaign_id || null,
        reply_to: form.reply_to || null,
        status: triggerType === "scheduled" ? "scheduled" : "draft",
        scheduled_at: primaryScheduledAt,
        ab_test_config,
      });
    } finally {
      setSaving(false);
    }
  };

  // Build current state for test send
  const currentState = {
    subject: form.subject,
    html_body: htmlMode ? rawHtml : blocksToHtml(blocks),
    from_name: form.from_name,
    from_email: form.from_email,
    reply_to: form.reply_to,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="w-[96vw] max-w-6xl h-[92vh] p-0 flex flex-col overflow-hidden gap-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">
            {isEdit ? "Edit Campaign" : "New Email Campaign"}
          </DialogTitle>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
            <Input
              value={form.name}
              onChange={e => set("name", e.target.value)}
              className="text-base font-semibold border-none shadow-none focus-visible:ring-0 h-8 px-0 max-w-xs bg-transparent"
              placeholder="Campaign name..."
            />
            {isEdit && initial?.status && (
              <Badge variant="outline" className="text-[11px] capitalize flex-shrink-0">
                {initial.status}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setTestOpen(true)}
              >
                <FlaskConical className="w-3.5 h-3.5" />
                Send Test
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : isEdit ? "Save Changes" : "Save as Draft"}
              </Button>
            </div>
          </div>

          {/* ── Tab nav ────────────────────────────────────────────────── */}
          <div className="flex gap-0 border-b border-border px-5 flex-shrink-0">
            {[
              { id: "email",    label: "Email" },
              { id: "audience", label: "Audience" },
              { id: "schedule", label: "Schedule & Triggers" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors",
                  activeTab === t.id
                    ? "border-foreground text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Tab content ────────────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-hidden">

            {/* Email tab */}
            {activeTab === "email" && (
              <div className="h-full flex flex-col">
                {/* Compact settings bar */}
                <div className="px-5 py-3 border-b border-border space-y-2.5 flex-shrink-0">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1 block">Subject Line</Label>
                      <Input
                        value={form.subject}
                        onChange={e => set("subject", e.target.value)}
                        placeholder="Hi {{first_name}}, something for you"
                        className="h-8 text-sm"
                      />
                      {form.subject.length > 50 && (
                        <p className="text-[11px] text-amber-500 mt-0.5 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Over 50 chars — may be clipped in inbox
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1 block">Preview Text</Label>
                      <Input
                        value={form.preview_text}
                        onChange={e => set("preview_text", e.target.value)}
                        placeholder="Quick summary shown below subject in inbox..."
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1 block">From Name</Label>
                      <Input value={form.from_name} onChange={e => set("from_name", e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1 block">From Email</Label>
                      <Input value={form.from_email} onChange={e => set("from_email", e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1 block">
                        Reply-To <span className="opacity-60">(optional)</span>
                      </Label>
                      <Input
                        value={form.reply_to}
                        onChange={e => set("reply_to", e.target.value)}
                        placeholder="replies@yourdomain.com"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
                {/* Template load bar */}
                <div className="px-5 py-1.5 border-b border-border flex items-center gap-2 flex-shrink-0 bg-secondary/10">
                  <Layout className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">Start from a template or build from scratch below</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1 ml-auto px-2"
                    onClick={() => setTemplatePickerOpen(true)}
                  >
                    Load Template
                  </Button>
                </div>
                {/* Email builder fills remaining space */}
                <div className="flex-1 min-h-0 p-3">
                  <EmailBuilder
                    blocks={blocks}
                    onChange={setBlocks}
                    htmlMode={htmlMode}
                    onHtmlModeChange={setHtmlMode}
                    rawHtml={rawHtml}
                    onRawHtmlChange={setRawHtml}
                  />
                </div>
              </div>
            )}

            {/* Audience tab */}
            {activeTab === "audience" && (
              <div className="overflow-y-auto h-full p-6">
                <div className="max-w-xl space-y-6">

                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Label className="text-sm font-medium">Audience Segment</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Only customer segments are available — anonymous profiles don't have email addresses.
                        </p>
                      </div>
                      <button
                        onClick={previewRecipients}
                        disabled={loadingRecipients}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 border border-border rounded-md px-2.5 py-1 flex-shrink-0"
                      >
                        <Users className="w-3 h-3" />
                        {loadingRecipients
                          ? "Loading..."
                          : recipientCount !== null
                            ? `${recipientCount.toLocaleString()} opted-in recipients`
                            : "Preview count"
                        }
                      </button>
                    </div>
                    <Select
                      value={form.segment_id || "__none__"}
                      onValueChange={v => { set("segment_id", v === "__none__" ? "" : v); setRecipientCount(null); }}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select a customer segment..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">All opted-in customers (no segment filter)</SelectItem>
                        {segments.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}{s.estimated_size ? ` (~${s.estimated_size})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {segments.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        No customer segments yet. Create one from the Segments page first.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-1 block">Link UTM Campaign</Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Automatically injects UTM parameters into all links in your email.
                    </p>
                    <Select
                      value={form.utm_campaign_id || "__none__"}
                      onValueChange={v => set("utm_campaign_id", v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="None — use links as-is" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None — use links as-is</SelectItem>
                        {utmCampaigns.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="bg-secondary/40 rounded-lg p-4">
                    <p className="text-sm font-medium mb-1.5">Personalisation Tokens</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Use these in your subject line and email content to personalise each email.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TOKENS.map(t => (
                        <span key={t} className="font-mono text-xs bg-background border border-border rounded px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Schedule tab */}
            {activeTab === "schedule" && (
              <div className="overflow-y-auto h-full p-6">
                <div className="max-w-2xl space-y-8">

                  {/* Delivery method picker */}
                  <div>
                    <Label className="text-sm font-medium mb-1 block">Delivery Method</Label>
                    <p className="text-xs text-muted-foreground mb-4">How should this campaign be triggered?</p>
                    <div className="grid grid-cols-3 gap-3">
                      {TRIGGER_OPTIONS.map(opt => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setTriggerType(opt.value)}
                            className={cn(
                              "p-4 rounded-lg border-2 text-left transition-all",
                              triggerType === opt.value
                                ? "border-foreground bg-foreground/5"
                                : "border-border hover:border-foreground/40"
                            )}
                          >
                            <Icon className={cn("w-5 h-5 mb-2.5", triggerType === opt.value ? "text-foreground" : "text-muted-foreground")} />
                            <p className={cn("text-sm font-medium", triggerType === opt.value ? "" : "text-muted-foreground")}>{opt.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Scheduled sends list ── */}
                  {triggerType === "scheduled" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" /> Send Times
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Add one or more scheduled times. The earliest upcoming time activates the campaign.
                          </p>
                        </div>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs flex-shrink-0" onClick={addSchedule}>
                          <Plus className="w-3.5 h-3.5" /> Add Time
                        </Button>
                      </div>

                      {schedules.length === 0 && (
                        <div className="border border-dashed border-border rounded-lg p-6 text-center">
                          <Calendar className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-xs text-muted-foreground">No send times yet. Click "Add Time" to schedule a send.</p>
                        </div>
                      )}

                      {schedules.map((s, i) => (
                        <div key={s.id} className="flex items-center gap-2 border border-border rounded-lg p-3">
                          <span className="text-xs font-medium text-muted-foreground w-6 flex-shrink-0">#{i + 1}</span>
                          <Input
                            type="datetime-local"
                            value={s.scheduled_at}
                            onChange={e => updateSchedule(s.id, "scheduled_at", e.target.value)}
                            className="h-8 text-sm flex-1 min-w-0"
                            min={new Date().toISOString().slice(0, 16)}
                          />
                          <Input
                            value={s.label}
                            onChange={e => updateSchedule(s.id, "label", e.target.value)}
                            placeholder="Label (optional)"
                            className="h-8 text-sm w-40 flex-shrink-0"
                          />
                          <button
                            onClick={() => removeSchedule(s.id)}
                            className="p-1.5 text-muted-foreground hover:text-destructive rounded flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      {schedules.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {schedules.filter(s => s.scheduled_at).length} of {schedules.length} times set
                          {schedules[0]?.scheduled_at && ` · First send: ${new Date(schedules.sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at))[0].scheduled_at).toLocaleString()}`}
                        </p>
                      )}
                    </div>
                  )}

                  {/* ── Event triggers list ── */}
                  {triggerType === "event" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm font-medium flex items-center gap-1.5">
                            <Zap className="w-4 h-4" /> Event Triggers
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            This email fires when any of these member events occur. Each trigger fires independently.
                          </p>
                        </div>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs flex-shrink-0" onClick={addEvent}>
                          <Plus className="w-3.5 h-3.5" /> Add Trigger
                        </Button>
                      </div>

                      {events.length === 0 && (
                        <div className="border border-dashed border-border rounded-lg p-6 text-center">
                          <Zap className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-xs text-muted-foreground">No triggers yet. Click "Add Trigger" to configure your first event.</p>
                        </div>
                      )}

                      {events.map((ev, i) => (
                        <div key={ev.id} className="border border-border rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground w-6 flex-shrink-0">#{i + 1}</span>
                            <Select
                              value={ev.event}
                              onValueChange={v => updateEvent(ev.id, "event", v)}
                            >
                              <SelectTrigger className="h-8 text-sm flex-1 min-w-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EVENT_TRIGGER_GROUPS.map(group => (
                                  <SelectGroup key={group.label}>
                                    <SelectLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
                                      {group.label}
                                    </SelectLabel>
                                    {group.triggers.map(t => (
                                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                    ))}
                                  </SelectGroup>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-xs text-muted-foreground">after</span>
                              <Input
                                type="number"
                                value={ev.delay_hours}
                                onChange={e => updateEvent(ev.id, "delay_hours", Number(e.target.value))}
                                className="h-8 text-sm w-16 text-center"
                                min={0}
                                max={720}
                              />
                              <span className="text-xs text-muted-foreground">h</span>
                            </div>
                            <button
                              onClick={() => removeEvent(ev.id)}
                              className="p-1.5 text-muted-foreground hover:text-destructive rounded flex-shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[11px] text-muted-foreground ml-8">
                            {ev.delay_hours === 0
                              ? "Sends immediately when event occurs."
                              : `Sends ${ev.delay_hours}h after event.`}
                            {" "}Trigger: <span className="font-medium">{EVENT_TRIGGERS_FLAT.find(t => t.value === ev.event)?.label || ev.event}</span>
                          </p>
                        </div>
                      ))}

                      {events.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 dark:bg-amber-950/20 dark:border-amber-900 dark:text-amber-400">
                          <strong>Note:</strong> Event triggers require an active Automation to fire. Save as draft, then link this campaign to an Automation on the Email page.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TestSendModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        campaignState={currentState}
      />

      <TemplatePicker
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onApply={applyTemplate}
      />
    </>
  );
}
