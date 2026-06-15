import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { usePreferences, DEFAULT_PREFS } from "@/lib/PreferencesContext";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePlan } from "@/lib/usePlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  User, Lock, Bell, Building2, Users, ClipboardList,
  Trash2, Plus, Shield, Eye, EyeOff, Zap,
  CreditCard, MessageCircle, CheckCircle2,
  ExternalLink, ChevronRight, ChevronDown, Mail, Globe, Briefcase,
  Upload, RefreshCw, Link2, Image as ImageIcon, Search,
  LogIn, LogOut, UserPlus, PenLine, UserMinus, KeyRound,
} from "lucide-react";

// ── Shared primitives ─────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function NativeSelect({ children, ...props }) {
  return (
    <select
      {...props}
      className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors"
    >
      {children}
    </select>
  );
}

function RoleBadge({ role, isOwner }) {
  const styles = {
    owner: "bg-foreground text-background",
    admin: "bg-secondary text-foreground border border-border",
    contributor: "bg-secondary text-muted-foreground border border-border",
    viewer: "bg-secondary text-muted-foreground",
  };
  const label = isOwner ? "owner" : role;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[label] || styles.viewer}`}>
      {label}
    </span>
  );
}

function SideCard({ children }) {
  return (
    <div className="border border-border rounded-lg p-5 space-y-4 bg-secondary/20 sticky top-0">
      {children}
    </div>
  );
}

// ── Image Upload Field ─────────────────────────────────────────────────────────

function normalizeImageUrl(url) {
  if (!url) return url;
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  if (url.includes("dropbox.com")) return url.replace(/[?&]dl=\d/, "").replace(/\?$/, "") + "?raw=1";
  return url;
}

function ImageUploadField({ value, onChange, shape = "circle" }) {
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await appClient.integrations.Core.UploadFile({ file });
      onChange(result.file_url);
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
    e.target.value = "";
  };

  const applyUrl = () => {
    const normalized = normalizeImageUrl(urlInput.trim());
    if (normalized) onChange(normalized);
    setShowUrl(false);
    setUrlInput("");
  };

  const previewClass = shape === "circle"
    ? "w-16 h-16 rounded-full object-cover border-2 border-border"
    : "w-16 h-16 rounded-lg object-cover border border-border";

  const placeholderClass = shape === "circle"
    ? "w-16 h-16 rounded-full bg-secondary border-2 border-border flex items-center justify-center"
    : "w-16 h-16 rounded-lg bg-secondary border border-border flex items-center justify-center";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-4">
        {value ? (
          <img src={value} alt="" className={previewClass} />
        ) : (
          <div className={placeholderClass}>
            <ImageIcon className="w-6 h-6 text-muted-foreground opacity-40" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
              : <><Upload className="w-3.5 h-3.5" /> Upload from computer</>}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground justify-start"
            onClick={() => setShowUrl(v => !v)}
          >
            <Link2 className="w-3.5 h-3.5" />
            {showUrl ? "Hide URL input" : "Paste URL (Drive / Dropbox)"}
          </Button>
        </div>
      </div>

      {showUrl && (
        <div className="flex gap-2">
          <Input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applyUrl()}
            placeholder="https://… or Google Drive / Dropbox share link"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" className="h-8 text-xs flex-shrink-0" onClick={applyUrl}>
            Apply
          </Button>
        </div>
      )}

      {value && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          onClick={() => onChange("")}
        >
          Remove photo
        </button>
      )}
    </div>
  );
}

// ── Tab: Profile ──────────────────────────────────────────────────────────────

function ProfileTab({ user, onRefresh }) {
  const [form, setForm] = useState({ full_name: user?.full_name || "", avatar_url: user?.avatar_url || "" });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await appClient.auth.updateProfile(form);
      await onRefresh();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title="Profile" description="Manage your personal information and avatar.">
        <form onSubmit={save} className="space-y-4">
          <Field label="Full name">
            <Input
              name="full_name"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label="Email" hint="Email cannot be changed here.">
            <Input value={user?.email || ""} disabled className="opacity-60 cursor-not-allowed" />
          </Field>
          <Field label="Profile photo" hint="Upload from your computer or paste a Google Drive / Dropbox link.">
            <ImageUploadField
              value={form.avatar_url}
              onChange={url => setForm(f => ({ ...f, avatar_url: url }))}
              shape="circle"
            />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Section>

      <SideCard>
        <div className="flex flex-col items-center text-center gap-3 pb-3 border-b border-border">
          {form.avatar_url ? (
            <img src={form.avatar_url} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-border" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-secondary border-2 border-border flex items-center justify-center text-2xl font-semibold text-muted-foreground">
              {(user?.full_name || user?.email || "?")[0].toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-medium text-sm">{user?.full_name || "No name set"}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Mail className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{user?.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Member since {user?.created_date ? new Date(user.created_date).toLocaleDateString() : "-"}</span>
          </div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Tab: Security ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) { toast.error("New passwords do not match"); return; }
    if (form.new_password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setSaving(true);
    try {
      await appClient.auth.changePassword(form.current_password, form.new_password);
      toast.success("Password changed");
      setForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title="Security" description="Update your password to keep your account secure.">
        <form onSubmit={save} className="space-y-4">
          <Field label="Current password">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={form.current_password}
                onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))}
                required
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input
              type="password"
              value={form.new_password}
              onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
              required
              minLength={8}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              required
            />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Change password"}
          </Button>
        </form>
      </Section>

      <SideCard>
        <div>
          <p className="text-sm font-medium mb-2">Password requirements</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {[
              "At least 8 characters long",
              "Mix of uppercase and lowercase letters",
              "Include numbers or symbols",
              "Avoid personal information",
            ].map(req => (
              <li key={req} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                {req}
              </li>
            ))}
          </ul>
        </div>
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            After changing your password, you may be signed out of other active sessions.
          </p>
        </div>
      </SideCard>
    </div>
  );
}

// ── Searchable Timezone Select ─────────────────────────────────────────────────

const ALL_TIMEZONES = Intl.supportedValuesOf?.("timeZone") ?? ["UTC"];

function TimezoneSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  const filtered = search
    ? ALL_TIMEZONES.filter(tz => tz.toLowerCase().includes(search.toLowerCase()))
    : ALL_TIMEZONES;

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setSearch(""); }}
        className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 transition-colors text-left flex items-center justify-between"
      >
        <span className="truncate">{value || "UTC"}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 ml-2" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search timezones…"
              className="w-full h-8 px-3 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No timezones found</p>
            ) : filtered.map(tz => (
              <button
                key={tz}
                type="button"
                onClick={() => { onChange(tz); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary transition-colors ${tz === value ? "font-medium bg-secondary/50" : ""}`}
              >
                {tz}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Preferences ─────────────────────────────────────────────────────────

const LANG_LABELS = {
  en: "English",
  zh: "Chinese (Traditional)",
  "zh-cn": "Chinese (Simplified)",
};

function PreferencesTab() {
  const { prefs: contextPrefs, updatePrefs } = usePreferences();
  const { currentCompany } = useAuth();
  const [form, setForm] = useState(() => ({ ...DEFAULT_PREFS, ...contextPrefs }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...DEFAULT_PREFS, ...contextPrefs });
  }, [contextPrefs]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Preferences are per-workspace (user_preferences keyed by user+company).
      await appClient.companies.updatePreferences(currentCompany.id, form);
      updatePrefs(form);
      toast.success("Preferences saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title="Preferences" description="Customize your workspace display and notification settings.">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Theme">
              <NativeSelect value={form.theme || "system"} onChange={e => setForm(p => ({ ...p, theme: e.target.value }))}>
                <option value="system">System default</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </NativeSelect>
            </Field>
            <Field label="Language">
              <NativeSelect value={form.language || "en"} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                <option value="en">English</option>
                <option value="zh">Chinese (Traditional) 繁體中文</option>
                <option value="zh-cn">Chinese (Simplified) 简体中文</option>
              </NativeSelect>
            </Field>
            <Field label="Timezone">
              <TimezoneSelect value={form.timezone || "UTC"} onChange={tz => setForm(p => ({ ...p, timezone: tz }))} />
            </Field>
            <Field label="Date format">
              <NativeSelect value={form.date_format || "MMM d, yyyy"} onChange={e => setForm(p => ({ ...p, date_format: e.target.value }))}>
                <option value="MMM d, yyyy">Jan 15, 2025</option>
                <option value="dd/MM/yyyy">15/01/2025</option>
                <option value="MM/dd/yyyy">01/15/2025</option>
                <option value="yyyy-MM-dd">2025-01-15</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium">Notifications</label>
            {[
              { key: "campaign_completed", label: "Campaign sent",       hint: "When an email campaign finishes sending." },
              { key: "sync_status",        label: "Data sync status",    hint: "When an integration sync completes or fails." },
              { key: "new_leads",          label: "New leads captured",  hint: "When your pop-ups collect new contacts." },
            ].map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-border mt-0.5"
                  checked={form.notifications?.[key] !== false}
                  onChange={e => setForm(p => ({
                    ...p,
                    notifications: { ...(p.notifications || {}), [key]: e.target.checked },
                  }))}
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Section>

      <SideCard>
        <div>
          <p className="text-sm font-medium mb-1">About preferences</p>
          <p className="text-xs text-muted-foreground">
            Display preferences apply to your account and affect all workspaces. Notification settings control what emails you receive.
          </p>
        </div>
        <div className="pt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-xs">Current settings</p>
          <div className="flex justify-between"><span>Theme</span><span className="capitalize">{form.theme || "System"}</span></div>
          <div className="flex justify-between"><span>Language</span><span>{LANG_LABELS[form.language] || form.language || "English"}</span></div>
          <div className="flex justify-between"><span>Timezone</span><span className="truncate ml-2 text-right max-w-[120px]">{form.timezone || "UTC"}</span></div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Tab: Company ──────────────────────────────────────────────────────────────

function CompanyTab({ company, onRefresh }) {
  // currentCompany (the `company` prop) is a slim record from /me and lacks
  // website/industry/company_size/settings - fetch the full row so the form shows
  // saved values (and doesn't overwrite them with blanks on save).
  const { data: full } = useQuery({
    queryKey: ["company-full", company?.id],
    queryFn: () => appClient.companies.get(company.id),
    enabled: !!company?.id,
  });
  const [form, setForm] = useState({
    name: company?.name || "",
    website: company?.website || "",
    industry: company?.industry || "",
    company_size: company?.company_size || "",
    logo_url: company?.logo_url || "",
  });
  const [edmForm, setEdmForm] = useState({
    edm_from_name:  company?.settings?.edm_from_name  || "",
    edm_from_email: company?.settings?.edm_from_email || "",
    edm_reply_to:   company?.settings?.edm_reply_to   || "",
  });
  const [saving, setSaving] = useState(false);
  const [savingEdm, setSavingEdm] = useState(false);

  // Hydrate the forms once the full company record loads.
  useEffect(() => {
    if (!full) return;
    setForm({
      name: full.name || "",
      website: full.website || "",
      industry: full.industry || "",
      company_size: full.company_size || "",
      logo_url: full.logo_url || "",
    });
    setEdmForm({
      edm_from_name:  full.settings?.edm_from_name  || "",
      edm_from_email: full.settings?.edm_from_email || "",
      edm_reply_to:   full.settings?.edm_reply_to   || "",
    });
  }, [full]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await appClient.companies.update(company.id, form);
      await onRefresh();
      toast.success("Company updated");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdm = async (e) => {
    e.preventDefault();
    setSavingEdm(true);
    try {
      await appClient.companies.update(company.id, { settings: edmForm });
      await onRefresh();
      toast.success("Email sending defaults saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEdm(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title="Company profile" description="Update your company's name, branding and details.">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Company name">
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Website">
              <Input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://acme.com" />
            </Field>
            <Field label="Industry">
              <NativeSelect value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                <option value="">Select industry…</option>
                {["Technology", "Finance", "Healthcare", "Retail", "Education", "Marketing", "Media", "Real Estate", "Other"].map(i => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Company size">
              <NativeSelect value={form.company_size} onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))}>
                <option value="">Select size…</option>
                {["1-10", "11-50", "51-200", "201-1000", "1000+"].map(s => (
                  <option key={s} value={s}>{s} employees</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Company logo" hint="Upload from your computer or paste a Google Drive / Dropbox link.">
            <ImageUploadField
              value={form.logo_url}
              onChange={url => setForm(f => ({ ...f, logo_url: url }))}
              shape="square"
            />
          </Field>
          <Field label="Plan" hint="Contact support to change your plan.">
            <Input value={company?.plan || "free"} disabled className="opacity-60 cursor-not-allowed capitalize" />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Section>

      <Section title="Email sending defaults" description="Default sender used for EDM campaigns when no override is set on the campaign itself.">
        <form onSubmit={saveEdm} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From name" hint="Displayed as the sender name in recipients' inboxes.">
              <Input
                value={edmForm.edm_from_name}
                onChange={e => setEdmForm(f => ({ ...f, edm_from_name: e.target.value }))}
                placeholder="Acme Inc."
              />
            </Field>
            <Field label="From email" hint="Must be a verified sender address with your ESP.">
              <Input
                type="email"
                value={edmForm.edm_from_email}
                onChange={e => setEdmForm(f => ({ ...f, edm_from_email: e.target.value }))}
                placeholder="hello@yourdomain.com"
              />
            </Field>
          </div>
          <Field label="Reply-to" hint="Optional. Replies will go to this address instead of the from address.">
            <Input
              type="email"
              value={edmForm.edm_reply_to}
              onChange={e => setEdmForm(f => ({ ...f, edm_reply_to: e.target.value }))}
              placeholder="replies@yourdomain.com"
            />
          </Field>
          <Button type="submit" size="sm" disabled={savingEdm}>
            {savingEdm ? "Saving…" : "Save email defaults"}
          </Button>
        </form>
      </Section>

      <SideCard>
        <div className="flex flex-col items-center text-center gap-3 pb-3 border-b border-border">
          {form.logo_url ? (
            <img src={form.logo_url} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-border" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-secondary border border-border flex items-center justify-center">
              <Building2 className="w-7 h-7 text-muted-foreground" />
            </div>
          )}
          <div>
            <p className="font-medium text-sm">{form.name || "Company name"}</p>
            {form.website && <p className="text-xs text-muted-foreground">{form.website}</p>}
          </div>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          {form.industry && (
            <div className="flex items-center gap-2"><Briefcase className="w-3.5 h-3.5 flex-shrink-0" /><span>{form.industry}</span></div>
          )}
          {form.company_size && (
            <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5 flex-shrink-0" /><span>{form.company_size} employees</span></div>
          )}
          {form.website && (
            <div className="flex items-center gap-2"><Globe className="w-3.5 h-3.5 flex-shrink-0" /><a href={form.website} target="_blank" rel="noopener noreferrer" className="truncate hover:text-foreground transition-colors">{form.website}</a></div>
          )}
          <div className="pt-2 border-t border-border flex items-center justify-between">
            <span>Plan</span>
            <span className="capitalize font-medium text-foreground">{company?.plan || "free"}</span>
          </div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Invite section - gated by the live plan's team-member limit ──────────────
// The limit comes straight from the plan catalog (planConfig.limits.team_members),
// which a platform admin can change at any time - so this reflects whatever the
// current plan allows, with no hardcoded per-plan rules. null = unlimited.

function InviteSection({ company, invite, inviteEmail, setInviteEmail, inviteRole, setInviteRole, inviting, activeMemberCount = 0 }) {
  const { upgradePlan, planConfig, limits } = usePlan();

  const teamLimit = limits?.team_members ?? null;        // null = unlimited
  const atLimit = teamLimit != null && activeMemberCount >= teamLimit;

  if (atLimit) {
    // Only surface an upgrade CTA if a higher tier actually grants more seats
    // (a platform admin may have set both plans to the same limit).
    const upgradeSeats = upgradePlan?.limits?.team_members;
    const upgradeGivesMore = !!upgradePlan && (upgradeSeats == null || Number(upgradeSeats) > teamLimit);
    const upgradeLabel = upgradePlan
      ? (upgradePlan.period
          ? `Upgrade to ${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
          : `Upgrade to ${upgradePlan.name}`)
      : "Upgrade your plan";

    return (
      <Section title="Invite member">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-secondary/30">
          <Zap className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              You've reached your plan's limit of {teamLimit} team member{teamLimit === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {upgradeGivesMore
                ? `Upgrade to ${upgradePlan.name} to invite more, or contact support to raise the limit on your ${planConfig?.name ?? "current"} plan.`
                : "Remove a member to free up a seat, or contact support to raise your team-member limit."}
            </p>
            {upgradeGivesMore && (
              <Link
                to="/settings?tab=billing"
                className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:bg-primary/90 transition-colors"
              >
                <Zap className="w-3 h-3" />
                {upgradeLabel}
              </Link>
            )}
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Invite member"
      description={teamLimit != null
        ? `${activeMemberCount} of ${teamLimit} seats used on your ${planConfig?.name ?? "current"} plan.`
        : "Invite teammates to this workspace by email."}
    >
      <form onSubmit={invite} className="grid grid-cols-[1fr_160px_auto] gap-3 items-end">
        <Field label="Email">
          <Input
            type="email"
            required
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
          />
        </Field>
        <Field label="Role">
          <NativeSelect value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="contributor">Contributor</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </Field>
        <Button type="submit" size="sm" disabled={inviting} className="gap-1.5 mb-px">
          <Plus className="w-3.5 h-3.5" />
          {inviting ? "Sending…" : "Send invite"}
        </Button>
      </form>
    </Section>
  );
}

// ── Tab: Members ──────────────────────────────────────────────────────────────

function MembersTab({ company, currentUserId }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [m, i] = await Promise.all([
        appClient.companies.getMembers(company.id),
        appClient.companies.getInvitations(company.id),
      ]);
      setMembers(m);
      setInvitations(i);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [company.id]);

  const invite = async (e) => {
    e.preventDefault();
    setInviting(true);
    try {
      await appClient.companies.invite(company.id, inviteEmail, inviteRole);
      setInviteEmail("");
      await load();
      toast.success(`Invitation sent to ${inviteEmail}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setInviting(false);
    }
  };

  const updateRole = async (memberId, role) => {
    try {
      await appClient.companies.updateMember(company.id, memberId, { role });
      await load();
      toast.success("Role updated");
    } catch (err) { toast.error(err.message); }
  };

  const removeMember = async (memberId, name) => {
    if (!confirm(`Remove ${name} from this company?`)) return;
    try {
      await appClient.companies.removeMember(company.id, memberId);
      await load();
      toast.success("Member removed");
    } catch (err) { toast.error(err.message); }
  };

  const cancelInvite = async (invId, email) => {
    try {
      await appClient.companies.cancelInvitation(company.id, invId);
      await load();
      toast.success(`Invitation to ${email} cancelled`);
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <InviteSection
        company={company}
        invite={invite}
        inviteEmail={inviteEmail}
        setInviteEmail={setInviteEmail}
        inviteRole={inviteRole}
        setInviteRole={setInviteRole}
        inviting={inviting}
        activeMemberCount={members.filter(m => m.status === "active").length}
      />

      <Section title="Team members" description={`${members.length} member${members.length !== 1 ? "s" : ""} in this workspace.`}>
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_1fr_120px_100px_40px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
            <span />
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Joined</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {members.map(m => (
              <div key={m.id} className="grid grid-cols-[40px_1fr_1fr_120px_100px_40px] gap-3 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium flex-shrink-0">
                  {(m.full_name || m.email || "?")[0].toUpperCase()}
                </div>
                <p className="text-sm font-medium truncate">{m.full_name || "-"}</p>
                <p className="text-sm text-muted-foreground truncate">{m.email}</p>
                <div>
                  {!m.is_account_owner && m.user_id !== currentUserId ? (
                    <select
                      value={m.role}
                      onChange={e => updateRole(m.id, e.target.value)}
                      className="text-xs border border-border rounded px-1.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring w-full"
                    >
                      <option value="admin">Admin</option>
                      <option value="contributor">Contributor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <RoleBadge role={m.role} isOwner={m.is_account_owner} />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "-"}</p>
                <div className="flex justify-center">
                  {!m.is_account_owner && m.user_id !== currentUserId && (
                    <button
                      onClick={() => removeMember(m.id, m.full_name || m.email)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {invitations.length > 0 && (
        <Section title="Pending invitations">
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_160px_80px_40px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Email</span><span>Role</span><span>Expires</span><span>Status</span><span />
            </div>
            <div className="divide-y divide-border">
              {invitations.map(inv => (
                <div key={inv.id} className="grid grid-cols-[1fr_120px_160px_80px_40px] gap-3 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  <p className="text-sm truncate">{inv.email}</p>
                  <RoleBadge role={inv.role} />
                  <p className="text-xs text-muted-foreground">{new Date(inv.expires_at).toLocaleDateString()}</p>
                  <span className="text-xs px-2 py-0.5 bg-secondary text-foreground border border-border rounded-full font-medium w-fit">
                    Pending
                  </span>
                  <div className="flex justify-center">
                    <button
                      onClick={() => cancelInvite(inv.id, inv.email)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Tab: Audit Log ────────────────────────────────────────────────────────────

const ACTION_META = {
  login:            { label: "Signed in",       icon: LogIn,      color: "text-foreground",        bg: "bg-secondary" },
  logout:           { label: "Signed out",      icon: LogOut,     color: "text-muted-foreground",  bg: "bg-secondary" },
  register:         { label: "Registered",      icon: UserPlus,   color: "text-foreground",        bg: "bg-secondary" },
  create:           { label: "Created",         icon: Plus,       color: "text-foreground",        bg: "bg-secondary" },
  update:           { label: "Updated",         icon: PenLine,    color: "text-muted-foreground",  bg: "bg-secondary" },
  delete:           { label: "Deleted",         icon: Trash2,     color: "text-destructive",       bg: "bg-destructive/10" },
  invite_member:    { label: "Invited member",  icon: UserPlus,   color: "text-foreground",        bg: "bg-secondary" },
  remove_member:    { label: "Removed member",  icon: UserMinus,  color: "text-destructive",       bg: "bg-destructive/10" },
  password_changed: { label: "Changed password",icon: KeyRound,   color: "text-muted-foreground",  bg: "bg-secondary" },
};

const RESOURCE_LABELS = {
  user: "profile",
  company: "workspace",
  campaign: "email campaign",
  segment: "segment",
  popup: "pop-up",
  template: "template",
  api_key: "API key",
};

function formatAuditAction(action, resourceType) {
  const meta = ACTION_META[action];
  const label = meta?.label ?? action.replace(/_/g, " ");
  if (!resourceType || ["login", "logout", "register", "password_changed"].includes(action)) return label;
  const resLabel = RESOURCE_LABELS[resourceType] ?? resourceType;
  return `${label} ${resLabel}`;
}

function relativeTime(val) {
  if (!val) return "-";
  const diff = Date.now() - new Date(val).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 30) return `${days}d ago`;
  return new Date(val).toLocaleDateString();
}

function AuditLogTab({ company }) {
  const { formatDateTime } = usePreferences();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  useEffect(() => {
    appClient.companies.getAuditLog(company.id, 200)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [company.id]);

  const uniqueActions = [...new Set(logs.map(l => l.action))];

  const filtered = logs.filter(l => {
    const desc = formatAuditAction(l.action, l.resource_type).toLowerCase();
    const actor = (l.user_email || "system").toLowerCase();
    if (search && !actor.includes(search.toLowerCase()) && !desc.includes(search.toLowerCase())) return false;
    if (actionFilter && l.action !== actionFilter) return false;
    if (dateFilter === "today") {
      const today = new Date();
      if (new Date(l.occurred_at).toDateString() !== today.toDateString()) return false;
    }
    if (dateFilter === "week" && Date.now() - new Date(l.occurred_at).getTime() > 7 * 86_400_000) return false;
    if (dateFilter === "month" && Date.now() - new Date(l.occurred_at).getTime() > 30 * 86_400_000) return false;
    return true;
  });

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-border border-t-foreground rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight">Audit log</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Activity history for this workspace.</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search user or activity…"
            className="pl-8 h-8 text-sm w-56"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="h-8 px-2.5 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All actions</option>
          {uniqueActions.map(a => (
            <option key={a} value={a}>{ACTION_META[a]?.label ?? a.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="h-8 px-2.5 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} of {logs.length} entries</span>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
          <ClipboardList className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">{logs.length === 0 ? "No activity yet." : "No entries match your filters."}</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_180px] gap-4 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
            <span>User</span>
            <span>Activity</span>
            <span>Date &amp; Time</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map(l => {
              const desc = formatAuditAction(l.action, l.resource_type);
              const actor = l.user_email || "System";
              return (
                <div key={l.id} className="grid grid-cols-[1fr_2fr_180px] gap-4 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  <p className="text-sm font-medium truncate">{actor}</p>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(l.occurred_at)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Billing & Usage ──────────────────────────────────────────────────────

function UsageBar({ label, used, limit, unlimited }) {
  const pct = (!unlimited && limit > 0) ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = pct >= 90;
  const warn   = pct >= 70;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">
          {used.toLocaleString()} / {unlimited ? "Unlimited" : limit?.toLocaleString() ?? "-"}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              danger ? "bg-destructive" : warn ? "bg-foreground/60" : "bg-foreground"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BillingTab({ company }) {
  const { planConfig, upgradePlan, isFreePlan, isPaidPlan, isTrialExpired, daysLeft, upgradedAt, plans } = usePlan();

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ["billing-usage", company?.id],
    queryFn: appClient.billing.getUsage,
    enabled: !!company?.id,
    staleTime: 60_000,
  });

  const limits = planConfig?.limits ?? {};

  const badgeClass = "text-xs px-2 py-0.5 rounded-full bg-secondary text-foreground font-medium border border-border";
  const statusBadge = isTrialExpired
    ? <span className={badgeClass}>Trial expired</span>
    : isFreePlan
      ? <span className={badgeClass}>{daysLeft}d left in trial</span>
      : <span className={badgeClass}>Active</span>;

  // Free upgrades go through sales; surface the paid plan's contact link directly.
  const isContactSales = upgradePlan?.cta_external;

  const usageItems = [
    { key: "team_members", label: "Team members",      limitKey: "team_members" },
    { key: "campaigns",    label: "Email campaigns",   limitKey: "campaigns"    },
    { key: "ai_tokens",    label: "AI tokens",         limitKey: "ai_tokens"    },
    { key: "profiles",     label: "Customer profiles", limitKey: "profiles"     },
  ];

  return (
    <div className="space-y-8">

      {/* Current plan */}
      <Section title="Current plan" description="Your active plan and trial status.">
        <div className="border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-base">{planConfig?.name ?? "Free"}</p>
              {planConfig?.badge && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium">
                  {planConfig.badge}
                </span>
              )}
              {statusBadge}
            </div>
            {upgradePlan && (
              <a
                href={isContactSales ? upgradePlan.cta_href : "/settings?tab=billing"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:bg-primary/90 transition-colors"
              >
                <Zap className="w-3 h-3" />
                {isContactSales ? `Contact sales to upgrade` : `Upgrade to ${upgradePlan.name}`}
              </a>
            )}
          </div>
          {planConfig?.description && <p className="text-sm text-muted-foreground">{planConfig.description}</p>}
          {isPaidPlan ? (
            <p className="text-sm font-medium">
              Upgraded on{" "}
              <span className="text-muted-foreground font-normal">
                {upgradedAt ? upgradedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "-"}
              </span>
            </p>
          ) : planConfig?.price_display && (
            <p className="text-sm font-medium">
              {planConfig.price_display}
              {planConfig.period && <span className="text-muted-foreground font-normal"> / {planConfig.period}</span>}
            </p>
          )}
        </div>
      </Section>

      {/* Detailed usage */}
      <Section title="Usage this period" description="Account-wide totals tracked against your plan limits.">
        {usageLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {usageItems.map(({ key, label, limitKey }) => {
              const limit = limits[limitKey];
              return (
                <div key={key} className="border border-border rounded-lg px-5 py-4">
                  <UsageBar
                    label={label}
                    used={usage?.[key] ?? 0}
                    limit={limit}
                    unlimited={limit === null || limit === undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Usage by workspace */}
      {usage?.workspaces?.length > 0 && (
        <Section title="Usage by workspace" description="How the account total breaks down across your workspaces.">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Workspace</th>
                  <th className="text-right font-medium px-4 py-2.5">Members</th>
                  <th className="text-right font-medium px-4 py-2.5">Profiles</th>
                  <th className="text-right font-medium px-4 py-2.5">Campaigns</th>
                  <th className="text-right font-medium px-4 py-2.5">AI tokens</th>
                </tr>
              </thead>
              <tbody>
                {usage.workspaces.map((w) => (
                  <tr key={w.id} className={`border-t border-border ${w.id === company?.id ? "bg-secondary/20" : ""}`}>
                    <td className="px-4 py-2.5 font-medium">
                      {w.name}
                      {w.id === company?.id && <span className="ml-1.5 text-[10px] text-muted-foreground">(current)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.team_members.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.profiles.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.campaigns.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.ai_tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  <td className="px-4 py-2.5">Account total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.team_members ?? usage.team_members ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.profiles ?? usage.profiles ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.campaigns ?? usage.campaigns ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.ai_tokens ?? usage.ai_tokens ?? 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      {/* All plans */}
      <Section title="All plans" description="Compare plans and upgrade at any time.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          {plans.filter(p => p.is_active).map(p => (
            <div
              key={p.id}
              className={`border rounded-lg p-5 space-y-4 ${
                p.is_highlighted ? "border-primary/50 bg-primary/5" : "border-border"
              } ${p.id === company?.plan ? "ring-2 ring-primary/30" : ""}`}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold">{p.name}</p>
                  {p.id === company?.plan && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Current</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <p className="text-xl font-bold mt-3">
                  {p.price_display}
                  {p.period && <span className="text-xs font-normal text-muted-foreground"> / {p.period}</span>}
                </p>
              </div>
              <ul className="space-y-1.5">
                {(p.features || []).map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              {p.id !== company?.plan && (
                p.cta_external
                  ? <a href={p.cta_href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {p.cta_label} <ExternalLink className="w-3 h-3" />
                    </a>
                  : <Link to={p.cta_href} className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                      {p.cta_label} <ChevronRight className="w-3 h-3" />
                    </Link>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Tab: Support & Feedback ───────────────────────────────────────────────────

const TICKET_TYPES = [
  { value: "feedback",        label: "General feedback" },
  { value: "bug",             label: "Bug report" },
  { value: "feature_request", label: "Feature request" },
  { value: "support",         label: "Support request" },
];

const TICKET_PRIORITIES = [
  { value: "low",    label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high",   label: "High" },
  { value: "urgent", label: "Urgent" },
];

const ticketStatusLabel = {
  open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed",
};

function SupportTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ type: "feedback", subject: "", body: "", priority: "normal" });
  const [submitting, setSubmitting] = useState(false);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: appClient.support.listTickets,
    staleTime: 30_000,
  });

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await appClient.support.createTicket(form);
      toast.success("Ticket submitted - we'll be in touch soon.");
      setForm({ type: "feedback", subject: "", body: "", priority: "normal" });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_360px] gap-8 items-start">
      <Section title="Submit feedback or raise a ticket" description="We read every submission and aim to respond within 1 business day.">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <NativeSelect value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TICKET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Priority">
              <NativeSelect value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {TICKET_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Subject">
            <Input
              required
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Brief summary of your issue or idea"
            />
          </Field>
          <Field label="Details">
            <Textarea
              required
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Describe your feedback, the steps to reproduce a bug, or what you'd like to see..."
              rows={6}
              className="resize-none"
            />
          </Field>
          <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" />
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </form>
      </Section>

      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">Your submissions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Tickets and feedback you've previously raised.</p>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-lg" />)}
          </div>
        ) : tickets.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
            <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {tickets.map(t => (
              <div key={t.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.body}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="capitalize">{TICKET_TYPES.find(x => x.value === t.type)?.label ?? t.type}</span>
                    <span>·</span>
                    <span>{new Date(t.created_date).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0 pt-0.5">
                  {ticketStatusLabel[t.status] ?? t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile",     label: "Profile",     icon: User },
  { id: "security",    label: "Security",    icon: Lock },
  { id: "preferences", label: "Preferences", icon: Bell },
  { id: "billing",     label: "Billing",     icon: CreditCard },
  { id: "company",     label: "Company",     icon: Building2,     adminOnly: true },
  { id: "members",     label: "Members",     icon: Users,         adminOnly: true },
  { id: "audit-log",   label: "Audit Log",   icon: ClipboardList, adminOnly: true },
  { id: "support",     label: "Support",     icon: MessageCircle },
];

export default function Settings() {
  const { user, currentCompany, refreshUser } = useAuth();
  const { t } = usePreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "profile";

  const role = user?.companies?.find(c => c.id === currentCompany?.id)?.role;
  const isAdmin = role === "admin";

  const visibleTabs = TABS.filter(tab => !tab.adminOnly || isAdmin);
  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-8 pt-8 pb-6 flex-shrink-0 border-b border-border">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Settings")}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your account, workspace and preferences.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 flex-shrink-0 border-r border-border px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                activeTab === tab.id
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <tab.icon className="w-4 h-4 flex-shrink-0" />
              {t(tab.label)}
            </button>
          ))}
          {isAdmin && (
            <div className="pt-4 mt-2 border-t border-border flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
              <Shield className="w-3 h-3" />
              <span className="capitalize">{role}</span>
            </div>
          )}
        </aside>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === "profile"     && <ProfileTab user={user} onRefresh={refreshUser} />}
          {activeTab === "security"    && <SecurityTab />}
          {activeTab === "preferences" && <PreferencesTab />}
          {activeTab === "company"     && isAdmin && <CompanyTab company={currentCompany} onRefresh={refreshUser} />}
          {activeTab === "members"     && isAdmin && <MembersTab company={currentCompany} currentUserId={user?.id} />}
          {activeTab === "audit-log"   && isAdmin && <AuditLogTab company={currentCompany} />}
          {activeTab === "billing"     && <BillingTab company={currentCompany} />}
          {activeTab === "support"     && <SupportTab />}
        </main>
      </div>
    </div>
  );
}
