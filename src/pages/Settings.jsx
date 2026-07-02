import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { usePreferences, DEFAULT_PREFS } from "@/lib/PreferencesContext";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePlan } from "@/lib/usePlan";
import { passwordError, PASSWORD_HINT } from "@/lib/password";
import { TOKENS_PER_CREDIT, toCredits } from "@/lib/credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  User, Lock, Bell, Building2, Users, ClipboardList,
  Trash2, Plus, Shield, Eye, EyeOff, Zap,
  CreditCard, MessageCircle, CheckCircle2,
  ExternalLink, ChevronRight, ChevronDown, Mail,
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
  const { t } = usePreferences();
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
      toast.success(t("Photo uploaded"));
    } catch (err) {
      toast.error(err.message || t("Upload failed"));
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
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t("Uploading…")}</>
              : <><Upload className="w-3.5 h-3.5" /> {t("Upload from computer")}</>}
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
            {showUrl ? t("Hide URL input") : t("Paste URL (Drive / Dropbox)")}
          </Button>
        </div>
      </div>

      {showUrl && (
        <div className="flex gap-2">
          <Input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && applyUrl()}
            placeholder={t("https://… or Google Drive / Dropbox share link")}
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" className="h-8 text-xs flex-shrink-0" onClick={applyUrl}>
            {t("Apply")}
          </Button>
        </div>
      )}

      {value && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          onClick={() => onChange("")}
        >
          {t("Remove photo")}
        </button>
      )}
    </div>
  );
}

// ── Tab: Profile ──────────────────────────────────────────────────────────────

function ProfileTab({ user, onRefresh }) {
  const { t } = usePreferences();
  const [form, setForm] = useState({ full_name: user?.full_name || "", avatar_url: user?.avatar_url || "" });
  const [saving, setSaving] = useState(false);

  // Persist the avatar as soon as it's uploaded / changed / removed so it survives
  // a refresh without needing a separate "Save changes" click. (Full name still
  // saves via the button below.)
  const updateAvatar = async (url) => {
    setForm(f => ({ ...f, avatar_url: url }));
    try {
      await appClient.auth.updateProfile({ avatar_url: url });
      await onRefresh();
    } catch (err) {
      toast.error(err.message || t("Could not save photo"));
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await appClient.auth.updateProfile(form);
      await onRefresh();
      toast.success(t("Profile updated"));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title={t("Profile")} description={t("Manage your personal information and avatar.")}>
        <form onSubmit={save} className="space-y-4">
          <Field label={t("Full name")}>
            <Input
              name="full_name"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            />
          </Field>
          <Field label={t("Email")} hint={t("Email cannot be changed here.")}>
            <Input value={user?.email || ""} disabled className="opacity-60 cursor-not-allowed" />
          </Field>
          <Field label={t("Profile photo")} hint={t("Upload from your computer or paste a Google Drive / Dropbox link.")}>
            <ImageUploadField
              value={form.avatar_url}
              onChange={updateAvatar}
              shape="circle"
            />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t("Saving…") : t("Save changes")}
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
            <p className="font-medium text-sm">{user?.full_name || t("No name set")}</p>
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
            <span>{t("Member since")} {user?.created_date ? new Date(user.created_date).toLocaleDateString() : "-"}</span>
          </div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Tab: Security ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const { t } = usePreferences();
  const { user } = useAuth();
  // OAuth-only accounts (no password) sign in via Google/Microsoft - password
  // management and email-OTP MFA don't apply to them.
  const oauthOnly = user?.has_password === false;
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [show, setShow] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (form.new_password !== form.confirm) { toast.error(t("New passwords do not match")); return; }
    const pwErr = passwordError(form.new_password);
    if (pwErr) { toast.error(t(pwErr)); return; }
    setSaving(true);
    try {
      await appClient.auth.changePassword(form.current_password, form.new_password);
      toast.success(t("Password changed"));
      setForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-10">
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section
        title={t("Security")}
        description={oauthOnly ? t("Your sign-in is managed by your identity provider.") : t("Update your password to keep your account secure.")}
      >
        {oauthOnly ? (
          <div className="flex items-start gap-3 rounded-md border border-border p-4">
            <KeyRound className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              {t("You sign in with Google or Microsoft, so this account doesn't use a password. Manage your sign-in security from your Google or Microsoft account.")}
            </p>
          </div>
        ) : (
        <form onSubmit={save} className="space-y-4">
          <Field label={t("Current password")}>
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
          <Field label={t("New password")} hint={t(PASSWORD_HINT)}>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={form.new_password}
                onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label={t("Confirm new password")}>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t("Saving…") : t("Change password")}
          </Button>
        </form>
        )}
      </Section>

      {!oauthOnly && (
      <SideCard>
        <div>
          <p className="text-sm font-medium mb-2">{t("Password requirements")}</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {[
              t("At least 8 characters long"),
              t("At least one capital letter"),
              t("At least one number"),
              t("At least one symbol"),
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
            {t("After changing your password, you may be signed out of other active sessions.")}
          </p>
        </div>
      </SideCard>
      )}
    </div>

    <TwoFactorCard />
    </div>
  );
}

// ── Two-factor authentication (email OTP) ─────────────────────────────────────
//  Opt-in. Enabling sends a confirmation code to the account email; disabling
//  asks for the current password (left blank for OAuth-only accounts).
function TwoFactorCard() {
  const { t } = usePreferences();
  const { user, refreshUser } = useAuth();
  const enabled = !!user?.mfa_enabled;
  // OAuth-only accounts don't use the password login path, so email-OTP MFA
  // would never challenge them - 2FA is handled by their identity provider.
  const oauthOnly = user?.has_password === false;
  const [mode, setMode] = useState(null); // null | 'enabling' | 'disabling'
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const startEnable = async () => {
    setBusy(true);
    try {
      const r = await appClient.auth.mfaSetup();
      setMode("enabling");
      setCode("");
      if (r?.sent) toast.success(t("We emailed you a confirmation code."));
      else toast.error(r?.error ? `${t("Couldn't send the code:")} ${r.error}` : t("Couldn't send the code. Try again."));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e) => {
    e.preventDefault();
    if (code.length !== 6) { toast.error(t("Enter the 6-digit code")); return; }
    setBusy(true);
    try {
      await appClient.auth.mfaEnable(code);
      await refreshUser();
      setMode(null); setCode("");
      toast.success(t("Two-factor authentication is on."));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await appClient.auth.mfaDisable(password);
      await refreshUser();
      setMode(null); setPassword("");
      toast.success(t("Two-factor authentication is off."));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  // OAuth-only account: explain that 2FA lives with their provider; no toggle.
  if (oauthOnly) {
    return (
      <Section
        title={t("Two-factor authentication")}
        description={t("Sign-in security for this account is managed by your identity provider.")}
      >
        <div className="flex items-start gap-3 rounded-md border border-border p-4">
          <Shield className="w-5 h-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            {t("You sign in with Google or Microsoft. Two-factor authentication is managed in your Google or Microsoft account settings.")}
          </p>
        </div>
      </Section>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section
        title={t("Two-factor authentication")}
        description={t("Require a code sent to your email each time you sign in with a password.")}
      >
        <div className="flex items-center gap-3 rounded-md border border-border p-4">
          <Shield className={`w-5 h-5 ${enabled ? "text-foreground" : "text-muted-foreground"}`} />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {enabled ? t("Two-factor is on") : t("Two-factor is off")}
            </p>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? t("You'll be asked for an emailed code when signing in.")
                : t("Add an extra layer of security to your account.")}
            </p>
          </div>
          {!mode && (
            enabled ? (
              <Button type="button" size="sm" variant="outline" onClick={() => { setMode("disabling"); setPassword(""); }}>
                {t("Turn off")}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={startEnable} disabled={busy}>
                {busy ? t("Sending…") : t("Enable")}
              </Button>
            )
          )}
        </div>

        {mode === "enabling" && (
          <form onSubmit={confirmEnable} className="space-y-3 rounded-md border border-border p-4">
            <Field label={t("Enter the 6-digit code we emailed you")}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t("6-digit confirmation code")}
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
                {busy ? t("Verifying…") : t("Confirm & turn on")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={startEnable} disabled={busy}>
                {t("Resend code")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setMode(null); setCode(""); }}>
                {t("Cancel")}
              </Button>
            </div>
          </form>
        )}

        {mode === "disabling" && (
          <form onSubmit={confirmDisable} className="space-y-3 rounded-md border border-border p-4">
            <Field
              label={t("Confirm your password to turn off two-factor")}
              hint={t("Signed in with Google or Microsoft? Leave this blank.")}
            >
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="destructive" disabled={busy}>
                {busy ? t("Turning off…") : t("Turn off two-factor")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setMode(null); setPassword(""); }}>
                {t("Cancel")}
              </Button>
            </div>
          </form>
        )}
      </Section>

      <SideCard>
        <div>
          <p className="text-sm font-medium mb-2">{t("How it works")}</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {[
              t("We email a 6-digit code at sign-in"),
              t("Codes expire after 10 minutes"),
              t("Applies to password sign-in"),
            ].map(req => (
              <li key={req} className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                {req}
              </li>
            ))}
          </ul>
        </div>
      </SideCard>
    </div>
  );
}

// ── Searchable Timezone Select ─────────────────────────────────────────────────

const ALL_TIMEZONES = Intl.supportedValuesOf?.("timeZone") ?? ["UTC"];

function TimezoneSelect({ value, onChange }) {
  const { t } = usePreferences();
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
              placeholder={t("Search timezones…")}
              className="w-full h-8 px-3 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">{t("No timezones found")}</p>
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
  const { prefs: contextPrefs, updatePrefs, t } = usePreferences();
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
      toast.success(t("Preferences saved"));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title={t("Preferences")} description={t("Customize your workspace display and notification settings.")}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("Theme")}>
              <NativeSelect value={form.theme || "system"} onChange={e => setForm(p => ({ ...p, theme: e.target.value }))}>
                <option value="system">{t("System default")}</option>
                <option value="light">{t("Light")}</option>
                <option value="dark">{t("Dark")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("Language")}>
              <NativeSelect value={form.language || "en"} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                <option value="en">English</option>
                <option value="zh">Chinese (Traditional) 繁體中文</option>
                <option value="zh-cn">Chinese (Simplified) 简体中文</option>
              </NativeSelect>
            </Field>
            <Field label={t("Timezone")}>
              <TimezoneSelect value={form.timezone || "UTC"} onChange={tz => setForm(p => ({ ...p, timezone: tz }))} />
            </Field>
            <Field label={t("Date format")}>
              <NativeSelect value={form.date_format || "MMM d, yyyy"} onChange={e => setForm(p => ({ ...p, date_format: e.target.value }))}>
                <option value="MMM d, yyyy">Jan 15, 2025</option>
                <option value="dd/MM/yyyy">15/01/2025</option>
                <option value="MM/dd/yyyy">01/15/2025</option>
                <option value="yyyy-MM-dd">2025-01-15</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium">{t("Notifications")}</label>
            {[
              { key: "campaign_completed", label: t("Campaign sent"),       hint: t("When an email campaign finishes sending.") },
              { key: "sync_status",        label: t("Data sync status"),    hint: t("When an integration sync completes or fails.") },
              { key: "new_leads",          label: t("New leads captured"),  hint: t("When your pop-ups collect new contacts.") },
            ].map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-border mt-0.5 accent-foreground"
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
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </form>
      </Section>

      <SideCard>
        <div>
          <p className="text-sm font-medium mb-1">{t("About preferences")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Display preferences apply to your account and affect all workspaces. Notification settings control what emails you receive.")}
          </p>
        </div>
        <div className="pt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-xs">{t("Current settings")}</p>
          <div className="flex justify-between"><span>{t("Theme")}</span><span className="capitalize">{form.theme || "System"}</span></div>
          <div className="flex justify-between"><span>{t("Language")}</span><span>{LANG_LABELS[form.language] || form.language || "English"}</span></div>
          <div className="flex justify-between"><span>{t("Timezone")}</span><span className="truncate ml-2 text-right max-w-[120px]">{form.timezone || "UTC"}</span></div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Tab: Company ──────────────────────────────────────────────────────────────

function CompanyTab({ company, onRefresh }) {
  const { t } = usePreferences();
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

  // Delete-account danger zone (type-email-to-confirm). Eligibility (owner /
  // solo / single-workspace) is decided server-side and re-checked on delete.
  const { logout } = useAuth();
  const { data: delStatus } = useQuery({
    queryKey: ["account-deletion-status"],
    queryFn: () => appClient.account.deletionStatus(),
  });
  const [showDelete, setShowDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const confirmEmail = delStatus?.email || "";

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
      toast.success(t("Company updated"));
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
      toast.success(t("Email sending defaults saved"));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingEdm(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      await appClient.account.delete(confirmText.trim());
      toast.success(t("Account deleted"));
      // The account (incl. this login) is gone - clear local state and hard-reload
      // to the signed-out landing page.
      localStorage.removeItem("cdp_company_id");
      await logout();
      window.location.assign("/");
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  };

  const contactSupportToDelete = () => {
    const subject = "Account deletion request";
    const body = "I'd like to permanently delete my account and all of its workspaces and data.";
    window.location.href =
      `mailto:support@clickcdp.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="space-y-8">
    <div className="space-y-8 max-w-3xl">
      <Section title={t("Company profile")} description={t("Update your company's name, branding and details.")}>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("Company name")}>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label={t("Website")}>
              <Input type="url" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://acme.com" />
            </Field>
            <Field label={t("Industry")}>
              <NativeSelect value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                <option value="">{t("Select industry…")}</option>
                {["Technology", "Finance", "Healthcare", "Retail", "Education", "Marketing", "Media", "Real Estate", "Other"].map(i => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("Company size")}>
              <NativeSelect value={form.company_size} onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))}>
                <option value="">{t("Select size…")}</option>
                {["1-10", "11-50", "51-200", "201-1000", "1000+"].map(s => (
                  <option key={s} value={s}>{s} {t("employees")}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t("Company logo")} hint={t("Upload from your computer or paste a Google Drive / Dropbox link.")}>
            <ImageUploadField
              value={form.logo_url}
              onChange={url => setForm(f => ({ ...f, logo_url: url }))}
              shape="square"
            />
          </Field>
          <Field label={t("Plan")} hint={t("Contact support to change your plan.")}>
            <Input value={company?.plan || "lite"} disabled className="opacity-60 cursor-not-allowed capitalize" />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </form>
      </Section>

      <Section title={t("Email sending defaults")} description={t("Default sender used for EDM campaigns when no override is set on the campaign itself.")}>
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {t("Coming soon — you'll be able to set these once the Email page launches.")}
        </div>
        <form onSubmit={saveEdm}>
          {/* Disabled until the Email page ships: a native disabled fieldset greys
              out and blocks every control inside (inputs + save button). */}
          <fieldset disabled aria-disabled="true" className="space-y-4 opacity-60 cursor-not-allowed">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("From name")} hint={t("Displayed as the sender name in recipients' inboxes.")}>
                <Input
                  value={edmForm.edm_from_name}
                  onChange={e => setEdmForm(f => ({ ...f, edm_from_name: e.target.value }))}
                  placeholder="Acme Inc."
                />
              </Field>
              <Field label={t("From email")} hint={t("Must be a verified sender address with your ESP.")}>
                <Input
                  type="email"
                  value={edmForm.edm_from_email}
                  onChange={e => setEdmForm(f => ({ ...f, edm_from_email: e.target.value }))}
                  placeholder="hello@yourdomain.com"
                />
              </Field>
            </div>
            <Field label={t("Reply-to")} hint={t("Optional. Replies will go to this address instead of the from address.")}>
              <Input
                type="email"
                value={edmForm.edm_reply_to}
                onChange={e => setEdmForm(f => ({ ...f, edm_reply_to: e.target.value }))}
                placeholder="replies@yourdomain.com"
              />
            </Field>
            <Button type="submit" size="sm">
              {t("Save email defaults")}
            </Button>
          </fieldset>
        </form>
      </Section>

    </div>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 max-w-3xl">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-destructive">{t("Danger zone")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("Permanently delete your entire account - every workspace and all of its data, your team members' access, and your own login. This cannot be undone.")}
        </p>
        {!delStatus ? (
          <p className="text-sm text-muted-foreground mt-4">{t("Loading…")}</p>
        ) : !delStatus.is_account_owner ? (
          <p className="text-sm text-muted-foreground mt-4">
            {t("Only the account owner can delete this account.")}
          </p>
        ) : !delStatus.can_self_delete ? (
          <div className="mt-4 space-y-3 max-w-md">
            <p className="text-sm text-muted-foreground">
              {t("Your account has other team members across its workspaces, so deletion has to be handled by our team to protect everyone's access and data.")}
            </p>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={contactSupportToDelete}>
              <Mail className="w-3.5 h-3.5" /> {t("Contact support to delete account")}
            </Button>
          </div>
        ) : !showDelete ? (
          <Button variant="destructive" size="sm" className="mt-4 gap-1.5" onClick={() => setShowDelete(true)}>
            <Trash2 className="w-3.5 h-3.5" /> {t("Delete account")}
          </Button>
        ) : (
          <div className="mt-4 space-y-3 max-w-md">
            <Field label={t("Type your email to confirm")} hint={t("Enter “") + confirmEmail + t("” exactly to enable deletion.")}>
              <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={confirmEmail} autoFocus />
            </Field>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive" size="sm" className="gap-1.5"
                disabled={deleting || confirmText.trim().toLowerCase() !== confirmEmail.toLowerCase()}
                onClick={deleteAccount}
              >
                <Trash2 className="w-3.5 h-3.5" /> {deleting ? t("Deleting…") : t("Permanently delete account")}
              </Button>
              <Button variant="outline" size="sm" disabled={deleting}
                onClick={() => { setShowDelete(false); setConfirmText(""); }}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Invite section - gated by the live plan's team-member limit ──────────────
// The limit comes straight from the plan catalog (planConfig.limits.team_members),
// which a platform admin can change at any time - so this reflects whatever the
// current plan allows, with no hardcoded per-plan rules. null = unlimited.

function InviteSection({ company, invite, inviteEmail, setInviteEmail, inviteRole, setInviteRole, inviting, activeMemberCount = 0 }) {
  const { t } = usePreferences();
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
          ? `${t("Upgrade to")} ${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
          : `${t("Upgrade to")} ${upgradePlan.name}`)
      : t("Upgrade your plan");

    return (
      <Section title={t("Invite member")}>
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-secondary/30">
          <Zap className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {t("You've reached your plan's limit of")} {teamLimit} {teamLimit === 1 ? t("team member") : t("team members")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {upgradeGivesMore
                ? `${t("Upgrade to")} ${upgradePlan.name} ${t("to invite more, or contact support to raise the limit on your")} ${planConfig?.name ?? t("current")} ${t("plan.")}`
                : t("Remove a member to free up a seat, or contact support to raise your team-member limit.")}
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
      title={t("Invite member")}
      description={teamLimit != null
        ? `${activeMemberCount} ${t("of")} ${teamLimit} ${t("seats used on your")} ${planConfig?.name ?? t("current")} ${t("plan.")}`
        : t("Invite teammates to this workspace by email.")}
    >
      <form onSubmit={invite} className="grid grid-cols-[1fr_160px_auto] gap-3 items-end">
        <Field label={t("Email")}>
          <Input
            type="email"
            required
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
          />
        </Field>
        <Field label={t("Role")}>
          <NativeSelect value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
            <option value="viewer">{t("Viewer")}</option>
            <option value="contributor">{t("Contributor")}</option>
            <option value="admin">{t("Admin")}</option>
          </NativeSelect>
        </Field>
        <Button type="submit" size="sm" disabled={inviting} className="gap-1.5 mb-px">
          <Plus className="w-3.5 h-3.5" />
          {inviting ? t("Sending…") : t("Send invite")}
        </Button>
      </form>
    </Section>
  );
}

// ── Tab: Members ──────────────────────────────────────────────────────────────

function MembersTab({ company, currentUserId }) {
  const { t } = usePreferences();
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
      toast.success(`${t("Invitation sent to")} ${inviteEmail}`);
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
      toast.success(t("Role updated"));
    } catch (err) { toast.error(err.message); }
  };

  const removeMember = async (memberId, name) => {
    if (!confirm(`${t("Remove")} ${name} ${t("from this company?")}`)) return;
    try {
      await appClient.companies.removeMember(company.id, memberId);
      await load();
      toast.success(t("Member removed"));
    } catch (err) { toast.error(err.message); }
  };

  const cancelInvite = async (invId, email) => {
    try {
      await appClient.companies.cancelInvitation(company.id, invId);
      await load();
      toast.success(`${t("Invitation to")} ${email} ${t("cancelled")}`);
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <p className="text-sm text-muted-foreground">{t("Loading…")}</p>;

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

      <Section title={t("Team members")} description={`${members.length} ${members.length !== 1 ? t("members") : t("member")} ${t("in this workspace.")}`}>
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_1fr_120px_100px_40px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
            <span />
            <span>{t("Name")}</span>
            <span>{t("Email")}</span>
            <span>{t("Role")}</span>
            <span>{t("Joined")}</span>
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
                      <option value="admin">{t("Admin")}</option>
                      <option value="contributor">{t("Contributor")}</option>
                      <option value="viewer">{t("Viewer")}</option>
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
        <Section title={t("Pending invitations")}>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_160px_80px_40px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>{t("Email")}</span><span>{t("Role")}</span><span>{t("Expires")}</span><span>{t("Status")}</span><span />
            </div>
            <div className="divide-y divide-border">
              {invitations.map(inv => (
                <div key={inv.id} className="grid grid-cols-[1fr_120px_160px_80px_40px] gap-3 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  <p className="text-sm truncate">{inv.email}</p>
                  <RoleBadge role={inv.role} />
                  <p className="text-xs text-muted-foreground">{new Date(inv.expires_at).toLocaleDateString()}</p>
                  <span className="text-xs px-2 py-0.5 bg-secondary text-foreground border border-border rounded-full font-medium w-fit">
                    {t("Pending")}
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
  const { formatDateTime, t } = usePreferences();
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
        <h2 className="font-heading text-lg font-semibold tracking-tight">{t("Audit log")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("Activity history for this workspace.")}</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("Search user or activity…")}
            className="pl-8 h-8 text-sm w-56"
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="h-8 px-2.5 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("All actions")}</option>
          {uniqueActions.map(a => (
            <option key={a} value={a}>{ACTION_META[a]?.label ? t(ACTION_META[a].label) : a.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="h-8 px-2.5 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">{t("All time")}</option>
          <option value="today">{t("Today")}</option>
          <option value="week">{t("Last 7 days")}</option>
          <option value="month">{t("Last 30 days")}</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} {t("of")} {logs.length} {t("entries")}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
          <ClipboardList className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">{logs.length === 0 ? t("No activity yet.") : t("No entries match your filters.")}</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_2fr_180px] gap-4 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
            <span>{t("User")}</span>
            <span>{t("Activity")}</span>
            <span>{t("Date & Time")}</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map(l => {
              const desc = formatAuditAction(l.action, l.resource_type);
              const actor = l.user_email || t("System");
              return (
                <div key={l.id} className="grid grid-cols-[1fr_2fr_180px] gap-4 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  <p className="text-sm font-medium truncate">{actor}</p>
                  <p className="text-sm text-muted-foreground">{t(desc)}</p>
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
  const { t } = usePreferences();
  const pct = (!unlimited && limit > 0) ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const danger = pct >= 90;
  const warn   = pct >= 70;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">
          {used.toLocaleString()} / {unlimited ? t("Unlimited") : limit?.toLocaleString() ?? "-"}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              danger ? "bg-destructive" : warn ? "bg-yellow-500" : "bg-foreground"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {!unlimited && warn && !danger && (
        <p className="text-[10px] text-yellow-700 font-medium">{t("Approaching plan limit")}</p>
      )}
    </div>
  );
}

// Plan cards show the quantitative bullets DERIVED from the structured `limits`
// (the source of truth that admins edit in Studio), so they always match the plan
// and update live when limits change. The free-text `features` array is then used
// only for qualitative perks, with any limit restatements filtered out so the two
// can't contradict each other.
const num = (n) => Number(n).toLocaleString();
const PLAN_LIMIT_BULLETS = [
  ["workspaces",   (n) => n == null ? "5+ workspaces"               : `${num(n)} workspace${n === 1 ? "" : "s"}`],
  ["team_members", (n) => n == null ? "Unlimited team members"      : `${num(n)} team member${n === 1 ? "" : "s"}`],
  ["profiles",     (n) => n == null ? "Unlimited customer profiles" : `${num(n)} customer profiles`],
  ["campaigns",    (n) => n == null ? "Unlimited email campaigns"   : `${num(n)} email campaigns`],
  ["ai_tokens",    (n) => n == null ? "Custom credits"              : `${num(toCredits(n))} credits`],
];
const LIMIT_WORDS = ["workspace", "profile", "campaign", "token", "member", "credit"];
function planLimitBullets(limits) {
  const l = limits || {};
  return PLAN_LIMIT_BULLETS.filter(([k]) => k in l).map(([k, fmt]) => fmt(l[k] ?? null));
}
function qualitativeFeatures(features) {
  return (features || []).filter(f => f && !LIMIT_WORDS.some(w => String(f).toLowerCase().includes(w)));
}

function BillingTab({ company }) {
  const { t } = usePreferences();
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
    ? <span className={badgeClass}>{t("Trial expired")}</span>
    : isFreePlan
      ? <span className={badgeClass}>{daysLeft}{t("d left in trial")}</span>
      : <span className={badgeClass}>{t("Active")}</span>;

  // Free upgrades go through sales; surface the paid plan's contact link directly.
  const isContactSales = upgradePlan?.cta_external;

  const usageItems = [
    { key: "team_members", label: t("Team members"),      limitKey: "team_members" },
    { key: "campaigns",    label: t("Email campaigns"),   limitKey: "campaigns"    },
    { key: "ai_tokens",    label: t("AI credits (this period)"), limitKey: "ai_tokens", divisor: TOKENS_PER_CREDIT, usageKey: "ai_tokens_month" },
    { key: "profiles",     label: t("Customer profiles"), limitKey: "profiles"     },
  ];

  return (
    <div className="space-y-8">

      {/* Current plan */}
      <Section title={t("Current plan")} description={t("Your active plan and trial status.")}>
        <div className="border border-border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-base">{planConfig?.name ?? "Lite"}</p>
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
                {isContactSales ? t("Contact sales to upgrade") : `${t("Upgrade to")} ${upgradePlan.name}`}
              </a>
            )}
          </div>
          {planConfig?.description && <p className="text-sm text-muted-foreground">{planConfig.description}</p>}
          {isPaidPlan ? (
            <p className="text-sm font-medium">
              {t("Upgraded on")}{" "}
              <span className="text-muted-foreground font-normal">
                {upgradedAt ? upgradedAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "-"}
              </span>
            </p>
          ) : planConfig?.price_display && (
            <p className="text-sm font-medium">
              {planConfig.price_display}
              {planConfig.period && <span className="text-muted-foreground font-normal">{planConfig.period}</span>}
            </p>
          )}
        </div>
      </Section>

      {/* Detailed usage */}
      <Section title={t("Usage this period")} description={t("Account-wide totals tracked against your plan limits.")}>
        {usageLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {usageItems.map(({ key, label, limitKey, divisor, usageKey }) => {
              const rawLimit = limits[limitKey];
              const d = divisor || 1;
              const unlimited = rawLimit === null || rawLimit === undefined;
              return (
                <div key={key} className="border border-border rounded-lg px-5 py-4">
                  <UsageBar
                    label={label}
                    used={Math.round((usage?.[usageKey || key] ?? 0) / d)}
                    limit={unlimited ? rawLimit : Math.round(rawLimit / d)}
                    unlimited={unlimited}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* AI usage */}
      <Section title={t("AI usage")} description={t("Total AI credits consumed across all your workspaces.")}>
        {usageLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-20 bg-secondary animate-pulse rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: t("Total credits"), value: num(toCredits(usage?.overall?.ai_tokens ?? usage?.ai_tokens ?? 0)) },
              { label: t("Input credits"), value: num(toCredits(usage?.overall?.ai_input_tokens ?? 0)) },
              { label: t("Output credits"),value: num(toCredits(usage?.overall?.ai_output_tokens ?? 0)) },
            ].map(({ label, value }) => (
              <div key={label} className="border border-border rounded-lg px-5 py-4">
                <p className="text-xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Usage by workspace */}
      {usage?.workspaces?.length > 0 && (
        <Section title={t("Usage by workspace")} description={t("How the account total breaks down across your workspaces.")}>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">{t("Workspace")}</th>
                  <th className="text-right font-medium px-4 py-2.5">{t("Members")}</th>
                  <th className="text-right font-medium px-4 py-2.5">{t("Profiles")}</th>
                  <th className="text-right font-medium px-4 py-2.5">{t("Campaigns")}</th>
                  <th className="text-right font-medium px-4 py-2.5">{t("AI credits")}</th>
                </tr>
              </thead>
              <tbody>
                {usage.workspaces.map((w) => (
                  <tr key={w.id} className={`border-t border-border ${w.id === company?.id ? "bg-secondary/20" : ""}`}>
                    <td className="px-4 py-2.5 font-medium">
                      {w.name}
                      {w.id === company?.id && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("(current)")}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.team_members.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.profiles.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{w.campaigns.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{toCredits(w.ai_tokens).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  <td className="px-4 py-2.5">{t("Account total")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.team_members ?? usage.team_members ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.profiles ?? usage.profiles ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(usage.overall?.campaigns ?? usage.campaigns ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{toCredits(usage.overall?.ai_tokens ?? usage.ai_tokens ?? 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      )}

      {/* All plans */}
      <Section title={t("All plans")} description={t("Compare plans and upgrade at any time.")}>
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t("Current")}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                <p className="text-xl font-bold mt-3">
                  {p.price_display}
                  {p.period && <span className="text-xs font-normal text-muted-foreground"> / {p.period}</span>}
                </p>
              </div>
              <ul className="space-y-1.5">
                {/* Quantitative bullets derived from limits (always in sync), then
                    qualitative perks from the free-text features. */}
                {[...planLimitBullets(p.limits), ...qualitativeFeatures(p.features)].map((f, i) => (
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
  const { t } = usePreferences();
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
      toast.success(t("Ticket submitted - we'll be in touch soon."));
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
      <Section title={t("Submit feedback or raise a ticket")} description={t("We read every submission and aim to respond within 1 business day.")}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("Type")}>
              <NativeSelect value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TICKET_TYPES.map(opt => <option key={opt.value} value={opt.value}>{t(opt.label)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("Priority")}>
              <NativeSelect value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {TICKET_PRIORITIES.map(p => <option key={p.value} value={p.value}>{t(p.label)}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label={t("Subject")}>
            <Input
              required
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder={t("Brief summary of your issue or idea")}
            />
          </Field>
          <Field label={t("Details")}>
            <Textarea
              required
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder={t("Describe your feedback, the steps to reproduce a bug, or what you'd like to see...")}
              rows={6}
              className="resize-none"
            />
          </Field>
          <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" />
            {submitting ? t("Submitting…") : t("Submit")}
          </Button>
        </form>
      </Section>

      <div className="space-y-4">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">{t("Your submissions")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("Tickets and feedback you've previously raised.")}</p>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-secondary animate-pulse rounded-lg" />)}
          </div>
        ) : tickets.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
            <MessageCircle className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">{t("No submissions yet.")}</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {tickets.map(ticket => (
              <div key={ticket.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ticket.subject}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ticket.body}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="capitalize">{TICKET_TYPES.find(x => x.value === ticket.type)?.label ? t(TICKET_TYPES.find(x => x.value === ticket.type).label) : ticket.type}</span>
                    <span>·</span>
                    <span>{new Date(ticket.created_date).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0 pt-0.5">
                  {ticketStatusLabel[ticket.status] ? t(ticketStatusLabel[ticket.status]) : ticket.status}
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
          {t("Manage your account, workspace and preferences.")}
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
