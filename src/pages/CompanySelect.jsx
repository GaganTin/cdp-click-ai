import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { Building2, Plus, LogOut, Home, PenLine, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function CompanySelect() {
  const navigate = useNavigate();
  const { user, currentCompany, switchCompany, logout, refreshUser } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Per-workspace admin actions (rename inline / delete with type-to-confirm).
  const [editId, setEditId] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const companies = user?.companies || [];

  const selectCompany = (company) => {
    switchCompany(company);
    navigate("/");
  };

  const startRename = (c) => { setDeleteId(null); setRenameVal(c.name); setEditId(c.id); };
  const saveRename = async (c) => {
    const name = renameVal.trim();
    if (!name || name === c.name) { setEditId(null); return; }
    setBusy(true);
    try {
      await appClient.companies.update(c.id, { name });
      await refreshUser();
      toast.success("Workspace renamed");
      setEditId(null);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const startDelete = (c) => { setEditId(null); setConfirmName(""); setDeleteId(c.id); };
  const confirmDelete = async (c) => {
    setBusy(true);
    try {
      await appClient.companies.delete(c.id, confirmName.trim());
      // If we just deleted the active workspace, move to another (or clear it).
      if (c.id === currentCompany?.id) {
        const next = companies.find(x => x.id !== c.id);
        if (next) switchCompany(next);
        else localStorage.removeItem("cdp_company_id");
      }
      await refreshUser();
      toast.success("Workspace deleted");
      setDeleteId(null); setConfirmName("");
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const createCompany = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await appClient.companies.create({ name: newName.trim() });
      await refreshUser();
      setShowCreate(false);
      setNewName("");
      toast.success("Company created");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Select a workspace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as <span className="font-medium text-foreground">{user?.email}</span>
          </p>
        </div>

        <div className="space-y-2 mb-4">
          {companies.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              You don&apos;t belong to any company yet.
            </p>
          )}
          {companies.map((c) => {
            const isAdmin = c.role === "admin";

            // Inline rename
            if (editId === c.id) {
              return (
                <div key={c.id} className="flex items-center gap-2 p-4 border border-border rounded-lg">
                  <form onSubmit={(e) => { e.preventDefault(); saveRename(c); }} className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      autoFocus type="text" value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="submit" disabled={busy} title="Save"
                      className="p-2 rounded-md hover:bg-secondary text-foreground disabled:opacity-50"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setEditId(null)} title="Cancel"
                      className="p-2 rounded-md hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
                  </form>
                </div>
              );
            }

            // Delete with type-to-confirm
            if (deleteId === c.id) {
              return (
                <div key={c.id} className="p-4 border border-destructive/40 bg-destructive/5 rounded-lg space-y-2">
                  <p className="text-xs text-muted-foreground">
                    This permanently deletes <span className="font-medium text-foreground">{c.name}</span> and all of its data. Type the name to confirm.
                  </p>
                  <form onSubmit={(e) => { e.preventDefault(); if (confirmName.trim() === c.name) confirmDelete(c); }} className="flex items-center gap-2">
                    <input
                      autoFocus type="text" value={confirmName} placeholder={c.name}
                      onChange={e => setConfirmName(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button type="submit" disabled={busy || confirmName.trim() !== c.name} title="Delete"
                      className="px-3 py-2 rounded-md bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
                      <Trash2 className="w-3.5 h-3.5" /> {busy ? "Deleting…" : "Delete"}
                    </button>
                    <button type="button" onClick={() => { setDeleteId(null); setConfirmName(""); }} title="Cancel"
                      className="p-2 rounded-md hover:bg-secondary text-muted-foreground"><X className="w-4 h-4" /></button>
                  </form>
                </div>
              );
            }

            // Normal row: select + (admin only) rename / delete actions
            return (
              <div key={c.id} className="flex items-center gap-1 border border-border rounded-lg hover:bg-secondary transition-colors">
                <button
                  onClick={() => selectCompany(c)}
                  className="flex items-center gap-3 p-4 flex-1 min-w-0 text-left"
                >
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{c.role} · {c.plan}</p>
                  </div>
                </button>
                {isAdmin && (
                  <div className="flex items-center gap-0.5 pr-2 flex-shrink-0">
                    <button onClick={() => startRename(c)} title="Rename workspace"
                      className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background"><PenLine className="w-3.5 h-3.5" /></button>
                    <button onClick={() => startDelete(c)} title="Delete workspace"
                      className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-background"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showCreate ? (
          <form onSubmit={createCompany} className="border border-border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium">New company</p>
            <input
              autoFocus
              type="text"
              required
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Company name"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="flex-1 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {creating ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2 border border-border text-sm rounded-md hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full flex items-center gap-2 justify-center p-3 border border-dashed border-border rounded-lg hover:bg-secondary transition-colors text-sm text-muted-foreground"
          >
            <Plus className="w-4 h-4" />
            Create a new company
          </button>
        )}

        <div className="flex items-center justify-between mt-4">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            Back to home
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
