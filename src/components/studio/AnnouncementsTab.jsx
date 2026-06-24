import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, Pencil } from "lucide-react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtRelative } from "./helpers.jsx";

const LEVELS = [
  { id: "info",        label: "Info" },
  { id: "success",     label: "Success" },
  { id: "warning",     label: "Warning" },
  { id: "maintenance", label: "Maintenance" },
];

const levelStyle = {
  info:        "bg-secondary text-muted-foreground",
  success:     "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  warning:     "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  maintenance: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
};

const EMPTY = {
  level: "info", title: "", body: "",
  link_url: "", link_label: "",
  is_active: true, dismissible: true,
  starts_at: "", ends_at: "",
};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm"; the API returns ISO.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// datetime-local has no timezone; treat it as local and send a full ISO string.
function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

function AnnouncementForm({ initial, onCancel, onSubmit, saving }) {
  const [f, setF] = useState(initial || EMPTY);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    if (!f.body.trim()) { toast.error("Message body is required"); return; }
    onSubmit({
      level: f.level,
      title: f.title.trim() || null,
      body: f.body.trim(),
      link_url: f.link_url.trim() || null,
      link_label: f.link_label.trim() || null,
      is_active: f.is_active,
      dismissible: f.dismissible,
      starts_at: fromLocalInput(f.starts_at),
      ends_at: fromLocalInput(f.ends_at),
    });
  };

  return (
    <form onSubmit={submit} className="border border-border rounded-lg p-4 space-y-4 bg-secondary/20">
      <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Level</label>
          <select value={f.level} onChange={(e) => set("level", e.target.value)}
            className="mt-1 w-full h-9 px-3 border border-input rounded-md bg-background text-sm">
            {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Title <span className="opacity-60">(optional)</span></label>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)}
            placeholder="Scheduled maintenance" className="mt-1 h-9" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Message</label>
        <Textarea value={f.body} onChange={(e) => set("body", e.target.value)}
          placeholder="We'll be performing maintenance on Sunday 2am-4am UTC. The app may be briefly unavailable."
          className="mt-1 min-h-[72px]" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Link URL <span className="opacity-60">(optional)</span></label>
          <Input value={f.link_url} onChange={(e) => set("link_url", e.target.value)}
            placeholder="https://status.example.com" className="mt-1 h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Link label</label>
          <Input value={f.link_label} onChange={(e) => set("link_label", e.target.value)}
            placeholder="Status page" className="mt-1 h-9" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Show from <span className="opacity-60">(optional)</span></label>
          <Input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} className="mt-1 h-9" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Hide after <span className="opacity-60">(optional)</span></label>
          <Input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} className="mt-1 h-9" />
        </div>
      </div>

      <div className="flex items-center gap-5 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} className="accent-foreground" />
          Active (visible to users)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={f.dismissible} onChange={(e) => set("dismissible", e.target.checked)} className="accent-foreground" />
          Users can dismiss
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save announcement"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export default function AnnouncementsTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => appClient.announcements.list(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    qc.invalidateQueries({ queryKey: ["announcements", "active"] }); // refresh live banner
  };

  const create = useMutation({
    mutationFn: (data) => appClient.announcements.create(data),
    onSuccess: () => { toast.success("Announcement published"); setCreating(false); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to create"),
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }) => appClient.announcements.update(id, data),
    onSuccess: () => { toast.success("Announcement updated"); setEditingId(null); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to update"),
  });
  const remove = useMutation({
    mutationFn: (id) => appClient.announcements.remove(id),
    onSuccess: () => { toast.success("Announcement deleted"); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to delete"),
  });

  // An announcement is "live now" if active and within its time window.
  const isLive = (a) => {
    if (!a.is_active) return false;
    const now = Date.now();
    if (a.starts_at && new Date(a.starts_at).getTime() > now) return false;
    if (a.ends_at && new Date(a.ends_at).getTime() < now) return false;
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          App-wide banners shown to <strong>every user</strong> across all clients - maintenance notices, incident updates, announcements.
        </p>
        {!creating && (
          <Button size="sm" onClick={() => { setCreating(true); setEditingId(null); }}>
            <Plus className="w-4 h-4" /> New announcement
          </Button>
        )}
      </div>

      {creating && (
        <AnnouncementForm
          onCancel={() => setCreating(false)}
          onSubmit={(data) => create.mutate(data)}
          saving={create.isPending}
        />
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !items?.length && !creating ? (
        <div className="border border-border rounded-lg px-4 py-10 text-center text-muted-foreground">
          <Megaphone className="w-6 h-6 mx-auto mb-2 opacity-60" />
          <p className="text-sm">No announcements yet. Create one to broadcast a banner to all users.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(items || []).map((a) => (
            editingId === a.id ? (
              <AnnouncementForm
                key={a.id}
                initial={{
                  level: a.level, title: a.title || "", body: a.body,
                  link_url: a.link_url || "", link_label: a.link_label || "",
                  is_active: a.is_active, dismissible: a.dismissible,
                  starts_at: toLocalInput(a.starts_at), ends_at: toLocalInput(a.ends_at),
                }}
                onCancel={() => setEditingId(null)}
                onSubmit={(data) => update.mutate({ id: a.id, ...data })}
                saving={update.isPending}
              />
            ) : (
              <div key={a.id} className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${levelStyle[a.level] || ""}`}>
                        {a.level}
                      </span>
                      {isLive(a) ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-foreground text-background">Live</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground">
                          {a.is_active ? "Scheduled / expired" : "Disabled"}
                        </span>
                      )}
                      {!a.dismissible && <span className="text-xs text-muted-foreground">non-dismissible</span>}
                    </div>
                    <p className="mt-1.5">
                      {a.title && <span className="font-semibold">{a.title} </span>}
                      {a.body}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm"
                      onClick={() => update.mutate({ id: a.id, is_active: !a.is_active })}
                      disabled={update.isPending}>
                      {a.is_active ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8"
                      onClick={() => { setEditingId(a.id); setCreating(false); }} aria-label="Edit">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Delete this announcement?")) remove.mutate(a.id); }}
                      aria-label="Delete">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground pt-1 border-t border-border flex flex-wrap gap-x-3 gap-y-1">
                  {a.link_url && <span>Link: {a.link_label || a.link_url}</span>}
                  {a.starts_at && <span>From {fmtRelative(a.starts_at)}</span>}
                  {a.ends_at && <span>Until {fmtRelative(a.ends_at)}</span>}
                  <span>Created {fmtRelative(a.created_at)}</span>
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
