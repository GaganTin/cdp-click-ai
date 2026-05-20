import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePlan } from "@/lib/usePlan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  User, Lock, Bell, Building2, Users, Key, ClipboardList,
  Trash2, Plus, Copy, Check, Shield, Eye, EyeOff, AlertTriangle, Zap,
  CreditCard, BarChart2, MessageCircle, CheckCircle2, Clock, XCircle,
  ExternalLink, ChevronRight, Mail, Globe, Briefcase,
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

function Badge({ role }) {
  const styles = {
    owner: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    editor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    viewer: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[role] || styles.viewer}`}>
      {role}
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
          <Field label="Avatar URL" hint="Link to a profile photo.">
            <Input
              name="avatar_url"
              value={form.avatar_url}
              onChange={e => setForm(f => ({ ...f, avatar_url: e.target.value }))}
              placeholder="https://..."
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

// ── Tab: Preferences ─────────────────────────────────────────────────────────

function PreferencesTab({ companyId }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    appClient.companies.getPreferences(companyId).then(setPrefs).catch(() => {});
  }, [companyId]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await appClient.companies.updatePreferences(companyId, prefs);
      toast.success("Preferences saved");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
      <Section title="Preferences" description="Customize your workspace display and notification settings.">
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Theme">
              <NativeSelect value={prefs.theme || "system"} onChange={e => setPrefs(p => ({ ...p, theme: e.target.value }))}>
                <option value="system">System default</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </NativeSelect>
            </Field>
            <Field label="Language">
              <NativeSelect value={prefs.language || "en"} onChange={e => setPrefs(p => ({ ...p, language: e.target.value }))}>
                <option value="en">English</option>
                <option value="zh">Chinese (Traditional)</option>
                <option value="zh-cn">Chinese (Simplified)</option>
              </NativeSelect>
            </Field>
            <Field label="Timezone">
              <NativeSelect value={prefs.timezone || "UTC"} onChange={e => setPrefs(p => ({ ...p, timezone: e.target.value }))}>
                {Intl.supportedValuesOf?.("timeZone")?.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                )) || <option value="UTC">UTC</option>}
              </NativeSelect>
            </Field>
            <Field label="Date format">
              <NativeSelect value={prefs.date_format || "MMM d, yyyy"} onChange={e => setPrefs(p => ({ ...p, date_format: e.target.value }))}>
                <option value="MMM d, yyyy">Jan 15, 2025</option>
                <option value="dd/MM/yyyy">15/01/2025</option>
                <option value="MM/dd/yyyy">01/15/2025</option>
                <option value="yyyy-MM-dd">2025-01-15</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Notifications</label>
            {[
              { key: "email_digest",  label: "Email digest" },
              { key: "member_joined", label: "When a member joins" },
              { key: "report_ready",  label: "When a report is ready" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-border"
                  checked={prefs.notifications?.[key] !== false}
                  onChange={e => setPrefs(p => ({
                    ...p,
                    notifications: { ...(p.notifications || {}), [key]: e.target.checked },
                  }))}
                />
                {label}
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
            Display preferences apply to this workspace. Notification settings control what emails you receive.
          </p>
        </div>
        <div className="pt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-xs">Current settings</p>
          <div className="flex justify-between"><span>Theme</span><span className="capitalize">{prefs.theme || "System"}</span></div>
          <div className="flex justify-between"><span>Language</span><span>{prefs.language || "English"}</span></div>
          <div className="flex justify-between"><span>Timezone</span><span className="truncate ml-2 text-right">{prefs.timezone || "UTC"}</span></div>
        </div>
      </SideCard>
    </div>
  );
}

// ── Tab: Company ──────────────────────────────────────────────────────────────

function CompanyTab({ company, onRefresh }) {
  const [form, setForm] = useState({
    name: company?.name || "",
    website: company?.website || "",
    industry: company?.industry || "",
    company_size: company?.company_size || "",
    logo_url: company?.logo_url || "",
  });
  const [saving, setSaving] = useState(false);

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
          <Field label="Logo URL">
            <Input type="url" value={form.logo_url} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} placeholder="https://..." />
          </Field>
          <Field label="Plan" hint="Contact support to change your plan.">
            <Input value={company?.plan || "free"} disabled className="opacity-60 cursor-not-allowed capitalize" />
          </Field>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
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

// ── Invite section - gated by plan ───────────────────────────────────────────

function InviteSection({ company, invite, inviteEmail, setInviteEmail, inviteRole, setInviteRole, inviting }) {
  const { isFreePlan, upgradePlan, planConfig } = usePlan();

  if (isFreePlan) {
    const upgradeLabel = upgradePlan
      ? `Upgrade to ${upgradePlan.name} - ${upgradePlan.price_display}/${upgradePlan.period}`
      : "Upgrade your plan";
    const teamLimit = upgradePlan?.limits?.team_members;
    const teamLimitText = teamLimit ? `up to ${teamLimit} team members` : "team members";

    return (
      <Section title="Invite member">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-secondary/30">
          <Zap className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Team members require {upgradePlan?.name ?? "a paid plan"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The {planConfig?.name ?? "Free"} plan is for solo users only. Upgrade to invite {teamLimitText}.
            </p>
            <Link
              to="/settings?tab=billing"
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:bg-primary/90 transition-colors"
            >
              <Zap className="w-3 h-3" />
              {upgradeLabel}
            </Link>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Invite member">
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
            <option value="editor">Editor</option>
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
                  {m.role !== "owner" && m.user_id !== currentUserId ? (
                    <select
                      value={m.role}
                      onChange={e => updateRole(m.id, e.target.value)}
                      className="text-xs border border-border rounded px-1.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring w-full"
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <Badge role={m.role} />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "-"}</p>
                <div className="flex justify-center">
                  {m.role !== "owner" && m.user_id !== currentUserId && (
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
                  <Badge role={inv.role} />
                  <p className="text-xs text-muted-foreground">{new Date(inv.expires_at).toLocaleDateString()}</p>
                  <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-full font-medium w-fit">
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

// ── Tab: API Keys ─────────────────────────────────────────────────────────────

function ApiKeysTab({ company }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", permissions: ["read"] });
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const data = await appClient.companies.getApiKeys(company.id);
      setKeys(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, [company.id]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await appClient.companies.createApiKey(company.id, form);
      setNewKey(result.raw_key);
      setForm({ name: "", permissions: ["read"] });
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (keyId) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      await appClient.companies.revokeApiKey(company.id, keyId);
      await load();
      toast.success("API key revoked");
    } catch (err) { toast.error(err.message); }
  };

  const copy = async (text) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePerm = (perm) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm],
    }));
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      {newKey && (
        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">
            <AlertTriangle className="w-4 h-4" />
            Copy this key now - it won&apos;t be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background border border-border rounded px-3 py-2 font-mono break-all">
              {newKey}
            </code>
            <button onClick={() => copy(newKey)} className="p-2 hover:bg-secondary rounded transition-colors flex-shrink-0">
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            I&apos;ve copied it
          </button>
        </div>
      )}

      <Section title="Create API key" description="Generate a key to authenticate API requests from your applications.">
        <form onSubmit={create} className="grid grid-cols-[1fr_auto] gap-4 items-end">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Key name" hint="Describe what this key is used for.">
              <Input
                required
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. CI/CD Pipeline"
              />
            </Field>
            <Field label="Permissions">
              <div className="h-9 flex items-center gap-4">
                {["read", "write", "admin"].map(perm => (
                  <label key={perm} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={form.permissions.includes(perm)}
                      onChange={() => togglePerm(perm)}
                    />
                    <span className="capitalize">{perm}</span>
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={creating || form.permissions.length === 0} className="gap-1.5 mb-px">
            <Plus className="w-3.5 h-3.5" />
            {creating ? "Creating…" : "Create key"}
          </Button>
        </form>
      </Section>

      <Section title="Active keys">
        {keys.filter(k => k.is_active).length === 0 ? (
          <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
            <Key className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No active API keys yet.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_160px_120px_80px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span><span>Prefix</span><span>Permissions</span><span>Created</span><span />
            </div>
            <div className="divide-y divide-border">
              {keys.filter(k => k.is_active).map(k => (
                <div key={k.id} className="grid grid-cols-[1fr_120px_160px_120px_80px] gap-3 px-4 py-3 items-center hover:bg-secondary/20 transition-colors">
                  <p className="text-sm font-medium">{k.name}</p>
                  <code className="text-xs font-mono text-muted-foreground">{k.key_prefix}…</code>
                  <p className="text-xs text-muted-foreground">{k.permissions?.join(", ")}</p>
                  <p className="text-xs text-muted-foreground">{new Date(k.created_date).toLocaleDateString()}</p>
                  <button
                    onClick={() => revoke(k.id)}
                    className="text-xs px-2.5 py-1 text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Tab: Audit Log ────────────────────────────────────────────────────────────

function AuditLogTab({ company }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    appClient.companies.getAuditLog(company.id, 200)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [company.id]);

  const actionColor = {
    login: "text-green-600 dark:text-green-400",
    logout: "text-muted-foreground",
    register: "text-blue-600 dark:text-blue-400",
    create: "text-blue-500",
    update: "text-yellow-600 dark:text-yellow-400",
    delete: "text-red-500",
    invite_member: "text-purple-600 dark:text-purple-400",
    remove_member: "text-red-600",
    password_changed: "text-orange-600 dark:text-orange-400",
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Section title="Audit log" description={`A record of all actions taken in this workspace. Showing last ${logs.length} entries.`}>
      {logs.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
          <ClipboardList className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[160px_120px_1fr_1fr_120px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
            <span>Time</span><span>Action</span><span>User</span><span>Resource</span><span>IP Address</span>
          </div>
          <div className="divide-y divide-border">
            {logs.map(l => (
              <div key={l.id} className="grid grid-cols-[160px_120px_1fr_1fr_120px] gap-3 px-4 py-2.5 text-xs hover:bg-secondary/30 transition-colors">
                <span className="text-muted-foreground">
                  {new Date(l.occurred_at).toLocaleString()}
                </span>
                <span className={`font-mono ${actionColor[l.action] || "text-foreground"}`}>
                  {l.action}
                </span>
                <span className="truncate text-muted-foreground">{l.user_email || l.user_id || "-"}</span>
                <span className="truncate font-mono">
                  {l.resource_type}{l.resource_id ? ` ${l.resource_id.slice(0, 8)}` : ""}
                </span>
                <span className="text-muted-foreground font-mono">{l.ip_address || "-"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
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
              danger ? "bg-destructive" : warn ? "bg-yellow-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BillingTab({ company }) {
  const { planConfig, upgradePlan, isFreePlan, isTrialExpired, daysLeft, plans } = usePlan();

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ["billing-usage", company?.id],
    queryFn: appClient.billing.getUsage,
    enabled: !!company?.id,
    staleTime: 60_000,
  });

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ["billing-invoices", company?.id],
    queryFn: appClient.billing.getInvoices,
    enabled: !!company?.id,
    staleTime: 60_000,
  });

  const limits = planConfig?.limits ?? {};

  const statusBadge = isTrialExpired
    ? <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">Trial expired</span>
    : isFreePlan
      ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 font-medium">{daysLeft}d left in trial</span>
      : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-medium">Active</span>;

  const invoiceStatusColor = {
    paid:     "text-green-600 dark:text-green-400",
    pending:  "text-yellow-600 dark:text-yellow-400",
    failed:   "text-destructive",
    refunded: "text-muted-foreground",
  };

  const usageItems = [
    { key: "team_members", label: "Team members",      limitKey: "team_members" },
    { key: "campaigns",    label: "Email campaigns",   limitKey: "campaigns"    },
    { key: "ai_tokens",    label: "AI tokens",         limitKey: "ai_tokens"    },
    { key: "profiles",     label: "Customer profiles", limitKey: "profiles"     },
  ];

  return (
    <div className="space-y-8">

      {/* Current plan + upgrade */}
      <div className="grid grid-cols-[1fr_280px] gap-6 items-start">
        <Section title="Current plan" description="Your active subscription and trial status.">
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
                <Link
                  to="/settings?tab=billing"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-md hover:bg-primary/90 transition-colors"
                >
                  <Zap className="w-3 h-3" />
                  Upgrade to {upgradePlan.name}
                </Link>
              )}
            </div>
            {planConfig?.description && <p className="text-sm text-muted-foreground">{planConfig.description}</p>}
            {planConfig?.price_display && (
              <p className="text-sm font-medium">
                {planConfig.price_display}
                {planConfig.period && <span className="text-muted-foreground font-normal"> / {planConfig.period}</span>}
              </p>
            )}
          </div>
        </Section>

        {/* Usage summary */}
        <div className="mt-[52px] border border-border rounded-lg p-5 space-y-4">
          <p className="text-sm font-medium">Quick usage summary</p>
          {usageLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-5 bg-secondary animate-pulse rounded" />)}</div>
          ) : (
            <div className="space-y-3">
              {usageItems.map(({ key, label, limitKey }) => {
                const limit = limits[limitKey];
                const used = usage?.[key] ?? 0;
                const unlimited = limit === null || limit === undefined;
                const pct = (!unlimited && limit > 0) ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={pct >= 90 ? "text-destructive font-medium" : "font-medium"}>
                        {used.toLocaleString()}{!unlimited && ` / ${limit?.toLocaleString()}`}
                      </span>
                    </div>
                    {!unlimited && (
                      <div className="h-1 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detailed usage */}
      <Section title="Usage this period" description="Full breakdown tracked against your plan limits.">
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

      {/* All plans */}
      <Section title="All plans" description="Compare plans and upgrade at any time.">
        <div className="grid grid-cols-3 gap-4">
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

      {/* Invoice history */}
      <Section title="Billing history" description="Past invoices for this workspace.">
        {invoicesLoading ? (
          <div className="h-20 bg-secondary animate-pulse rounded-lg" />
        ) : invoices.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg px-6 py-8 text-center">
            <CreditCard className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_140px_100px_80px] gap-3 px-4 py-2.5 bg-secondary/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Description</span><span>Amount</span><span>Date</span><span>Period</span><span>Status</span>
            </div>
            <div className="divide-y divide-border">
              {invoices.map(inv => (
                <div key={inv.id} className="grid grid-cols-[1fr_100px_140px_100px_80px] gap-3 px-4 py-3 text-sm items-center hover:bg-secondary/30 transition-colors">
                  <span className="truncate">{inv.description || "Subscription"}</span>
                  <span className="font-medium">{inv.currency} {Number(inv.amount).toFixed(2)}</span>
                  <span className="text-muted-foreground text-xs">{new Date(inv.invoice_date).toLocaleDateString()}</span>
                  <span className="text-muted-foreground text-xs">
                    {inv.period_start ? new Date(inv.period_start).toLocaleDateString() : "-"}
                  </span>
                  <span className={`text-xs capitalize font-medium ${invoiceStatusColor[inv.status] || ""}`}>{inv.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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

const ticketStatusIcon = {
  open:        <Clock className="w-3.5 h-3.5 text-yellow-500" />,
  in_progress: <BarChart2 className="w-3.5 h-3.5 text-blue-500" />,
  resolved:    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  closed:      <XCircle className="w-3.5 h-3.5 text-muted-foreground" />,
};

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
                <div className="mt-0.5 flex-shrink-0">{ticketStatusIcon[t.status] ?? ticketStatusIcon.open}</div>
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
  { id: "profile",     label: "Profile",      icon: User },
  { id: "security",    label: "Security",     icon: Lock },
  { id: "preferences", label: "Preferences",  icon: Bell },
  { id: "billing",     label: "Billing",      icon: CreditCard },
  { id: "company",     label: "Company",      icon: Building2,     adminOnly: true },
  { id: "members",     label: "Members",      icon: Users,         adminOnly: true },
  { id: "api-keys",    label: "API Keys",     icon: Key,           adminOnly: true },
  { id: "audit-log",   label: "Audit Log",    icon: ClipboardList, adminOnly: true },
  { id: "support",     label: "Support",      icon: MessageCircle },
];

export default function Settings() {
  const { user, currentCompany, refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "profile";

  const role = user?.companies?.find(c => c.id === currentCompany?.id)?.role;
  const isAdmin = ["owner", "admin"].includes(role);

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);
  const setTab = (id) => setSearchParams({ tab: id });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-8 pt-8 pb-6 flex-shrink-0 border-b border-border">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage your account, workspace and preferences.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 flex-shrink-0 border-r border-border px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                activeTab === t.id
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              }`}
            >
              <t.icon className="w-4 h-4 flex-shrink-0" />
              {t.label}
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
          {activeTab === "preferences" && <PreferencesTab companyId={currentCompany?.id} />}
          {activeTab === "company"     && isAdmin && <CompanyTab company={currentCompany} onRefresh={refreshUser} />}
          {activeTab === "members"     && isAdmin && <MembersTab company={currentCompany} currentUserId={user?.id} />}
          {activeTab === "api-keys"    && isAdmin && <ApiKeysTab company={currentCompany} />}
          {activeTab === "audit-log"   && isAdmin && <AuditLogTab company={currentCompany} />}
          {activeTab === "billing"     && <BillingTab company={currentCompany} />}
          {activeTab === "support"     && <SupportTab />}
        </main>
      </div>
    </div>
  );
}
